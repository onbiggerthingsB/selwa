"""Bounded, fresh-process local inference. Importing this module never imports MLX."""
from __future__ import annotations

from dataclasses import asdict
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

from .artifacts import write_json_new
from .inference import InferenceRequest, InferenceResult


def validate_local_request(request, model_path, model_identity, prompt_token_ids, seed, temperature):
    if not isinstance(request, InferenceRequest):
        raise ValueError('Expected an InferenceRequest')
    path = Path(model_path).expanduser().resolve(strict=True)
    if not path.is_dir() or not (path / 'config.json').is_file():
        raise ValueError('A local model snapshot with config.json is required')
    if not isinstance(model_identity, str) or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@[0-9a-f]{40}', model_identity):
        raise ValueError('An exact repository@revision identity is required')
    if not isinstance(prompt_token_ids, list) or not 1 <= len(prompt_token_ids) <= 8192:
        raise ValueError('Expected 1-8192 explicit prompt token IDs')
    if any(type(n) is not int or n < 0 for n in prompt_token_ids):
        raise ValueError('Invalid prompt token ID')
    if type(seed) is not int or not 0 <= seed <= 2**32 - 1 or type(temperature) not in (float, int) or temperature != 0:
        raise ValueError('This baseline supports a uint32 seed and greedy temperature=0 only')
    if request.max_output_tokens > 512 or len(prompt_token_ids) + request.max_output_tokens > 8192:
        raise ValueError('Baseline token limits exceeded')
    config = json.loads((path / 'config.json').read_text())
    # MLX-LM can execute a model_file even with a local path. Never permit that hook.
    if 'model_file' in config or config.get('model_type') not in {'qwen3', 'gemma3', 'gemma3_text'}:
        raise ValueError('Unsupported/custom model configuration')
    return path


def _read_worker(path):
    if not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError('Missing or oversized worker response')
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError('Invalid worker response')
    return value


def validate_worker_response(value, request, identity, prompt_token_ids):
    result = InferenceResult(**value['result'])
    if (result.run_id != request.run_id or result.model_identity != identity or result.synthetic
            or result.adapter_identity is not None):
        raise ValueError('Worker result identity mismatch')
    if result.input_tokens is not None and result.input_tokens != len(prompt_token_ids):
        raise ValueError('Worker input token count mismatch')
    if result.output_tokens is not None and result.output_tokens > request.max_output_tokens:
        raise ValueError('Worker output token limit exceeded')
    raw = value.get('raw_output')
    if raw is not None and (not isinstance(raw, str) or len(raw) > 1024 * 1024):
        raise ValueError('Invalid raw output')
    if result.outcome == 'success' and (result.termination_reason != 'stop' or raw != result.answer):
        raise ValueError('Only a complete stopped answer may count as successful execution')
    json.dumps(value, allow_nan=False)
    return value


def _stop(process):
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def run_local_inference(request: InferenceRequest, *, model_path: Path, model_identity: str,
                        prompt_token_ids: list[int], seed: int = 0, temperature: float = 0.0) -> dict:
    path = validate_local_request(request, model_path, model_identity, prompt_token_ids, seed, temperature)
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='ht-mlx-worker-') as directory:
        scratch = Path(directory)
        write_json_new(scratch / 'request.json', {'request': asdict(request), 'model_path': str(path),
            'model_identity': model_identity, 'prompt_token_ids': prompt_token_ids,
            'seed': seed, 'temperature': temperature})
        environment = os.environ.copy()
        environment.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
                           TOKENIZERS_PARALLELISM='false', PYTHONDONTWRITEBYTECODE='1')
        command = [sys.executable, '-m', 'ht_tibetan.mlx_worker', str(scratch)]
        outcome = None
        with subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL, env=environment) as process:
            try:
                process.wait(timeout=request.timeout_seconds)
            except subprocess.TimeoutExpired:
                _stop(process)
                outcome = 'timeout'
            except KeyboardInterrupt:
                _stop(process)
                outcome = 'cancelled'
        elapsed = time.monotonic() - started
        if outcome is not None:
            partial = None
            try:
                progress = _read_worker(scratch / 'progress.json')
                if isinstance(progress.get('raw_output'), str) and len(progress['raw_output']) <= 1024 * 1024:
                    partial = progress['raw_output']
            except (OSError, ValueError):
                pass
            return {'result': asdict(InferenceResult(request.run_id, outcome, None,
                outcome, model_identity, elapsed_seconds=elapsed)), 'raw_output': partial,
                'measurements': {'worker_wall_seconds': elapsed, 'partial_output': partial is not None}}
        try:
            if process.returncode != 0:
                raise ValueError('Worker process failed')
            value = validate_worker_response(_read_worker(scratch / 'response.json'), request,
                                             model_identity, prompt_token_ids)
            value.setdefault('measurements', {})['worker_wall_seconds'] = elapsed
            return value
        except (OSError, ValueError, TypeError, KeyError):
            return {'result': asdict(InferenceResult(request.run_id, 'runtime_failure', None,
                'invalid_worker_response', model_identity, elapsed_seconds=elapsed)),
                'raw_output': None, 'measurements': {'worker_wall_seconds': elapsed}}
