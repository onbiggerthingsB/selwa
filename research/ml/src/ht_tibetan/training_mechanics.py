"""Explicit synthetic-only adapter experiment; no downloads or model imports here."""
from __future__ import annotations

import importlib.metadata
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

from .acquisition import verify_snapshot
from .artifacts import hash_file, make_manifest, runtime_record, utc_now, write_json_new
from .preflight import DEFAULT_RESERVE, inspect
from .records import load_dataset, record_sha256

GIB = 1024 ** 3
MAX_RSS = 14 * GIB
MAX_SWAP_GROWTH = GIB
PROJECTED_BYTES = 128 * 1024 ** 2
CANDIDATES = {'gemma3-4b-it-mlx-4bit', 'qwen3-4b-mlx-4bit'}


def runtime_sources() -> list[dict]:
    distribution = importlib.metadata.distribution('mlx-lm')
    names = ['mlx_lm/utils.py', 'mlx_lm/models/gemma3.py', 'mlx_lm/models/gemma3_text.py',
             'mlx_lm/models/qwen3.py', 'mlx_lm/tuner/utils.py', 'mlx_lm/tuner/lora.py',
             'mlx_lm/tuner/trainer.py', 'mlx_lm/tuner/datasets.py']
    return [{'path': name, 'sha256': hash_file(Path(distribution.locate_file(name)))} for name in names]


def _command(args: list[str]) -> str | None:
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=3).strip()
    except (OSError, subprocess.SubprocessError):
        return None


def parse_swap_used(value: str | None) -> int | None:
    if value is None:
        return None
    match = re.search(r'\bused\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*([KMGT])\b', value)
    if not match:
        return None
    return int(float(match[1]) * 1024 ** ('KMGT'.index(match[2]) + 1))


def sample_resources(root: Path, pid: int | None = None) -> dict:
    swap = parse_swap_used(_command(['/usr/sbin/sysctl', '-n', 'vm.swapusage'])) if sys.platform == 'darwin' else None
    pressure = _command(['/usr/sbin/sysctl', '-n', 'kern.memorystatus_vm_pressure_level']) if sys.platform == 'darwin' else None
    rss = _command(['/bin/ps', '-o', 'rss=', '-p', str(pid)]) if pid is not None else None
    return {'at': utc_now(), 'free_disk_bytes': shutil.disk_usage(root).free,
            'swap_used_bytes': swap,
            'pressure_level': int(pressure) if pressure and pressure.isdigit() else None,
            'worker_rss_bytes': int(rss) * 1024 if rss and rss.isdigit() else None}


def resource_violation(sample: dict, initial: dict, *, require_swap: bool = True) -> str | None:
    if sample['free_disk_bytes'] < DEFAULT_RESERVE:
        return 'disk_reserve'
    if sample.get('pressure_level') is not None and sample['pressure_level'] >= 4:
        return 'critical_memory_pressure'
    if require_swap and (sample.get('swap_used_bytes') is None or initial.get('swap_used_bytes') is None):
        return 'swap_telemetry_unavailable'
    if sample.get('swap_used_bytes') is not None and initial.get('swap_used_bytes') is not None:
        if sample['swap_used_bytes'] - initial['swap_used_bytes'] > MAX_SWAP_GROWTH:
            return 'swap_growth'
    if sample.get('worker_rss_bytes') is not None and sample['worker_rss_bytes'] > MAX_RSS:
        return 'worker_rss'
    return None


def _private_directory(path: Path) -> None:
    for parent in (path, *path.parents):
        if parent.is_symlink():
            raise ValueError('Research output may not traverse symbolic links')
    path.mkdir(mode=0o700, parents=True, exist_ok=False)
    path.chmod(0o700)


def validate_output_path(root: Path, output: Path) -> tuple[Path, Path]:
    root = root.expanduser().resolve(strict=True)
    output = output.expanduser().absolute()
    if '..' in output.parts or any(p.is_symlink() for p in (output, *output.parents)):
        raise ValueError('Output may not traverse parent components or symbolic links')
    output = output.resolve(strict=False)
    if root.is_relative_to((Path.home() / 'Desktop').resolve()):
        raise ValueError('Model/checkpoint research root must be outside Desktop')
    if not output.is_relative_to(root / 'runs') or output == root / 'runs':
        raise ValueError('Use a new run directory below the private research root/runs')
    if output.exists():
        raise ValueError('Refusing to overwrite an existing mechanics run')
    return root, output


def _stop(process) -> None:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)


def supervise_worker(payload: dict, scratch: Path, *, timeout_seconds: float,
                     initial_resources: dict, resource_root: Path) -> dict:
    """Poll resource limits and terminate a fresh child; preserve all partial evidence."""
    if (type(timeout_seconds) not in (int, float) or not 0 < timeout_seconds <= 600):
        raise ValueError('Worker deadline must be positive and at most 600 seconds')
    _private_directory(scratch)
    write_json_new(scratch / 'request.json', payload)
    environment = os.environ.copy()
    environment.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
                       TOKENIZERS_PARALLELISM='false', PYTHONDONTWRITEBYTECODE='1')
    started = time.monotonic()
    samples, reason, response = [], None, None
    log_path = scratch / 'worker.log'
    descriptor = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as log:
        process = subprocess.Popen([sys.executable, '-m', 'ht_tibetan.training_worker', str(scratch)],
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=log, env=environment)
        try:
            while process.poll() is None:
                if time.monotonic() - started >= timeout_seconds:
                    reason = 'timeout'
                    break
                current = sample_resources(resource_root, process.pid)
                samples.append(current)
                reason = resource_violation(current, initial_resources)
                if current.get('worker_rss_bytes') is None and process.poll() is None:
                    reason = 'rss_telemetry_unavailable'
                if log_path.stat().st_size > 8 * 1024 ** 2:
                    reason = 'worker_log_limit'
                if reason:
                    break
                try:
                    process.wait(timeout=min(1, max(.01, timeout_seconds - (time.monotonic() - started))))
                except subprocess.TimeoutExpired:
                    pass
        except KeyboardInterrupt:
            reason = 'interrupted'
        finally:
            _stop(process)
    samples.append(sample_resources(resource_root))
    reason = reason or resource_violation(samples[-1], initial_resources)
    if reason is None and process.returncode == 0:
        try:
            path = scratch / 'response.json'
            if path.is_symlink() or path.stat().st_size > 16 * 1024 ** 2:
                raise ValueError('Invalid worker output')
            response = load_dataset(path)
            if not isinstance(response, dict) or response.get('model_identity') != payload['model_identity']:
                raise ValueError('Worker identity mismatch')
            if response.get('mode') != payload['mode'] or response.get('outcome') not in {'success', 'runtime_failure'}:
                raise ValueError('Worker outcome mismatch')
        except (OSError, ValueError, TypeError):
            reason = 'invalid_worker_response'
    elif reason is None:
        reason = 'worker_exit'
    result = {'outcome': 'failed' if reason or not response or response['outcome'] != 'success' else 'completed',
              'stop_reason': reason, 'worker_returncode': process.returncode,
              'wall_seconds': time.monotonic() - started, 'resource_samples': samples,
              'response': response,
              'limits': {'deadline_seconds': timeout_seconds, 'max_worker_rss_bytes': MAX_RSS,
                         'max_swap_growth_bytes': MAX_SWAP_GROWTH, 'minimum_disk_bytes': DEFAULT_RESERVE,
                         'monitoring': 'Sampled approximately once per second; limits terminate the worker after detection.'}}
    write_json_new(scratch / 'supervisor.json', result)
    return result


def run_mechanics(lock_path: Path, candidate: str, root: Path, output: Path, *, steps: int = 20,
                  timeout_seconds: float = 300) -> dict:
    """Serialize this synthetic exercise with release and evaluation activity."""
    from .experiment_lock import experiment_lock
    with experiment_lock(Path(root)):
        return _run_mechanics(lock_path, candidate, root, output, steps=steps, timeout_seconds=timeout_seconds)


def _run_mechanics(lock_path: Path, candidate: str, root: Path, output: Path, *, steps: int = 20,
                   timeout_seconds: float = 300) -> dict:
    """Run only the built-in synthetic exercise, never a caller-supplied training corpus."""
    from .training_inputs import prepare_mechanics_examples
    from .training_worker import validate_config
    from .token_audit import load_local_tokenizer

    if candidate not in CANDIDATES:
        raise ValueError('Select an existing supported local mechanics candidate')
    config = validate_config({'steps': steps})
    if type(timeout_seconds) not in (int, float) or not 0 < timeout_seconds <= 600:
        raise ValueError('Worker deadline must be positive and at most 600 seconds')
    # Raw model/data/checkpoint outputs stay in the private research root, never synced Desktop.
    root, output = validate_output_path(root, output)
    lock = load_dataset(lock_path)
    selected = [entry for entry in lock['candidates'] if entry['candidate_id'] == candidate]
    if len(selected) != 1:
        raise ValueError('Candidate must resolve exactly once')
    selected = selected[0]
    snapshot = root / 'models' / candidate / selected['revision'] / 'model'
    verified = verify_snapshot(lock_path, candidate, snapshot, include_weights=True)
    if not verified['valid']:
        raise ValueError('Local model payloads failed the pinned snapshot verification')
    preflight = inspect(root, PROJECTED_BYTES)
    packages = runtime_record()['packages']
    if not preflight['native_apple_silicon'] or packages['mlx-lm'] != '0.31.3' or packages['mlx'] != '0.32.2':
        raise ValueError('Mechanics requires the inspected native MLX 0.32.2 / MLX-LM 0.31.3 runtime')
    if not preflight['storage']['within_budget']:
        raise ValueError('Insufficient disk after projected mechanics outputs and reserve')
    initial = sample_resources(root)
    violation = resource_violation(initial, initial)
    if violation:
        raise ValueError('Mechanics preflight failed: ' + violation)
    identity = selected['repository'] + '@' + selected['revision']
    records = prepare_mechanics_examples(load_local_tokenizer(snapshot), config['max_seq_length'],
        {'candidate_id': candidate, 'reasoning_mode': 'disabled'})
    _private_directory(output)
    dataset = {'schema_version': '1.0', 'kind': 'synthetic_mechanics_only',
               'created_at': utc_now(), 'instruction_language': 'en', 'content_language': 'en',
               'authorship': 'New Codex-authored nonclinical engineering fixtures; no contributor submissions.',
               'permitted_scope': 'Local mechanics testing only; not Tibetan evidence or a substantive training release.',
               'exposures': ['smoke_training'], 'eligible_for_unseen_test': False, 'records': records}
    write_json_new(output / 'synthetic-inputs.json', dataset)
    write_json_new(output / 'model-verification.json', verified)
    write_json_new(output / 'preflight.json', {'preflight': preflight, 'resources': initial})
    provenance = {'conversion': selected['conversion_provenance'],
                  'disposition': 'Exact local conversion artifact used only to test adapter mechanics; '
                  'no claim that its upstream instruction/pretraining declaration is resolved, '
                  'that it is a selected Tibetan model, or that its conversion was reproduced.'}
    manifest = make_manifest(output.name, 'synthetic_adapter_mechanics',
        [lock_path, output / 'synthetic-inputs.json', output / 'model-verification.json'],
        {'training': config, 'model_identity': identity, 'provenance': provenance,
         'resume': 'not_supported; every invocation starts a fresh optimizer and new output directory'}, 'started')
    manifest['evidence_type'] = 'local_synthetic_training_mechanics'
    manifest['runtime_source_files'] = runtime_sources()
    write_json_new(output / 'started.json', manifest)
    # Reserve smoke exposure before dispatch even if execution later fails.
    write_json_new(output / 'exposure.json', {'kind': 'synthetic_mechanics_exposure',
        'input_sha256': hash_file(output / 'synthetic-inputs.json'), 'record_hashes': [record_sha256(r) for r in records],
        'exposures': ['smoke_training'], 'eligible_for_unseen_test': False,
        'dispatch_state': 'reserved_before_training', 'cumulative_release_ledger': 'not_implemented'})
    payload = {'mode': 'train', 'model_path': str(snapshot), 'model_identity': identity,
               'records': records, 'config': config, 'checkpoint_dir': str(output / 'checkpoint')}
    train, reload = None, None
    outcome, failure = 'failed', None
    try:
        train = supervise_worker(payload, output / 'train-worker', timeout_seconds=timeout_seconds,
                                 initial_resources=initial, resource_root=root)
        if train['outcome'] == 'completed':
            reload = supervise_worker({**payload, 'mode': 'reload',
                'expected_checkpoint_files': train['response']['evidence']['checkpoint_files']}, output / 'reload-worker',
                timeout_seconds=min(120, timeout_seconds), initial_resources=initial, resource_root=root)
            if reload['outcome'] == 'completed':
                before = train['response']
                after = reload['response']
                if (before.get('completed_steps') != config['steps']
                        or not before.get('evidence', {}).get('base_unchanged')
                        or before.get('evidence', {}).get('changed_tensor_count', 0) < 1
                        or not after.get('evidence', {}).get('reload_verified')
                        or not before.get('adapter_identity')
                        or before['adapter_identity'] != after.get('adapter_identity')):
                    raise ValueError('Training/reload proof incomplete')
                outcome = 'completed'
    except (OSError, ValueError, TypeError, KeyError) as exc:
        failure = type(exc).__name__
    current = make_manifest(output.name, 'synthetic_adapter_mechanics', [], {}, outcome)
    if current['code']['content_sha256'] != manifest['code']['content_sha256']:
        outcome, failure = 'failed', 'code_changed_during_run'
    if runtime_sources() != manifest['runtime_source_files']:
        outcome, failure = 'failed', 'runtime_source_changed_during_run'
    result = {**manifest, 'outcome': outcome, 'finished_at': utc_now(), 'failure': failure,
              'train': train, 'reload': reload, 'post_resources': sample_resources(root),
              'claims': {'local_adapter_updates_and_reload': outcome == 'completed',
                         'tibetan_comprehension': False, 'health_correctness': False,
                         'held_out_improvement': False, 'exact_resume': False,
                         'dataset_release_ready': False},
              'artifact_inventory': [{'path': str(p.relative_to(output)), 'sha256': hash_file(p), 'bytes': p.stat().st_size}
                  for p in sorted(output.rglob('*')) if p.is_file()]}
    write_json_new(output / 'manifest.json', result)
    return {'outcome': outcome, 'run_directory': str(output), 'model_identity': identity,
            'completed_steps': train['response'].get('completed_steps', 0) if train and train.get('response') else 0,
            'adapter_identity': train['response'].get('adapter_identity') if train and train.get('response') else None,
            'reload_verified': bool(reload and reload['outcome'] == 'completed'), 'failure': failure,
            'train_stop_reason': train.get('stop_reason') if train else None,
            'reload_stop_reason': reload.get('stop_reason') if reload else None,
            'train_failure': {key: train['response'].get(key) for key in ('stage', 'error_type')}
                if train and train.get('response') and train['response']['outcome'] != 'success' else None,
            'reload_failure': {key: reload['response'].get(key) for key in ('stage', 'error_type')}
                if reload and reload.get('response') and reload['response']['outcome'] != 'success' else None,
            'claims': result['claims']}
