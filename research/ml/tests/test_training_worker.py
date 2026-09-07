"""Portable guard and checkpoint tests; these never import MLX or model weights."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ht_tibetan.artifacts import hash_file
from ht_tibetan.training_worker import (
    CHECKPOINT_FILES, DEFAULT_CONFIG, assistant_loss, execute,
    validate_config, validate_payload, validate_tensor_schema,
    _measure_memory, MAX_PROCESS_RSS, vocabulary_size,
)


class TrainingWorkerTests(unittest.TestCase):
    def test_gemma_omitted_vocabulary_is_resolved_from_packed_embedding(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            header = json.dumps({'language_model.model.embed_tokens.weight':
                                 {'shape': [262208, 320], 'dtype': 'U32'}}).encode()
            (root / 'model.safetensors').write_bytes(len(header).to_bytes(8, 'little') + header)
            self.assertEqual(vocabulary_size({'model_type': 'gemma3', 'text_config': {}}, root), 262208)
            (root / 'model.safetensors').write_bytes((9 * 1024**2).to_bytes(8, 'little'))
            with self.assertRaises(ValueError):
                vocabulary_size({'model_type': 'gemma3', 'text_config': {}}, root)

    def test_recorded_peak_rss_cannot_bypass_parent_sample_limit(self):
        class FakeMx:
            get_active_memory = staticmethod(lambda: 1024)
            get_peak_memory = staticmethod(lambda: 2048)
            get_cache_memory = staticmethod(lambda: 512)
        with patch('ht_tibetan.training_worker._rss_bytes', return_value=MAX_PROCESS_RSS + 1):
            with self.assertRaises(MemoryError):
                _measure_memory(FakeMx, 4096)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.model = self.root / 'model'
        self.model.mkdir()
        self.model_config = {'model_type': 'gemma3', 'text_config': {'vocab_size': 100},
                             'quantization': {'bits': 4, 'group_size': 64}}
        (self.model / 'config.json').write_text(json.dumps(self.model_config))
        self.payload = {
            'mode': 'train', 'model_path': str(self.model),
            'model_identity': 'owner/model@' + '1' * 40,
            'checkpoint_dir': str(self.root / 'checkpoint'), 'config': {},
            'records': [{'example_id': 'fixture', 'tokens': [1, 2, 3, 4, 5, 6],
                         'offset': 3, 'prompt_token_ids': [1, 2, 3],
                         'messages': [{'role': 'user', 'content': 'Color?'},
                                      {'role': 'assistant', 'content': 'blue'}],
                         'decoded_target': 'blue<eos>'}],
        }

    def test_configuration_defaults_are_bounded_and_not_mutated(self):
        value = validate_config({})
        self.assertEqual(value, DEFAULT_CONFIG)
        value['steps'] = 1
        self.assertEqual(DEFAULT_CONFIG['steps'], 20)
        self.assertEqual(validate_config({'steps': 1, 'max_seq_length': 512})['steps'], 1)

    def test_dangerous_or_ambiguous_configuration_rejects(self):
        for key, value in [('steps', True), ('steps', 21), ('max_seq_length', 513),
                           ('num_layers', 0), ('num_layers', 3), ('rank', 9),
                           ('scale', float('nan')), ('scale', float('inf')),
                           ('learning_rate', True), ('learning_rate', 0),
                           ('seed', -1), ('max_mlx_bytes', 13 * 1024**3),
                           ('resume', True), ('dropout', 0.1)]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                validate_config({key: value})

    def test_valid_inputs_preserved_without_implicit_padding_or_truncation(self):
        value = validate_payload(self.payload)
        self.assertEqual(value['records'], self.payload['records'])
        self.assertEqual(value['config']['max_seq_length'], 256)

    def test_bad_target_prefix_length_or_vocabulary_rejects_before_gpu(self):
        cases = [dict(offset=6), dict(offset=0), dict(tokens=[1] * 257),
                 dict(tokens=[1, 2, 100, 4, 5, 6]), dict(prompt_token_ids=[1, 9, 3])]
        for change in cases:
            payload = copy.deepcopy(self.payload)
            payload['records'][0].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_payload(payload)

    def test_custom_and_nonquantized_model_reject_before_gpu(self):
        for change in [{'model_file': 'execute.py'}, {'model_type': 'unknown'},
                       {'quantization': {}}, {'quantization': {'bits': 8, 'group_size': 64}}]:
            (self.model / 'config.json').write_text(json.dumps(self.model_config | change))
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_payload(self.payload)

    def test_checkpoint_inside_base_or_existing_output_is_rejected(self):
        for directory in [self.model, self.model / 'adapter', self.root]:
            with self.subTest(directory=directory), self.assertRaises(ValueError):
                validate_payload(self.payload | {'checkpoint_dir': str(directory)})
        checkpoint = self.root / 'checkpoint'
        checkpoint.mkdir()
        (checkpoint / 'existing.txt').write_text('preserve')
        with self.assertRaises(ValueError):
            validate_payload(self.payload)
        self.assertEqual((checkpoint / 'existing.txt').read_text(), 'preserve')

    def test_linked_checkpoint_and_model_paths_reject(self):
        link = self.root / 'linked-model'
        link.symlink_to(self.model, target_is_directory=True)
        with self.assertRaises(ValueError):
            validate_payload(self.payload | {'model_path': str(link)})
        checkpoint = self.root / 'checkpoint'
        checkpoint.symlink_to(self.model, target_is_directory=True)
        with self.assertRaises(ValueError):
            validate_payload(self.payload)

    def test_reload_requires_parent_bound_complete_checkpoint_identity(self):
        checkpoint = self.root / 'checkpoint'
        checkpoint.mkdir()
        for name in CHECKPOINT_FILES:
            (checkpoint / name).write_text('{}')
        hashes = {name: hash_file(checkpoint / name) for name in CHECKPOINT_FILES}
        payload = self.payload | {'mode': 'reload', 'expected_checkpoint_files': hashes}
        self.assertEqual(validate_payload(payload)['expected_checkpoint_files'], hashes)
        for name in CHECKPOINT_FILES:
            (checkpoint / name).write_text('changed')
            with self.subTest(name=name), self.assertRaises(ValueError):
                validate_payload(payload)
            (checkpoint / name).write_text('{}')
        with self.assertRaises(ValueError):
            validate_payload(self.payload | {'mode': 'reload'})

    def test_missing_extra_shape_dtype_and_byte_mismatches_reject(self):
        expected = {'layer.lora_a': {'shape': [2, 4], 'dtype': 'float32', 'sha256': 'a' * 64}}
        validate_tensor_schema(copy.deepcopy(expected), expected)
        cases = [{}, expected | {'unexpected': expected['layer.lora_a']},
                 {'renamed': expected['layer.lora_a']}]
        for field, value in [('shape', [4, 2]), ('dtype', 'float16'), ('sha256', 'b' * 64)]:
            cases.append({'layer.lora_a': expected['layer.lora_a'] | {field: value}})
        for actual in cases:
            with self.subTest(actual=actual), self.assertRaises(ValueError):
                validate_tensor_schema(actual, expected)

    def test_invalid_execution_does_not_import_mlx_or_write_checkpoint(self):
        import builtins
        original = builtins.__import__

        def guarded(name, *args, **kwargs):
            if name == 'mlx' or name.startswith('mlx.') or name == 'mlx_lm':
                self.fail('Invalid payload reached GPU imports')
            return original(name, *args, **kwargs)

        with patch('builtins.__import__', side_effect=guarded):
            result = execute(self.payload | {'config': {'steps': 1000}}, self.root)
        self.assertEqual(result['outcome'], 'runtime_failure')
        self.assertEqual(result['stage'], 'validate')
        self.assertEqual(result['completed_steps'], 0)
        self.assertEqual(result['error_type'], 'ValueError')
        self.assertNotIn('error_message', result)
        self.assertFalse((self.root / 'checkpoint').exists())

    def test_loss_supervises_answer_and_suffix_using_original_positions(self):
        """Spy on the actual worker loss, independently checking its shifted slices."""
        calls = {}

        class Array:
            def __init__(self, source, indices=None):
                self.source, self.indices = source, indices

            def __getitem__(self, indices):
                return Array(self.source, indices)

            def astype(self, dtype):
                calls['loss_dtype'] = dtype
                return self

            def mean(self):
                return 'selected-target-mean'

        class Core:
            int32 = 'int32'
            float32 = 'float32'

            @staticmethod
            def array(value, dtype):
                calls['batch'] = value
                return Array('tokens')

        class Losses:
            @staticmethod
            def cross_entropy(logits, targets):
                calls['logit_columns'] = logits.indices[1]
                calls['target_positions'] = targets.indices[1]
                return Array('loss')

        class Neural:
            losses = Losses

        def model(inputs):
            calls['input_positions'] = inputs.indices[1]
            return Array('logits')

        self.assertEqual(assistant_loss(model, [10, 11, 12, 13, 14, 15], 3, Core, Neural),
                         'selected-target-mean')
        self.assertEqual(calls['input_positions'], slice(None, -1))
        self.assertEqual(calls['logit_columns'], slice(2, 5))
        self.assertEqual(calls['target_positions'], slice(3, 6))
        self.assertEqual(calls['loss_dtype'], 'float32')
        self.assertEqual(calls['batch'], [[10, 11, 12, 13, 14, 15]])


if __name__ == '__main__':
    unittest.main()
