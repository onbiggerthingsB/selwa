"""Private child entrypoint. GPU imports occur only inside explicit execution."""
from __future__ import annotations

from dataclasses import asdict
import json
import os
from pathlib import Path
import resource
import sys
import time

from .artifacts import write_json_new
from .inference import InferenceRequest, InferenceResult
from .mlx_backend import validate_local_request


def execute(payload, scratch):
    request = InferenceRequest(**payload['request'])
    identity = payload['model_identity']
    started = time.monotonic()
    raw = ''
    measurements = {}
    input_tokens = None
    output_tokens = None
    try:
        path = validate_local_request(request, payload['model_path'], identity,
            payload['prompt_token_ids'], payload['seed'], payload['temperature'])
        import mlx.core as mx
        from mlx_lm import load, stream_generate
        from mlx_lm.sample_utils import make_sampler
        if not mx.metal.is_available():
            raise ValueError('Metal unavailable')
        mx.random.seed(payload['seed'])
        load_started = time.monotonic()
        model, tokenizer, config = load(str(path),
            tokenizer_config={'local_files_only': True, 'trust_remote_code': False}, return_config=True)
        measurements['load_seconds'] = time.monotonic() - load_started
        if tokenizer.encode(request.prompt, add_special_tokens=False) != payload['prompt_token_ids']:
            raise ValueError('Loaded tokenizer differs from audited prompt')
        effective_eos = set(tokenizer.eos_token_ids)
        generation = path / 'generation_config.json'
        if generation.is_file():
            eos = json.loads(generation.read_text()).get('eos_token_id')
            if eos is not None:
                eos = eos if isinstance(eos, list) else [eos]
                if any(type(n) is not int or n < 0 for n in eos):
                    raise ValueError('Invalid declared stop token')
                effective_eos.update(eos)
        if not effective_eos:
            raise ValueError('No explicit stop tokens')
        tokenizer.eos_token_ids = effective_eos
        measurements['stop_token_ids'] = sorted(effective_eos)
        measurements['seed'] = payload['seed']
        measurements['temperature'] = payload['temperature']
        measurements['model_type'] = config['model_type']
        generation_started = time.monotonic()
        last = None
        for last in stream_generate(model, tokenizer, payload['prompt_token_ids'],
                                    max_tokens=request.max_output_tokens, sampler=make_sampler(temp=0)):
            raw += last.text
            # Mutable scratch only; final run artifacts remain immutable. Preserve diagnostic
            # output if the parent must terminate a stalled or cancelled child.
            progress = scratch / 'progress.next.json'
            with progress.open('w', encoding='utf-8') as stream:
                json.dump({'raw_output': raw}, stream, ensure_ascii=False)
            os.replace(progress, scratch / 'progress.json')
        measurements['generation_seconds'] = time.monotonic() - generation_started
        if last is None:
            raise ValueError('No generation response')
        input_tokens, output_tokens = int(last.prompt_tokens), int(last.generation_tokens)
        measurements.update(prompt_tokens_per_second=last.prompt_tps,
                            generation_tokens_per_second=last.generation_tps,
                            peak_memory_bytes=int(mx.get_peak_memory()),
                            generation_token_count_includes_stop_step=True)
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        measurements['process_peak_rss_bytes'] = int(rss if sys.platform == 'darwin' else rss * 1024)
        measurements['memory_scope'] = 'MLX allocations and child peak RSS; not total system memory pressure or training headroom.'
        reason = last.finish_reason
        if reason != 'stop':
            reason = 'output_limit' if reason == 'length' else 'missing_stop'
        elif '<think>' in raw or '</think>' in raw:
            reason = 'unexpected_reasoning_markup'
        elif not raw.strip():
            reason = 'empty_output'
        success = reason == 'stop'
        result = InferenceResult(request.run_id, 'success' if success else 'runtime_failure',
            raw if success else None, reason, identity, elapsed_seconds=time.monotonic()-started,
            input_tokens=input_tokens, output_tokens=output_tokens)
        return {'result':asdict(result), 'raw_output':raw, 'measurements':measurements}
    except Exception as exc:
        # Avoid provider/library exception strings leaking input text into general logs.
        return {'result':asdict(InferenceResult(request.run_id, 'runtime_failure', None,
            'worker_exception', identity, elapsed_seconds=time.monotonic()-started,
            input_tokens=input_tokens, output_tokens=output_tokens)),
            'raw_output':raw or None, 'measurements':measurements, 'error_type':type(exc).__name__}


def main():
    scratch = Path(sys.argv[1]).resolve(strict=True)
    payload = json.loads((scratch / 'request.json').read_text())
    write_json_new(scratch / 'response.json', execute(payload, scratch))


if __name__ == '__main__': main()
