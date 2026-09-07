"""Process lock tests without model execution or private project data."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from ht_tibetan.experiment_lock import experiment_lock
from ht_tibetan.records import RecordsError


class ExperimentLockTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def child(self, code):
        return subprocess.run([sys.executable, '-c', code, str(self.root)], capture_output=True,
                              text=True, timeout=10, env=os.environ.copy())

    def test_lock_is_persistent_private_and_reusable(self):
        with experiment_lock(self.root) as root:
            self.assertEqual(root, self.root)
            info = (root / '.experiment.lock').stat()
            self.assertEqual(info.st_mode & 0o777, 0o600)
        with experiment_lock(self.root):
            self.assertEqual((self.root / '.experiment.lock').stat().st_ino, info.st_ino)

    def test_nested_acquisition_is_rejected_and_outer_stays_locked(self):
        with experiment_lock(self.root):
            for _ in range(2):
                with self.assertRaisesRegex(RecordsError, 'Another experiment'):
                    with experiment_lock(self.root):
                        self.fail('nested lock acquired')
        with experiment_lock(self.root):
            pass

    def test_other_process_cannot_acquire_until_context_exits(self):
        code = '''from pathlib import Path
import sys
from ht_tibetan.experiment_lock import experiment_lock
from ht_tibetan.records import RecordsError
try:
    with experiment_lock(Path(sys.argv[1])):
        print('acquired')
except RecordsError:
    print('blocked')
'''
        with experiment_lock(self.root):
            result = self.child(code)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), 'blocked')
        self.assertEqual(self.child(code).stdout.strip(), 'acquired')

    def test_process_exit_releases_lock_without_cleanup(self):
        result = self.child('''from pathlib import Path
import os, sys
from ht_tibetan.experiment_lock import experiment_lock
with experiment_lock(Path(sys.argv[1])):
    os._exit(7)
''')
        self.assertEqual(result.returncode, 7)
        with experiment_lock(self.root):
            pass

    def test_exception_releases_lock(self):
        with self.assertRaisesRegex(ValueError, 'fixture'):
            with experiment_lock(self.root):
                raise ValueError('fixture')
        with experiment_lock(self.root):
            pass

    def test_unknown_existing_file_is_not_overwritten(self):
        target = self.root / '.experiment.lock'
        target.write_text('User-owned content, preserve it.')
        before = target.read_bytes()
        with self.assertRaises(RecordsError):
            with experiment_lock(self.root):
                self.fail('unexpected lock')
        self.assertEqual(target.read_bytes(), before)

    def test_symlink_and_nonregular_lock_are_rejected(self):
        target = self.root / '.experiment.lock'
        outside = self.root / 'outside'
        outside.write_text('untouched')
        target.symlink_to(outside)
        with self.assertRaises(RecordsError):
            with experiment_lock(self.root):
                pass
        self.assertEqual(outside.read_text(), 'untouched')
        target.unlink()
        target.mkdir()
        with self.assertRaises(RecordsError):
            with experiment_lock(self.root):
                pass

    def test_symlink_root_and_missing_root_are_rejected(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        for root in [alias, self.root / 'missing']:
            with self.subTest(root=root), self.assertRaises(RecordsError):
                with experiment_lock(root):
                    pass


if __name__ == '__main__':
    unittest.main()
