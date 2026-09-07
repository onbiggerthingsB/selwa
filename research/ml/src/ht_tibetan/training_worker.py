"""Fresh-process, bounded LoRA mechanics proof; no dataset loader or resume path.

MLX imports happen only after input validation. The caller must verify the local
base artifacts and supervise wall time, RSS, swap and free disk. MLX's allocator
limit is advisory; this worker additionally checks observed allocation peaks.
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import resource
import sys
import tempfile
import time

from .artifacts import hash_file, write_json_new


DEFAULT_CONFIG = {
    'steps': 20, 'max_seq_length': 256, 'num_layers': 2, 'rank': 4,
    'scale': 8.0, 'learning_rate': 0.0001, 'seed': 0,
    'max_mlx_bytes': 12 * 1024**3,
}
LORA_KEYS = ['self_attn.q_proj', 'self_attn.v_proj']
CHECKPOINT_FILES = {'adapters.safetensors', 'adapter_config.json', 'checkpoint-evidence.json'}
MAX_PROCESS_RSS = 14 * 1024**3
_IDENTITY = re.compile(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@[0-9a-f]{40}')
_DIGEST = re.compile(r'[0-9a-f]{64}')


def validate_config(config):
    if not isinstance(config, dict) or set(config) - set(DEFAULT_CONFIG):
        raise ValueError('Invalid mechanics configuration keys')
    value = {**DEFAULT_CONFIG, **config}
    bounds = {'steps': (1, 20), 'max_seq_length': (16, 512),
              'num_layers': (1, 2), 'rank': (1, 8), 'seed': (0, 2**32 - 1),
              'max_mlx_bytes': (1024**3, 12 * 1024**3)}
    for key, (lower, upper) in bounds.items():
        if type(value[key]) is not int or not lower <= value[key] <= upper:
            raise ValueError('Mechanics integer bound violated: ' + key)
    for key, upper in (('scale', 32), ('learning_rate', 0.001)):
        if (type(value[key]) not in (int, float) or not math.isfinite(value[key])
                or not 0 < value[key] <= upper):
            raise ValueError('Mechanics numeric bound violated: ' + key)
        value[key] = float(value[key])
    return value


def _safe_path(value, *, exists):
    if not isinstance(value, str) or not value or not Path(value).is_absolute():
        raise ValueError('An absolute local path is required')
    path = Path(value)
    # Refuse linked ancestors as well as a linked final component.
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise ValueError('Symlink paths are not accepted')
    return path.resolve(strict=exists)


def _checkpoint_hashes(directory):
    result = {}
    for name in sorted(CHECKPOINT_FILES):
        path = directory / name
        if path.is_symlink() or not path.is_file():
            raise ValueError('Incomplete or linked checkpoint artifact')
        limit = 64 * 1024**2 if name.endswith('.safetensors') else 4 * 1024**2
        if path.stat().st_size > limit:
            raise ValueError('Checkpoint artifact exceeds mechanics bound')
        result[name] = hash_file(path)
    return result


def vocabulary_size(model_config, model_path):
    """Use explicit metadata, or Gemma's verified packed embedding row count.

    This conversion omits vocab_size; the pinned loader supplies its default.
    Inspect actual tensor metadata before loading and check the loader afterwards.
    """
    size = model_config.get('text_config', model_config).get('vocab_size')
    if size is None and model_config.get('model_type') == 'gemma3':
        path = Path(model_path) / 'model.safetensors'
        if path.is_symlink():
            raise ValueError('Linked model tensor file')
        with path.open('rb') as stream:
            header_length = int.from_bytes(stream.read(8), 'little')
            if not 1 <= header_length <= 8 * 1024**2:
                raise ValueError('Invalid safetensors header size')
            header = json.loads(stream.read(header_length))
        embedding = header.get('language_model.model.embed_tokens.weight', {})
        shape = embedding.get('shape', [])
        if len(shape) != 2 or embedding.get('dtype') != 'U32':
            raise ValueError('Expected packed text embedding tensor')
        size = shape[0]
    if type(size) is not int or not 1 <= size <= 1_000_000:
        raise ValueError('Explicit or tensor-derived vocabulary size is required')
    return size


def validate_payload(payload):
    from .training_inputs import validate_training_record

    required = {'mode', 'model_path', 'model_identity', 'records', 'config', 'checkpoint_dir'}
    if (not isinstance(payload, dict) or not required <= set(payload)
            or set(payload) - required - {'expected_checkpoint_files', 'validation_records', 'release_sha256'}):
        raise ValueError('Invalid mechanics payload keys')
    if payload['mode'] not in ('train', 'reload'):
        raise ValueError('Only fresh training and verified reload are supported')
    identity = payload['model_identity']
    if not isinstance(identity, str) or not _IDENTITY.fullmatch(identity):
        raise ValueError('An exact model repository and revision are required')
    config = validate_config(payload['config'])
    path = _safe_path(payload['model_path'], exists=True)
    model_config_path = path / 'config.json'
    if (not path.is_dir() or model_config_path.is_symlink() or not model_config_path.is_file()
            or model_config_path.stat().st_size > 1024**2):
        raise ValueError('A local model configuration is required')
    model_config = json.loads(model_config_path.read_text())
    if ('model_file' in model_config
            or model_config.get('model_type') not in {'qwen3', 'gemma3', 'gemma3_text'}):
        raise ValueError('Custom or unsupported model code is forbidden')
    quantization = model_config.get('quantization', {})
    if quantization.get('bits') != 4 or quantization.get('group_size') != 64:
        raise ValueError('Mechanics requires the inspected four-bit group-64 model')
    vocab_size = vocabulary_size(model_config, path)
    records = payload['records']
    if not isinstance(records, list) or not 1 <= len(records) <= 16:
        raise ValueError('Expected one to sixteen mechanics records')
    ids = []
    for record in records:
        validate_training_record(record, config['max_seq_length'])
        if max(record['tokens']) >= vocab_size:
            raise ValueError('Record token is outside the model vocabulary')
        ids.append(record['example_id'])
        if ('prompt_token_ids' in record
                and record['prompt_token_ids'] != record['tokens'][:record['offset']]):
            raise ValueError('Generation prompt differs from the audited training prefix')
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate mechanics record identifier')
    validation_records = payload.get('validation_records', [])
    if 'release_sha256' in payload:
        if not isinstance(payload['release_sha256'], str) or not _DIGEST.fullmatch(payload['release_sha256']):
            raise ValueError('An exact immutable dataset release identity is required')
        if not isinstance(validation_records, list) or not 1 <= len(validation_records) <= 16:
            raise ValueError('Released training requires one to sixteen validation records')
        validation_ids = []
        for record in validation_records:
            validate_training_record(record, config['max_seq_length'])
            if max(record['tokens']) >= vocab_size:
                raise ValueError('Validation token is outside the model vocabulary')
            validation_ids.append(record['example_id'])
        if len(validation_ids) != len(set(validation_ids)) or set(ids).intersection(validation_ids):
            raise ValueError('Training and validation identifiers must be disjoint')
    elif 'validation_records' in payload:
        raise ValueError('Validation records require an immutable dataset release identity')
    checkpoint = _safe_path(payload['checkpoint_dir'], exists=payload['mode'] == 'reload')
    if checkpoint == path or path in checkpoint.parents or checkpoint in path.parents:
        raise ValueError('Checkpoint must be separate from the base model')
    if payload['mode'] == 'train':
        if 'expected_checkpoint_files' in payload:
            raise ValueError('Training does not accept an existing checkpoint identity')
        if checkpoint.exists() and (not checkpoint.is_dir() or any(checkpoint.iterdir())):
            raise ValueError('Training requires an empty checkpoint directory')
        if not checkpoint.parent.is_dir():
            raise ValueError('Checkpoint parent must already exist')
    else:
        expected = payload.get('expected_checkpoint_files')
        if (not isinstance(expected, dict) or set(expected) != CHECKPOINT_FILES
                or any(not isinstance(v, str) or not _DIGEST.fullmatch(v) for v in expected.values())
                or _checkpoint_hashes(checkpoint) != expected):
            raise ValueError('Checkpoint identity differs from the completed training process')
    return {**payload, 'config': config, 'model_path': str(path), 'checkpoint_dir': str(checkpoint)}


def _canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                    ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def checkpoint_config(payload):
    config = payload['config']
    value = {'schema_version': '1.0', 'model_identity': payload['model_identity'],
            'fine_tune_type': 'lora', 'num_layers': config['num_layers'],
            'lora_parameters': {'rank': config['rank'], 'scale': config['scale'],
                                'dropout': 0.0, 'keys': LORA_KEYS},
            'training_config': config, 'records_sha256': _canonical_hash(payload['records']),
            'restart_support': 'none; this checkpoint saves adapter weights, not optimizer or RNG state'}
    if 'release_sha256' in payload:
        value.update(release_sha256=payload['release_sha256'],
                     validation_records_sha256=_canonical_hash(payload['validation_records']))
    return value


def validate_tensor_schema(actual, expected):
    """Exact set, shape, dtype and optional byte digest; usable without MLX."""
    if not isinstance(actual, dict) or not isinstance(expected, dict) or not expected:
        raise ValueError('A nonempty tensor inventory is required')
    if set(actual) != set(expected):
        raise ValueError('Checkpoint tensor names differ')
    for key in expected:
        for field in ('shape', 'dtype'):
            if actual[key].get(field) != expected[key].get(field):
                raise ValueError('Checkpoint tensor schema differs')
        if ('sha256' in expected[key]
                and actual[key].get('sha256') != expected[key]['sha256']):
            raise ValueError('Checkpoint tensor bytes differ')


def _array_digest(value, mx):
    import numpy as np

    digest = hashlib.sha256()
    # At most eight MiB of host bytes per chunk, including bfloat16/packed weights.
    raw = value.reshape(-1).view(mx.uint8).reshape(-1)
    for offset in range(0, raw.size, 8 * 1024**2):
        chunk = raw[offset:offset + 8 * 1024**2]
        mx.eval(chunk)
        digest.update(memoryview(np.asarray(chunk)).cast('B'))
    return digest.hexdigest()


def _inventory(arrays, mx, *, hashes=True):
    result = {}
    for name, value in sorted(arrays.items()):
        result[name] = {'shape': list(value.shape), 'dtype': str(value.dtype)}
        if hashes:
            result[name]['sha256'] = _array_digest(value, mx)
    return result


def _rss_bytes():
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(value if sys.platform == 'darwin' else value * 1024)


def _measure_memory(mx, bound):
    result = {'mlx_active_bytes': int(mx.get_active_memory()),
              'mlx_peak_bytes': int(mx.get_peak_memory()),
              'mlx_cache_bytes': int(mx.get_cache_memory()),
              'process_peak_rss_bytes': _rss_bytes()}
    if result['mlx_peak_bytes'] > bound or result['mlx_active_bytes'] > bound:
        raise MemoryError('Observed MLX allocations exceeded the declared bound')
    if result['process_peak_rss_bytes'] > MAX_PROCESS_RSS:
        raise MemoryError('Observed process peak RSS exceeded the declared bound')
    return result


def _progress(scratch, value):
    fd, temporary = tempfile.mkstemp(prefix='.training-progress-', dir=scratch)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, allow_nan=False)
        os.replace(temporary, scratch / 'progress.json')
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _trainables(model, config, tree_flatten):
    arrays = dict(tree_flatten(model.trainable_parameters()))
    expected_layers = set(range(len(model.layers) - config['num_layers'], len(model.layers)))
    found = set()
    for name in arrays:
        match = re.search(r'(?:^|\.)layers\.(\d+)\.self_attn\.(q_proj|v_proj)\.lora_(a|b)$', name)
        if not match or int(match[1]) not in expected_layers:
            raise ValueError('An unintended model parameter is trainable')
        found.add((int(match[1]), match[2], match[3]))
    wanted = {(layer, projection, side) for layer in expected_layers
              for projection in ('q_proj', 'v_proj') for side in ('a', 'b')}
    if found != wanted or len(arrays) != len(wanted):
        raise ValueError('Missing or duplicated intended adapter tensors')
    return arrays


def assistant_loss(model, tokens, offset, mx, nn):
    """Batch-one assistant/EOS loss; original target positions offset <= p < n.

    Inputs have no padding and are never truncated. Target position p is output
    column p-1. Only selected targets enter cross entropy or its denominator.
    """
    batch = mx.array([tokens], dtype=mx.int32)
    logits = model(batch[:, :-1])
    selected_logits = logits[:, offset - 1:len(tokens) - 1, :]
    selected_targets = batch[:, offset:len(tokens)]
    return nn.losses.cross_entropy(selected_logits, selected_targets).astype(mx.float32).mean()


def _assert_finite(arrays, mx):
    checks = [mx.all(mx.isfinite(value)) for value in arrays.values()]
    mx.eval(checks)
    if not all(bool(check.item()) for check in checks):
        raise FloatingPointError('Nonfinite adapter or gradient value')


def token_weighted_loss(rows):
    """One assistant-token weighting formula for both training and validation."""
    if not isinstance(rows, list) or not rows:
        raise ValueError('Loss aggregation requires nonempty examples')
    for row in rows:
        count, loss = row.get('supervised_tokens'), row.get('loss')
        if type(count) is not int or count < 1:
            raise ValueError('Loss aggregation requires positive supervised token counts')
        if type(loss) not in (int, float) or not math.isfinite(loss):
            raise FloatingPointError('Loss aggregation requires finite losses')
    value = sum(row['loss'] * row['supervised_tokens'] for row in rows) / sum(
        row['supervised_tokens'] for row in rows)
    if not math.isfinite(value):
        raise FloatingPointError('Nonfinite aggregate loss')
    return value


def _evaluate_records(model, records, mx, nn, config, stage, stage_name):
    model.eval()
    rows = []
    started = time.monotonic()
    for index, record in enumerate(records):
        stage(stage_name, validation_example=index + 1)
        loss = assistant_loss(model, record['tokens'], record['offset'], mx, nn)
        mx.eval(loss)
        rows.append({'example_id': record['example_id'], 'loss': float(loss.item()),
                     'supervised_tokens': len(record['tokens']) - record['offset'],
                     'complete_tokens': len(record['tokens'])})
        token_weighted_loss(rows)  # Fail at the first nonfinite example.
        _measure_memory(mx, config['max_mlx_bytes'])
        mx.clear_cache()
    return {'token_weighted_loss': token_weighted_loss(rows),
            'supervised_tokens': sum(row['supervised_tokens'] for row in rows),
            'complete_tokens': sum(row['complete_tokens'] for row in rows),
            'examples': rows, 'seconds': time.monotonic() - started,
            'objective': 'final_assistant_and_template_suffix_only',
            'quality_claim': None}


def execute(payload, scratch):
    started = time.monotonic()
    scratch = Path(scratch)
    result = {'outcome': 'runtime_failure', 'mode': payload.get('mode') if isinstance(payload, dict) else None,
              'model_identity': payload.get('model_identity') if isinstance(payload, dict) else None,
              'adapter_identity': None, 'completed_steps': 0, 'stage': 'validate',
              'measurements': {}, 'evidence': {}}
    mx = None

    def stage(name, **extra):
        result['stage'] = name
        _progress(scratch, {'stage': name, 'completed_steps': result['completed_steps'],
                            'elapsed_seconds': time.monotonic() - started, **extra})

    try:
        stage('validate')
        payload = validate_payload(payload)
        config = payload['config']
        checkpoint = Path(payload['checkpoint_dir'])
        expected_vocab_size = vocabulary_size(
            json.loads((Path(payload['model_path']) / 'config.json').read_text()), payload['model_path'])
        expected_config = checkpoint_config(payload)
        if payload['mode'] == 'reload':
            if json.loads((checkpoint / 'adapter_config.json').read_text()) != expected_config:
                raise ValueError('Checkpoint configuration differs from this experiment')
            saved_evidence = json.loads((checkpoint / 'checkpoint-evidence.json').read_text())
            if (saved_evidence.get('completed_steps') != config['steps']
                    or saved_evidence.get('base_unchanged') is not True
                    or saved_evidence.get('model_identity') != payload['model_identity']):
                raise ValueError('Checkpoint does not prove completed training')
        versions = {name: importlib.metadata.version(name) for name in ('mlx', 'mlx-lm')}
        if versions != {'mlx': '0.32.2', 'mlx-lm': '0.31.3'}:
            raise ValueError('Mechanics worker requires the inspected MLX runtime')
        result['measurements']['runtime'] = versions
        os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
                          HF_HUB_DISABLE_TELEMETRY='1', TOKENIZERS_PARALLELISM='false')
        os.umask(0o077)
        stage('import_runtime')
        import mlx.core as mx
        import mlx.nn as nn
        import mlx.optimizers as optim
        from mlx.utils import tree_flatten, tree_unflatten
        from mlx_lm import load
        from mlx_lm.models.cache import make_prompt_cache
        from mlx_lm.tuner.utils import linear_to_lora_layers

        if not mx.metal.is_available():
            raise ValueError('Apple Metal is unavailable')
        mx.set_memory_limit(config['max_mlx_bytes'])
        mx.set_cache_limit(128 * 1024**2)
        mx.reset_peak_memory()
        mx.random.seed(config['seed'])
        result['measurements']['limits'] = {
            'mlx_allocator_guideline_bytes': config['max_mlx_bytes'],
            'observed_mlx_peak_stop_bytes': config['max_mlx_bytes'], 'cache_limit_bytes': 128 * 1024**2,
            'process_peak_rss_stop_bytes': MAX_PROCESS_RSS,
            'enforcement': 'MLX allocator limit is advisory; check peaks at stage/step boundaries; parent supervises process resources',
        }
        stage('load_base')
        stamp = time.monotonic()
        model, tokenizer, model_config = load(payload['model_path'],
            tokenizer_config={'local_files_only': True, 'trust_remote_code': False}, return_config=True)
        mx.eval(model.parameters())
        result['measurements']['load_seconds'] = time.monotonic() - stamp
        result['measurements']['after_load'] = _measure_memory(mx, config['max_mlx_bytes'])
        vocab_size = model_config.get('text_config', model_config).get('vocab_size')
        if type(vocab_size) is not int or vocab_size < 1:
            raise ValueError('Explicit model vocabulary size is required')
        if vocab_size != expected_vocab_size:
            raise ValueError('Loaded vocabulary differs from preflight tensor/config evidence')
        result['measurements']['verified_vocabulary_size'] = vocab_size
        stage('verify_runtime_rendering')
        from .training_inputs import prepare_training_example
        for record in payload['records'] + payload.get('validation_records', []):
            if max(record['tokens']) >= vocab_size:
                raise ValueError('Record token is outside the model vocabulary')
            rendered = prepare_training_example(tokenizer, example_id=record['example_id'],
                messages=record['messages'], max_seq_length=config['max_seq_length'],
                template_kwargs={'candidate_id': record['candidate_id'], 'reasoning_mode': 'disabled'})
            if any(record.get(key) != value for key, value in rendered.items()):
                raise ValueError('Loaded tokenizer or rendering differs from audited project inputs')
        result['evidence']['runtime_inputs_verified'] = True
        if 'release_sha256' in payload:
            result['evidence']['release_sha256'] = payload['release_sha256']
        if len(model.layers) < config['num_layers']:
            raise ValueError('Requested adapter depth exceeds this model')
        stage('prepare_adapter')
        model.freeze()
        linear_to_lora_layers(model, config['num_layers'], expected_config['lora_parameters'])
        adapters = _trainables(model, config, tree_flatten)
        mx.eval(adapters)
        _assert_finite(adapters, mx)
        initial_adapters = _inventory(adapters, mx)
        base = {key: value for key, value in tree_flatten(model.parameters()) if key not in adapters}
        if not base:
            raise ValueError('No frozen base tensors found')
        stage('hash_frozen_base_before')
        stamp = time.monotonic()
        base_before = _inventory(base, mx)
        result['measurements']['base_hash_before_seconds'] = time.monotonic() - stamp
        del base
        result['evidence'].update(adapter_tensor_count=len(adapters), frozen_tensor_count=len(base_before))
        if payload['mode'] == 'train':
            if payload.get('validation_records'):
                result['evidence']['validation_before'] = _evaluate_records(
                    model, payload['validation_records'], mx, nn, config, stage, 'validation_before')
            optimizer = optim.Adam(learning_rate=config['learning_rate'])
            value_and_grad = nn.value_and_grad(model,
                lambda current, tokens, offset: assistant_loss(current, tokens, offset, mx, nn))
            steps = []
            model.train()
            for index in range(config['steps']):
                record = payload['records'][index % len(payload['records'])]
                stage('gradient', step=index + 1)
                stamp = time.monotonic()
                loss, gradients = value_and_grad(model, record['tokens'], record['offset'])
                mx.eval(loss, gradients)
                loss_value = float(loss.item())
                if not math.isfinite(loss_value):
                    raise FloatingPointError('Nonfinite assistant loss')
                gradient_arrays = dict(tree_flatten(gradients))
                if set(gradient_arrays) != set(adapters):
                    raise ValueError('Gradient tensor set differs from intended adapters')
                _assert_finite(gradient_arrays, mx)
                gradient_norm = float(mx.sqrt(sum(mx.sum(value.astype(mx.float32) ** 2)
                                      for value in gradient_arrays.values())).item())
                if not math.isfinite(gradient_norm) or gradient_norm == 0:
                    raise FloatingPointError('Gradient norm is nonfinite or zero')
                gradient_seconds = time.monotonic() - stamp
                previous = _trainables(model, config, tree_flatten)
                stage('optimizer_update', step=index + 1)
                stamp = time.monotonic()
                optimizer.update(model, gradients)
                mx.eval(model.trainable_parameters(), optimizer.state)
                adapters = _trainables(model, config, tree_flatten)
                _assert_finite(adapters, mx)
                changed = [name for name in adapters if bool(mx.any(adapters[name] != previous[name]).item())]
                if not changed:
                    raise ValueError('Optimizer update did not change any adapter tensor')
                update_norm = float(mx.sqrt(sum(mx.sum((adapters[name] - previous[name]).astype(mx.float32) ** 2)
                                    for name in adapters)).item())
                if not math.isfinite(update_norm) or update_norm == 0:
                    raise FloatingPointError('Adapter update norm is nonfinite or zero')
                row = {'step': index + 1, 'example_id': record['example_id'], 'loss': loss_value,
                       'complete_tokens': len(record['tokens']),
                       'supervised_tokens': len(record['tokens']) - record['offset'],
                       'gradient_l2': gradient_norm, 'update_l2': update_norm,
                       'changed_tensor_count': len(changed), 'changed_tensor_names': changed,
                       'gradient_seconds': gradient_seconds,
                       'update_seconds': time.monotonic() - stamp,
                       **_measure_memory(mx, config['max_mlx_bytes'])}
                steps.append(row)
                result['completed_steps'] = index + 1
                result['evidence']['steps'] = steps
                stage('step_complete', step=index + 1, last_step=row)
                del previous, gradients, gradient_arrays
                mx.clear_cache()
            model.eval()
            if payload.get('validation_records'):
                result['evidence']['validation_after'] = _evaluate_records(
                    model, payload['validation_records'], mx, nn, config, stage, 'validation_after')
            final_adapters = _inventory(adapters, mx)
            changed_total = sum(initial_adapters[name]['sha256'] != final_adapters[name]['sha256']
                                for name in adapters)
            result['evidence']['changed_tensor_count'] = changed_total
            stage('hash_frozen_base_after')
            stamp = time.monotonic()
            base_after = _inventory({key: value for key, value in tree_flatten(model.parameters())
                                     if key not in adapters}, mx)
            result['measurements']['base_hash_after_seconds'] = time.monotonic() - stamp
            validate_tensor_schema(base_after, base_before)
            result['evidence']['base_unchanged'] = True
            result['measurements']['training'] = {
                'updates': len(steps), 'complete_tokens': sum(row['complete_tokens'] for row in steps),
                'supervised_tokens': sum(row['supervised_tokens'] for row in steps),
                'token_weighted_training_loss': token_weighted_loss(steps),
                'gradient_seconds': sum(row['gradient_seconds'] for row in steps),
                'update_seconds': sum(row['update_seconds'] for row in steps),
                'validation_loss': result['evidence'].get('validation_after', {}).get('token_weighted_loss'),
            }
            stage('save_checkpoint')
            checkpoint.mkdir(mode=0o700, exist_ok=True)
            checkpoint.chmod(0o700)
            fd, temporary = tempfile.mkstemp(prefix='.adapter-', suffix='.safetensors', dir=checkpoint)
            os.close(fd)
            try:
                mx.save_safetensors(temporary, adapters)
                os.chmod(temporary, 0o600)
                os.link(temporary, checkpoint / 'adapters.safetensors')
            finally:
                os.unlink(temporary)
            write_json_new(checkpoint / 'adapter_config.json', expected_config)
            proof = {'schema_version': '1.0', 'model_identity': payload['model_identity'],
                     'completed_steps': result['completed_steps'], 'base_unchanged': True,
                     'adapter_initial': initial_adapters, 'adapter_final': final_adapters,
                     'base_before': base_before, 'base_after': base_after, 'steps': steps,
                     'adapter_file_sha256': hash_file(checkpoint / 'adapters.safetensors'),
                     'adapter_config_sha256': hash_file(checkpoint / 'adapter_config.json')}
            if 'release_sha256' in payload:
                proof.update(release_sha256=payload['release_sha256'],
                    validation_before=result['evidence']['validation_before'],
                    validation_after=result['evidence']['validation_after'])
            write_json_new(checkpoint / 'checkpoint-evidence.json', proof)
            result['evidence']['checkpoint_files'] = _checkpoint_hashes(checkpoint)
            result['adapter_identity'] = 'sha256:' + proof['adapter_file_sha256']
            result['evidence']['reload_verified'] = False
        else:
            stage('verify_checkpoint_tensors')
            validate_tensor_schema(base_before, saved_evidence['base_after'])
            saved = mx.load(str(checkpoint / 'adapters.safetensors'))
            loaded_inventory = _inventory(saved, mx)
            validate_tensor_schema(loaded_inventory, saved_evidence['adapter_final'])
            validate_tensor_schema(loaded_inventory, _inventory(adapters, mx, hashes=False))
            _assert_finite(saved, mx)
            # Module.update(strict=True) verifies destinations. Full adapter key set,
            # shape, dtype and byte equality were verified separately above.
            model.update(tree_unflatten(list(saved.items())), strict=True)
            adapters = _trainables(model, config, tree_flatten)
            mx.eval(adapters)
            validate_tensor_schema(_inventory(adapters, mx), saved_evidence['adapter_final'])
            if any(not bool(mx.array_equal(adapters[name], saved[name]).item()) for name in saved):
                raise ValueError('Assigned adapter values differ from the saved tensors')
            result['evidence'].update(base_unchanged=True, reload_verified=True,
                changed_tensor_count=sum(initial_adapters[name]['sha256'] != loaded_inventory[name]['sha256']
                                         for name in adapters),
                checkpoint_files=_checkpoint_hashes(checkpoint))
            if result['evidence']['changed_tensor_count'] == 0:
                raise ValueError('Reloaded checkpoint equals the initial untrained adapters')
            result['completed_steps'] = saved_evidence['completed_steps']
            result['adapter_identity'] = 'sha256:' + result['evidence']['checkpoint_files']['adapters.safetensors']
            model.eval()
            if payload.get('validation_records'):
                validation = _evaluate_records(model, payload['validation_records'], mx, nn,
                                               config, stage, 'validation_reloaded')
                expected = saved_evidence['validation_after']
                if (saved_evidence.get('release_sha256') != payload['release_sha256']
                        or validation['supervised_tokens'] != expected['supervised_tokens']
                        or len(validation['examples']) != len(expected['examples'])):
                    raise ValueError('Reload validation identity differs from the training checkpoint')
                for current, original in zip(validation['examples'], expected['examples']):
                    if (current['example_id'] != original['example_id']
                            or current['supervised_tokens'] != original['supervised_tokens']
                            or not math.isclose(current['loss'], original['loss'], rel_tol=1e-5, abs_tol=1e-6)):
                        raise ValueError('Reload validation does not reproduce checkpoint losses')
                result['evidence']['validation_reloaded'] = validation
                result['evidence']['validation_reload_verified'] = True
            stage('reload_inference')
            prompt = payload['records'][0]['tokens'][:payload['records'][0]['offset']]
            output_ids = []
            stamp = time.monotonic()
            stop_ids = set(tokenizer.eos_token_ids)
            generation_file = Path(payload['model_path']) / 'generation_config.json'
            if generation_file.is_file():
                declared = json.loads(generation_file.read_text()).get('eos_token_id')
                if declared is not None:
                    stop_ids.update(declared if isinstance(declared, list) else [declared])
            if not stop_ids or any(type(token) is not int or not 0 <= token < vocab_size for token in stop_ids):
                raise ValueError('Explicit valid stop-token IDs are required')
            cache = make_prompt_cache(model)
            next_input = mx.array([prompt], dtype=mx.int32)
            finish_reason = 'length'
            # Own this tiny greedy loop: stream_generate temporarily raises the
            # wired-memory limit, and generate_step computes an extra lookahead.
            for _ in range(16):
                logits = model(next_input, cache=cache)[:, -1, :]
                if not bool(mx.all(mx.isfinite(logits)).item()):
                    raise FloatingPointError('Nonfinite reload inference logits')
                token = int(mx.argmax(logits, axis=-1).item())
                output_ids.append(token)
                _measure_memory(mx, config['max_mlx_bytes'])
                stage('reload_inference', generation_steps=len(output_ids))
                if token in stop_ids:
                    finish_reason = 'stop'
                    break
                next_input = mx.array([[token]], dtype=mx.int32)
            if not 1 <= len(output_ids) <= 16:
                raise ValueError('Reload inference produced no bounded execution evidence')
            raw = tokenizer.decode(output_ids, skip_special_tokens=True)
            result['evidence']['inference'] = {
                'model_identity': payload['model_identity'], 'adapter_identity': result['adapter_identity'],
                'prompt_token_ids': prompt, 'output_token_ids': output_ids, 'raw_output': raw,
                'max_output_tokens': 16, 'temperature': 0, 'finish_reason': finish_reason,
                'stop_token_ids': sorted(stop_ids), 'output_token_count_includes_stop': True,
                'quality_claim': None, 'purpose': 'reloaded adapter execution mechanics only',
            }
            result['measurements']['inference_seconds'] = time.monotonic() - stamp
        result['measurements']['final_memory'] = _measure_memory(mx, config['max_mlx_bytes'])
        result['outcome'] = 'success'
        stage('complete')
    except Exception as exc:
        # Exception messages may contain local paths or input text. Preserve type and
        # last stable operation for actionable diagnostics without printing inputs.
        result['error_type'] = type(exc).__name__
        if mx is not None:
            try:
                result['measurements']['failure_memory'] = {
                    'mlx_peak_bytes': int(mx.get_peak_memory()), 'process_peak_rss_bytes': _rss_bytes()}
            except Exception:
                pass
    result['measurements']['worker_seconds'] = time.monotonic() - started
    return result


def main():
    scratch = Path(sys.argv[1]).resolve(strict=True)
    payload = json.loads((scratch / 'request.json').read_text())
    write_json_new(scratch / 'response.json', execute(payload, scratch))


if __name__ == '__main__':
    main()
