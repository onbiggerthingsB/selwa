"""Read-only resource accounting; no model imports or downloads."""
from __future__ import annotations

import os
from pathlib import Path
import platform
import shutil
import subprocess

from .artifacts import runtime_record, utc_now

GIB = 1024 ** 3
DEFAULT_RESERVE = 15 * GIB


def default_root() -> Path:
    return Path(os.environ.get('HT_ML_ROOT', str(Path.home() / 'Library/Application Support/HealthTranslatorML'))).expanduser()


def nearest_existing(path: Path) -> Path:
    path = path.expanduser().resolve()
    while not path.exists():
        if path == path.parent:
            raise ValueError('Cannot locate a filesystem for the data root')
        path = path.parent
    return path


def storage_budget(free_bytes: int, projected_bytes: int, reserve_bytes: int = DEFAULT_RESERVE) -> dict:
    for value in (free_bytes, projected_bytes, reserve_bytes):
        if type(value) is not int or value < 0:
            raise ValueError('Storage byte counts must be non-negative integers')
    remaining = free_bytes - projected_bytes
    return {'free_bytes': free_bytes, 'projected_additional_bytes': projected_bytes,
            'reserve_bytes': reserve_bytes, 'remaining_bytes': remaining,
            'within_budget': remaining >= reserve_bytes}


def _sysctl(key: str) -> str | None:
    if platform.system() != 'Darwin':
        return None
    try:
        result = subprocess.run(['/usr/sbin/sysctl', '-n', key], capture_output=True, text=True, timeout=5, check=True)
        return result.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def inspect(root: Path | None = None, projected_bytes: int = 0, reserve_bytes: int = DEFAULT_RESERVE) -> dict:
    root = (root or default_root()).expanduser().resolve()
    memory = _sysctl('hw.memsize')
    record = runtime_record()
    local_platform = platform.system() == 'Darwin' and platform.machine() == 'arm64'
    storage = storage_budget(shutil.disk_usage(nearest_existing(root)).free, projected_bytes, reserve_bytes)
    warnings = []
    if not local_platform:
        warnings.append('Local MLX model execution requires a supported native Apple Silicon environment.')
    if not storage['within_budget']:
        warnings.append('Projected storage use would cross the project free-space reserve.')
    if record['packages']['mlx-lm'] is None:
        warnings.append('MLX-LM is not installed in this Python environment.')
    if memory is None:
        warnings.append('Physical memory could not be read; do not infer it is zero or sufficient.')
    return {'schema_version': '1.0', 'created_at': utc_now(), 'data_root': str(root),
            'hardware': {'chip': _sysctl('machdep.cpu.brand_string'),
                         'memory_bytes': int(memory) if memory and memory.isdigit() else None,
                         'os': platform.mac_ver()[0] or platform.system()},
            'runtime': record, 'storage': storage, 'native_apple_silicon': local_platform,
            'metal_execution': 'not_tested', 'model_fit': 'not_tested', 'training_speed': 'not_tested',
            'warnings': warnings}
