"""Offline text and complete-chat token accounting; never a language-quality score.

Core helpers accept a tokenizer object and do not import model libraries. The one
loader imports Transformers lazily and only opens a pre-acquired local snapshot.
No text normalization, prompt truncation, or model generation occurs here.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
from typing import Any

_MAX_CASES = 256
_MAX_MESSAGES = 128
_MAX_CONTENT_CODEPOINTS = 65_536
_MAX_CONVERSATION_CODEPOINTS = 262_144
_MAX_TEMPLATE_BYTES = 262_144
_ROLES = {'system', 'user', 'assistant'}
_MODES = {'generation', 'training'}
_PROBE = [{'role': 'user', 'content': 'Template control probe.'}]
_TSHEG_DEFINITION = (
    'Count nonempty substrings containing at least one character U+0F40..U+0FBC '
    'after splitting each exact message at U+0F0B or U+0F0C. Other punctuation and '
    'spaces are not separators. This is an orthographic cost proxy, not a count '
    'of linguistic words or a verified syllable segmentation.'
)


class PromptConfigurationError(ValueError):
    """A prompt cannot be rendered under the requested explicit configuration."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _utf8(text: str) -> bytes:
    try:
        return text.encode('utf-8')
    except UnicodeEncodeError as exc:
        raise ValueError('text must contain valid Unicode scalar values') from exc


def _sha(text: str) -> str:
    return hashlib.sha256(_utf8(text)).hexdigest()


def _json_sha(value: Any) -> str:
    return _sha(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False))


def _positive_int(value: Any, name: str, *, maximum: int) -> None:
    if type(value) is not int or not 1 <= value <= maximum:
        raise ValueError(f'{name} must be an integer from 1 through {maximum}')


def _identifier(value: Any, name: str) -> None:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise ValueError(f'{name} must contain 1-128 nonblank characters')
    _utf8(value)


def _messages(messages: Any, mode: str) -> list[dict[str, str]]:
    if not isinstance(mode, str) or mode not in _MODES:
        raise ValueError('mode must be generation or training')
    if not isinstance(messages, list) or not 1 <= len(messages) <= _MAX_MESSAGES:
        raise ValueError(f'messages must contain 1-{_MAX_MESSAGES} messages')
    copied: list[dict[str, str]] = []
    total = 0
    expected_role = 'user'
    for index, message in enumerate(messages):
        if not isinstance(message, dict) or set(message) != {'role', 'content'}:
            raise ValueError('each text-only message requires exactly role and content')
        role, content = message['role'], message['content']
        if not isinstance(role, str) or role not in _ROLES:
            raise ValueError('unknown message role')
        if not isinstance(content, str) or not content.strip() or len(content) > _MAX_CONTENT_CODEPOINTS:
            raise ValueError('message content must contain 1-65536 nonblank Unicode code points')
        _utf8(content)
        total += len(content)
        if total > _MAX_CONVERSATION_CODEPOINTS:
            raise ValueError('conversation exceeds 262144 Unicode code points')
        if index == 0 and role == 'system':
            copied.append(dict(message))
            continue
        if role != expected_role:
            raise ValueError('messages must alternate user and assistant after an optional initial system')
        expected_role = 'assistant' if role == 'user' else 'user'
        copied.append(dict(message))
    required_last = 'user' if mode == 'generation' else 'assistant'
    if copied[-1]['role'] != required_last:
        raise ValueError(f'{mode} messages must end in {required_last}')
    return copied


def _template(tokenizer: Any) -> str:
    try:
        getter = getattr(tokenizer, 'get_chat_template', None)
        raw_template = getattr(tokenizer, 'chat_template', None)
        # A legacy wrapper is one template, not a named template collection.
        template = (raw_template['chat_template']
                    if isinstance(raw_template, dict) and set(raw_template) == {'chat_template'}
                    else getter() if callable(getter) else raw_template)
        if isinstance(template, dict) and set(template) == {'chat_template'}:
            template = template['chat_template']
        elif isinstance(template, dict):
            template = template.get('default')
        if not isinstance(template, str) or not template.strip():
            raise PromptConfigurationError('chat_template_unavailable_or_ambiguous')
        if len(_utf8(template)) > _MAX_TEMPLATE_BYTES:
            raise PromptConfigurationError('chat_template_exceeds_size_bound')
        return template
    except PromptConfigurationError:
        raise
    except Exception as exc:
        raise PromptConfigurationError('chat_template_unavailable_or_ambiguous') from exc


def _token_ids(value: Any) -> list[int]:
    if not isinstance(value, list) or any(type(token) is not int or token < 0 for token in value):
        raise PromptConfigurationError('tokenizer_returned_invalid_token_ids')
    return list(value)


def _encode(tokenizer: Any, text: str) -> list[int]:
    try:
        return _token_ids(tokenizer.encode(text, add_special_tokens=False))
    except PromptConfigurationError:
        raise
    except Exception as exc:
        raise PromptConfigurationError('text_tokenization_failed') from exc


def _render(tokenizer: Any, messages: list[dict[str, str]], template: str,
            generation: bool, kwargs: dict[str, Any]) -> str:
    try:
        rendered = tokenizer.apply_chat_template(
            messages, chat_template=template, tokenize=False,
            add_generation_prompt=generation, continue_final_message=False,
            return_dict=False, truncation=False, **kwargs,
        )
        if not isinstance(rendered, str) or not rendered:
            raise PromptConfigurationError('chat_template_returned_invalid_text')
        _utf8(rendered)
        return rendered
    except PromptConfigurationError:
        raise
    except Exception as exc:
        raise PromptConfigurationError('chat_template_render_failed') from exc


def _reasoning(tokenizer: Any, template: str, candidate_id: str,
               reasoning_mode: str) -> tuple[dict[str, Any], dict[str, Any]]:
    if not isinstance(reasoning_mode, str) or reasoning_mode not in {'disabled', 'enabled'}:
        raise ValueError('reasoning_mode must be disabled or enabled')
    lower = candidate_id.lower()
    if 'qwen3' in lower or 'qwen-3' in lower:
        if 'enable_thinking' not in template:
            raise PromptConfigurationError('qwen_reasoning_control_unsupported')
        disabled = _render(tokenizer, _PROBE, template, True, {'enable_thinking': False})
        enabled = _render(tokenizer, _PROBE, template, True, {'enable_thinking': True})
        empty_closed_think = re.compile(r'<think>\s*</think>\s*\Z')
        # A permissive **kwargs signature does not show that a template consumes a
        # flag. Confirm the requested prefix change with exact rendered strings.
        if (disabled == enabled or not empty_closed_think.search(disabled)
                or empty_closed_think.search(enabled)):
            raise PromptConfigurationError('qwen_reasoning_control_unverified')
        return {'enable_thinking': reasoning_mode == 'enabled'}, {
            'requested': reasoning_mode,
            'status': 'verified_generation_prefix_control',
            'scope': 'Template generation prefix only; this does not prove model reasoning behavior.',
            'disabled_probe_utf8_sha256': _sha(disabled),
            'enabled_probe_utf8_sha256': _sha(enabled),
            'disabled_probe_ends_with_empty_closed_think': True,
        }
    if 'gemma3' in lower or 'gemma-3' in lower:
        if reasoning_mode == 'enabled':
            raise PromptConfigurationError('gemma_reasoning_control_not_supported')
        return {}, {
            'requested': reasoning_mode,
            'status': 'not_applicable',
            'scope': 'Gemma 3 uses its unchanged local chat template; no thinking flag is applied.',
        }
    raise PromptConfigurationError('candidate_reasoning_policy_unknown')


def render_conversation(messages: list[dict[str, str]], tokenizer: Any, *,
                        candidate_id: str, mode: str = 'generation',
                        reasoning_mode: str = 'disabled') -> dict[str, Any]:
    """Return the exact complete prompt and IDs consumed by an offline runner.

    The full string and token IDs are returned deliberately, for actual inference;
    use ``audit_conversations`` when an artifact should contain only measurements.
    The selected template, system turn, evidence, previous turns and generation
    prefix all participate. Training does not append a generation prefix.
    """
    _identifier(candidate_id, 'candidate_id')
    messages = _messages(messages, mode)
    template = _template(tokenizer)
    kwargs, reasoning = _reasoning(tokenizer, template, candidate_id, reasoning_mode)
    rendered = _render(tokenizer, messages, template, mode == 'generation', kwargs)
    if reasoning['status'] == 'verified_generation_prefix_control' and mode == 'generation':
        closed_empty = bool(re.search(r'<think>\s*</think>\s*\Z', rendered))
        if closed_empty != (reasoning_mode == 'disabled'):
            raise PromptConfigurationError('qwen_actual_generation_prefix_unverified')
        reasoning['actual_generation_prefix_verified'] = True
    token_ids = _encode(tokenizer, rendered)
    if not token_ids:
        raise PromptConfigurationError('rendered_prompt_has_no_tokens')
    try:
        template_ids = _token_ids(tokenizer.apply_chat_template(
            messages, chat_template=template, tokenize=True,
            add_generation_prompt=mode == 'generation', continue_final_message=False,
            return_dict=False, truncation=False, **kwargs,
        ))
    except PromptConfigurationError:
        raise
    except Exception as exc:
        raise PromptConfigurationError('chat_template_tokenization_failed') from exc
    if template_ids != token_ids:
        raise PromptConfigurationError('rendered_and_template_token_ids_differ')
    return {
        'candidate_id': candidate_id, 'mode': mode,
        'add_generation_prompt': mode == 'generation',
        'rendered_text': rendered, 'input_ids': token_ids,
        'rendered_utf8_sha256': _sha(rendered),
        'rendered_utf8_bytes': len(_utf8(rendered)),
        'rendered_unicode_codepoints': len(rendered),
        'input_ids_sha256': _json_sha(token_ids),
        'chat_template_utf8_sha256': _sha(template),
        'messages_sha256': _json_sha(messages),
        'reasoning': reasoning,
        'text_normalized': False, 'truncated': False,
        'tokenization': 'Complete rendered template encoded with add_special_tokens=False; IDs checked against apply_chat_template(tokenize=True).',
    }


def _text_measurements(text: str, tokenizer: Any) -> dict[str, Any]:
    tsheg_segments = sum(bool(re.search(r'[\u0f40-\u0fbc]', segment))
                         for segment in re.split(r'[\u0f0b\u0f0c]', text))
    token_count = len(_encode(tokenizer, text))
    return {
        'content_utf8_sha256': _sha(text),
        'unicode_codepoints': len(text), 'utf8_bytes': len(_utf8(text)),
        'tsheg_separated_tibetan_segments': tsheg_segments,
        'raw_content_tokens': token_count,
        'tokens_per_tsheg_segment': token_count / tsheg_segments if tsheg_segments else None,
    }


def _cases(value: Any) -> tuple[list[dict[str, Any]], str]:
    evidence_type = 'unspecified_input_evidence'
    if isinstance(value, dict):
        if set(value) != {'schema_version', 'evidence_type', 'cases'} or value['schema_version'] != '1.0':
            raise ValueError('audit fixture requires schema_version 1.0, evidence_type and cases only')
        evidence_type = value['evidence_type']
        _identifier(evidence_type, 'evidence_type')
        value = value['cases']
    if not isinstance(value, list) or not 1 <= len(value) <= _MAX_CASES:
        raise ValueError(f'cases must contain 1-{_MAX_CASES} cases')
    seen = set()
    clean = []
    for case in value:
        if not isinstance(case, dict) or set(case) != {'case_id', 'messages', 'mode'}:
            raise ValueError('each case requires exactly case_id, messages and mode')
        _identifier(case['case_id'], 'case_id')
        if case['case_id'] in seen:
            raise ValueError('case_id values must be unique')
        seen.add(case['case_id'])
        clean.append({'case_id': case['case_id'], 'mode': case['mode'],
                      'messages': _messages(case['messages'], case['mode'])})
    return clean, evidence_type


def audit_conversations(cases: Any, tokenizer: Any, *, candidate_id: str,
                        context_limit: int, max_output_tokens: int,
                        reasoning_mode: str = 'disabled') -> dict[str, Any]:
    """Audit a case list or full fixture without saving prompt text or generating.

    ``context_limit`` is an explicit caller-provided experiment budget, not an
    inferred claim about a model's supported context. For a training case the
    target is already present, so reserved additional output is zero.
    """
    _identifier(candidate_id, 'candidate_id')
    _positive_int(context_limit, 'context_limit', maximum=1_048_576)
    _positive_int(max_output_tokens, 'max_output_tokens', maximum=1_048_576)
    if not isinstance(reasoning_mode, str) or reasoning_mode not in {'disabled', 'enabled'}:
        raise ValueError('reasoning_mode must be disabled or enabled')
    cases, evidence_type = _cases(cases)
    rows = []
    for case in cases:
        row = {'case_id': case['case_id'], 'mode': case['mode'],
               'messages_sha256': _json_sha(case['messages']), 'fit': False,
               'truncated': False}
        try:
            measurements = [dict(index=index, role=message['role'],
                                 **_text_measurements(message['content'], tokenizer))
                            for index, message in enumerate(case['messages'])]
            row['messages'] = measurements
            row['raw_content_tokens_sum'] = sum(m['raw_content_tokens'] for m in measurements)
            row['raw_unicode_codepoints_sum'] = sum(m['unicode_codepoints'] for m in measurements)
            row['raw_utf8_bytes_sum'] = sum(m['utf8_bytes'] for m in measurements)
            rendered = render_conversation(case['messages'], tokenizer, candidate_id=candidate_id,
                                           mode=case['mode'], reasoning_mode=reasoning_mode)
            complete_count = len(rendered['input_ids'])
            remaining = context_limit - complete_count
            reserved = max_output_tokens if case['mode'] == 'generation' else 0
            fit = remaining >= reserved
            row.update({
                'outcome': 'fits_context_budget' if fit else 'context_overflow',
                'complete_chat_tokens': complete_count,
                'complete_minus_individual_raw_tokens': complete_count - row['raw_content_tokens_sum'],
                'rendered_utf8_sha256': rendered['rendered_utf8_sha256'],
                'rendered_utf8_bytes': rendered['rendered_utf8_bytes'],
                'rendered_unicode_codepoints': rendered['rendered_unicode_codepoints'],
                'input_ids_sha256': rendered['input_ids_sha256'],
                'chat_template_utf8_sha256': rendered['chat_template_utf8_sha256'],
                'reasoning': rendered['reasoning'],
                'add_generation_prompt': rendered['add_generation_prompt'],
                'remaining_context_tokens': remaining,
                'available_output_tokens': max(0, remaining),
                'reserved_output_tokens': reserved,
                'fits_prompt': remaining >= 0,
                'fits_output_budget': fit, 'fit': fit,
            })
        except PromptConfigurationError as exc:
            row.update({'outcome': 'unsupported_configuration', 'error_code': exc.code,
                        'complete_chat_tokens': None, 'available_output_tokens': None})
        rows.append(row)
    return {
        'schema_version': '1.0', 'evidence_type': 'tokenizer_cost_audit',
        'input_evidence_type': evidence_type, 'candidate_id': candidate_id,
        'context_limit': context_limit, 'context_limit_basis': 'Caller-selected experiment budget.',
        'max_output_tokens': max_output_tokens, 'reasoning_mode': reasoning_mode,
        'input_cases_sha256': _json_sha(cases), 'cases': rows,
        'all_fit': all(row['fit'] for row in rows),
        'definitions': {
            'unicode_codepoints': 'Python len(str), without Unicode normalization; not grapheme count.',
            'tsheg_separated_tibetan_segments': _TSHEG_DEFINITION,
            'raw_content_tokens_sum': 'Sum of each message content encoded separately without special tokens; excludes role/template syntax.',
            'tokens_per_tsheg_segment': 'Entire raw message token count divided by the defined segment count, or null when zero; mixed-language text includes all non-Tibetan tokens in the numerator.',
            'complete_chat_tokens': 'All template-rendered roles and content, with generation prefix only for generation mode.',
            'complete_minus_individual_raw_tokens': 'Difference between full prompt and separately encoded contents; token merging and special-token treatment can affect it.',
            'hashes': 'SHA-256 of exact UTF-8 strings. Structured messages, cases and token IDs use sorted-key compact JSON encoded as UTF-8.',
        },
        'limitations': [
            'Token counts and fixture fit do not measure Tibetan comprehension, translation accuracy or health safety.',
            'No model was loaded or sampled. Memory fit, latency and language quality remain untested.',
            'Reasoning control evidence concerns template rendering only, not model compliance.',
        ],
        'text_normalized': False, 'truncated': False,
    }


def load_local_tokenizer(snapshot_dir: str | Path) -> Any:
    """Load an already acquired tokenizer, with no network or remote Python code.

    Legacy ``chat_template.json`` wrappers are read only if they agree with the
    tokenizer's selected template or no template was loaded. A conflict must be
    resolved explicitly in the candidate configuration; this loader never picks
    an unrecorded replacement template.
    """
    path = Path(snapshot_dir).expanduser().resolve(strict=True)
    if not path.is_dir() or not (path / 'tokenizer_config.json').is_file():
        raise ValueError('snapshot must be an existing directory with tokenizer_config.json')
    if not any((path / name).is_file() for name in ('tokenizer.json', 'tokenizer.model')):
        raise ValueError('snapshot must contain a local tokenizer.json or tokenizer.model')
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(
        str(path), local_files_only=True, trust_remote_code=False, token=False,
    )
    legacy = path / 'chat_template.json'
    if legacy.exists():
        if not legacy.is_file() or legacy.stat().st_size > _MAX_TEMPLATE_BYTES:
            raise PromptConfigurationError('legacy_chat_template_invalid')
        try:
            def unique_keys(pairs):
                result = {}
                for key, item in pairs:
                    if key in result:
                        raise ValueError('duplicate JSON keys')
                    result[key] = item
                return result
            value = json.loads(legacy.read_text(encoding='utf-8'), object_pairs_hook=unique_keys)
            if isinstance(value, dict) and set(value) == {'chat_template'}:
                value = value['chat_template']
            if not isinstance(value, str) or not value.strip():
                raise ValueError('expected a template string or chat_template wrapper')
            if len(_utf8(value)) > _MAX_TEMPLATE_BYTES:
                raise ValueError('template too large')
        except (OSError, UnicodeError, ValueError) as exc:
            raise PromptConfigurationError('legacy_chat_template_invalid') from exc
        existing = getattr(tokenizer, 'chat_template', None)
        if existing is None:
            tokenizer.chat_template = value
        elif _template(tokenizer) != value:
            raise PromptConfigurationError('conflicting_local_chat_templates')
    _template(tokenizer)
    return tokenizer
