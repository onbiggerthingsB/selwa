import hashlib
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

from ht_tibetan.token_audit import (
    PromptConfigurationError, audit_conversations, load_local_tokenizer,
    render_conversation,
)


class FakeTokenizer:
    """Characters are synthetic token IDs; never a real model measurement."""
    chat_template = 'fake template checks enable_thinking'

    def __init__(self, *, ignores_thinking=False, folds_system=False):
        self.ignores_thinking = ignores_thinking
        self.folds_system = folds_system
        self.calls = []

    def encode(self, text, *, add_special_tokens):
        if add_special_tokens is not False:
            raise AssertionError('duplicate special tokens requested')
        return [ord(character) for character in text]

    def apply_chat_template(self, messages, *, chat_template, tokenize,
                            add_generation_prompt, return_dict, truncation,
                            continue_final_message, **kwargs):
        if return_dict or truncation or continue_final_message:
            raise AssertionError('unexpected implicit formatting or output mode')
        self.calls.append({'generation': add_generation_prompt, 'tokenize': tokenize,
                           'messages': messages, 'kwargs': kwargs})
        turns = list(messages)
        if self.folds_system and turns[0]['role'] == 'system':
            turns = [dict(role='user', content=turns[0]['content']+'\n'+turns[1]['content'])]+turns[2:]
        text = ''.join('<'+m['role']+'>'+m['content']+'</'+m['role']+'>\n' for m in turns)
        if add_generation_prompt:
            text += '<assistant>\n'
            if not self.ignores_thinking and kwargs.get('enable_thinking') is False:
                text += '<think>\n\n</think>\n\n'
        return self.encode(text, add_special_tokens=False) if tokenize else text


def case(messages=None, *, mode='generation', case_id='one'):
    return dict(case_id=case_id, mode=mode,
                messages=messages or [{'role': 'user', 'content': 'Hello'}])


def audit(cases=None, tokenizer=None, **kwargs):
    return audit_conversations(cases or [case()], tokenizer or FakeTokenizer(),
                               **(dict(candidate_id='qwen3-fixture', context_limit=4096,
                                       max_output_tokens=128) | kwargs))


class TokenAuditTests(unittest.TestCase):
    def test_full_template_includes_system_evidence_and_history(self):
        messages = [dict(role='system', content='Use only evidence'),
                    dict(role='user', content='Evidence: a blue box. Which color?'),
                    dict(role='assistant', content='Blue'),
                    dict(role='user', content='Is it large?')]
        tokenizer = FakeTokenizer()
        result = audit([case(messages)], tokenizer)
        row = result['cases'][0]
        expected = render_conversation(messages, tokenizer, candidate_id='qwen3-fixture')
        self.assertEqual(row['complete_chat_tokens'], len(expected['input_ids']))
        self.assertGreater(row['complete_chat_tokens'], row['raw_content_tokens_sum'])
        self.assertEqual(row['messages'][0]['role'], 'system')
        self.assertEqual(row['raw_content_tokens_sum'], sum(len(m['content']) for m in messages))
        self.assertEqual(row['reasoning']['status'], 'verified_generation_prefix_control')
        self.assertEqual(row['rendered_utf8_sha256'], hashlib.sha256(expected['rendered_text'].encode()).hexdigest())
        self.assertNotIn('rendered_text', row)
        self.assertNotIn('content', row['messages'][0])
        self.assertNotIn('Evidence:', json.dumps(result))

    def test_generation_prefix_and_training_target_are_counted_differently(self):
        tokenizer = FakeTokenizer()
        history = [dict(role='user', content='Question'), dict(role='assistant', content='Answer')]
        rendered = render_conversation(history, tokenizer, candidate_id='qwen3-fixture', mode='training')
        self.assertFalse(rendered['add_generation_prompt'])
        self.assertTrue(rendered['rendered_text'].endswith('Answer</assistant>\n'))
        size = len(rendered['input_ids'])
        result = audit([case(history, mode='training')], tokenizer, context_limit=size, max_output_tokens=size+1)
        row = result['cases'][0]
        self.assertTrue(row['fit'])
        self.assertEqual(row['reserved_output_tokens'], 0)
        self.assertEqual(row['available_output_tokens'], 0)
        self.assertEqual(row['remaining_context_tokens'], 0)

    def test_exact_context_and_output_boundary_no_truncation(self):
        size = len(render_conversation(case()['messages'], FakeTokenizer(), candidate_id='qwen3-fixture')['input_ids'])
        self.assertTrue(audit(context_limit=size+10, max_output_tokens=10)['all_fit'])
        output_overflow = audit(context_limit=size+9, max_output_tokens=10)['cases'][0]
        self.assertEqual(output_overflow['outcome'], 'context_overflow')
        self.assertTrue(output_overflow['fits_prompt'])
        self.assertFalse(output_overflow['fits_output_budget'])
        overflow = audit(context_limit=size-1)['cases'][0]
        self.assertEqual(overflow['complete_chat_tokens'], size)
        self.assertEqual(overflow['remaining_context_tokens'], -1)
        self.assertEqual(overflow['available_output_tokens'], 0)
        self.assertFalse(overflow['truncated'])

    def test_unicode_hashes_preserve_whitespace_and_decomposed_codepoints(self):
        text = 'ཀ་ ཁ།  ཀ༌ཁ་\n'
        row = audit([case([dict(role='user', content=text)])])['cases'][0]['messages'][0]
        self.assertEqual(row['content_utf8_sha256'], hashlib.sha256(text.encode('utf-8')).hexdigest())
        self.assertEqual(row['unicode_codepoints'], len(text))
        self.assertGreater(row['utf8_bytes'], row['unicode_codepoints'])
        # Only tsheg characters split. A shad/spaces inside a segment do not.
        self.assertEqual(row['tsheg_separated_tibetan_segments'], 3)
        hashes = [audit([case([dict(role='user', content=s)])])['cases'][0]['messages'][0]['content_utf8_sha256']
                  for s in ('e\u0301', '\u00e9', 'e\u0301 ')]
        self.assertEqual(len(set(hashes)), 3)
        self.assertIsNone(audit()['cases'][0]['messages'][0]['tokens_per_tsheg_segment'])

    def test_qwen_silently_ignored_flag_is_not_claimed_as_disabled(self):
        result = audit(tokenizer=FakeTokenizer(ignores_thinking=True))
        self.assertFalse(result['all_fit'])
        self.assertEqual(result['cases'][0]['outcome'], 'unsupported_configuration')
        self.assertEqual(result['cases'][0]['error_code'], 'qwen_reasoning_control_unverified')
        self.assertIsNone(result['cases'][0]['complete_chat_tokens'])
        tokenizer = FakeTokenizer()
        tokenizer.chat_template = 'old template with fixed open think prefix'
        with self.assertRaises(PromptConfigurationError) as error:
            render_conversation(case()['messages'], tokenizer, candidate_id='qwen3-fixture')
        self.assertEqual(error.exception.code, 'qwen_reasoning_control_unsupported')

    def test_gemma_keeps_its_own_system_folding_and_applies_no_qwen_flag(self):
        tokenizer = FakeTokenizer(folds_system=True)
        tokenizer.chat_template = 'gemma template'
        messages = [dict(role='system', content='System fixture'), dict(role='user', content='Question')]
        rendered = render_conversation(messages, tokenizer, candidate_id='gemma3-fixture')
        self.assertIn('<user>System fixture\nQuestion</user>', rendered['rendered_text'])
        self.assertEqual(rendered['reasoning']['status'], 'not_applicable')
        self.assertTrue(all(not call['kwargs'] for call in tokenizer.calls))
        result = audit([case(messages)], tokenizer, candidate_id='gemma3-fixture', reasoning_mode='enabled')
        self.assertFalse(result['all_fit'])

    def test_token_id_disagreement_and_malformed_ids_fail_explicitly(self):
        class MismatchedTokenizer(FakeTokenizer):
            def apply_chat_template(self, *args, **kwargs):
                value = super().apply_chat_template(*args, **kwargs)
                return value+[1] if kwargs['tokenize'] else value
        self.assertEqual(audit(tokenizer=MismatchedTokenizer())['cases'][0]['error_code'],
                         'rendered_and_template_token_ids_differ')
        tokenizer = FakeTokenizer()
        tokenizer.encode = lambda *args, **kwargs: [True]
        self.assertEqual(audit(tokenizer=tokenizer)['cases'][0]['error_code'],
                         'tokenizer_returned_invalid_token_ids')

    def test_invalid_inputs_are_rejected_before_rendering(self):
        bad_cases = [
            [case([dict(role='unknown', content='hello')])],
            [case([dict(role='user', content='')])],
            [case([dict(role='user', content='  ')])],
            [case([dict(role='user', content='\ud800')])],
            [case([dict(role='system', content='only system')])],
            [case([dict(role='assistant', content='orphan')])],
            [case([dict(role='user', content='one'), dict(role='user', content='two')])],
            [case([dict(role='user', content='one'), dict(role='system', content='late')])],
            [case([dict(role='user', content='one', hidden='ignored')])],
            [case(mode='training')],
            [case(mode={})],
            [case(), case()],
            [case([dict(role='user', content='x'*65537)])],
        ]
        for cases in bad_cases:
            tokenizer = FakeTokenizer()
            with self.subTest(cases=repr(cases)[:80]), self.assertRaises(ValueError):
                audit_conversations(cases, tokenizer, candidate_id='qwen3-fixture', context_limit=4096, max_output_tokens=100)
            self.assertEqual(tokenizer.calls, [])
        for kwargs in ({'context_limit': True}, {'context_limit': 0}, {'max_output_tokens': -1},
                       {'max_output_tokens': 0.5}, {'reasoning_mode': 'automatic'}, {'reasoning_mode': {}}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError): audit(**kwargs)

    def test_fixture_is_explicitly_synthetic_and_all_cases_are_measurable(self):
        path = Path(__file__).resolve().parents[2]/'config'/'token-audit-fixture.json'
        fixture = json.loads(path.read_text(encoding='utf-8'))
        result = audit(fixture)
        self.assertEqual(result['input_evidence_type'], 'synthetic_transport_fixture')
        self.assertEqual(len(result['cases']), 4)
        self.assertTrue(result['all_fit'])
        self.assertIn('not-native-gold', result['cases'][-1]['case_id'])
        self.assertEqual(audit()['input_evidence_type'], 'unspecified_input_evidence')

    def test_enabled_qwen_records_distinct_verified_control_without_closing_think(self):
        enabled = render_conversation(case()['messages'], FakeTokenizer(), candidate_id='qwen3-fixture', reasoning_mode='enabled')
        disabled = render_conversation(case()['messages'], FakeTokenizer(), candidate_id='qwen3-fixture')
        self.assertNotEqual(enabled['input_ids_sha256'], disabled['input_ids_sha256'])
        self.assertEqual(enabled['reasoning']['requested'], 'enabled')
        self.assertNotIn('<think>', enabled['rendered_text'])


class LocalTokenizerLoaderTests(unittest.TestCase):
    def _snapshot(self, path):
        (path/'tokenizer_config.json').write_text('{}')
        (path/'tokenizer.json').write_text('{}')

    def test_loader_is_local_only_and_does_not_import_model_weights(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            self._snapshot(path)
            auto = Mock()
            auto.from_pretrained.return_value = FakeTokenizer()
            with patch.dict(sys.modules, {'transformers': types.SimpleNamespace(AutoTokenizer=auto)}):
                tokenizer = load_local_tokenizer(path)
            self.assertIs(tokenizer, auto.from_pretrained.return_value)
            auto.from_pretrained.assert_called_once_with(str(path.resolve()), local_files_only=True, trust_remote_code=False, token=False)

    def test_loader_rejects_repo_id_and_incomplete_snapshot_before_import(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError): load_local_tokenizer(directory)
            with self.assertRaises(FileNotFoundError): load_local_tokenizer(Path(directory)/'not-acquired')

    def test_legacy_template_wrapper_loads_without_silent_conflicting_override(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            self._snapshot(path)
            (path/'chat_template.json').write_text(json.dumps({'chat_template': 'Legacy template'}))
            tokenizer = FakeTokenizer()
            tokenizer.chat_template = None
            auto = Mock()
            auto.from_pretrained.return_value = tokenizer
            with patch.dict(sys.modules, {'transformers': types.SimpleNamespace(AutoTokenizer=auto)}):
                loaded = load_local_tokenizer(path)
                self.assertEqual(loaded.chat_template, 'Legacy template')
                loaded.chat_template = 'Conflicting template'
                with self.assertRaises(PromptConfigurationError) as error: load_local_tokenizer(path)
            self.assertEqual(error.exception.code, 'conflicting_local_chat_templates')
            self.assertEqual(loaded.chat_template, 'Conflicting template')

    def test_legacy_duplicate_keys_and_ambiguous_templates_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            self._snapshot(path)
            (path/'chat_template.json').write_text('{"chat_template":"one","chat_template":"two"}')
            auto = Mock()
            auto.from_pretrained.return_value = FakeTokenizer()
            with patch.dict(sys.modules, {'transformers': types.SimpleNamespace(AutoTokenizer=auto)}):
                with self.assertRaises(PromptConfigurationError) as error: load_local_tokenizer(path)
            self.assertEqual(error.exception.code, 'legacy_chat_template_invalid')
        tokenizer = FakeTokenizer()
        tokenizer.chat_template = {'tool_use': 'one', 'other': 'two'}
        self.assertEqual(audit(tokenizer=tokenizer)['cases'][0]['error_code'],
                         'chat_template_unavailable_or_ambiguous')

    def test_legacy_wrapper_can_be_selected_without_named_template_lookup(self):
        tokenizer = FakeTokenizer()
        tokenizer.chat_template = {'chat_template': 'legacy enable_thinking template'}
        tokenizer.get_chat_template = Mock(side_effect=ValueError('no named default template'))
        self.assertTrue(audit(tokenizer=tokenizer)['all_fit'])
        tokenizer.get_chat_template.assert_not_called()


if __name__ == '__main__':
    unittest.main()
