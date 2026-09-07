"""Verified mechanics adapters and identical bounded base/adapter transport.

Importing or verifying a checkpoint never imports MLX. The caller must verify the
base snapshot against its model lock before dispatch. Checkpoint evidence proves
recorded mechanics and byte integrity, not authorship, permissions or quality.
"""
from __future__ import annotations

from dataclasses import asdict
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import time

from .artifacts import write_json_new
from .inference import InferenceRequest, InferenceResult
from .mlx_backend import validate_local_request
from .training_mechanics import (DEFAULT_RESERVE, MAX_RSS, MAX_SWAP_GROWTH,
                                 resource_violation, sample_resources, _stop)
from .training_worker import CHECKPOINT_FILES, LORA_KEYS, validate_config

EXECUTION_CONTRACT = 'bounded-greedy-v1'
MAX_MLX_BYTES = 12 * 1024**3
_SHA = re.compile(r'[0-9a-f]{64}')
_IDENTITY = re.compile(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@[0-9a-f]{40}')
_ADAPTER = re.compile(r'(?:language_model\.)?model\.layers\.(\d+)\.self_attn\.(q_proj|v_proj)\.lora_(a|b)')


class WorkerMemoryLimit(ValueError):
    """An otherwise decoded response explicitly reports a breached memory cap."""


def _json(raw: bytes):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON field')
            result[key] = value
        return result

    def constant(value):
        raise ValueError('Nonfinite JSON value')

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def _path(value) -> Path:
    path = Path(value).expanduser().absolute()
    if '..' in path.parts or any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('Linked or parent-traversing artifact path')
    return path.resolve(strict=True)


def _read(path: Path, maximum: int) -> bytes:
    if path.is_symlink():
        raise ValueError('Linked artifact')
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 < before.st_size <= maximum:
            raise ValueError('Invalid artifact type or size')
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
    fields = ('st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_ino', 'st_dev')
    if len(raw) != before.st_size or any(getattr(before, f) != getattr(after, f) for f in fields):
        raise ValueError('Artifact changed while being read')
    return raw


def _hash(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _inventory(value, *, adapters=False):
    if not isinstance(value, dict) or not 1 <= len(value) <= 10000:
        raise ValueError('A bounded nonempty tensor inventory is required')
    for key, item in value.items():
        if (not isinstance(key, str) or not key or len(key) > 256
                or not isinstance(item, dict) or set(item) != {'shape', 'dtype', 'sha256'}
                or not isinstance(item['shape'], list) or not 1 <= len(item['shape']) <= 8
                or any(type(n) is not int or not 1 <= n <= 1_000_000 for n in item['shape'])
                or not isinstance(item['dtype'], str) or not item['dtype'].startswith('mlx.core.')
                or not isinstance(item['sha256'], str) or not _SHA.fullmatch(item['sha256'])):
            raise ValueError('Malformed tensor inventory')
        if adapters and (not _ADAPTER.fullmatch(key) or item['dtype'] != 'mlx.core.float32'
                         or len(item['shape']) != 2):
            raise ValueError('Unknown mechanics adapter tensor')


def _safetensor_inventory(raw: bytes) -> dict:
    if len(raw) < 9:
        raise ValueError('Incomplete safetensors file')
    header_bytes = struct.unpack('<Q', raw[:8])[0]
    if not 1 <= header_bytes <= 1024**2 or 8 + header_bytes > len(raw):
        raise ValueError('Invalid safetensors header')
    header = _json(raw[8:8 + header_bytes])
    if not isinstance(header, dict):
        raise ValueError('Invalid safetensors inventory')
    data = memoryview(raw)[8 + header_bytes:]
    result, spans = {}, []
    for name, item in header.items():
        if name == '__metadata__':
            # The pinned MLX writer emits null when no metadata was supplied.
            if item is not None and (not isinstance(item, dict)
                    or any(not isinstance(k, str) or not isinstance(v, str) for k, v in item.items())):
                raise ValueError('Invalid safetensors metadata')
            continue
        if (not isinstance(item, dict) or set(item) != {'dtype', 'shape', 'data_offsets'}
                or item['dtype'] != 'F32' or not isinstance(item['shape'], list)
                or len(item['shape']) != 2 or any(type(n) is not int or n < 1 for n in item['shape'])):
            raise ValueError('Expected float32 adapter matrices')
        offsets = item['data_offsets']
        if (not isinstance(offsets, list) or len(offsets) != 2
                or any(type(n) is not int for n in offsets)
                or not 0 <= offsets[0] < offsets[1] <= len(data)
                or offsets[1] - offsets[0] != math.prod(item['shape']) * 4):
            raise ValueError('Invalid safetensors data range')
        spans.append(tuple(offsets))
        result[name] = {'shape': item['shape'], 'dtype': 'mlx.core.float32',
                        'sha256': _hash(data[offsets[0]:offsets[1]])}
    cursor = 0
    for start, end in sorted(spans):
        if start != cursor:
            raise ValueError('Overlapping or unaccounted safetensors bytes')
        cursor = end
    if cursor != len(data):
        raise ValueError('Unaccounted safetensors bytes')
    _inventory(result, adapters=True)
    return result


def _validation_evidence(value):
    fields = {'token_weighted_loss', 'supervised_tokens', 'complete_tokens', 'examples',
              'seconds', 'objective', 'quality_claim'}
    if (not isinstance(value, dict) or set(value) != fields
            or value['objective'] != 'final_assistant_and_template_suffix_only'
            or value['quality_claim'] is not None
            or not isinstance(value['examples'], list) or not 1 <= len(value['examples']) <= 16):
        raise ValueError('Invalid checkpoint validation evidence')
    for key in ('token_weighted_loss', 'seconds'):
        if type(value[key]) not in (int, float) or not math.isfinite(value[key]) or value[key] < 0:
            raise ValueError('Invalid checkpoint validation numerics')
    ids, supervised, complete, weighted = set(), 0, 0, 0.0
    for row in value['examples']:
        if (not isinstance(row, dict) or set(row) != {'example_id', 'loss', 'supervised_tokens', 'complete_tokens'}
                or not isinstance(row['example_id'], str) or not row['example_id'].strip() or row['example_id'] in ids
                or type(row['loss']) not in (int, float) or not math.isfinite(row['loss']) or row['loss'] < 0
                or type(row['supervised_tokens']) is not int or type(row['complete_tokens']) is not int
                or not 0 < row['supervised_tokens'] < row['complete_tokens'] <= 512):
            raise ValueError('Invalid per-example validation evidence')
        ids.add(row['example_id'])
        supervised += row['supervised_tokens']
        complete += row['complete_tokens']
        weighted += row['loss'] * row['supervised_tokens']
    if (type(value['supervised_tokens']) is not int or value['supervised_tokens'] != supervised
            or type(value['complete_tokens']) is not int or value['complete_tokens'] != complete
            or not math.isclose(value['token_weighted_loss'], weighted / supervised, rel_tol=1e-9, abs_tol=1e-12)):
        raise ValueError('Validation denominator or weighted loss differs from recorded examples')


def verify_adapter_checkpoint(checkpoint_dir: Path, model_identity: str) -> dict:
    """Verify current mechanics checkpoint bytes/config/proof without model code."""
    if not isinstance(model_identity, str) or not _IDENTITY.fullmatch(model_identity):
        raise ValueError('A pinned model identity is required')
    directory = _path(checkpoint_dir)
    if not directory.is_dir() or {p.name for p in directory.iterdir()} != CHECKPOINT_FILES:
        raise ValueError('Checkpoint inventory differs from the mechanics format')
    raw = {name: _read(directory / name, 64 * 1024**2 if name.endswith('.safetensors') else 4 * 1024**2)
           for name in sorted(CHECKPOINT_FILES)}
    hashes = {name: _hash(value) for name, value in raw.items()}
    config = _json(raw['adapter_config.json'])
    fields = {'schema_version', 'model_identity', 'fine_tune_type', 'num_layers', 'lora_parameters',
              'training_config', 'records_sha256', 'restart_support'}
    release_fields = {'release_sha256', 'validation_records_sha256'}
    if (not isinstance(config, dict) or set(config) not in (fields, fields | release_fields) or config['schema_version'] != '1.0'
            or config['model_identity'] != model_identity or config['fine_tune_type'] != 'lora'
            or not isinstance(config['records_sha256'], str) or not _SHA.fullmatch(config['records_sha256'])
            or config['restart_support'] != 'none; this checkpoint saves adapter weights, not optimizer or RNG state'):
        raise ValueError('Unsupported or mismatched mechanics adapter configuration')
    training = validate_config(config['training_config'])
    if (training != config['training_config'] or type(config['num_layers']) is not int or config['num_layers'] != training['num_layers']
            or config['lora_parameters'] != {'rank': training['rank'], 'scale': training['scale'],
                                            'dropout': 0.0, 'keys': LORA_KEYS}):
        raise ValueError('Adapter configuration differs from recorded training')
    released = 'release_sha256' in config
    if released and any(not isinstance(config[k], str) or not _SHA.fullmatch(config[k]) for k in release_fields):
        raise ValueError('Invalid checkpoint release identity')
    evidence = _json(raw['checkpoint-evidence.json'])
    if (not isinstance(evidence, dict) or evidence.get('schema_version') != '1.0'
            or evidence.get('model_identity') != model_identity or evidence.get('base_unchanged') is not True
            or evidence.get('completed_steps') != training['steps']
            or evidence.get('adapter_file_sha256') != hashes['adapters.safetensors']
            or evidence.get('adapter_config_sha256') != hashes['adapter_config.json']):
        raise ValueError('Checkpoint evidence is not bound to these completed mechanics bytes')
    if released:
        if evidence.get('release_sha256') != config['release_sha256']:
            raise ValueError('Checkpoint release identity differs from its configuration')
        for key in ('validation_before', 'validation_after'):
            _validation_evidence(evidence.get(key))
        before_rows = evidence['validation_before']['examples']
        after_rows = evidence['validation_after']['examples']
        if ([{k: v for k, v in row.items() if k != 'loss'} for row in before_rows]
                != [{k: v for k, v in row.items() if k != 'loss'} for row in after_rows]):
            raise ValueError('Validation examples changed between before and after')
    elif any(k in evidence for k in ('release_sha256', 'validation_before', 'validation_after')):
        raise ValueError('Unbound release evidence on a mechanics-only checkpoint')
    before, after = evidence.get('adapter_initial'), evidence.get('adapter_final')
    _inventory(before, adapters=True)
    _inventory(after, adapters=True)
    if set(before) != set(after) or len(after) != training['num_layers'] * 4:
        raise ValueError('Adapter tensor set differs from the configured scope')
    found, layers = set(), set()
    for name in after:
        match = _ADAPTER.fullmatch(name)
        layer, projection, side = int(match[1]), match[2], match[3]
        found.add((layer, projection, side))
        layers.add(layer)
        if (before[name]['shape'] != after[name]['shape'] or before[name]['dtype'] != after[name]['dtype']
                or after[name]['shape'][1 if side == 'a' else 0] != training['rank']):
            raise ValueError('Adapter matrix rank/schema mismatch')
    if (len(layers) != training['num_layers'] or max(layers) - min(layers) + 1 != len(layers)
            or found != {(n, p, s) for n in layers for p in ('q_proj', 'v_proj') for s in ('a', 'b')}
            or not any(before[k]['sha256'] != after[k]['sha256'] for k in after)):
        raise ValueError('Missing or unchanged adapter tensors')
    _inventory(evidence.get('base_before'))
    _inventory(evidence.get('base_after'))
    if evidence['base_before'] != evidence['base_after']:
        raise ValueError('Recorded frozen base changed')
    steps = evidence.get('steps')
    if not isinstance(steps, list) or len(steps) != training['steps']:
        raise ValueError('Missing completed optimizer steps')
    for i, row in enumerate(steps, 1):
        if not isinstance(row, dict) or type(row.get('step')) is not int or row['step'] != i:
            raise ValueError('Noncontiguous optimizer steps')
        for key in ('loss', 'gradient_l2', 'update_l2'):
            value = row.get(key)
            if type(value) not in (int, float) or not math.isfinite(value) or value < 0 or (key != 'loss' and value == 0):
                raise ValueError('Invalid optimizer-step numerics')
    tensors = _safetensor_inventory(raw['adapters.safetensors'])
    if tensors != after:
        raise ValueError('Actual adapter tensor bytes differ from recorded final tensors')
    # Detect ordinary replacement during multi-file verification before returning pins.
    if any(_hash(_read(directory / name, len(raw[name]))) != hashes[name] for name in raw):
        raise ValueError('Checkpoint changed during verification')
    return {'checkpoint_dir': str(directory), 'model_identity': model_identity,
            'adapter_identity': 'sha256:' + hashes['adapters.safetensors'],
            'checkpoint_hashes': hashes, 'config': config, 'evidence': evidence,
            'tensor_inventory': tensors,
            'claims': {'file_integrity': True, 'recorded_mechanics': True,
                       'authorship_verified': False, 'quality_verified': False, 'permissions_granted': False}}


def validate_adapter_response(value, request, model_identity, prompt_token_ids, adapter_identity):
    if not isinstance(value, dict) or not isinstance(value.get('measurements'), dict):
        raise ValueError('Invalid adapter worker response')
    result = InferenceResult(**value['result'])
    if (result.run_id != request.run_id or result.model_identity != model_identity
            or result.adapter_identity != adapter_identity or result.synthetic):
        raise ValueError('Worker model/adapter identity mismatch')
    if result.input_tokens is not None and result.input_tokens != len(prompt_token_ids):
        raise ValueError('Worker prompt token count mismatch')
    if result.output_tokens is not None and result.output_tokens > request.max_output_tokens:
        raise ValueError('Worker output token bound exceeded')
    raw = value.get('raw_output')
    if raw is not None and (not isinstance(raw, str) or len(raw.encode('utf-8')) > 1024**2):
        raise ValueError('Invalid raw output')
    measured = value['measurements']
    if result.outcome == 'success':
        if result.termination_reason != 'stop' or raw != result.answer or result.input_tokens != len(prompt_token_ids):
            raise ValueError('Successful execution needs complete stopped output')
        if (measured.get('execution_contract') != EXECUTION_CONTRACT
                or measured.get('runtime_input_ids_verified') is not True
                or measured.get('adapter_verified') is not (adapter_identity is not None)):
            raise ValueError('Missing verified execution proof')
        for key, bound in (('process_peak_rss_bytes', MAX_RSS), ('mlx_peak_bytes', MAX_MLX_BYTES)):
            if type(measured.get(key)) is not int or measured[key] <= 0:
                raise ValueError('Missing peak-memory evidence')
            if measured[key] > bound:
                raise WorkerMemoryLimit('Reported peak memory exceeds the declared bound')
        pins = measured.get('checkpoint_files')
        if adapter_identity is None:
            if pins is not None:
                raise ValueError('Base arm unexpectedly carries an adapter')
        elif (not isinstance(pins, dict) or set(pins) != CHECKPOINT_FILES
              or any(not isinstance(v, str) or not _SHA.fullmatch(v) for v in pins.values())
              or pins['adapters.safetensors'] != adapter_identity.removeprefix('sha256:')):
            raise ValueError('Reload proof is not bound to the adapter')
        tokens, stops = measured.get('output_token_ids'), measured.get('stop_token_ids')
        if (not isinstance(tokens, list) or not 1 <= len(tokens) <= request.max_output_tokens
                or any(type(n) is not int or n < 0 for n in tokens)
                or result.output_tokens != len(tokens) or not isinstance(stops, list) or not stops
                or any(type(n) is not int or n < 0 for n in stops) or tokens[-1] not in stops):
            raise ValueError('Stopped output token evidence is inconsistent')
    json.dumps(value, allow_nan=False)
    return value


def _resources(model_path, scratch, pid=None):
    value = sample_resources(model_path, pid)
    value['free_disk_bytes'] = min(value['free_disk_bytes'], shutil.disk_usage(scratch).free)
    return value


def run_adapter_inference(request: InferenceRequest, *, model_path: Path, model_identity: str,
                          prompt_token_ids: list[int], checkpoint_dir: Path | None = None,
                          checkpoint_hashes: dict | None = None, seed: int = 0,
                          temperature: float = 0.0) -> dict:
    """Base and adapted arms share this transport; None checkpoint selects base.

    Caller verifies pinned base bytes. Invalid arguments/checkpoints raise before
    dispatch. Runtime/resource failures return no answer and retain bounded raw
    partial output and supervisor samples in the returned evidence.
    """
    path = _path(model_path)
    validate_local_request(request, path, model_identity, prompt_token_ids, seed, temperature)
    verified = verify_adapter_checkpoint(checkpoint_dir, model_identity) if checkpoint_dir is not None else None
    if (verified is None and checkpoint_hashes is not None) or (verified is not None and checkpoint_hashes != verified['checkpoint_hashes']):
        raise ValueError('Explicit checkpoint hashes must match the chosen arm')
    adapter_identity = verified['adapter_identity'] if verified else None
    started = time.monotonic()
    measurements = {'execution_contract': EXECUTION_CONTRACT, 'resource_samples': [],
                    'limits': {'deadline_seconds': request.timeout_seconds, 'max_worker_rss_bytes': MAX_RSS,
                               'max_swap_growth_bytes': MAX_SWAP_GROWTH, 'minimum_disk_bytes': DEFAULT_RESERVE,
                               'max_mlx_bytes': MAX_MLX_BYTES},
                    'base_snapshot_verification': 'caller_responsibility',
                    'comparison_scope': 'Use this transport for both arms; older mlx_backend timings are not matched.'}

    def failed(reason, raw=None, *, outcome='runtime_failure'):
        measurements['worker_wall_seconds'] = time.monotonic() - started
        measurements['partial_output'] = raw is not None
        return {'result': asdict(InferenceResult(request.run_id, outcome, None, reason, model_identity,
                    adapter_identity=adapter_identity, elapsed_seconds=time.monotonic() - started)),
                'raw_output': raw, 'measurements': measurements}

    with tempfile.TemporaryDirectory(prefix='ht-adapter-worker-') as temporary:
        scratch = Path(temporary).resolve(strict=True)
        initial = _resources(path, scratch)
        measurements['resource_samples'].append(initial)
        reason = resource_violation(initial, initial)
        if reason:
            return failed(reason)
        payload = {'request': asdict(request), 'model_path': str(path), 'model_identity': model_identity,
                   'prompt_token_ids': prompt_token_ids, 'seed': seed, 'temperature': temperature,
                   'checkpoint_dir': verified['checkpoint_dir'] if verified else None,
                   'checkpoint_hashes': checkpoint_hashes, 'adapter_identity': adapter_identity}
        write_json_new(scratch / 'request.json', payload)
        environment = os.environ.copy()
        environment.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
                           TOKENIZERS_PARALLELISM='false', PYTHONDONTWRITEBYTECODE='1')
        descriptor = os.open(scratch / 'worker.log', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        process, reason = None, None
        with os.fdopen(descriptor, 'w') as log:
            try:
                process = subprocess.Popen([sys.executable, '-m', 'ht_tibetan.adapter_worker', str(scratch)],
                    stdin=subprocess.DEVNULL, stdout=log, stderr=log, env=environment)
                while process.poll() is None:
                    if time.monotonic() - started >= request.timeout_seconds:
                        reason = 'timeout'
                        break
                    current = _resources(path, scratch, process.pid)
                    measurements['resource_samples'].append(current)
                    reason = resource_violation(current, initial)
                    if current.get('worker_rss_bytes') is None and process.poll() is None:
                        reason = 'rss_telemetry_unavailable'
                    if (scratch / 'worker.log').stat().st_size > 8 * 1024**2:
                        reason = 'worker_log_limit'
                    if reason:
                        break
                    try:
                        process.wait(timeout=min(1, max(.01, request.timeout_seconds - (time.monotonic() - started))))
                    except subprocess.TimeoutExpired:
                        pass
            except KeyboardInterrupt:
                reason = 'cancelled'
            except OSError:
                reason = 'worker_dispatch_or_telemetry_failure'
            finally:
                if process is not None:
                    _stop(process)
        current = _resources(path, scratch)
        measurements['resource_samples'].append(current)
        reason = reason or resource_violation(current, initial)
        partial = None
        try:
            progress = _json(_read(scratch / 'progress.json', 2 * 1024**2))
            if isinstance(progress.get('raw_output'), str) and len(progress['raw_output'].encode('utf-8')) <= 1024**2:
                partial = progress['raw_output']
            measurements['last_worker_stage'] = progress.get('stage')
        except (OSError, ValueError, AttributeError):
            pass
        if reason:
            return failed(reason, partial, outcome=reason if reason in {'timeout', 'cancelled'} else 'runtime_failure')
        if process is None or process.returncode != 0:
            return failed('worker_exit', partial)
        try:
            raw_response = _json(_read(scratch / 'response.json', 4 * 1024**2))
            response = validate_adapter_response(raw_response, request, model_identity, prompt_token_ids, adapter_identity)
            if verified and (verify_adapter_checkpoint(checkpoint_dir, model_identity)['checkpoint_hashes'] != checkpoint_hashes
                             or (response['result']['outcome'] == 'success' and response['measurements']['checkpoint_files'] != checkpoint_hashes)):
                raise ValueError('Checkpoint changed during inference')
            worker_measurements = response['measurements']
            if worker_measurements.get('process_peak_rss_bytes', 0) > MAX_RSS or worker_measurements.get('mlx_peak_bytes', 0) > MAX_MLX_BYTES:
                return failed('worker_reported_memory_limit', response.get('raw_output'))
            response['measurements'] = {**worker_measurements, **measurements,
                                        'worker_wall_seconds': time.monotonic() - started}
            return response
        except WorkerMemoryLimit:
            return failed('worker_reported_memory_limit', raw_response.get('raw_output'))
        except (OSError, ValueError, TypeError, KeyError):
            return failed('invalid_worker_response', partial)
