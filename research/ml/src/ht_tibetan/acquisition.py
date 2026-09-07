"""Bounded public Hugging Face acquisition with pinned, locally verified receipts.

This module never imports a model runtime, reads a credential store, executes
repository code, or treats artifact integrity as model quality or compatibility.
"""
from __future__ import annotations

import ctypes
import errno
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import time
from typing import Callable, Iterable
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from .artifacts import utc_now
from .preflight import DEFAULT_RESERVE, nearest_existing, storage_budget

CHUNK_BYTES = 1024 * 1024
SCRATCH_MIN_BYTES = 64 * 1024 * 1024
SOCKET_TIMEOUT_SECONDS = 30
FILE_TIMEOUT_SECONDS = 1800
SNAPSHOT_TIMEOUT_SECONDS = 7200
RECEIPT_NAME = 'acquisition.receipt.json'
_COMPONENT = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z')
_REVISION = re.compile(r'[0-9a-f]{40}\Z')
_HEX64 = re.compile(r'[0-9a-f]{64}\Z')
_METADATA_NAMES = {
    'config.json', 'generation_config.json', 'merges.txt', 'vocab.json',
    'special_tokens_map.json', 'added_tokens.json', 'chat_template.jinja',
    'chat_template.json', 'README', 'README.md', 'LICENSE', 'LICENSE.txt',
    'LICENSE.md', 'NOTICE', 'NOTICE.txt',
}
_MODEL_NAMES = {'preprocessor_config.json', 'processor_config.json'}


def _strict_json(data: bytes) -> dict:
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = value
        return result
    def invalid_constant(_value):
        raise ValueError('Non-finite JSON number')
    value = json.loads(data, object_pairs_hook=pairs, parse_constant=invalid_constant)
    if not isinstance(value, dict):
        raise ValueError('Expected a JSON object')
    return value


def _component(value: str, label: str) -> str:
    if not isinstance(value, str) or not _COMPONENT.fullmatch(value) or '..' in value:
        raise ValueError(f'Unsafe {label}')
    return value


def _file_path(value: str) -> str:
    if not isinstance(value, str) or len(value) > 512:
        raise ValueError('Unsafe repository file path')
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or str(path) != value:
        raise ValueError('Unsafe repository file path')
    for part in path.parts:
        # .gitattributes is harmless catalogue metadata, never downloaded here.
        if part == '.gitattributes':
            continue
        _component(part, 'repository file path')
    if value == RECEIPT_NAME:
        raise ValueError('Repository file conflicts with the local receipt')
    return value


def _sha(value, length: int, label: str) -> str | None:
    if value is None:
        return None
    pattern = _REVISION if length == 40 else _HEX64
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise ValueError(f'Invalid {label}')
    return value


def _selected_file(path: str, include_weights: bool) -> bool:
    name = PurePosixPath(path).name
    # Keep the complete selected tokenizer, its prompt template, and support
    # files. Python/pickle/checkpoint/archive payloads are never in the allowlist.
    metadata = name in _METADATA_NAMES or (
        name.startswith('tokenizer') and name.endswith(('.json', '.model')))
    return metadata or (include_weights and (
        name.endswith('.safetensors') or name.endswith('.safetensors.index.json')
        or name in _MODEL_NAMES))


def _selection(lock_path: Path, candidate_id: str, include_weights: bool) -> dict:
    _component(candidate_id, 'candidate id')
    if type(include_weights) is not bool:
        raise ValueError('include_weights must be boolean')
    with Path(lock_path).open('rb') as stream:
        raw = stream.read(16 * 1024 * 1024 + 1)
    if len(raw) > 16 * 1024 * 1024:
        raise ValueError('Model lock exceeds the size limit')
    lock = _strict_json(raw)
    if lock.get('schema_version') != '1.0':
        raise ValueError('Unsupported model lock schema')
    candidates, repositories = lock.get('candidates'), lock.get('repositories')
    if not isinstance(candidates, list) or not isinstance(repositories, list):
        raise ValueError('Model lock needs candidates and repositories')
    matches = [item for item in candidates if isinstance(item, dict)
               and item.get('candidate_id') == candidate_id]
    if len(matches) != 1:
        raise ValueError('Candidate must occur exactly once in the model lock')
    candidate = matches[0]
    repository = candidate.get('repository')
    if not isinstance(repository, str) or len(repository.split('/')) != 2:
        raise ValueError('Expected a public org/repository identity')
    for part in repository.split('/'):
        _component(part, 'repository identity')
    revision = candidate.get('revision')
    if _sha(revision, 40, 'pinned revision') is None:
        raise ValueError('Pinned revision is required')
    repos = [item for item in repositories if isinstance(item, dict)
             and item.get('repository') == repository and item.get('revision') == revision]
    if len(repos) != 1:
        raise ValueError('Pinned repository must occur exactly once in the model lock')
    inventory = repos[0].get('files')
    if not isinstance(inventory, list) or not inventory or len(inventory) > 10000:
        raise ValueError('Invalid repository file inventory')
    selected, paths = [], set()
    for item in inventory:
        if not isinstance(item, dict):
            raise ValueError('Invalid repository file entry')
        path = _file_path(item.get('path'))
        if path.casefold() in paths:
            raise ValueError('Duplicate or case-colliding repository paths')
        paths.add(path.casefold())
        size = item.get('size_bytes')
        if type(size) is not int or not 0 <= size <= 1024 ** 4:
            raise ValueError('File size must be a bounded non-negative integer')
        entry = {'path': path, 'size_bytes': size,
                 'git_blob_sha1': _sha(item.get('git_blob_sha1'), 40, 'Git blob hash'),
                 'lfs_sha256': _sha(item.get('lfs_sha256'), 64, 'LFS payload hash'),
                 'content_sha256': _sha(item.get('content_sha256'), 64, 'content hash')}
        if not entry['lfs_sha256'] and not entry['git_blob_sha1']:
            raise ValueError('A repository payload identity is required for every file')
        if _selected_file(path, include_weights):
            selected.append(entry)
    selected.sort(key=lambda entry: entry['path'])
    selected_paths = {item['path'] for item in selected}
    if 'config.json' not in selected_paths or 'tokenizer_config.json' not in selected_paths:
        raise ValueError('Snapshot needs root config.json and tokenizer_config.json')
    if not {'tokenizer.json', 'tokenizer.model'}.intersection(selected_paths):
        raise ValueError('Snapshot needs a root tokenizer payload')
    if include_weights and not any(item['path'].endswith('.safetensors') for item in selected):
        raise ValueError('Model snapshot has no safetensors weights')
    # Prevent an inventory declaring a file as another selected file's parent.
    for path in selected_paths:
        if any(str(parent) in selected_paths for parent in PurePosixPath(path).parents):
            raise ValueError('Repository file paths have a parent/file conflict')
    inventory_hash = hashlib.sha256(json.dumps(selected, sort_keys=True,
        separators=(',', ':')).encode()).hexdigest()
    return {'candidate_id': candidate_id, 'repository': repository, 'revision': revision,
            'mode': 'model' if include_weights else 'tokenizer', 'files': selected,
            'inventory_sha256': inventory_hash, 'lock_sha256': hashlib.sha256(raw).hexdigest()}


def _identity(selection: dict) -> dict:
    return {key: selection[key] for key in
            ('candidate_id', 'repository', 'revision', 'mode', 'inventory_sha256')}


def _no_symlinks(path: Path) -> None:
    for item in (path, *path.parents):
        if item.is_symlink():
            raise ValueError('Symlink paths are not allowed for model artifacts')


def _directory(path: Path) -> None:
    _no_symlinks(path)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    _no_symlinks(path)
    if not path.is_dir():
        raise ValueError('Expected an artifact directory')


def _read_file_hashes(path: Path, expected_size: int) -> dict:
    _no_symlinks(path)
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size != expected_size:
            raise ValueError('File is not regular or its size differs from the lock')
        if before.st_nlink != 1:
            raise ValueError('Linked artifacts are not accepted as immutable snapshots')
        sha256 = hashlib.sha256()
        git_sha1 = hashlib.sha1(f'blob {expected_size}\0'.encode())
        count = 0
        for chunk in iter(lambda: stream.read(CHUNK_BYTES), b''):
            count += len(chunk)
            if count > expected_size:
                raise ValueError('File grew while being verified')
            sha256.update(chunk)
            git_sha1.update(chunk)
        after = os.fstat(stream.fileno())
        if count != expected_size or (before.st_mtime_ns, before.st_ctime_ns, before.st_size) != (
                after.st_mtime_ns, after.st_ctime_ns, after.st_size):
            raise ValueError('File changed while being verified')
    return {'size_bytes': count, 'content_sha256': sha256.hexdigest(),
            'git_blob_sha1': git_sha1.hexdigest()}


def _check_hashes(expected: dict, measured: dict) -> None:
    if expected['lfs_sha256']:
        # The API Git hash for an LFS file describes the pointer, not payload.
        if measured['content_sha256'] != expected['lfs_sha256']:
            raise ValueError('LFS payload SHA-256 mismatch')
    elif measured['git_blob_sha1'] != expected['git_blob_sha1']:
        raise ValueError('Git blob SHA-1 mismatch')
    if expected['content_sha256'] and measured['content_sha256'] != expected['content_sha256']:
        raise ValueError('Previously measured content SHA-256 mismatch')


def _verify(selection: dict, snapshot: Path) -> dict:
    errors, measured = [], []
    identity = _identity(selection)
    try:
        _no_symlinks(snapshot)
        if not snapshot.is_dir():
            raise ValueError('Snapshot directory is missing')
        expected = {item['path'] for item in selection['files']} | {RECEIPT_NAME}
        actual = set()
        expected_dirs = {str(parent) for item in expected
                         for parent in PurePosixPath(item).parents if str(parent) != '.'}
        for directory, dirs, filenames in os.walk(snapshot, followlinks=False):
            for name in dirs:
                child = Path(directory) / name
                relative = child.relative_to(snapshot).as_posix()
                if child.is_symlink() or relative not in expected_dirs:
                    raise ValueError('Snapshot contains an unexpected or symlink directory')
            for name in filenames:
                child = Path(directory) / name
                if child.is_symlink() or not child.is_file():
                    raise ValueError('Snapshot contains a non-regular file')
                actual.add(child.relative_to(snapshot).as_posix())
        if actual != expected:
            raise ValueError('Snapshot inventory differs from the selected pinned files')
        receipt_path = snapshot / RECEIPT_NAME
        if receipt_path.stat().st_size > 16 * 1024 * 1024:
            raise ValueError('Acquisition receipt exceeds its size limit')
        receipt = _strict_json(receipt_path.read_bytes())
        if receipt.get('schema_version') != '1.0' or receipt.get('status') != 'complete':
            raise ValueError('Snapshot has no complete acquisition receipt')
        if receipt.get('identity') != identity:
            raise ValueError('Acquisition receipt does not match the selected pinned identity')
        for item in selection['files']:
            try:
                hashes = _read_file_hashes(snapshot / item['path'], item['size_bytes'])
                _check_hashes(item, hashes)
                measured.append({'path': item['path'], **hashes})
            except (OSError, ValueError) as exc:
                errors.append({'path': item['path'], 'message': str(exc)})
        if not errors and receipt.get('files') != measured:
            raise ValueError('Acquisition receipt hashes do not match the measured payloads')
    except (OSError, ValueError) as exc:
        errors.append({'path': '.', 'message': str(exc)})
    return {'valid': not errors, 'errors': errors, 'identity': identity,
            'snapshot_dir': str(snapshot), 'receipt_path': str(snapshot / RECEIPT_NAME),
            'files': measured, 'runtime_compatibility': 'not_tested', 'model_quality': 'not_tested'}


def verify_snapshot(lock_path: Path, candidate_id: str, snapshot_dir: Path,
                    *, include_weights: bool = False) -> dict:
    """Read every selected payload and its receipt, without network or model code."""
    snapshot = Path(snapshot_dir).expanduser().absolute()
    try:
        selection = _selection(Path(lock_path), candidate_id, include_weights)
    except (OSError, ValueError) as exc:
        return {'valid': False, 'errors': [{'path': 'lock', 'message': str(exc)}],
                'identity': None, 'snapshot_dir': str(snapshot), 'files': []}
    return _verify(selection, snapshot)


class _PublicRedirects(HTTPRedirectHandler):
    """Only HTTPS redirects within the Hugging Face delivery domains."""
    max_redirections = 5
    max_repeats = 2

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urlsplit(newurl)
        host = parsed.hostname or ''
        allowed = host == 'huggingface.co' or host.endswith('.huggingface.co') or host.endswith('.hf.co')
        if parsed.scheme != 'https' or not allowed or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise ValueError('Artifact download attempted an unapproved redirect')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _read_body_once(response, deadline: float) -> bytes:
    """Return available bytes after at most one bounded raw socket read.

    HTTPResponse.read(n) may perform many reads while filling n bytes. A peer
    that drips bytes can keep resetting its inactivity timer, so the transfer
    deadline must be checked between read1 calls instead. Pin the supported
    CPython HTTPS response shape; do not fall back to an unbounded wrapper.
    """
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('Artifact download exceeded its total time limit')
    # HTTPResponse.read1's chunked path can loop on framing reads. Public
    # artifact responses with chunked framing are outside this bounded reader.
    if getattr(response, 'chunked', False) or response.headers.get('Transfer-Encoding'):
        raise ValueError('Chunked artifact transfers are not supported')
    fp = getattr(response, 'fp', None)
    if fp is None:
        if callable(getattr(response, 'isclosed', None)) and response.isclosed():
            return b''
        raise OSError('Unsupported artifact response stream')
    socket = getattr(getattr(fp, 'raw', None), '_sock', None)
    if socket is None or not callable(getattr(socket, 'settimeout', None)):
        raise OSError('Cannot enforce artifact response socket deadline')
    if not callable(getattr(response, 'read1', None)):
        raise OSError('Artifact response does not support bounded reads')
    socket.settimeout(min(SOCKET_TIMEOUT_SECONDS, remaining))
    chunk = response.read1(CHUNK_BYTES)
    # Never publish even the final chunk if it arrived after the deadline.
    if time.monotonic() >= deadline:
        raise TimeoutError('Artifact download exceeded its total time limit')
    return chunk


def _public_download(url: str, file_spec: dict, *, deadline: float | None = None) -> Iterable[bytes]:
    # No HF SDK, netrc, credential provider, environment proxies, or auth header.
    opener = build_opener(ProxyHandler({}), _PublicRedirects())
    request = Request(url, headers={'Accept-Encoding': 'identity',
                                  'User-Agent': 'ht-tibetan-research/0.1 pinned-acquisition'})
    started = time.monotonic()
    deadline = min(started + FILE_TIMEOUT_SECONDS, deadline) if deadline is not None else started + FILE_TIMEOUT_SECONDS
    if deadline <= started:
        raise TimeoutError('Artifact download exceeded its total time limit')
    try:
        with opener.open(request, timeout=min(SOCKET_TIMEOUT_SECONDS, deadline - started)) as response:
            if response.status != 200 or response.headers.get('Content-Encoding', 'identity') != 'identity':
                raise ValueError('Unexpected artifact HTTP status or content encoding')
            length = response.headers.get('Content-Length')
            if length is not None and (not length.isdigit() or int(length) != file_spec['size_bytes']):
                raise ValueError('Artifact HTTP length differs from the model lock')
            while True:
                chunk = _read_body_once(response, deadline)
                if not chunk:
                    break
                yield chunk
    except Exception as exc:
        # Do not propagate signed redirect queries or proxy/credential details.
        raise OSError(f'Public artifact transfer failed for {file_spec["path"]} ({type(exc).__name__})') from None


def _free_bytes(path: Path) -> int:
    return shutil.disk_usage(nearest_existing(path)).free


def _rename_no_replace(source: Path, destination: Path) -> None:
    """Atomic directory publication with an OS-enforced no-overwrite contract."""
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        function = libc.renamex_np
        function.argtypes = (ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint)
        function.restype = ctypes.c_int
        result = function(os.fsencode(source), os.fsencode(destination), 0x00000004)  # RENAME_EXCL
    elif sys.platform.startswith('linux') and hasattr(libc, 'renameat2'):
        function = libc.renameat2
        function.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
        function.restype = ctypes.c_int
        result = function(-100, os.fsencode(source), -100, os.fsencode(destination), 1)  # AT_FDCWD, RENAME_NOREPLACE
    else:
        raise OSError('This platform has no supported atomic no-overwrite directory publication')
    if result != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(destination))


def acquire_snapshot(lock_path: Path, candidate_id: str, root: Path, *,
                     include_weights: bool = False, reserve_bytes: int = DEFAULT_RESERVE,
                     downloader: Callable[[str, dict], Iterable[bytes]] | None = None,
                     free_bytes: Callable[[Path], int] | None = None) -> dict:
    """Download one explicit pinned selection and atomically publish its receipt.

    The root must be outside Desktop. Existing verified snapshots are reused;
    existing incomplete/corrupt destinations are never repaired or overwritten.
    Test injection avoids network access: downloader(url, file_spec) yields
    chunks no larger than CHUNK_BYTES; free_bytes(path) returns an integer.
    """
    selection = _selection(Path(lock_path), candidate_id, include_weights)
    # Validate even when reusing a snapshot, where no new allocation is needed.
    storage_budget(0, 0, reserve_bytes)
    root = Path(root).expanduser().absolute()
    _no_symlinks(root)
    if root.resolve().is_relative_to((Path.home() / 'Desktop').resolve()):
        raise ValueError('Research artifact storage must be outside Desktop')
    parent = root / 'models' / candidate_id / selection['revision']
    snapshot = parent / selection['mode']
    _no_symlinks(snapshot)
    get_free = free_bytes or _free_bytes
    if snapshot.exists():
        verified = _verify(selection, snapshot)
        if not verified['valid']:
            raise ValueError('Existing snapshot is incomplete or corrupted; it was left unchanged')
        return {**verified, 'reused': True, 'storage': storage_budget(get_free(root), 0, reserve_bytes)}
    payload_bytes = sum(item['size_bytes'] for item in selection['files'])
    # Publication is a same-filesystem rename, so no full duplicate is needed.
    # Explicit scratch/receipt/filesystem headroom remains in addition to the
    # 15 GiB default reserve. Existing artifacts and environment are in free().
    scratch_bytes = max(SCRATCH_MIN_BYTES, (payload_bytes + 19) // 20)
    storage = storage_budget(get_free(root), payload_bytes + scratch_bytes, reserve_bytes)
    storage.update({'payload_bytes': payload_bytes, 'scratch_bytes': scratch_bytes,
                    'publication_duplicate_bytes': 0})
    if not storage['within_budget']:
        raise ValueError('Acquisition would cross the free-space reserve')
    _directory(parent)
    stage = Path(tempfile.mkdtemp(prefix=f'.{selection["mode"]}-staging-', dir=parent))
    os.chmod(stage, 0o700)
    measured, written = [], 0
    started = time.monotonic()
    snapshot_deadline = started + SNAPSHOT_TIMEOUT_SECONDS
    transfer = downloader or (lambda url, spec: _public_download(url, spec, deadline=snapshot_deadline))
    try:
        for item in selection['files']:
            destination = stage / item['path']
            _directory(destination.parent)
            url = f'https://huggingface.co/{selection["repository"]}/resolve/{selection["revision"]}/{quote(item["path"], safe="/")}'
            file_bytes = 0
            sha256, git_sha1 = hashlib.sha256(), hashlib.sha1(f'blob {item["size_bytes"]}\0'.encode())
            fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
            with os.fdopen(fd, 'wb') as stream:
                for chunk in transfer(url, dict(item)):
                    if time.monotonic() - started > SNAPSHOT_TIMEOUT_SECONDS:
                        raise TimeoutError('Snapshot acquisition exceeded its total time limit')
                    if not isinstance(chunk, bytes) or not 0 < len(chunk) <= CHUNK_BYTES:
                        raise ValueError('Downloader yielded an invalid or oversized chunk')
                    if file_bytes + len(chunk) > item['size_bytes']:
                        raise ValueError('Artifact exceeds its declared file size')
                    remaining = payload_bytes - written
                    if not storage_budget(get_free(root), remaining + scratch_bytes, reserve_bytes)['within_budget']:
                        raise ValueError('Free space fell below the acquisition budget during transfer')
                    stream.write(chunk)
                    sha256.update(chunk)
                    git_sha1.update(chunk)
                    file_bytes += len(chunk)
                    written += len(chunk)
                stream.flush()
                os.fsync(stream.fileno())
            if file_bytes != item['size_bytes']:
                raise ValueError('Artifact ended before its declared file size')
            hashes = {'size_bytes': file_bytes, 'content_sha256': sha256.hexdigest(),
                      'git_blob_sha1': git_sha1.hexdigest()}
            _check_hashes(item, hashes)
            measured.append({'path': item['path'], **hashes})
        if not storage_budget(get_free(root), scratch_bytes, reserve_bytes)['within_budget']:
            raise ValueError('Free space fell below the reserve before publication')
        receipt = {'schema_version': '1.0', 'status': 'complete', 'created_at': utc_now(),
                   'identity': _identity(selection), 'lock_sha256_at_acquisition': selection['lock_sha256'],
                   'files': measured, 'storage_at_start': storage,
                   'credentials_read': False, 'terms_acceptance_performed': False,
                   'runtime_compatibility': 'not_tested', 'model_quality': 'not_tested'}
        with (stage / RECEIPT_NAME).open('x', encoding='utf-8') as stream:
            json.dump(receipt, stream, ensure_ascii=False, allow_nan=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        verified = _verify(selection, stage)
        if not verified['valid']:
            raise ValueError('Completed staging snapshot failed independent file verification')
        _no_symlinks(parent)
        try:
            _rename_no_replace(stage, snapshot)
        except OSError as exc:
            if exc.errno not in (errno.EEXIST, errno.ENOTEMPTY):
                raise
            # A concurrent cooperating acquisition may have published first.
            existing = _verify(selection, snapshot)
            if not existing['valid']:
                raise ValueError('Concurrent destination is not verified; it was left unchanged') from None
            return {**existing, 'reused': True, 'storage': storage}
        return {**verified, 'snapshot_dir': str(snapshot),
                'receipt_path': str(snapshot / RECEIPT_NAME), 'reused': False, 'storage': storage}
    finally:
        # Own unique staging only. Never delete someone else's prior failed run
        # or an existing final snapshot. Abrupt process death can leave staging,
        # which is never recognized as a complete published snapshot.
        if stage.exists():
            shutil.rmtree(stage)
