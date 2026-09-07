"""One process-exclusive lock across research preflight, dispatch and release.

The persistent file is a named lock inode, not a stale-owner sentinel. The kernel
releases the flock when the process exits, including abrupt termination. Existing
unrecognized files are never overwritten or removed.
"""
from __future__ import annotations

from contextlib import contextmanager
import fcntl
import os
from pathlib import Path
import stat
import tempfile

from .records import RecordsError

_MARKER = b'HealthTranslatorML experiment lock v1\n'


def _root(value: Path) -> Path:
    root = Path(value).expanduser().absolute()
    if root.resolve() != root or any(path.is_symlink() for path in (root, *root.parents)):
        raise RecordsError('Experiment lock requires an unambiguous root without symlinks.')
    if not root.is_dir():
        raise RecordsError('Experiment lock root must already exist.')
    return root


def _prepare(root: Path) -> Path:
    path = root / '.experiment.lock'
    if path.is_symlink():
        raise RecordsError('Experiment lock cannot be a symlink.')
    if not path.exists():
        descriptor, temporary = tempfile.mkstemp(prefix='.experiment-lock-create-', dir=root)
        try:
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(_MARKER)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, path)
            except FileExistsError:
                pass  # A competing creator published the same named lock first.
        finally:
            os.unlink(temporary)
    return path


@contextmanager
def experiment_lock(root: Path):
    """Hold ``root/.experiment.lock``; fail immediately if another holder exists.

    Acquire once in the outer orchestration, before audit/preflight, and retain
    through reservation, worker dispatch and final manifest publication. Calls
    are deliberately non-reentrant; helpers must not take the same lock again.
    ``root`` is the private research root, not its ``runs`` subdirectory.
    """
    descriptor = None
    acquired = False
    active = False
    try:
        checked = _root(root)
        path = _prepare(checked)
        descriptor = os.open(path, os.O_RDWR | os.O_NONBLOCK | getattr(os, 'O_NOFOLLOW', 0))
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_size != len(_MARKER):
            raise RecordsError('Existing experiment lock is not an owned project lock file; it was not changed.')
        if os.read(descriptor, len(_MARKER) + 1) != _MARKER:
            raise RecordsError('Existing experiment lock contents are unrecognized; they were not changed.')
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RecordsError('Another experiment currently owns the research lock; nested acquisition is not allowed.') from exc
        acquired = True
        current = path.stat(follow_symlinks=False)
        if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
            raise RecordsError('Experiment lock inode changed during acquisition.')
        active = True
        yield checked
    except OSError as exc:
        if active:
            raise
        raise RecordsError('Experiment lock could not be acquired safely.') from exc
    finally:
        if descriptor is not None:
            if acquired:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)
