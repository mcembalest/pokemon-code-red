import importlib.util, tempfile, unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('save_guard', Path(__file__).resolve().parents[1] / 'scripts/save_guard.py')
guard = importlib.util.module_from_spec(spec); spec.loader.exec_module(guard)

PATCH = '''From: x
Subject: {subject}
{extra}
diff --git a/{path} b/{path}
--- a/{path}
+++ b/{path}
@@ -1 +1 @@
-a
+b
'''


class SaveGuard(unittest.TestCase):
    def check(self, path, extra=''):
        with tempfile.TemporaryDirectory() as d:
            Path(d, '009-x.patch').write_text(PATCH.format(subject='x', extra=extra, path=path))
            return guard.protected_touches(Path(d))

    def test_protected_files_need_migration_header(self):
        for path in ['include/global.h', 'include/pokemon.h', 'include/global.fieldmap.h', 'src/save.c', 'src/load_save.c']:
            self.assertEqual(len(self.check(path)), 1, path)
            self.assertEqual(self.check(path, 'Save-Migration: v2 adds X; saves.ts migrates'), [], path)

    def test_other_files_are_fine(self):
        for path in ['src/code_red.c', 'include/constants/menu.h', 'data/maps/PalletTown/scripts.inc']:
            self.assertEqual(self.check(path), [], path)

    def test_current_patches_pass(self):
        self.assertEqual(guard.protected_touches(), [])


if __name__ == '__main__':
    unittest.main()
