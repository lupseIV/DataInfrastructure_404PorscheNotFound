"""Which Lambda functions does a change affect?

Every function is built from the same folder (src/backend), but each one only runs its own
handler module plus the modules it imports. This follows the `from .x import ...` lines in
src/backend/handlers to find, for every changed file, the functions that load it.

A function is a module in handlers/ that defines `def handler(`; its name is the module name
(handlers/battery.py -> function "battery", deployed as fleet-telemetry-battery).

Rules:
- handlers/<module>.py changed -> every function whose handler imports it (directly or not)
- handlers/__init__.py, requirements.txt, or a handlers/ module that no longer exists -> all
- anything else (tests, requirements-dev.txt, README, ...) -> none

Usage:
    git diff --name-only A B | python affected_lambdas.py [--backend src/backend]
    python affected_lambdas.py --all [--backend src/backend]

Prints one "<function>=true|false" line per function (GitHub output format), then
"functions=<space separated affected functions>".
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# The imported names are either in parentheses (may span lines) or the rest of the line.
IMPORT_RE = re.compile(r"^[ \t]*from[ \t]+\.(\w*)[ \t]+import[ \t]+(\([^)]*\)|[^\n]*)", re.MULTILINE)
HANDLER_RE = re.compile(r"^def handler\(", re.MULTILINE)


def local_imports(source: str, modules: set[str]) -> set[str]:
    """Modules of the same package imported by `from .x import ...` or `from . import x`."""
    found: set[str] = set()
    for module, names in IMPORT_RE.findall(source):
        if module:
            found.add(module)
        else:  # from . import a, b
            for name in re.split(r"[\s,()]+", names):
                if name in modules:
                    found.add(name)
    return found & modules


def load_graph(handlers_dir: Path) -> tuple[dict[str, set[str]], list[str]]:
    sources = {p.stem: p.read_text(encoding="utf-8") for p in sorted(handlers_dir.glob("*.py"))}
    modules = set(sources) - {"__init__"}
    graph = {m: local_imports(sources[m], modules) for m in modules}
    functions = sorted(m for m in modules if HANDLER_RE.search(sources[m]))
    return graph, functions


def closure(start: str, graph: dict[str, set[str]]) -> set[str]:
    seen, todo = set(), [start]
    while todo:
        module = todo.pop()
        if module not in seen:
            seen.add(module)
            todo.extend(graph.get(module, ()))
    return seen


def affected(changed: list[str], backend: Path, graph: dict[str, set[str]], functions: list[str]) -> list[str]:
    prefix = backend.as_posix().strip("/") + "/"
    uses = {fn: closure(fn, graph) for fn in functions}
    result: set[str] = set()
    for path in changed:
        path = path.strip().replace("\\", "/")
        if not path.startswith(prefix):
            continue
        rel = path[len(prefix):]
        if rel == "requirements.txt" or rel == "handlers/__init__.py":
            return functions
        match = re.fullmatch(r"handlers/(\w+)\.py", rel)
        if not match:
            continue
        module = match.group(1)
        if module not in graph:  # deleted or renamed: cannot tell who used it
            return functions
        result.update(fn for fn in functions if module in uses[fn])
    return [fn for fn in functions if fn in result]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--backend", default="src/backend", help="backend folder, relative to the repo root")
    parser.add_argument("--all", action="store_true", help="mark every function as affected")
    args = parser.parse_args(argv)

    backend = Path(args.backend)
    graph, functions = load_graph(backend / "handlers")
    chosen = functions if args.all else affected(sys.stdin.read().splitlines(), backend, graph, functions)
    for fn in functions:
        print(f"{fn}={'true' if fn in chosen else 'false'}")
    print(f"functions={' '.join(chosen)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
