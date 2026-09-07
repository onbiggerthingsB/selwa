"""Exact, assistant-only inputs for the isolated synthetic mechanics experiment.

This is not a contributed-data release builder. The four examples are newly
authored English extraction exercises, not Tibetan or medical training data.
All input IDs come from the project's existing complete-chat renderer. Nothing
in this module loads model weights, imports MLX, truncates, or pads a sequence.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from .token_audit import render_conversation


_MAX_SEQUENCE_LENGTH = 8192
_MECHANICS_EXAMPLES = (
    ('mechanics-color', 'Box color: blue. Return only the box color.', 'blue'),
    ('mechanics-count', 'There are three cups. Return only the count word.', 'three'),
    ('mechanics-place', 'The book is on the desk. Return only the place.', 'desk'),
    ('mechanics-name', 'The label reads Cedar. Return only the label text.', 'Cedar'),
)


def _integer(value: Any, name: str, *, minimum: int, maximum: int) -> None:
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f'{name} must be an integer from {minimum} through {maximum}')


def _text(value: Any, name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{name} must contain nonblank text')
    try:
        value.encode('utf-8')
    except UnicodeEncodeError as exc:
        raise ValueError(f'{name} must contain valid Unicode scalar values') from exc


def _json_sha(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':'), allow_nan=False).encode('utf-8')).hexdigest()


def _decode(tokenizer: Any, tokens: list[int], *, skip_special_tokens: bool = False) -> str:
    try:
        decoded = tokenizer.decode(tokens, skip_special_tokens=skip_special_tokens)
    except Exception as exc:
        raise ValueError('target token decoding failed') from exc
    _text(decoded, 'decoded tokens')
    return decoded


def _configuration(template_kwargs: dict[str, Any] | None) -> dict[str, str]:
    # These are options of the existing project renderer, not arbitrary template
    # flags. In particular no caller can request implicit truncation or thinking.
    if template_kwargs is None:
        template_kwargs = {}
    if not isinstance(template_kwargs, dict) or set(template_kwargs) - {'candidate_id', 'reasoning_mode'}:
        raise ValueError('template_kwargs permits only candidate_id and reasoning_mode')
    candidate_id = template_kwargs.get('candidate_id', 'gemma-3-mechanics')
    _text(candidate_id, 'candidate_id')
    reasoning_mode = template_kwargs.get('reasoning_mode', 'disabled')
    if reasoning_mode != 'disabled':
        raise ValueError('mechanics training requires explicitly disabled reasoning')
    return {'candidate_id': candidate_id, 'reasoning_mode': reasoning_mode}


def supervised_positions(token_count: int, offset: int, padded_length: int) -> list[int]:
    """Return original token indices to supervise, excluding prompt and pads.

    For next-token logits ``logits[:, :-1]`` and targets ``tokens[:, 1:]``, the
    corresponding loss-column indices are each returned index minus one. A
    six-token sequence with assistant offset three has targets [3, 4, 5], even
    when padded to eight tokens. The first pad at original index six is excluded.
    """
    _integer(token_count, 'token_count', minimum=2, maximum=_MAX_SEQUENCE_LENGTH)
    _integer(offset, 'offset', minimum=1, maximum=token_count - 1)
    _integer(padded_length, 'padded_length', minimum=token_count,
             maximum=_MAX_SEQUENCE_LENGTH)
    return list(range(offset, token_count))


def validate_training_record(record: dict[str, Any], max_seq_length: int) -> None:
    """Reject malformed, overlong or empty assistant objectives before execution.

    This structural check does not establish contribution rights or model/data
    provenance. ``prepare_training_example`` additionally verifies rendering and
    decoded answer identity with the actual tokenizer.
    """
    _integer(max_seq_length, 'max_seq_length', minimum=2, maximum=_MAX_SEQUENCE_LENGTH)
    required = {'example_id', 'messages', 'tokens', 'offset', 'decoded_target'}
    if not isinstance(record, dict) or not required <= set(record):
        raise ValueError('training record is missing required fields')
    _text(record['example_id'], 'example_id')
    messages = record['messages']
    if not isinstance(messages, list) or len(messages) < 2:
        raise ValueError('training messages must contain a prompt and final assistant answer')
    expected = 'user'
    for index, message in enumerate(messages):
        if not isinstance(message, dict) or set(message) != {'role', 'content'}:
            raise ValueError('messages require exactly role and content')
        _text(message['content'], 'message content')
        if index == 0 and message['role'] == 'system':
            continue
        if message['role'] != expected:
            raise ValueError('messages must alternate user and assistant')
        expected = 'assistant' if expected == 'user' else 'user'
    if messages[-1]['role'] != 'assistant':
        raise ValueError('training messages must end in assistant')
    tokens = record['tokens']
    if (not isinstance(tokens, list) or len(tokens) < 2
            or any(type(token) is not int or token < 0 for token in tokens)):
        raise ValueError('tokens must contain at least two nonnegative integer IDs')
    if len(tokens) > max_seq_length:
        raise ValueError('training record exceeds max_seq_length; truncation is forbidden')
    supervised_positions(len(tokens), record['offset'], len(tokens))
    _text(record['decoded_target'], 'decoded_target')
    if not record['decoded_target'].startswith(messages[-1]['content']):
        raise ValueError('decoded supervised target must begin with the exact assistant answer')
    if 'decoded_target_without_special_tokens' in record:
        _text(record['decoded_target_without_special_tokens'], 'meaningful decoded target')
    if 'prompt_token_ids' in record and record['prompt_token_ids'] != tokens[:record['offset']]:
        raise ValueError('prompt_token_ids differ from the exact token prefix')
    if 'input_ids_sha256' in record and record['input_ids_sha256'] != _json_sha(tokens):
        raise ValueError('training token hash mismatch')
    if 'messages_sha256' in record and record['messages_sha256'] != _json_sha(messages):
        raise ValueError('training messages hash mismatch')
    if 'target_ids_sha256' in record and record['target_ids_sha256'] != _json_sha(tokens[record['offset']:]):
        raise ValueError('training target hash mismatch')


def prepare_training_example(tokenizer: Any, *, example_id: str,
                             messages: list[dict[str, str]], max_seq_length: int = 256,
                             template_kwargs: dict[str, Any] | None = None) -> dict[str, Any]:
    """Render one exact final-assistant objective; refuse ambiguous boundaries.

    The generation prefix must be both a text prefix and a token prefix of the
    training rendering. No offset from a separate tokenizer path is trusted.
    The complete template-provided answer suffix, including its intended EOS /
    end-of-turn tokens, is supervised. No EOS is synthesized or stripped.
    """
    _integer(max_seq_length, 'max_seq_length', minimum=2, maximum=_MAX_SEQUENCE_LENGTH)
    _text(example_id, 'example_id')
    configuration = _configuration(template_kwargs)
    full = render_conversation(messages, tokenizer, mode='training', **configuration)
    prompt = render_conversation(messages[:-1], tokenizer, mode='generation', **configuration)
    tokens, prefix = full['input_ids'], prompt['input_ids']
    if not full['rendered_text'].startswith(prompt['rendered_text']):
        raise ValueError('generation rendering is not an exact training text prefix')
    if tokens[:len(prefix)] != prefix:
        raise ValueError('generation token IDs are not an exact training token prefix')
    offset = len(prefix)
    supervised_positions(len(tokens), offset, len(tokens))
    target_text = full['rendered_text'][len(prompt['rendered_text']):]
    if not target_text.startswith(messages[-1]['content']):
        raise ValueError('rendered supervised target must begin with the exact assistant answer')
    record = {
        'example_id': example_id,
        'messages': [dict(message) for message in messages],
        'tokens': tokens,
        'offset': offset,
        'prompt_token_ids': prefix,
        'decoded_prompt': _decode(tokenizer, prefix),
        'decoded_target': _decode(tokenizer, tokens[offset:]),
        'decoded_target_without_special_tokens': _decode(
            tokenizer, tokens[offset:], skip_special_tokens=True),
        'rendered_prompt': prompt['rendered_text'],
        'rendered_target': target_text,
        'input_ids_sha256': full['input_ids_sha256'],
        'messages_sha256': full['messages_sha256'],
        'target_ids_sha256': _json_sha(tokens[offset:]),
        'rendered_utf8_sha256': full['rendered_utf8_sha256'],
        'chat_template_utf8_sha256': full['chat_template_utf8_sha256'],
        'candidate_id': full['candidate_id'],
        'reasoning': full['reasoning'],
        'truncated': False,
        'objective': 'final_assistant_and_template_suffix_only',
    }
    validate_training_record(record, max_seq_length)
    return record


def prepare_mechanics_examples(tokenizer: Any, max_seq_length: int = 256,
                               template_kwargs: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Prepare four newly authored, nonclinical English mechanics-only examples."""
    return [prepare_training_example(
        tokenizer, example_id=example_id,
        messages=[{'role': 'user', 'content': prompt},
                  {'role': 'assistant', 'content': answer}],
        max_seq_length=max_seq_length, template_kwargs=template_kwargs,
    ) | {'evidence_type': 'newly_authored_synthetic_mechanics_only',
         'instruction_language': 'en', 'content_language': 'en',
         'eligible_for_language_quality_claim': False}
        for example_id, prompt, answer in _MECHANICS_EXAMPLES]
