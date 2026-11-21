"""Tests for affected_lambdas.py, run against the real src/backend/handlers.

    python -m pytest .github/scripts -q
"""

from pathlib import Path

import affected_lambdas as al

BACKEND = Path(__file__).resolve().parents[2] / "src" / "backend"
GRAPH, FUNCTIONS = al.load_graph(BACKEND / "handlers")
ALL = ["battery", "connectivity", "ingest", "presence", "processor", "query"]


def run(*paths: str) -> list[str]:
    return al.affected(list(paths), Path("src/backend"), GRAPH, FUNCTIONS)


def test_finds_every_function():
    assert FUNCTIONS == ALL


def test_handler_module_affects_only_its_function():
    assert run("src/backend/handlers/battery.py") == ["battery"]
    assert run("src/backend/handlers/query.py") == ["query"]


def test_shared_modules_follow_imports():
    assert run("src/backend/handlers/event_validation.py") == ["battery", "connectivity"]
    assert run("src/backend/handlers/event_common.py") == ["battery", "connectivity", "presence", "processor"]
    # validation is imported (directly or through rules / event_*) by all but query
    assert run("src/backend/handlers/validation.py") == ["battery", "connectivity", "ingest", "presence", "processor"]


def test_package_wide_files_affect_all():
    assert run("src/backend/requirements.txt") == ALL
    assert run("src/backend/handlers/__init__.py") == ALL
    assert run("src/backend/handlers/removed_module.py") == ALL


def test_unrelated_files_affect_none():
    assert run("src/backend/tests/test_events.py", "src/backend/requirements-dev.txt", "README.md") == []
    assert run("infrastructure/lib/naming.ts") == []


def test_windows_paths_and_union():
    assert run("src\\backend\\handlers\\ingest.py", "src/backend/handlers/query.py") == ["ingest", "query"]
