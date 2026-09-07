"""Small immutable JSON outputs and reproducibility metadata."""
from __future__ import annotations

import hashlib
import importlib.metadata
from importlib.resources import files
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile
from datetime import datetime, timezone


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def write_json_new(path: Path, value: dict) -> None:
    """Publish a complete file atomically, refusing to overwrite an existing output."""
    path = path.expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + '\n').encode('utf-8')
    fd, temp = tempfile.mkstemp(prefix='.ht-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temp, path)
    finally:
        os.unlink(temp)


def runtime_record() -> dict:
    packages = {}
    for name in ('jsonschema', 'mlx', 'mlx-lm', 'transformers', 'tokenizers'):
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    return {'python': platform.python_version(), 'architecture': platform.machine(),
            'platform': platform.platform(), 'packages': packages}


def make_manifest(run_id: str, kind: str, inputs: list[Path], config: dict, outcome: str) -> dict:
    if not run_id or len(run_id) > 128:
        raise ValueError('run_id must contain 1-128 characters')
    source = Path(__file__).resolve().parent
    project = source.parent.parent.parent
    source_hashes = [{'name': 'ht_tibetan/' + p.name, 'sha256': hash_file(p)}
                     for p in sorted(source.glob('*.py'))]
    assets = files('ht_tibetan').joinpath('reviewer_assets')
    if assets.is_dir():
        for resource in sorted(assets.iterdir(), key=lambda p: p.name):
            if resource.name.endswith(('.html', '.css', '.js')):
                source_hashes.append({'name': 'ht_tibetan/reviewer_assets/' + resource.name,
                                     'sha256': hashlib.sha256(resource.read_bytes()).hexdigest()})
    for resource in sorted(files('ht_tibetan_contracts').iterdir(), key=lambda p: p.name):
        if resource.name.endswith('.json'):
            source_hashes.append({'name': 'contracts/' + resource.name,
                                  'sha256': hashlib.sha256(resource.read_bytes()).hexdigest()})
    code = {'commit': None, 'dirty': None}
    # An installed wheel has no checkout identity. Never label it with the caller's Git repo.
    if source.parent.name == 'src' and (project / 'pyproject.toml').is_file():
        for p in sorted((project / 'ml').glob('requirements*.lock')) + [project / 'pyproject.toml']:
            source_hashes.append({'name': 'project/' + p.name, 'sha256': hash_file(p)})
        try:
            code['commit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=project,
                text=True, stderr=subprocess.DEVNULL, timeout=5).strip()
            code['dirty'] = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=project,
                text=True, stderr=subprocess.DEVNULL, timeout=5).strip())
        except (OSError, subprocess.SubprocessError):
            pass
    code['files'] = source_hashes
    code['content_sha256'] = hashlib.sha256(json.dumps(source_hashes, sort_keys=True).encode()).hexdigest()
    return {'schema_version': '1.0', 'run_id': run_id, 'kind': kind, 'created_at': utc_now(),
            'evidence_type': 'infrastructure_manifest',
            'code': code, 'runtime': runtime_record(), 'inputs': [
                {'name': path.name, 'sha256': hash_file(path)} for path in inputs],
            'config': config, 'outcome': outcome}
