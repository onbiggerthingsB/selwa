"""Import exact blinded responses as private, append-only operator evidence.

File hashes and exact embedded submissions detect accidental changes; they do not
authenticate a reviewer or prove the operator's declaration of independence.
Nothing here approves source material, selects a model, or authorizes training.
"""
from __future__ import annotations

from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import tempfile
from typing import Any

from .artifacts import utc_now
from .blind_review import _encoded, _hash, _path, _private_directory, _unique
from .inference import OUTCOMES
from .records import RecordsError, content_sha256, record_sha256

_MAX_INPUT_BYTES = 32 * 1024 * 1024
_MAX_RECORD_BYTES = 128 * 1024 * 1024
_MAX_CHAIN = 32
_MAX_CHAIN_BYTES = 256 * 1024 * 1024
_RATINGS = {'fidelity', 'comprehension', 'naturalness'}
_RESPONSE_FIELDS = {'ratings', 'issues', 'blind_compromised'}
_ROW_FIELDS = {'blind_id', 'source_text', 'question', 'answer'} | _RESPONSE_FIELDS
_PACKET_FIELDS = {'schema_version', 'kind', 'packet_id', 'reviewer_id', 'status',
                  'input_evidence_type', 'instructions', 'rating_scale', 'items'}
_KEY_FIELDS = {'schema_version', 'kind', 'packet_id', 'reviewer_id', 'created_at',
               'run_id', 'run_manifest_sha256', 'dataset_canonical_sha256',
               'dataset_input_file_sha256', 'packet_file_sha256', 'purpose',
               'status', 'items', 'excluded_cases', 'unrecorded_case_count',
               'operator_instructions', 'approval_granted'}
_BINDING_FIELDS = {'blind_id', 'case_id', 'candidate_id', 'model_identity',
                   'result_file', 'result_file_sha256', 'example_id',
                   'example_version', 'example_sha256', 'source_id',
                   'source_version', 'source_sha256', 'question_sha256',
                   'answer_sha256', 'review_item_sha256'}
_PAIRED_ROW_FIELDS = {'input_language', 'requested_output_language'}
_PAIRED_KEY_FIELDS = {'parallel_material_sha256'}
_PAIRED_BINDING_FIELDS = {'pair_id', 'condition_id', 'input_language',
                          'output_language', 'parallel_pair_sha256'}
_CONDITIONS = {'bo_to_bo': ('bo', 'bo'), 'bo_to_zh': ('bo', 'zh'),
               'zh_to_bo': ('zh', 'bo'), 'zh_to_zh': ('zh', 'zh')}
_RECORD_FIELDS = {'schema_version', 'kind', 'import_id', 'created_at', 'packet_id',
                  'reviewer_id', 'purpose', 'input_evidence_type', 'evidence_kind',
                  'independent', 'status', 'completed_item_count', 'item_count',
                  'approval_granted', 'dataset_modified', 'items', 'provenance',
                  'embedded_evidence', 'private_key'}
_PROVENANCE_FIELDS = {'original_packet_path', 'returned_packet_path', 'private_key_path',
                      'original_packet_file_sha256', 'returned_packet_file_sha256',
                      'private_key_file_sha256', 'previous_import'}


def _object(value: Any, fields: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != fields:
        raise RecordsError(f'{label} has missing or unknown fields.')
    return value


def _text(value: Any, label: str, *, maximum: int = 1024) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise RecordsError(f'{label} must be bounded nonblank text.')
    return value


def _timestamp(value: Any) -> None:
    _text(value, 'Timestamp', maximum=64)
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            raise ValueError('No timezone')
    except ValueError as exc:
        raise RecordsError('Timestamp must include an explicit timezone.') from exc


def _parse(text: str) -> dict:
    def nonfinite(value):
        raise RecordsError('Non-finite JSON values are not allowed.')
    try:
        result = json.loads(text, object_pairs_hook=_unique, parse_constant=nonfinite)
        if not isinstance(result, dict):
            raise RecordsError('Review evidence must be a JSON object.')
        record_sha256(result)
        return result
    except (UnicodeError, json.JSONDecodeError, TypeError, ValueError, RecursionError) as exc:
        raise RecordsError('Review evidence must contain strict finite UTF-8 JSON.') from exc


def _private(path: Path, *, directory: bool = False) -> None:
    info = path.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise RecordsError('Operator evidence and key files/directories must be owner-private (0700/0600 or stricter).')
    if directory and not stat.S_ISDIR(info.st_mode):
        raise RecordsError('Private evidence parent must be a directory.')


def _read_text(path: Path, *, private: bool = False, limit: int = _MAX_INPUT_BYTES) -> tuple[str, str]:
    _path(path)
    if not stat.S_ISREG(path.lstat().st_mode):
        raise RecordsError('Review inputs must be regular, non-hardlinked files.')
    if private:
        _private(path.parent, directory=True)
        _private(path)
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise RecordsError('Review inputs must be regular, non-hardlinked files.')
        if private and (info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077):
            raise RecordsError('Operator evidence must remain owner-private.')
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise RecordsError('Review evidence exceeds its bounded file size.')
    try:
        return data.decode('utf-8'), hashlib.sha256(data).hexdigest()
    except UnicodeError as exc:
        raise RecordsError('Review evidence must be UTF-8.') from exc


def _response(row: dict) -> bool:
    _object(row['ratings'], _RATINGS, 'Ratings')
    for value in row['ratings'].values():
        if value is not None and (type(value) is not int or not 1 <= value <= 4):
            raise RecordsError('Ratings must be null or integers from 1 to 4, never booleans.')
    if not isinstance(row['issues'], list) or len(row['issues']) > 128:
        raise RecordsError('Issues must be a bounded list of strings.')
    for issue in row['issues']:
        _text(issue, 'Issue', maximum=8192)
    if row['blind_compromised'] is not None and type(row['blind_compromised']) is not bool:
        raise RecordsError('blind_compromised must be null or a boolean.')
    return all(value is not None for value in row['ratings'].values()) and row['blind_compromised'] is not None


def _validate_pair(original: dict, returned: dict, key: dict, original_sha: str) -> list[dict]:
    _object(original, _PACKET_FIELDS, 'Review packet')
    version = original['schema_version']
    if not isinstance(version, str) or version not in {'1.0', '1.1'}:
        raise RecordsError('Unsupported review packet schema version.')
    paired = version == '1.1'
    for packet in (original, returned):
        _object(packet, _PACKET_FIELDS, 'Review packet')
        if (packet['schema_version'] != version or packet['kind'] != 'blind_model_output_review'
                or packet['status'] != 'unfilled'):
            raise RecordsError('Packet identity and unfilled status must remain unchanged.')
        _text(packet['packet_id'], 'Packet ID', maximum=128)
        _text(packet['reviewer_id'], 'Reviewer ID', maximum=128)
        if not isinstance(packet['input_evidence_type'], str) or packet['input_evidence_type'] not in {'infrastructure_smoke', 'unscored_language_generation'}:
            raise RecordsError('Unknown packet evidence type.')
        if not isinstance(packet['instructions'], list) or not 1 <= len(packet['instructions']) <= 32:
            raise RecordsError('Packet instructions must be a bounded nonempty list.')
        for instruction in packet['instructions']:
            _text(instruction, 'Instruction', maximum=8192)
        if packet['rating_scale'] != {'1': 'Major failure', '2': 'Substantial problems', '3': 'Minor problems', '4': 'No identified problems'}:
            raise RecordsError('Packet rating scale differs from the exported contract.')
        if not isinstance(packet['items'], list) or not 1 <= len(packet['items']) <= 10000:
            raise RecordsError('Packet items must be a bounded nonempty list.')
    if record_sha256({k: v for k, v in original.items() if k != 'items'}) != record_sha256({k: v for k, v in returned.items() if k != 'items'}):
        raise RecordsError('Returned packet metadata differs from the original.')
    _object(key, _KEY_FIELDS | (_PAIRED_KEY_FIELDS if paired else set()), 'Private key')
    if (key['schema_version'] != version or key['kind'] != 'private_blind_model_output_key'
            or key['status'] != 'exported_awaiting_independent_review'
            or key['approval_granted'] is not False
            or key['packet_id'] != original['packet_id'] or key['reviewer_id'] != original['reviewer_id']):
        raise RecordsError('Private key does not bind the original packet identity.')
    _timestamp(key['created_at'])
    _text(key['run_id'], 'Run ID', maximum=128)
    _text(key['operator_instructions'], 'Operator instructions', maximum=8192)
    for field in ('run_manifest_sha256', 'dataset_canonical_sha256', 'dataset_input_file_sha256', 'packet_file_sha256'):
        if not _hash(key[field]):
            raise RecordsError('Private key contains an invalid evidence hash.')
    if paired and not _hash(key['parallel_material_sha256']):
        raise RecordsError('Private key contains an invalid parallel material hash.')
    if key['packet_file_sha256'] != original_sha:
        raise RecordsError('Original packet bytes differ from the trusted private key hash.')
    expected = {'infrastructure_smoke': 'infrastructure_smoke', 'language_baseline': 'unscored_language_generation'}
    if not isinstance(key['purpose'], str) or key['purpose'] not in expected or expected[key['purpose']] != original['input_evidence_type']:
        raise RecordsError('Private key purpose disagrees with packet evidence type.')
    if type(key['unrecorded_case_count']) is not int or not 0 <= key['unrecorded_case_count'] <= 10000:
        raise RecordsError('Invalid unrecorded case count.')
    if not isinstance(key['excluded_cases'], list) or len(key['excluded_cases']) > 10000:
        raise RecordsError('Invalid excluded case inventory.')
    excluded_ids = set()
    for item in key['excluded_cases']:
        _object(item, {'case_id', 'outcome', 'reason'}, 'Excluded case')
        _text(item['case_id'], 'Excluded case ID', maximum=256)
        if (item['case_id'] in excluded_ids or not isinstance(item['outcome'], str) or item['outcome'] not in OUTCOMES
                or not isinstance(item['reason'], str) or item['reason'] not in {'synthetic_backend', 'inference_not_successful'}
                or (item['reason'] == 'inference_not_successful' and item['outcome'] == 'success')):
            raise RecordsError('Malformed or duplicate excluded case.')
        excluded_ids.add(item['case_id'])
    if (not isinstance(key['items'], list) or len(key['items']) != len(original['items'])
            or len(returned['items']) != len(original['items'])):
        raise RecordsError('Returned packet or key has a missing or extra item.')
    seen, cases, pairs, result_files = set(), set(excluded_ids), set(), set()
    items = []
    for before, after, binding in zip(original['items'], returned['items'], key['items']):
        row_fields = _ROW_FIELDS | (_PAIRED_ROW_FIELDS if paired else set())
        binding_fields = _BINDING_FIELDS | (_PAIRED_BINDING_FIELDS if paired else set())
        _object(before, row_fields, 'Original review item')
        _object(after, row_fields, 'Returned review item')
        _object(binding, binding_fields, 'Private item binding')
        _text(before['blind_id'], 'Blind ID', maximum=128)
        if before['blind_id'] in seen:
            raise RecordsError('Duplicate blind item IDs are not allowed.')
        seen.add(before['blind_id'])
        for field in ('source_text', 'question', 'answer'):
            _text(before[field], field, maximum=1024 * 1024)
        if (before['ratings'] != {name: None for name in _RATINGS}
                or before['issues'] != [] or before['blind_compromised'] is not None):
            raise RecordsError('Original packet must contain only unfilled responses.')
        _response(before)
        if record_sha256({k: v for k, v in before.items() if k not in _RESPONSE_FIELDS}) != record_sha256({k: v for k, v in after.items() if k not in _RESPONSE_FIELDS}):
            raise RecordsError('Returned item identity, order, source, question or answer was changed.')
        complete = _response(after)
        for field in ('case_id', 'candidate_id', 'model_identity', 'example_id', 'source_id'):
            _text(binding[field], field, maximum=512)
        for field in ('example_version', 'source_version'):
            if type(binding[field]) is not int or binding[field] < 1:
                raise RecordsError('Binding versions must be positive integers.')
        for field in ('result_file_sha256', 'example_sha256', 'source_sha256', 'question_sha256', 'answer_sha256', 'review_item_sha256'):
            if not _hash(binding[field]):
                raise RecordsError('A private item binding hash is invalid.')
        if (not re.fullmatch(r'[^/@\s]+/[^/@\s]+@[0-9a-f]{40}', binding['model_identity'])
                or not isinstance(binding['result_file'], str)
                or not re.fullmatch(r'case\.[0-9]{3,}\.result\.json', binding['result_file'])):
            raise RecordsError('Binding requires a pinned model and local result filename.')
        if (binding['blind_id'] != before['blind_id'] or binding['review_item_sha256'] != record_sha256(before)
                or binding['source_sha256'] != content_sha256(before['source_text'])
                or binding['question_sha256'] != content_sha256(before['question'])
                or binding['answer_sha256'] != content_sha256(before['answer'])):
            raise RecordsError('Private item binding differs from the exact review text.')
        if paired:
            if (not isinstance(binding['pair_id'], str)
                    or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,95}', binding['pair_id'])):
                raise RecordsError('Pair ID must be a safe 1-96 character identifier.')
            if not _hash(binding['parallel_pair_sha256']):
                raise RecordsError('A private parallel pair hash is invalid.')
            condition = binding['condition_id']
            if (not isinstance(condition, str) or condition not in _CONDITIONS
                    or (binding['input_language'], binding['output_language']) != _CONDITIONS[condition]
                    or (before['input_language'], before['requested_output_language']) != _CONDITIONS[condition]):
                raise RecordsError('Paired condition and input/output languages disagree.')
            pair = (binding['candidate_id'], binding['pair_id'], condition)
        else:
            pair = (binding['candidate_id'], binding['example_id'])
        if binding['case_id'] in cases or pair in pairs or binding['result_file'] in result_files:
            raise RecordsError('Duplicate private case, result, or candidate/item bindings are not allowed.')
        cases.add(binding['case_id'])
        pairs.add(pair)
        result_files.add(binding['result_file'])
        items.append(dict(after, complete=complete, binding=binding))
    return items


def _derived(original: dict, key: dict, items: list[dict], evidence_kind: str, independent: bool) -> dict:
    if not isinstance(evidence_kind, str) or evidence_kind not in {'human_review', 'synthetic_test'}:
        raise RecordsError('evidence_kind must explicitly be human_review or synthetic_test.')
    if type(independent) is not bool:
        raise RecordsError('independent must be an explicit boolean declaration.')
    count = sum(item['complete'] for item in items)
    complete = count == len(items) and (evidence_kind != 'human_review' or independent)
    return {'schema_version': original['schema_version'], 'kind': 'imported_model_output_review',
            'packet_id': original['packet_id'], 'reviewer_id': original['reviewer_id'],
            'purpose': key['purpose'], 'input_evidence_type': original['input_evidence_type'],
            'evidence_kind': evidence_kind, 'independent': independent,
            'status': 'complete' if complete else 'incomplete', 'completed_item_count': count,
            'item_count': len(items), 'approval_granted': False, 'dataset_modified': False,
            'items': items, 'private_key': key}


def _validate_revision(record: dict, previous: dict) -> None:
    if previous['status'] == 'complete':
        raise RecordsError('A fully complete import cannot be revised.')
    if any(record_sha256(record[field]) != record_sha256(previous[field]) for field in (
            'schema_version', 'packet_id', 'reviewer_id', 'purpose', 'input_evidence_type', 'evidence_kind',
            'independent', 'private_key')):
        raise RecordsError('A revision must retain the same packet, reviewer, key and evidence declarations.')
    if record['embedded_evidence']['original_packet'] != previous['embedded_evidence']['original_packet']:
        raise RecordsError('A revision must retain the exact original packet bytes.')
    for old, new in zip(previous['items'], record['items']):
        if old['complete'] and record_sha256(old) != record_sha256(new):
            raise RecordsError('An already completed item response cannot change in a partial revision.')


def _outside_run_and_desktop(path: Path) -> None:
    if path.is_relative_to((Path.home() / 'Desktop').resolve()):
        raise RecordsError('Private review artifacts must be outside Desktop.')
    for parent in path.parents:
        if (parent / 'manifest.started.json').exists() or (parent / 'manifest.json').exists():
            raise RecordsError('Private review artifacts must be outside source run directories.')


def _load(path: Path, seen: set[Path], depth: int, budget: list[int] | None = None) -> tuple[dict, str]:
    path = _path(path)
    _outside_run_and_desktop(path)
    if depth >= _MAX_CHAIN or path in seen:
        raise RecordsError('Review revision chain is cyclic or exceeds its 32-record bound.')
    seen.add(path)
    text, checksum = _read_text(path, private=True, limit=_MAX_RECORD_BYTES)
    if budget is None:
        budget = [0]
    budget[0] += len(text.encode('utf-8'))
    if budget[0] > _MAX_CHAIN_BYTES:
        raise RecordsError('Review revision chain exceeds its aggregate byte bound.')
    record = _parse(text)
    _object(record, _RECORD_FIELDS, 'Imported review')
    _text(record['import_id'], 'Import ID', maximum=128)
    _timestamp(record['created_at'])
    evidence = _object(record['embedded_evidence'], {'original_packet', 'returned_packet', 'key'}, 'Embedded evidence')
    provenance = _object(record['provenance'], _PROVENANCE_FIELDS, 'Provenance')
    parsed = {}
    for name, prefix in (('original_packet', 'original_packet'), ('returned_packet', 'returned_packet'), ('key', 'private_key')):
        raw = evidence[name]
        if not isinstance(raw, str) or len(raw.encode('utf-8')) > _MAX_INPUT_BYTES:
            raise RecordsError('Embedded input exceeds its strict UTF-8 size bound.')
        if (not _hash(provenance[prefix + '_file_sha256'])
                or content_sha256(raw) != provenance[prefix + '_file_sha256']):
            raise RecordsError('Embedded evidence bytes differ from the recorded input hash.')
        source_path = provenance[prefix + '_path']
        if not isinstance(source_path, str) or not Path(source_path).is_absolute():
            raise RecordsError('Provenance input paths must be absolute.')
        parsed[name] = _parse(raw)
    items = _validate_pair(parsed['original_packet'], parsed['returned_packet'], parsed['key'],
                           provenance['original_packet_file_sha256'])
    derived = _derived(parsed['original_packet'], parsed['key'], items, record['evidence_kind'], record['independent'])
    if any(record_sha256(record[field]) != record_sha256(value) for field, value in derived.items()):
        raise RecordsError('Imported review summary or responses disagree with embedded evidence.')
    previous_ref = provenance['previous_import']
    if previous_ref is not None:
        _object(previous_ref, {'path', 'file_sha256'}, 'Previous import reference')
        if not isinstance(previous_ref['path'], str) or not Path(previous_ref['path']).is_absolute() or not _hash(previous_ref['file_sha256']):
            raise RecordsError('Previous import requires an absolute path and exact file hash.')
        previous, previous_hash = _load(Path(previous_ref['path']), seen, depth + 1, budget)
        if previous_hash != previous_ref['file_sha256']:
            raise RecordsError('Previous import bytes changed after the revision was written.')
        _validate_revision(record, previous)
    return record, checksum


def load_imported_review(path: str | Path) -> tuple[dict, str]:
    """Revalidate embedded bytes, derived responses, and the bounded revision chain.

    The original submission files need not remain available. Prior imported records
    must remain at their recorded private paths, and their exact hashes must match.
    These are operator-controlled evidence records, not authenticated signatures.
    """
    return _load(_path(path), set(), 0)


def _publish(path: Path, record: dict) -> None:
    payload = _encoded(record)
    if len(payload) > _MAX_RECORD_BYTES:
        raise RecordsError('Imported review exceeds its bounded record size.')
    _private_directory(path.parent)
    _private(path.parent, directory=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.output-review-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        _path(path)
        _outside_run_and_desktop(path)
        os.link(temporary, path, follow_symlinks=False)
    finally:
        Path(temporary).unlink(missing_ok=True)


def import_output_review(original_packet_path: str | Path, returned_packet_path: str | Path,
                         key_path: str | Path, output_path: str | Path, *, evidence_kind: str,
                         independent: bool, previous_path: str | Path | None = None) -> dict:
    """Capture a complete or partial return without editing any original artifact."""
    original_path, returned_path, key_file, output = map(_path, (
        original_packet_path, returned_packet_path, key_path, output_path))
    _outside_run_and_desktop(output)
    _outside_run_and_desktop(key_file)
    if len({original_path, returned_path, key_file, output}) != 4:
        raise RecordsError('Original, returned, private key, and imported output must be different files.')
    if output.exists():
        raise FileExistsError(output)
    inputs = {}
    provenance = {'previous_import': None}
    for name, prefix, path in (('original_packet', 'original_packet', original_path),
                               ('returned_packet', 'returned_packet', returned_path),
                               ('key', 'private_key', key_file)):
        text, checksum = _read_text(path, private=name == 'key')
        inputs[name] = text
        provenance[prefix + '_path'] = str(path)
        provenance[prefix + '_file_sha256'] = checksum
    original, returned, key = (_parse(inputs[name]) for name in ('original_packet', 'returned_packet', 'key'))
    items = _validate_pair(original, returned, key, provenance['original_packet_file_sha256'])
    record = dict(_derived(original, key, items, evidence_kind, independent),
                  import_id=secrets.token_urlsafe(24), created_at=utc_now(),
                  provenance=provenance, embedded_evidence=inputs)
    if previous_path is not None:
        prior_path = _path(previous_path)
        if prior_path in {original_path, returned_path, key_file, output}:
            raise RecordsError('Prior import must be a separate immutable evidence artifact.')
        previous, checksum = load_imported_review(prior_path)
        _validate_revision(record, previous)
        provenance['previous_import'] = {'path': str(prior_path), 'file_sha256': checksum}
        # A new record adds one link; reject rather than create an unloadable chain.
        _load(prior_path, set(), 1, [len(_encoded(record))])
    _publish(output, record)
    return {'schema_version': record['schema_version'], 'status': record['status'], 'import_id': record['import_id'],
            'packet_id': record['packet_id'], 'reviewer_id': record['reviewer_id'],
            'evidence_kind': evidence_kind, 'independent': independent,
            'completed_item_count': record['completed_item_count'], 'item_count': record['item_count'],
            'output_path': str(output), 'approval_granted': False, 'dataset_modified': False}
