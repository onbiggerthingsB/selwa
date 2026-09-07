import copy
import unittest

from ht_tibetan.training_inputs import (
    prepare_mechanics_examples, prepare_training_example,
    supervised_positions, validate_training_record,
)


class ExactTokenizer:
    """Character-token fixture; results never represent model measurements."""
    chat_template = 'synthetic exact template'

    def encode(self, text, *, add_special_tokens):
        assert add_special_tokens is False
        return [ord(character) for character in text]

    def decode(self, tokens, *, skip_special_tokens):
        decoded = ''.join(chr(token) for token in tokens)
        return decoded.replace('<eos>', '') if skip_special_tokens else decoded

    def apply_chat_template(self, messages, *, chat_template, tokenize,
                            add_generation_prompt, return_dict, truncation,
                            continue_final_message, **kwargs):
        assert not return_dict and not truncation and not continue_final_message
        text = ''.join(f"<{message['role']}>{message['content']}<eos>" for message in messages)
        if add_generation_prompt:
            text += '<assistant>'
        return self.encode(text, add_special_tokens=False) if tokenize else text


def example(tokenizer=None, *, answer='blue', max_seq_length=256):
    return prepare_training_example(
        tokenizer or ExactTokenizer(), example_id='fixture',
        messages=[{'role': 'user', 'content': 'Color?'},
                  {'role': 'assistant', 'content': answer}],
        max_seq_length=max_seq_length,
    )


class TrainingInputsTests(unittest.TestCase):
    def test_new_synthetic_examples_have_exact_prefix_and_eos_targets(self):
        tokenizer = ExactTokenizer()
        records = prepare_mechanics_examples(tokenizer)
        self.assertEqual(len(records), 4)
        self.assertEqual(len({row['example_id'] for row in records}), 4)
        for row in records:
            self.assertFalse(row['truncated'])
            self.assertEqual(row['prompt_token_ids'], row['tokens'][:row['offset']])
            self.assertEqual(row['decoded_target'], row['messages'][-1]['content'] + '<eos>')
            self.assertEqual(row['decoded_target_without_special_tokens'], row['messages'][-1]['content'])
            self.assertEqual(row['decoded_prompt'], row['rendered_prompt'])
            self.assertEqual(row['instruction_language'], 'en')
            self.assertFalse(row['eligible_for_language_quality_claim'])
            self.assertNotIn('mlx', row)
            validate_training_record(row, 256)

    def test_mixed_length_padding_masks_exclude_first_pad_and_prompt(self):
        self.assertEqual(supervised_positions(6, 3, 8), [3, 4, 5])
        self.assertEqual(supervised_positions(8, 6, 8), [6, 7])
        short_loss_columns = [position - 1 for position in supervised_positions(6, 3, 8)]
        self.assertEqual(short_loss_columns, [2, 3, 4])
        self.assertNotIn(5, short_loss_columns)  # column five predicts first pad

    def test_single_supervised_token_and_exact_unpadded_boundary(self):
        self.assertEqual(supervised_positions(2, 1, 2), [1])
        self.assertEqual(supervised_positions(6, 5, 6), [5])

    def test_impossible_or_empty_masks_reject(self):
        for arguments in [(40, 35, 32), (6, 6, 8), (6, 0, 8), (6, -1, 8),
                          (1, 1, 1), (6, 3, 5), (True, 1, 2), (6, True, 8),
                          (6, 3, 8.0), (8193, 1, 8193)]:
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                supervised_positions(*arguments)

    def test_exact_sequence_limit_is_allowed_and_no_oversize_truncation(self):
        row = example()
        exact = example(max_seq_length=len(row['tokens']))
        self.assertEqual(row['tokens'], exact['tokens'])
        with self.assertRaisesRegex(ValueError, 'truncation is forbidden'):
            example(max_seq_length=len(row['tokens']) - 1)
        with self.assertRaises(ValueError):
            prepare_mechanics_examples(ExactTokenizer(), max_seq_length=True)

    def test_unicode_targets_preserve_exact_codepoints_and_hashes(self):
        decomposed = example(answer='e\u0301 ཀ་')
        composed = example(answer='é ཀ་')
        self.assertEqual(decomposed['decoded_target'], 'e\u0301 ཀ་<eos>')
        self.assertNotEqual(decomposed['messages_sha256'], composed['messages_sha256'])
        self.assertNotEqual(decomposed['input_ids_sha256'], composed['input_ids_sha256'])

    def test_generation_text_prefix_mismatch_rejects_before_offset_use(self):
        class DifferentPrefix(ExactTokenizer):
            def apply_chat_template(self, messages, **kwargs):
                result = super().apply_chat_template(messages, **kwargs)
                if kwargs['add_generation_prompt']:
                    return result + ([33] if kwargs['tokenize'] else '!')
                return result
        with self.assertRaisesRegex(ValueError, 'training text prefix'):
            example(DifferentPrefix())

    def test_contextual_token_boundary_mismatch_rejects_even_with_text_prefix(self):
        class BoundaryTokenizer(ExactTokenizer):
            def encode(self, text, *, add_special_tokens):
                tokens = super().encode(text, add_special_tokens=add_special_tokens)
                # Emulate a token merge at the answer boundary in full rendering.
                if '<assistant>blue' in text:
                    tokens[text.index('<assistant>') + 10] = 9999
                return tokens
        with self.assertRaisesRegex(ValueError, 'training token prefix'):
            example(BoundaryTokenizer())

    def test_target_decode_that_loses_answer_rejects(self):
        class BrokenDecoder(ExactTokenizer):
            def decode(self, tokens, **kwargs):
                return '<eos>'
        with self.assertRaisesRegex(ValueError, 'exact assistant answer'):
            example(BrokenDecoder())

    def test_blank_assistant_and_eos_only_targets_reject(self):
        for answer in ['', ' ', '\n\t']:
            with self.subTest(answer=answer), self.assertRaises(ValueError):
                example(answer=answer)
        row = example()
        row['decoded_target'] = '<eos>'
        with self.assertRaisesRegex(ValueError, 'exact assistant answer'):
            validate_training_record(row, 256)
        with self.assertRaisesRegex(ValueError, 'nonblank'):
            example(answer='<eos>')

    def test_malformed_tokens_offsets_messages_and_tampered_hashes_reject(self):
        row = example()
        changes = [
            {'tokens': []}, {'tokens': [1, True]}, {'tokens': [1, -1]},
            {'tokens': [1, 2.0]}, {'tokens': [1, float('nan')]},
            {'offset': True}, {'offset': len(row['tokens'])},
            {'messages': [{'role': 'user', 'content': 'Only prompt'}]},
            {'messages': [{'role': 'assistant', 'content': 'blue'},
                          {'role': 'assistant', 'content': 'blue'}]},
            {'prompt_token_ids': [1]}, {'messages_sha256': 'wrong'},
            {'input_ids_sha256': 'wrong'}, {'target_ids_sha256': 'wrong'},
            {'example_id': '\ud800'}, {'decoded_target': '\ud800'},
        ]
        for change in changes:
            with self.subTest(change=repr(change)), self.assertRaises(ValueError):
                validate_training_record(copy.deepcopy(row) | change, 256)

    def test_previous_assistant_turn_is_part_of_prompt_not_supervised(self):
        row = prepare_training_example(
            ExactTokenizer(), example_id='history',
            messages=[{'role': 'user', 'content': 'First?'},
                      {'role': 'assistant', 'content': 'Earlier answer'},
                      {'role': 'user', 'content': 'Now?'},
                      {'role': 'assistant', 'content': 'Final answer'}],
        )
        self.assertIn('Earlier answer', row['decoded_prompt'])
        self.assertEqual(row['decoded_target'], 'Final answer<eos>')

    def test_template_configuration_is_explicit_and_bounded(self):
        for configuration in [{'truncation': True}, {'reasoning_mode': 'enabled'},
                              {'candidate_id': None}, {'candidate_id': '   '},
                              [], {'candidate_id': 'unknown-model'}]:
            with self.subTest(configuration=configuration), self.assertRaises(ValueError):
                prepare_mechanics_examples(ExactTokenizer(), template_kwargs=configuration)

    def test_callers_cannot_mutate_future_authored_examples(self):
        first = prepare_mechanics_examples(ExactTokenizer())
        first[0]['messages'][-1]['content'] = 'changed'
        first[0]['tokens'][0] = 0
        later = prepare_mechanics_examples(ExactTokenizer())
        self.assertEqual(later[0]['messages'][-1]['content'], 'blue')
        self.assertNotEqual(later[0]['tokens'][0], 0)


if __name__ == '__main__':
    unittest.main()
