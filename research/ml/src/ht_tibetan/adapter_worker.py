"""Local inference child with strict adapter assignment and bounded greedy output.

Base and adapted arms use the same load path, cache, seed, stop set and greedy
loop. No model imports occur until explicit execute() after payload validation.
"""
from __future__ import annotations

from dataclasses import asdict
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import time

from .adapter_backend import (EXECUTION_CONTRACT, MAX_MLX_BYTES, _json, _path, _read,
                              verify_adapter_checkpoint)
from .artifacts import write_json_new
from .inference import InferenceRequest, InferenceResult
from .mlx_backend import validate_local_request
from .training_worker import (_assert_finite, _inventory, _measure_memory, _progress,
                              _trainables, validate_tensor_schema, vocabulary_size)


def validate_payload(payload):
    required = {'request', 'model_path', 'model_identity', 'prompt_token_ids', 'seed', 'temperature',
                'checkpoint_dir', 'checkpoint_hashes', 'adapter_identity'}
    if not isinstance(payload, dict) or set(payload) != required:
        raise ValueError('Invalid adapter inference payload')
    request = InferenceRequest(**payload['request'])
    path = _path(payload['model_path'])
    validate_local_request(request, path, payload['model_identity'], payload['prompt_token_ids'],
                           payload['seed'], payload['temperature'])
    config = _json(_read(path / 'config.json', 1024**2))
    quantization = config.get('quantization', {})
    if quantization.get('bits') != 4 or quantization.get('group_size') != 64:
        raise ValueError('Expected the inspected four-bit group-64 base')
    vocab = vocabulary_size(config, path)
    if max(payload['prompt_token_ids']) >= vocab:
        raise ValueError('Prompt token exceeds the model vocabulary')
    checkpoint = None
    if payload['checkpoint_dir'] is None:
        if payload['checkpoint_hashes'] is not None or payload['adapter_identity'] is not None:
            raise ValueError('Base arm must not carry adapter identities')
    else:
        checkpoint = verify_adapter_checkpoint(payload['checkpoint_dir'], payload['model_identity'])
        if (checkpoint['checkpoint_hashes'] != payload['checkpoint_hashes']
                or checkpoint['adapter_identity'] != payload['adapter_identity']):
            raise ValueError('Checkpoint bytes differ from explicit requested pins')
        adapter_path = Path(checkpoint['checkpoint_dir'])
        if adapter_path == path or adapter_path in path.parents or path in adapter_path.parents:
            raise ValueError('Adapter checkpoint must be separate from base snapshot')
    return request, path, vocab, checkpoint


def execute(payload, scratch):
    request, path, vocab, checkpoint = validate_payload(payload)
    scratch = Path(scratch)
    started = time.monotonic()
    raw, output_ids, phase = '', [], 'validated'
    measurements = {'execution_contract': EXECUTION_CONTRACT,
                    'adapter_verified': False, 'runtime_input_ids_verified': False,
                    'checkpoint_files': None, 'seed': payload['seed'], 'temperature': payload['temperature'],
                    'output_token_ids': output_ids, 'output_token_count_includes_stop': True,
                    'timing_scope': 'Generation excludes loading and adapter verification; whole-worker timing includes both.'}
    mx = None

    def progress(name):
        nonlocal phase
        phase = name
        _progress(scratch, {'stage': name, 'raw_output': raw, 'output_token_ids': output_ids,
                            'elapsed_seconds': time.monotonic() - started})

    try:
        progress('import_runtime')
        versions = {name: importlib.metadata.version(name) for name in ('mlx', 'mlx-lm')}
        if versions != {'mlx': '0.32.2', 'mlx-lm': '0.31.3'}:
            raise ValueError('Requires the inspected native MLX runtime')
        measurements['runtime'] = versions
        os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
                          TOKENIZERS_PARALLELISM='false')
        os.umask(0o077)
        import mlx.core as mx
        from mlx.utils import tree_flatten, tree_unflatten
        from mlx_lm import load
        from mlx_lm.models.cache import make_prompt_cache
        from mlx_lm.tuner.utils import linear_to_lora_layers

        if not mx.metal.is_available():
            raise ValueError('Apple Metal is unavailable')
        mx.set_memory_limit(MAX_MLX_BYTES)
        mx.set_cache_limit(128 * 1024**2)
        mx.reset_peak_memory()
        mx.random.seed(payload['seed'])
        progress('load_base')
        stamp = time.monotonic()
        model, tokenizer, loaded_config = load(str(path),
            tokenizer_config={'local_files_only': True, 'trust_remote_code': False}, return_config=True)
        mx.eval(model.parameters())
        measurements['load_seconds'] = time.monotonic() - stamp
        measurements.update(_measure_memory(mx, MAX_MLX_BYTES))
        if vocabulary_size(loaded_config, path) != vocab:
            raise ValueError('Loaded vocabulary differs from verified tensor metadata')
        if tokenizer.encode(request.prompt, add_special_tokens=False) != payload['prompt_token_ids']:
            raise ValueError('Loaded tokenizer differs from the exact rendered prompt')
        measurements['runtime_input_ids_verified'] = True
        if checkpoint is not None:
            progress('verify_adapter')
            stamp = time.monotonic()
            config = checkpoint['config']
            if len(model.layers) < config['num_layers']:
                raise ValueError('Adapter layers exceed the loaded model')
            model.freeze()
            linear_to_lora_layers(model, config['num_layers'], config['lora_parameters'])
            fresh = _trainables(model, config['training_config'], tree_flatten)
            mx.eval(fresh)
            validate_tensor_schema(_inventory(fresh, mx, hashes=False),
                {k: {field: value[field] for field in ('shape', 'dtype')}
                 for k, value in checkpoint['tensor_inventory'].items()})
            frozen = {k: v for k, v in tree_flatten(model.parameters()) if k not in fresh}
            validate_tensor_schema(_inventory(frozen, mx), checkpoint['evidence']['base_after'])
            del frozen
            saved = mx.load(str(Path(checkpoint['checkpoint_dir']) / 'adapters.safetensors'))
            _assert_finite(saved, mx)
            validate_tensor_schema(_inventory(saved, mx), checkpoint['tensor_inventory'])
            model.update(tree_unflatten(list(saved.items())), strict=True)
            assigned = _trainables(model, config['training_config'], tree_flatten)
            mx.eval(assigned)
            validate_tensor_schema(_inventory(assigned, mx), checkpoint['tensor_inventory'])
            if any(not bool(mx.array_equal(assigned[k], saved[k]).item()) for k in saved):
                raise ValueError('Assigned adapter differs from saved tensor bytes')
            if verify_adapter_checkpoint(checkpoint['checkpoint_dir'], payload['model_identity'])['checkpoint_hashes'] != payload['checkpoint_hashes']:
                raise ValueError('Checkpoint changed during strict assignment')
            measurements.update(adapter_verified=True, checkpoint_files=payload['checkpoint_hashes'],
                adapter_tensor_count=len(assigned), frozen_tensor_count=len(checkpoint['evidence']['base_after']),
                adapter_verification_seconds=time.monotonic() - stamp)
            del fresh, saved, assigned
        model.eval()
        measurements.update(_measure_memory(mx, MAX_MLX_BYTES))
        stop_ids = set(tokenizer.eos_token_ids)
        generation = path / 'generation_config.json'
        if generation.is_file():
            declared = _json(_read(generation, 1024**2)).get('eos_token_id')
            if declared is not None:
                stop_ids.update(declared if isinstance(declared, list) else [declared])
        if not stop_ids or any(type(n) is not int or not 0 <= n < vocab for n in stop_ids):
            raise ValueError('A valid explicit stop-token set is required')
        measurements['stop_token_ids'] = sorted(stop_ids)
        cache = make_prompt_cache(model)
        next_input = mx.array([payload['prompt_token_ids']], dtype=mx.int32)
        reason = 'output_limit'
        stamp = time.monotonic()
        progress('generate')
        for _ in range(request.max_output_tokens):
            logits = model(next_input, cache=cache)[:, -1, :]
            if not bool(mx.all(mx.isfinite(logits)).item()):
                raise FloatingPointError('Nonfinite generation logits')
            token = int(mx.argmax(logits, axis=-1).item())
            output_ids.append(token)
            raw = tokenizer.decode(output_ids, skip_special_tokens=True)
            if len(raw.encode('utf-8')) > 1024**2:
                raise ValueError('Raw output exceeds its byte bound')
            measurements.update(_measure_memory(mx, MAX_MLX_BYTES))
            progress('generate')
            if token in stop_ids:
                reason = 'stop'
                break
            next_input = mx.array([[token]], dtype=mx.int32)
        measurements['generation_seconds'] = time.monotonic() - stamp
        if reason == 'stop' and ('<think>' in raw or '</think>' in raw):
            reason = 'unexpected_reasoning_markup'
        if reason == 'stop' and not raw.strip():
            reason = 'empty_output'
        progress('complete')
        success = reason == 'stop'
        result = InferenceResult(request.run_id, 'success' if success else 'runtime_failure', raw if success else None,
            reason, payload['model_identity'], adapter_identity=payload['adapter_identity'],
            elapsed_seconds=time.monotonic() - started, input_tokens=len(payload['prompt_token_ids']),
            output_tokens=len(output_ids))
    except Exception as exc:
        measurements.update(error_type=type(exc).__name__, failed_stage=phase)
        if mx is not None:
            try:
                measurements.update(_measure_memory(mx, MAX_MLX_BYTES))
            except Exception:
                pass
        result = InferenceResult(request.run_id, 'runtime_failure', None, 'worker_exception',
            payload['model_identity'], adapter_identity=payload['adapter_identity'],
            elapsed_seconds=time.monotonic() - started, input_tokens=len(payload['prompt_token_ids']),
            output_tokens=len(output_ids))
    measurements['worker_seconds'] = time.monotonic() - started
    return {'result': asdict(result), 'raw_output': raw or None, 'measurements': measurements}


def main():
    scratch = Path(sys.argv[1]).resolve(strict=True)
    payload = _json(_read(scratch / 'request.json', 4 * 1024**2))
    write_json_new(scratch / 'response.json', execute(payload, scratch))


if __name__ == '__main__':
    main()
