"""Each Lambda bundles its own copy of the helper modules it needs (no shared package).

These copies must stay identical: fix a bug in one, copy the file to the other functions.
This test lists, for each helper module, the functions that carry it and fails when the
copies differ, so a change never reaches only some of them by accident.
"""
import os
import unittest

FUNCTIONS_DIR = os.path.join(os.path.dirname(__file__), "..", "functions")

# helper module -> functions that bundle a copy (function-specific modules are not listed)
COPIES = {
    "checks.py": ["battery", "connectivity", "ingest", "presence", "processor"],
    "contract_a.py": ["ingest", "processor"],
    "dynamo.py": ["battery", "connectivity", "presence", "processor"],
    "travel.py": ["battery", "connectivity", "processor"],
    "events.py": ["battery", "connectivity"],
    "event_body.py": ["battery", "connectivity"],
}


def read(function, module):
    with open(os.path.join(FUNCTIONS_DIR, function, module), encoding="utf-8") as f:
        return f.read().replace("\r\n", "\n")


class CopiesTests(unittest.TestCase):
    def test_copies_are_identical(self):
        for module, functions in COPIES.items():
            first = read(functions[0], module)
            for function in functions[1:]:
                with self.subTest(module=module, function=function):
                    self.assertEqual(
                        read(function, module), first,
                        f"functions/{function}/{module} differs from functions/{functions[0]}/{module}",
                    )

    def test_list_matches_the_folders(self):
        """Every copy on disk is listed above, so a new copy is checked too."""
        for module, functions in COPIES.items():
            on_disk = sorted(
                f for f in os.listdir(FUNCTIONS_DIR)
                if os.path.isfile(os.path.join(FUNCTIONS_DIR, f, module))
            )
            self.assertEqual(on_disk, sorted(functions), f"functions carrying {module}")


if __name__ == "__main__":
    unittest.main()
