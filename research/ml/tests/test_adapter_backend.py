"""Portable adapter-bound inference checks; no MLX imports or model execution."""
from copy import deepcopy
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from ht_tibetan.adapter_backend import (
    run_adapter_inference, validate_adapter_response, verify_adapter_checkpoint,
)
from ht_tibetan.artifacts import hash_file
from ht_tibetan.inference import InferenceRequest, InferenceResult
from ht_tibetan.training_worker import checkpoint_config, validate_config


IDENTITY = 'owner/model@' + 'a' * 40
OTHER_IDENTITY = 'owner/model@' + 'b' * 40
CHECKPOINT_FILES = ('adapters.safetensors', 'adapter_config.json', 'checkpoint-evidence.json')
GIB = 1024 ** 3
RESOURCES = {'free_disk_bytes': 22 * GIB, 'swap_used_bytes': 5 * GIB,
             'worker_rss_bytes': 3 * GIB, 'pressure_level': 1}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False), encoding='utf-8')


def make_checkpoint(directory):
    """Write tiny real safetensors bytes and mechanically consistent proof metadata."""
    directory.mkdir()
    header, inventory, payload = {}, {}, bytearray()
    for projection in ('q_proj', 'v_proj'):
        for suffix, shape in (('lora_a', [2, 1]), ('lora_b', [1, 2])):
            name = f'model.layers.0.self_attn.{projection}.{suffix}'
            raw = struct.pack('<ff', 0.25, 0.5)
            header[name] = {'dtype': 'F32', 'shape': shape,
                            'data_offsets': [len(payload), len(payload) + len(raw)]}
            inventory[name] = {'dtype': 'mlx.core.float32', 'shape': shape,
                               'sha256': hashlib.sha256(raw).hexdigest()}
            payload.extend(raw)
    encoded = json.dumps(header, separators=(',', ':')).encode('utf-8')
    encoded += b' ' * ((-len(encoded)) % 8)
    (directory / 'adapters.safetensors').write_bytes(struct.pack('<Q', len(encoded)) + encoded + payload)
    config = checkpoint_config({'model_identity': IDENTITY,
        'config': validate_config({'steps': 1, 'num_layers': 1, 'rank': 1}),
        'records': [{'example_id': 'synthetic-1', 'tokens': [1, 2, 3], 'offset': 2}]})
    write_json(directory / 'adapter_config.json', config)
    initial = {name: {**entry, 'sha256': hashlib.sha256(b'\x00' * 8).hexdigest()}
               for name, entry in inventory.items()}
    frozen = {'model.embed_tokens.weight': {'shape': [2, 2], 'dtype': 'mlx.core.float32',
        'sha256': hashlib.sha256(b'\x00' * 16).hexdigest()}}
    evidence = {'schema_version': '1.0', 'model_identity': IDENTITY,
        'completed_steps': 1, 'base_unchanged': True, 'adapter_initial': initial,
        'adapter_final': inventory, 'base_before': frozen, 'base_after': deepcopy(frozen),
        'steps': [{'step': 1, 'example_id': 'synthetic-1', 'loss': 1.0,
            'complete_tokens': 3, 'supervised_tokens': 1, 'gradient_l2': 0.5,
            'update_l2': 0.25, 'changed_tensor_count': 4,
            'changed_tensor_names': list(inventory), 'gradient_seconds': 0.1,
            'update_seconds': 0.1, 'mlx_peak_bytes': 1024, 'process_peak_rss_bytes': 2048}],
        'adapter_file_sha256': hash_file(directory / 'adapters.safetensors'),
        'adapter_config_sha256': hash_file(directory / 'adapter_config.json')}
    write_json(directory / 'checkpoint-evidence.json', evidence)
    return config, evidence, inventory


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.checkpoint = self.root / 'checkpoint'
        self.config, self.evidence, self.inventory = make_checkpoint(self.checkpoint)

    def verify(self):
        return verify_adapter_checkpoint(self.checkpoint, IDENTITY)

    def save_evidence(self):
        write_json(self.checkpoint / 'checkpoint-evidence.json', self.evidence)

    def save_config(self):
        write_json(self.checkpoint / 'adapter_config.json', self.config)
        self.evidence['adapter_config_sha256'] = hash_file(self.checkpoint / 'adapter_config.json')
        self.save_evidence()

    def save_tensor_header(self, mutate):
        path = self.checkpoint / 'adapters.safetensors'
        data = path.read_bytes()
        length = struct.unpack('<Q', data[:8])[0]
        header = json.loads(data[8:8 + length])
        mutate(header)
        encoded = json.dumps(header, separators=(',', ':')).encode('utf-8')
        encoded += b' ' * ((-len(encoded)) % 8)
        path.write_bytes(struct.pack('<Q', len(encoded)) + encoded + data[8 + length:])
        self.evidence['adapter_file_sha256'] = hash_file(path)
        self.save_evidence()

    def test_valid_checkpoint_binds_all_three_files_and_actual_tensor_bytes(self):
        value = self.verify()
        self.assertEqual(value['adapter_identity'], 'sha256:' + hash_file(self.checkpoint / 'adapters.safetensors'))
        self.assertEqual(value['checkpoint_hashes'], {name: hash_file(self.checkpoint / name) for name in CHECKPOINT_FILES})
        self.assertEqual(value['config'], self.config)
        self.assertEqual(value['evidence'], self.evidence)
        self.assertEqual(value['tensor_inventory'], self.inventory)

    def test_pinned_mlx_writer_null_metadata_is_allowed_but_invalid_metadata_rejects(self):
        self.save_tensor_header(lambda header: header.update(__metadata__=None))
        self.assertEqual(self.verify()['tensor_inventory'], self.inventory)
        for metadata in ([], 1, {'unsafe': 3}):
            self.save_tensor_header(lambda header: header.update(__metadata__=metadata))
            with self.subTest(metadata=metadata), self.assertRaises(ValueError):
                self.verify()

    def bind_release(self):
        self.config.update(release_sha256='1' * 64, validation_records_sha256='2' * 64)
        validation = {'token_weighted_loss': 0.5, 'supervised_tokens': 2, 'complete_tokens': 5,
            'examples': [{'example_id': 'validation-1', 'loss': 0.5,
                          'supervised_tokens': 2, 'complete_tokens': 5}],
            'seconds': 0.1, 'objective': 'final_assistant_and_template_suffix_only', 'quality_claim': None}
        self.evidence.update(release_sha256='1' * 64,
                             validation_before=deepcopy(validation), validation_after=deepcopy(validation))
        self.save_config()

    def test_released_checkpoint_supports_hash_bound_validation_extension(self):
        self.bind_release()
        verified = self.verify()
        self.assertEqual(verified['config']['release_sha256'], '1' * 64)
        self.assertEqual(verified['evidence']['validation_after']['token_weighted_loss'], 0.5)

    def test_release_extension_must_be_complete_and_bound_to_evidence(self):
        self.bind_release()
        config, evidence = deepcopy(self.config), deepcopy(self.evidence)
        for mutate in (
            lambda: self.config.pop('validation_records_sha256'),
            lambda: self.config.update(release_sha256='not-a-hash'),
            lambda: self.evidence.update(release_sha256='3' * 64),
            lambda: self.evidence.pop('validation_after'),
            lambda: self.config.pop('release_sha256'),
        ):
            self.config, self.evidence = deepcopy(config), deepcopy(evidence)
            mutate()
            self.save_config()
            with self.assertRaises(ValueError):
                self.verify()

    def test_validation_evidence_rejects_changed_denominators_tasks_and_quality_claims(self):
        self.bind_release()
        original = deepcopy(self.evidence)
        for mutate in (
            lambda v: v.update(supervised_tokens=3),
            lambda v: v.update(complete_tokens=True),
            lambda v: v.update(token_weighted_loss=0.6),
            lambda v: v['examples'][0].update(example_id='other-task'),
            lambda v: v.update(quality_claim=True),
            lambda v: v.update(seconds=-1),
            lambda v: v['examples'][0].update(loss=-0.5),
        ):
            self.evidence = deepcopy(original)
            mutate(self.evidence['validation_after'])
            self.save_evidence()
            with self.assertRaises(ValueError):
                self.verify()

    def test_other_model_identity_and_unpinned_identity_are_rejected(self):
        for identity in (OTHER_IDENTITY, 'owner/model@main', '', None):
            with self.subTest(identity=identity), self.assertRaises((ValueError, OSError)):
                verify_adapter_checkpoint(self.checkpoint, identity)

    def test_changed_tensor_payload_is_rejected_even_when_file_hash_is_rebound(self):
        path = self.checkpoint / 'adapters.safetensors'
        data = bytearray(path.read_bytes())
        data[-1] ^= 1
        path.write_bytes(data)
        with self.assertRaises(ValueError):
            self.verify()
        self.evidence['adapter_file_sha256'] = hash_file(path)
        self.save_evidence()
        with self.assertRaises(ValueError):
            self.verify()

    def test_config_digest_mismatch_is_rejected(self):
        self.config['lora_parameters']['rank'] = 2
        write_json(self.checkpoint / 'adapter_config.json', self.config)
        with self.assertRaises(ValueError):
            self.verify()

    def test_invalid_config_rejected_with_matching_digest(self):
        original = deepcopy(self.config)
        mutations = (
            lambda c: c.update(schema_version='future'),
            lambda c: c.update(model_identity=OTHER_IDENTITY),
            lambda c: c.update(fine_tune_type='full'),
            lambda c: c.update(num_layers=2),
            lambda c: c['lora_parameters'].update(rank=2),
            lambda c: c['lora_parameters'].update(keys=['self_attn.k_proj']),
            lambda c: c['lora_parameters'].update(dropout=0.1),
            lambda c: c.update(unrecognized=True),
        )
        for index, mutate in enumerate(mutations):
            self.config = deepcopy(original)
            mutate(self.config)
            self.save_config()
            with self.subTest(index=index), self.assertRaises(ValueError):
                self.verify()

    def test_invalid_proof_never_counts_as_a_trained_checkpoint(self):
        original = deepcopy(self.evidence)
        first = next(iter(self.inventory))
        mutations = (
            lambda e: e.update(schema_version='future'),
            lambda e: e.update(model_identity=OTHER_IDENTITY),
            lambda e: e.update(base_unchanged=False),
            lambda e: e.update(completed_steps=0),
            lambda e: e.update(completed_steps=2),
            lambda e: e.update(steps=[]),
            lambda e: e['steps'][0].update(step=2),
            lambda e: e['steps'][0].update(gradient_l2=0),
            lambda e: e['steps'][0].update(update_l2=0),
            lambda e: e.update(adapter_initial=deepcopy(e['adapter_final'])),
            lambda e: e.update(base_before={}, base_after={}),
            lambda e: e['base_after']['model.embed_tokens.weight'].update(sha256='f' * 64),
            lambda e: e['adapter_final'][first].update(shape=[1, 2]),
            lambda e: e['adapter_final'][first].update(dtype='mlx.core.float16'),
            lambda e: e.update(adapter_final={}),
        )
        for index, mutate in enumerate(mutations):
            self.evidence = deepcopy(original)
            mutate(self.evidence)
            self.save_evidence()
            with self.subTest(index=index), self.assertRaises(ValueError):
                self.verify()

    def test_unknown_adapter_tensor_name_is_rejected(self):
        name = next(iter(self.inventory))
        renamed = name.replace('.q_proj.', '.k_proj.')
        for inventory in ('adapter_initial', 'adapter_final'):
            self.evidence[inventory][renamed] = self.evidence[inventory].pop(name)
        self.save_tensor_header(lambda header: header.update({renamed: header.pop(name)}))
        with self.assertRaises(ValueError):
            self.verify()

    def test_overlapping_tensor_offsets_are_rejected(self):
        names = list(self.inventory)
        self.save_tensor_header(lambda header: header[names[1]].update(
            data_offsets=header[names[0]]['data_offsets']))
        with self.assertRaises(ValueError):
            self.verify()

    def test_bad_tensor_dimensions_are_rejected(self):
        name = next(iter(self.inventory))
        self.save_tensor_header(lambda header: header[name].update(shape=[0, 1]))
        with self.assertRaises(ValueError):
            self.verify()

    def test_incomplete_checkpoint_and_empty_safetensors_are_rejected(self):
        path = self.checkpoint / 'adapters.safetensors'
        path.write_bytes(b'')
        with self.assertRaises((ValueError, OSError)):
            self.verify()
        path.unlink()
        with self.assertRaises((ValueError, OSError)):
            self.verify()

    def test_linked_checkpoint_artifacts_and_directory_are_rejected(self):
        path = self.checkpoint / 'adapters.safetensors'
        moved = self.root / 'moved.safetensors'
        path.rename(moved)
        path.symlink_to(moved)
        with self.assertRaises((ValueError, OSError)):
            self.verify()
        link = self.root / 'linked'
        link.symlink_to(self.checkpoint, target_is_directory=True)
        with self.assertRaises((ValueError, OSError)):
            verify_adapter_checkpoint(link, IDENTITY)


class AdapterResponseTests(unittest.TestCase):
    def setUp(self):
        self.request = InferenceRequest('case-1', 'prompt', max_output_tokens=8, timeout_seconds=1)
        self.tokens = [1, 2]
        self.adapter = 'sha256:' + 'c' * 64
        self.hashes = {'adapters.safetensors': 'c' * 64, 'adapter_config.json': 'd' * 64,
                       'checkpoint-evidence.json': 'e' * 64}

    def response(self, adapter=True):
        return {'result': asdict(InferenceResult('case-1', 'success', 'yes', 'stop', IDENTITY,
                    adapter_identity=self.adapter if adapter else None, input_tokens=2, output_tokens=2)),
            'raw_output': 'yes', 'measurements': {'execution_contract': 'bounded-greedy-v1',
                'runtime_input_ids_verified': True, 'adapter_verified': adapter,
                'checkpoint_files': self.hashes if adapter else None,
                'output_token_ids': [5, 9], 'stop_token_ids': [9], 'prompt_tokens': 2,
                'process_peak_rss_bytes': 2048, 'mlx_peak_bytes': 1024}}

    def validate(self, value, adapter=True):
        return validate_adapter_response(value, self.request, IDENTITY, self.tokens,
                                         self.adapter if adapter else None)

    def test_base_and_adapted_success_require_the_same_execution_contract(self):
        for adapted in (False, True):
            value = self.response(adapted)
            with self.subTest(adapted=adapted):
                self.assertEqual(self.validate(value, adapted), value)

    def test_forged_identity_run_or_synthetic_provenance_is_rejected(self):
        for key, replacement in (('adapter_identity', 'sha256:' + 'f' * 64),
                                 ('adapter_identity', None), ('model_identity', OTHER_IDENTITY),
                                 ('run_id', 'other-case'), ('synthetic', True)):
            value = self.response()
            value['result'][key] = replacement
            with self.subTest(key=key, value=replacement), self.assertRaises(ValueError):
                self.validate(value)
        with self.assertRaises(ValueError):
            self.validate(self.response(), adapter=False)

    def test_unverified_runtime_or_reload_cannot_be_a_success(self):
        for key, replacement in (('execution_contract', 'other'),
                                 ('runtime_input_ids_verified', False),
                                 ('adapter_verified', False), ('checkpoint_files', None)):
            value = self.response()
            value['measurements'][key] = replacement
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate(value)

    def test_success_requires_positive_bounded_peak_memory_evidence(self):
        for key, bound in (('process_peak_rss_bytes', 14 * GIB), ('mlx_peak_bytes', 12 * GIB)):
            for replacement in (None, True, 0, -1, 1.0, bound + 1):
                value = self.response()
                value['measurements'][key] = replacement
                with self.subTest(key=key, replacement=replacement), self.assertRaises(ValueError):
                    self.validate(value)
            value = self.response()
            del value['measurements'][key]
            with self.assertRaises(ValueError):
                self.validate(value)
        for key in ('execution_contract', 'runtime_input_ids_verified', 'adapter_verified', 'checkpoint_files'):
            value = self.response()
            del value['measurements'][key]
            with self.subTest(missing=key), self.assertRaises(ValueError):
                self.validate(value)

    def test_reloaded_checkpoint_identity_and_complete_three_file_set_required(self):
        for hashes in ({**self.hashes, 'adapters.safetensors': 'f' * 64},
                       {'adapters.safetensors': 'c' * 64},
                       {**self.hashes, 'adapter_config.json': 'not-a-hash'}):
            value = self.response()
            value['measurements']['checkpoint_files'] = hashes
            with self.subTest(hashes=hashes), self.assertRaises(ValueError):
                self.validate(value)

    def test_success_requires_exact_counts_stop_token_and_bounded_output(self):
        mutations = (
            lambda v: v['result'].update(input_tokens=3),
            lambda v: v['result'].update(input_tokens=None),
            lambda v: v['result'].update(output_tokens=9),
            lambda v: v['result'].update(output_tokens=None),
            lambda v: v['measurements'].update(output_token_ids=[5]),
            lambda v: v['measurements'].update(output_token_ids=[True, 9]),
            lambda v: v['measurements'].update(output_token_ids=[5, -1]),
            lambda v: v['measurements'].update(output_token_ids=[5, 6]),
            lambda v: v['measurements'].update(stop_token_ids=[]),
            lambda v: v['measurements'].update(stop_token_ids=[True]),
        )
        for index, mutate in enumerate(mutations):
            value = self.response()
            mutate(value)
            with self.subTest(index=index), self.assertRaises(ValueError):
                self.validate(value)

    def test_partial_or_raw_mismatched_output_is_never_success(self):
        for mutation in (lambda v: v.update(raw_output='different'),
                         lambda v: v['result'].update(termination_reason='output_limit'),
                         lambda v: v['result'].update(termination_reason='timeout'),
                         lambda v: v['result'].update(answer='')):
            value = self.response()
            mutation(value)
            with self.assertRaises(ValueError):
                self.validate(value)

    def test_failed_execution_preserves_partial_text_but_never_an_answer(self):
        for outcome in ('timeout', 'cancelled', 'context_overflow', 'runtime_failure'):
            value = {'result': asdict(InferenceResult('case-1', outcome, None, outcome, IDENTITY,
                adapter_identity=self.adapter)), 'raw_output': 'unfinished Tibetan བོད', 'measurements': {}}
            with self.subTest(outcome=outcome):
                self.assertEqual(self.validate(value), value)
                value['result']['answer'] = 'unfinished Tibetan བོད'
                with self.assertRaises(ValueError):
                    self.validate(value)

    def test_malformed_and_nonfinite_response_data_is_rejected(self):
        for raw in ([], {}, 1, 'x' * (1024 * 1024 + 1)):
            value = self.response()
            value['raw_output'] = raw
            with self.subTest(raw_type=type(raw)), self.assertRaises(ValueError):
                self.validate(value)
        value = self.response()
        value['measurements']['elapsed'] = float('nan')
        with self.assertRaises(ValueError):
            self.validate(value)


class FinishedProcess:
    pid = 42
    returncode = 0

    def poll(self):
        return self.returncode


class RunningProcess(FinishedProcess):
    returncode = None

    def __init__(self, wait_error=None):
        self.terminated = False
        self.wait_error = wait_error

    def terminate(self):
        self.terminated = True
        self.returncode = -15

    def kill(self):
        self.returncode = -9

    def wait(self, timeout):
        if self.returncode is None:
            if self.wait_error:
                raise self.wait_error
            raise subprocess.TimeoutExpired('worker', timeout)
        return self.returncode


class AdapterSupervisionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.model = self.root / 'model'
        self.model.mkdir()
        write_json(self.model / 'config.json', {'model_type': 'qwen3', 'vocab_size': 16,
                   'quantization': {'bits': 4, 'group_size': 64}})
        self.checkpoint = self.root / 'checkpoint'
        make_checkpoint(self.checkpoint)
        self.verified = verify_adapter_checkpoint(self.checkpoint, IDENTITY)
        self.hashes = self.verified['checkpoint_hashes']
        self.adapter = self.verified['adapter_identity']
        self.request = InferenceRequest('case-1', 'prompt', max_output_tokens=8, timeout_seconds=1)
        self.tokens = [1, 2]

    def run_inference(self, *, adapted=True, **kwargs):
        return run_adapter_inference(self.request, model_path=self.model, model_identity=IDENTITY,
            prompt_token_ids=self.tokens, checkpoint_dir=self.checkpoint if adapted else None,
            checkpoint_hashes=self.hashes if adapted else None, **kwargs)

    def response(self, *, adapted=True):
        return {'result': asdict(InferenceResult('case-1', 'success', 'yes', 'stop', IDENTITY,
            adapter_identity=self.adapter if adapted else None, input_tokens=2, output_tokens=2)),
            'raw_output': 'yes', 'measurements': {'execution_contract': 'bounded-greedy-v1',
                'runtime_input_ids_verified': True, 'adapter_verified': adapted,
                'checkpoint_files': self.hashes if adapted else None,
                'output_token_ids': [5, 9], 'stop_token_ids': [9],
                'process_peak_rss_bytes': 2048, 'mlx_peak_bytes': 1024}}

    def start(self, process, response=None, progress='unfinished བོད'):
        def start(command, **kwargs):
            self.assertEqual(command[-2], 'ht_tibetan.adapter_worker')
            self.assertEqual(kwargs['env']['HF_HUB_OFFLINE'], '1')
            self.assertEqual(kwargs['env']['TRANSFORMERS_OFFLINE'], '1')
            self.assertEqual(kwargs['env']['HF_HUB_DISABLE_TELEMETRY'], '1')
            scratch = Path(command[-1])
            write_json(scratch / 'progress.json', {'raw_output': progress, 'stage': 'generate'})
            if response is not None:
                write_json(scratch / 'response.json', response)
            return process
        return start

    def assert_failed(self, value, reason, *, outcome='runtime_failure', partial='unfinished བོད'):
        self.assertEqual(value['result']['outcome'], outcome)
        self.assertEqual(value['result']['termination_reason'], reason)
        self.assertEqual(value['result']['adapter_identity'], self.adapter)
        self.assertIsNone(value['result']['answer'])
        self.assertEqual(value['raw_output'], partial)

    def test_both_arms_dispatch_same_worker_with_explicit_bound_checkpoint(self):
        for adapted in (False, True):
            seen = []

            def start(command, **kwargs):
                seen.append(json.loads((Path(command[-1]) / 'request.json').read_text()))
                return self.start(FinishedProcess(), self.response(adapted=adapted))(command, **kwargs)

            with self.subTest(adapted=adapted), \
                 patch('ht_tibetan.adapter_backend.subprocess.Popen', side_effect=start), \
                 patch('ht_tibetan.adapter_backend._resources', return_value=deepcopy(RESOURCES)):
                value = self.run_inference(adapted=adapted)
            self.assertEqual(value['result']['outcome'], 'success')
            self.assertEqual(seen[0]['prompt_token_ids'], self.tokens)
            self.assertEqual(seen[0]['checkpoint_hashes'], self.hashes if adapted else None)
            self.assertEqual(seen[0]['adapter_identity'], self.adapter if adapted else None)
            self.assertEqual(value['measurements']['limits']['max_worker_rss_bytes'], 14 * GIB)

    def test_missing_changed_or_base_checkpoint_pins_refuse_before_dispatch(self):
        for directory, hashes in ((self.checkpoint, None),
                                  (self.checkpoint, {**self.hashes, 'adapters.safetensors': 'f' * 64}),
                                  (None, self.hashes)):
            with self.subTest(directory=directory, hashes=hashes), \
                 patch('ht_tibetan.adapter_backend.subprocess.Popen') as start, \
                 self.assertRaises(ValueError):
                run_adapter_inference(self.request, model_path=self.model, model_identity=IDENTITY,
                    prompt_token_ids=self.tokens, checkpoint_dir=directory, checkpoint_hashes=hashes)
            start.assert_not_called()

    def test_unknown_swap_refuses_before_dispatch_and_retains_identity(self):
        with patch('ht_tibetan.adapter_backend.subprocess.Popen') as start, \
             patch('ht_tibetan.adapter_backend._resources', return_value={**RESOURCES, 'swap_used_bytes': None}):
            value = self.run_inference()
        start.assert_not_called()
        self.assert_failed(value, 'swap_telemetry_unavailable', partial=None)

    def test_timeout_stops_child_retains_partial_and_cannot_return_answer(self):
        process = RunningProcess()
        with patch('ht_tibetan.adapter_backend.subprocess.Popen', side_effect=self.start(process)), \
             patch('ht_tibetan.adapter_backend._resources', return_value=deepcopy(RESOURCES)), \
             patch('ht_tibetan.adapter_backend.time.monotonic', side_effect=range(0, 100, 2)):
            value = self.run_inference()
        self.assertTrue(process.terminated)
        self.assert_failed(value, 'timeout', outcome='timeout')

    def test_cancellation_stops_child_preserves_partial_and_adapter_identity(self):
        process = RunningProcess(wait_error=KeyboardInterrupt())
        with patch('ht_tibetan.adapter_backend.subprocess.Popen', side_effect=self.start(process)), \
             patch('ht_tibetan.adapter_backend._resources', return_value=deepcopy(RESOURCES)):
            value = self.run_inference()
        self.assertTrue(process.terminated)
        self.assert_failed(value, 'cancelled', outcome='cancelled')

    def test_live_resource_limit_and_missing_rss_stop_child(self):
        for changed, reason in (({'worker_rss_bytes': 14 * GIB + 1}, 'worker_rss'),
                                ({'worker_rss_bytes': None}, 'rss_telemetry_unavailable'),
                                ({'swap_used_bytes': 6 * GIB + 1}, 'swap_growth'),
                                ({'free_disk_bytes': 1}, 'disk_reserve')):
            process = RunningProcess()

            def resources(model, scratch, pid=None):
                return {**RESOURCES, **(changed if pid else {})}

            with self.subTest(reason=reason), \
                 patch('ht_tibetan.adapter_backend.subprocess.Popen', side_effect=self.start(process)), \
                 patch('ht_tibetan.adapter_backend._resources', side_effect=resources):
                value = self.run_inference()
            self.assertTrue(process.terminated)
            self.assert_failed(value, reason)

    def test_recorded_memory_peak_over_limit_cannot_hide_between_samples(self):
        for key, value in (('process_peak_rss_bytes', 14 * GIB + 1),
                           ('mlx_peak_bytes', 12 * GIB + 1)):
            response = self.response()
            response['measurements'][key] = value
            with self.subTest(key=key), \
                 patch('ht_tibetan.adapter_backend.subprocess.Popen',
                       side_effect=self.start(FinishedProcess(), response)), \
                 patch('ht_tibetan.adapter_backend._resources', return_value=deepcopy(RESOURCES)):
                value = self.run_inference()
            self.assert_failed(value, 'worker_reported_memory_limit', partial='yes')

    def test_missing_worker_response_is_failure_with_partial_evidence(self):
        with patch('ht_tibetan.adapter_backend.subprocess.Popen', side_effect=self.start(FinishedProcess())), \
             patch('ht_tibetan.adapter_backend._resources', return_value=deepcopy(RESOURCES)):
            value = self.run_inference()
        self.assert_failed(value, 'invalid_worker_response')

    def test_checkpoint_replacement_after_dispatch_is_rejected(self):
        def start(command, **kwargs):
            original = self.start(FinishedProcess(), self.response())(command, **kwargs)
            evidence_path = self.checkpoint / 'checkpoint-evidence.json'
            evidence = json.loads(evidence_path.read_text())
            evidence['steps'][0]['loss'] = 0.5
            write_json(evidence_path, evidence)
            return original

        with patch('ht_tibetan.adapter_backend.subprocess.Popen', side_effect=start), \
             patch('ht_tibetan.adapter_backend._resources', return_value=deepcopy(RESOURCES)):
            value = self.run_inference()
        self.assert_failed(value, 'invalid_worker_response')


class AdapterWorkerPayloadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.model = self.root / 'model'
        self.model.mkdir()
        self.model_config = {'model_type': 'qwen3', 'vocab_size': 100,
                             'quantization': {'bits': 4, 'group_size': 64}}
        write_json(self.model / 'config.json', self.model_config)
        self.checkpoint = self.root / 'checkpoint'
        make_checkpoint(self.checkpoint)
        self.verified = verify_adapter_checkpoint(self.checkpoint, IDENTITY)
        self.payload = {'request': asdict(InferenceRequest('worker-case', 'prompt', max_output_tokens=8)),
            'model_path': str(self.model), 'model_identity': IDENTITY,
            'prompt_token_ids': [1, 2], 'seed': 0, 'temperature': 0.0,
            'checkpoint_dir': None, 'checkpoint_hashes': None, 'adapter_identity': None}

    def adapted(self):
        return {**self.payload, 'checkpoint_dir': str(self.checkpoint),
                'checkpoint_hashes': self.verified['checkpoint_hashes'],
                'adapter_identity': self.verified['adapter_identity']}

    def test_worker_revalidates_both_arms_without_loading_model(self):
        from ht_tibetan.adapter_worker import validate_payload
        for payload in (self.payload, self.adapted()):
            request, path, vocab, checkpoint = validate_payload(payload)
            self.assertEqual(request.run_id, 'worker-case')
            self.assertEqual(path, self.model)
            self.assertEqual(vocab, 100)
            if payload['checkpoint_dir'] is None:
                self.assertIsNone(checkpoint)
            else:
                self.assertEqual(checkpoint['checkpoint_hashes'], payload['checkpoint_hashes'])

    def test_worker_rejects_custom_model_quantization_and_out_of_vocab_prompt(self):
        from ht_tibetan.adapter_worker import validate_payload
        for changed in ({'model_file': 'custom.py'}, {'model_type': 'custom'},
                        {'quantization': {'bits': 8, 'group_size': 64}}, {'vocab_size': 1}):
            write_json(self.model / 'config.json', {**self.model_config, **changed})
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                validate_payload(self.payload)

    def test_worker_rejects_unknown_or_mismatched_arm_identity(self):
        from ht_tibetan.adapter_worker import validate_payload
        for payload in (
            {**self.payload, 'extra': True},
            {**self.payload, 'checkpoint_hashes': self.verified['checkpoint_hashes']},
            {**self.payload, 'adapter_identity': self.verified['adapter_identity']},
            {**self.adapted(), 'adapter_identity': None},
            {**self.adapted(), 'checkpoint_hashes': None},
            {**self.adapted(), 'model_identity': OTHER_IDENTITY},
        ):
            with self.subTest(keys=tuple(payload)), self.assertRaises(ValueError):
                validate_payload(payload)


if __name__ == '__main__':
    unittest.main()
