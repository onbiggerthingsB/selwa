"""Reconcile cumulative local model exposure from immutable run artifacts.

This inventory establishes recorded exposure, never permission or unseen semantic
independence. Missing, unknown, changed and unfinished evidence fails closed. The
scan is bounded, does not follow symlinks and never loads a tokenizer or model.
Historical records are checked for shape and exact source binding, independently
of today's stricter review-approval policy.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
from typing import Any

from .duplicate_content import content_keys, question_answer_keys
from .records import (RecordsError, atomic_write_json, content_sha256, example_sha256,
                      record_sha256, validate_record)

_MAX_FILES = 10_000
_MAX_DEPTH = 20
_MAX_JSON_BYTES = 32 * 1024 * 1024
_MAX_FILE_BYTES = 128 * 1024 * 1024
_MAX_TOTAL_BYTES = 512 * 1024 * 1024
_HASH = re.compile(r'[a-f0-9]{64}')
_SNAPSHOT = re.compile(r'exposed-dataset\.([0-9]{3,})\.json')
_ATTEMPT = re.compile(r'case\.([0-9]{3,})\.attempt\.json')
_RESERVATION = re.compile(r'exposure\.([0-9]{3,})\.json')
_RELEASE_KINDS = {'released_adapter_training', 'release_evaluation'}
_KEY_FIELDS = {'source_id', 'source_sha256', 'scenario_group', 'paraphrase_group',
               'task_exact_sha256', 'task_normalized_sha256',
               'question_answer_sha256', 'question_answer_normalized_sha256'}
_FINAL = {'completed', 'failed', 'interrupted'}
_ROLES = {'development_screen', 'smoke_training', 'train', 'validation', 'final_test'}
_ENGINEERING = {'foundation-checks', 'paired-comparison-engineering-checks',
                'synthetic_chat_interface_engineering', 'offline_review_form_engineering'}
_MARKERS = {'manifest.json', 'manifest.started.json', 'started.json'}


def _safe_root(value: Path) -> Path:
    root = Path(value).expanduser().absolute()
    if any(part.is_symlink() for part in (root, *root.parents)) or root.resolve() != root:
        raise RecordsError('Exposure inventory requires unambiguous paths without symlinks.')
    if not root.is_dir():
        raise RecordsError('Exposure runs root must be an existing directory.')
    return root


def _scan(root: Path) -> list[Path]:
    files: list[Path] = []
    pending = [(root, 0)]
    visited = 0
    while pending:
        directory, depth = pending.pop()
        if depth > _MAX_DEPTH:
            raise RecordsError('Exposure inventory directory depth exceeds its bound.')
        with os.scandir(directory) as stream:
            for item in stream:
                visited += 1
                if visited > _MAX_FILES:
                    raise RecordsError('Exposure inventory entry count exceeds its bound.')
                if item.is_symlink():
                    raise RecordsError('Exposure inventory refuses symlink entries.')
                if item.is_dir(follow_symlinks=False):
                    pending.append((Path(item.path), depth + 1))
                elif item.is_file(follow_symlinks=False):
                    files.append(Path(item.path))
                else:
                    raise RecordsError('Exposure inventory refuses nonregular filesystem entries.')
    return sorted(files)


def _file_identity(path: Path) -> tuple[int, int, int, int]:
    item = path.stat(follow_symlinks=False)
    return item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RecordsError('Duplicate JSON keys in exposure evidence.')
        result[key] = value
    return result


def _read(path: Path, budget: list[int], *, parse: bool = True) -> tuple[Any, str, int]:
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise RecordsError('Exposure evidence paths cannot contain symlinks.')
    digest = hashlib.sha256()
    chunks = []
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor, 'rb') as stream:
        initial = os.fstat(stream.fileno())
        limit = _MAX_JSON_BYTES if parse else _MAX_FILE_BYTES
        if not stat.S_ISREG(initial.st_mode) or initial.st_size > limit:
            raise RecordsError('Exposure artifact is nonregular or exceeds its size bound.')
        size = 0
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            size += len(block)
            budget[0] += len(block)
            if size > limit or budget[0] > _MAX_TOTAL_BYTES:
                raise RecordsError('Exposure evidence exceeds its bounded read budget.')
            digest.update(block)
            if parse:
                chunks.append(block)
        final = os.fstat(stream.fileno())
        if (initial.st_dev, initial.st_ino, initial.st_size, initial.st_mtime_ns) != (
                final.st_dev, final.st_ino, final.st_size, final.st_mtime_ns):
            raise RecordsError('Exposure artifact changed during reading.')
    if not parse:
        return None, digest.hexdigest(), size
    try:
        def nonfinite(value):
            raise RecordsError('Nonfinite JSON in exposure evidence.')
        value = json.loads(b''.join(chunks).decode('utf-8'), object_pairs_hook=_unique,
                           parse_constant=nonfinite)
        if not isinstance(value, dict):
            raise RecordsError('Exposure evidence must contain a JSON object.')
        record_sha256(value)
    except (UnicodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise RecordsError('Exposure evidence contains invalid finite UTF-8 JSON.') from exc
    return value, digest.hexdigest(), size


def _roles(value: Any) -> set[str]:
    if (not isinstance(value, list)
            or any(not isinstance(role, str) or role not in _ROLES for role in value)
            or len(value) != len(set(value))):
        raise RecordsError('Exposure evidence contains invalid or duplicate roles.')
    return set(value)


def _historical_dataset(dataset: dict) -> None:
    # Deliberately do not call validate_dataset(): stricter present-day approval
    # rules must never erase exposure that occurred under a historical policy.
    if validate_record(dataset, 'dataset'):
        raise RecordsError('Historical exposure snapshot fails its dataset schema.')
    sources = {source['source_id']: source for source in dataset['sources']}
    if len(sources) != len(dataset['sources']):
        raise RecordsError('Historical snapshot has duplicate source identities.')
    ids = set()
    for source in sources.values():
        if content_sha256(source['original_text']) != source['content_sha256']:
            raise RecordsError('Historical snapshot source text hash differs.')
    for example in dataset['examples']:
        if example['example_id'] in ids:
            raise RecordsError('Historical snapshot has duplicate example identities.')
        ids.add(example['example_id'])
        source = sources.get(example['source_id'])
        if source is None or (example['source_version'], example['source_sha256']) != (
                source['version'], source['content_sha256']):
            raise RecordsError('Historical example has an inconsistent source binding.')
        _roles(example['exposures'])


def _artifact_name(value: Any, *, nested: bool) -> str:
    if not isinstance(value, str) or not value or '\\' in value:
        raise RecordsError('Malformed exposure artifact path.')
    path = PurePosixPath(value)
    if (path.is_absolute() or str(path) != value or any(part in {'.', '..'} for part in path.parts)
            or (not nested and len(path.parts) != 1) or value == 'manifest.json'):
        raise RecordsError('Exposure artifacts require unique relative paths within their run.')
    return value


def _relevant(path: Path) -> bool:
    return (path.name in _MARKERS | {'exposure.json', 'synthetic-inputs.json'}
            or path.name.startswith('exposed-dataset.') or path.name.startswith('exposure.')
            or bool(re.fullmatch(r'case\..*\.(attempt|result)\.json', path.name)))


def _load_artifacts(run: Path, manifest: dict, owned: set[Path], budget: list[int],
                    inventory: dict[str, dict], root: Path, *, mechanics: bool,
                    metadata_only: bool = False) -> dict[str, dict]:
    field = 'artifact_inventory' if mechanics else 'artifacts'
    entries = manifest.get(field)
    if not isinstance(entries, list) or len(entries) > _MAX_FILES:
        raise RecordsError('Finalized run lacks a bounded artifact inventory.')
    artifacts = {}
    expected = set()
    for entry in entries:
        required = {'path', 'sha256', 'bytes'} if mechanics else {'name', 'sha256'}
        if not isinstance(entry, dict) or set(entry) != required:
            raise RecordsError('Malformed finalized artifact inventory entry.')
        name = _artifact_name(entry['path' if mechanics else 'name'], nested=mechanics)
        if name in artifacts or not isinstance(entry['sha256'], str) or not _HASH.fullmatch(entry['sha256']):
            raise RecordsError('Duplicate artifact paths or invalid artifact hashes.')
        path = run / name
        if path not in owned:
            raise RecordsError('Declared exposure artifact is missing or belongs to another run.')
        # New release runs publish fingerprint-only reservations specifically so
        # training-side historical checks never deserialize held-out prompts,
        # reference answers, model replies or scoring reports. All bytes still
        # receive the same integrity hash/size checks. Legacy baselines predate
        # that boundary and require their full snapshots for exposure recovery.
        parse = path.suffix == '.json' and (not metadata_only or name == 'started.json'
                                           or _RESERVATION.fullmatch(name) is not None)
        value, checksum, size = _read(path, budget, parse=parse)
        if checksum != entry['sha256'] or (mechanics and
                (type(entry['bytes']) is not int or entry['bytes'] != size)):
            raise RecordsError('Finalized exposure artifact hash or byte size differs.')
        artifacts[name] = {'value': value, 'sha256': checksum}
        expected.add(path)
        inventory[str(path.relative_to(root))] = {'path': str(path.relative_to(root)), 'sha256': checksum}
    actual = owned - {run / 'manifest.json'}
    if not mechanics:
        actual = {path for path in actual if path.suffix == '.json' or _relevant(path)}
    if actual != expected:
        raise RecordsError('Run artifacts differ from the finalized inventory; evidence may be omitted.')
    return artifacts


def _baseline(manifest: dict, artifacts: dict[str, dict], evidence: dict) -> list[dict]:
    if manifest.get('schema_version') not in {'1.0', '1.1'} or not manifest.get('finished_at'):
        raise RecordsError('Unsupported or unfinished baseline manifest.')
    started = artifacts.get('manifest.started.json', {}).get('value')
    immutable = ('schema_version', 'run_id', 'kind', 'config', 'purpose', 'evidence_type',
                 'planned_cases', 'selected_example_ids', 'loaded_records_sha256', 'parallel_material')
    if (not isinstance(started, dict) or started.get('outcome') != 'running'
            or any(started.get(key) != manifest.get(key) for key in immutable)):
        raise RecordsError('Started and finalized baseline identities differ.')
    count = manifest.get('attempted_case_count')
    if type(count) is not int or count < 0 or count > _MAX_FILES:
        raise RecordsError('Invalid baseline attempted-case count.')
    snapshots = sorted((name for name in artifacts if _SNAPSHOT.fullmatch(name)),
                       key=lambda name: int(_SNAPSHOT.fullmatch(name).group(1)))
    expected = [f'exposed-dataset.{index:03d}.json' for index in range(1, count + 1)]
    if snapshots != expected or manifest.get('latest_exposure_snapshot') != (expected[-1] if expected else None):
        raise RecordsError('Baseline exposure snapshots are missing or inconsistent with attempts.')
    entries, snapshot_examples = [], {}
    identity, prior = None, {}
    for name in snapshots:
        dataset = artifacts[name]['value']
        _historical_dataset(dataset)
        unchanged = deepcopy(dataset)
        for example in unchanged['examples']:
            example.pop('exposures')
        current_identity = record_sha256(unchanged)
        if identity is not None and current_identity != identity:
            raise RecordsError('Baseline snapshot task contents changed during the run.')
        identity = current_identity
        snapshot_examples[name] = {example['example_id']: example for example in dataset['examples']}
        for example in dataset['examples']:
            roles = _roles(example['exposures'])
            if not prior.get(example['example_id'], set()) <= roles:
                raise RecordsError('Baseline snapshots erased a previously recorded exposure.')
            prior[example['example_id']] = roles
            entries.append({'keys': sorted(map(list, content_keys(example))), 'exposures': sorted(roles),
                'evidence': [{**evidence, 'artifact': name, 'artifact_sha256': artifacts[name]['sha256'],
                              'example_id': example['example_id']}]})
    attempts = [entry['value'] for name, entry in artifacts.items() if _ATTEMPT.fullmatch(name)]
    if len(attempts) != count:
        raise RecordsError('Baseline attempted-case records do not match its exposure count.')
    for attempt in attempts:
        snapshot = snapshot_examples.get(attempt.get('exposure_snapshot'), {})
        example = snapshot.get(attempt.get('example_id'))
        if (attempt.get('attempted') is not True or example is None
                or 'development_screen' not in example['exposures']
                or attempt.get('source_id') != example['source_id']
                or attempt.get('source_sha256') != example['source_sha256']
                or attempt.get('example_sha256') != example_sha256(example)):
            raise RecordsError('Baseline dispatch does not bind its historical exposure snapshot.')
    cases = manifest.get('cases')
    if (not isinstance(cases, list) or any(not isinstance(case, dict) for case in cases)
            or sum(case.get('attempted') is True for case in cases) != count):
        raise RecordsError('Baseline finalized case count differs from recorded attempts.')
    return entries


def _mechanics(manifest: dict, artifacts: dict[str, dict], evidence: dict) -> list[dict]:
    if manifest.get('schema_version') != '1.0' or not manifest.get('finished_at'):
        raise RecordsError('Unsupported or unfinished mechanics manifest.')
    started = artifacts.get('started.json', {}).get('value')
    immutable = ('schema_version', 'run_id', 'kind', 'config', 'inputs', 'runtime_source_files')
    if (not isinstance(started, dict) or started.get('outcome') != 'started'
            or any(started.get(key) != manifest.get(key) for key in immutable)):
        raise RecordsError('Started and finalized mechanics identities differ.')
    inputs = artifacts.get('synthetic-inputs.json', {})
    dataset = inputs.get('value')
    exposure = artifacts.get('exposure.json', {}).get('value')
    if (not isinstance(dataset, dict) or dataset.get('schema_version') != '1.0'
            or dataset.get('kind') != 'synthetic_mechanics_only'
            or dataset.get('exposures') != ['smoke_training']
            or dataset.get('eligible_for_unseen_test') is not False
            or not isinstance(dataset.get('records'), list) or not dataset['records']):
        raise RecordsError('Mechanics synthetic inputs lack explicit smoke-only exposure.')
    records = dataset['records']
    if (not isinstance(exposure, dict) or exposure.get('kind') != 'synthetic_mechanics_exposure'
            or exposure.get('input_sha256') != inputs['sha256']
            or exposure.get('record_hashes') != [record_sha256(record) for record in records]
            or exposure.get('exposures') != ['smoke_training']
            or exposure.get('eligible_for_unseen_test') is not False
            or exposure.get('dispatch_state') != 'reserved_before_training'):
        raise RecordsError('Mechanics exposure does not bind its exact reserved training inputs.')
    manifest_inputs = manifest.get('inputs')
    if not isinstance(manifest_inputs, list) or any(not isinstance(item, dict) for item in manifest_inputs):
        raise RecordsError('Mechanics manifest input identities are malformed.')
    bound_inputs = [item for item in manifest_inputs if item.get('name') == 'synthetic-inputs.json']
    if len(bound_inputs) != 1 or bound_inputs[0].get('sha256') != inputs['sha256']:
        raise RecordsError('Mechanics manifest does not bind the exact synthetic input hash.')
    entries = []
    for record in records:
        if not isinstance(record, dict) or not isinstance(record.get('messages'), list):
            raise RecordsError('Malformed mechanics message record.')
        messages = record['messages']
        # Historical mechanics permits alternating conversations. Every paired
        # user/assistant exchange is marked, even if a future record has context.
        pairs = []
        for index, message in enumerate(messages):
            if (not isinstance(message, dict) or set(message) != {'role', 'content'}
                    or not isinstance(message['content'], str) or not message['content'].strip()):
                raise RecordsError('Malformed mechanics message contents.')
            if message['role'] == 'assistant':
                if index == 0 or messages[index - 1].get('role') != 'user':
                    raise RecordsError('Mechanics assistant message lacks its user prompt.')
                pairs.append((messages[index - 1]['content'], message['content']))
            elif message['role'] not in {'system', 'user'}:
                raise RecordsError('Unknown mechanics message role.')
        if not pairs:
            raise RecordsError('Mechanics record has no auditable question-answer exchange.')
        for question, answer in pairs:
            entries.append({'keys': sorted(map(list, question_answer_keys(question, answer))),
                'exposures': ['smoke_training'], 'evidence': [{**evidence,
                    'artifact': 'synthetic-inputs.json', 'artifact_sha256': inputs['sha256'],
                    'example_id': record.get('example_id'), 'reservation': 'before_dispatch'}]})
    return entries


def reserve_exposure(run_dir: Path, dataset: dict, role: str,
                     example_ids: list[str], sequence: int) -> Path:
    """Publish a fingerprint-only reservation before any selected model dispatch.

    Call under the outer experiment lock after permission/release validation.
    This does not grant approval, permission or release authority. In particular,
    protected final-test questions and answers are never copied into this journal.
    Reserve all selected roles first, then bind each path/hash in both started and
    final ``exposure_reservations`` inventories before invoking any worker.
    """
    run = _safe_root(run_dir)
    _historical_dataset(dataset)
    if not isinstance(role, str) or role not in _ROLES:
        raise RecordsError('Exposure reservation requires an explicit supported role.')
    if type(sequence) is not int or not 1 <= sequence <= _MAX_FILES:
        raise RecordsError('Exposure reservation sequence exceeds its supported bound.')
    if (not isinstance(example_ids, list) or not example_ids or len(example_ids) > _MAX_FILES
            or any(not isinstance(value, str) or not value for value in example_ids)
            or len(set(example_ids)) != len(example_ids)):
        raise RecordsError('Exposure reservation requires unique selected example IDs.')
    examples = {example['example_id']: example for example in dataset['examples']}
    if any(value not in examples for value in example_ids):
        raise RecordsError('Exposure reservation selection is absent from its dataset.')
    entries = []
    for example_id in example_ids:
        example = examples[example_id]
        keys = sorted(map(list, content_keys(example)))
        entries.append({'example_id': example_id, 'example_sha256': example_sha256(example),
                        'keys': keys, 'keys_sha256': record_sha256(keys)})
    journal = {'schema_version': '1.0', 'kind': 'research_exposure_reservation',
        'sequence': sequence, 'role': role, 'dataset_sha256': record_sha256(dataset),
        'selected_example_ids': list(example_ids), 'entries': entries,
        'entries_sha256': record_sha256(entries), 'dispatch_state': 'reserved_before_dispatch'}
    path = run / f'exposure.{sequence:03d}.json'
    atomic_write_json(path, journal)
    return path


def _reservation(name: str, journal: dict, evidence: dict, checksum: str) -> list[dict]:
    required = {'schema_version', 'kind', 'sequence', 'role', 'dataset_sha256',
                'selected_example_ids', 'entries', 'entries_sha256', 'dispatch_state'}
    match = _RESERVATION.fullmatch(name)
    if (not isinstance(journal, dict) or set(journal) != required or match is None
            or journal['schema_version'] != '1.0' or journal['kind'] != 'research_exposure_reservation'
            or type(journal['sequence']) is not int or not 1 <= journal['sequence'] <= _MAX_FILES
            or journal['sequence'] != int(match.group(1))
            or journal['dispatch_state'] != 'reserved_before_dispatch'
            or not isinstance(journal['role'], str) or journal['role'] not in _ROLES
            or not isinstance(journal['dataset_sha256'], str) or not _HASH.fullmatch(journal['dataset_sha256'])):
        raise RecordsError('Malformed or unsupported exposure reservation envelope.')
    entries, ids = journal['entries'], journal['selected_example_ids']
    if (not isinstance(entries, list) or not entries or len(entries) > _MAX_FILES
            or not isinstance(ids, list) or len(ids) != len(entries)
            or any(not isinstance(value, str) or not value for value in ids)
            or len(set(ids)) != len(ids) or journal['entries_sha256'] != record_sha256(entries)):
        raise RecordsError('Exposure reservation entries do not match their bound selection/hash.')
    result = []
    for example_id, entry in zip(ids, entries):
        if (not isinstance(entry, dict) or set(entry) != {'example_id', 'example_sha256', 'keys', 'keys_sha256'}
                or entry['example_id'] != example_id or not isinstance(entry['example_sha256'], str)
                or not _HASH.fullmatch(entry['example_sha256']) or not isinstance(entry['keys'], list)):
            raise RecordsError('Malformed selected exposure identity.')
        keys = entry['keys']
        if (not 6 <= len(keys) <= 8 or any(not isinstance(key, list) or len(key) != 2
                or not isinstance(key[0], str) or key[0] not in _KEY_FIELDS
                or not isinstance(key[1], str) or not key[1] for key in keys)):
            raise RecordsError('Malformed exposure fingerprints.')
        fields = {key[0] for key in keys}
        required_fields = _KEY_FIELDS - {'question_answer_sha256', 'question_answer_normalized_sha256'}
        if (len(fields) != len(keys) or not required_fields <= fields
                or len(fields & {'question_answer_sha256', 'question_answer_normalized_sha256'}) == 1
                or keys != sorted(keys) or entry['keys_sha256'] != record_sha256(keys)
                or any(field.endswith('sha256') and not _HASH.fullmatch(value) for field, value in keys)):
            raise RecordsError('Exposure fingerprints are incomplete, duplicated or changed.')
        result.append({'keys': keys, 'exposures': [journal['role']], 'evidence': [{**evidence,
            'artifact': name, 'artifact_sha256': checksum, 'example_id': example_id,
            'example_sha256': entry['example_sha256'], 'dataset_sha256': journal['dataset_sha256'],
            'reservation': 'before_dispatch', 'fingerprint_only': True}]})
    return result


def _released(manifest: dict, artifacts: dict[str, dict], evidence: dict) -> list[dict]:
    started = artifacts.get('started.json', {}).get('value')
    immutable = ('schema_version', 'kind', 'run_id', 'config', 'inputs',
                 'release_sha256', 'exposure_reservations')
    if (manifest.get('schema_version') != '1.0' or not manifest.get('finished_at')
            or not isinstance(manifest.get('release_sha256'), str)
            or not _HASH.fullmatch(manifest['release_sha256'])
            or not isinstance(started, dict) or started.get('outcome') != 'started'
            or any(started.get(key) != manifest.get(key) for key in immutable)):
        raise RecordsError('Released run lacks a matching started manifest and immutable release identity.')
    bindings = manifest.get('exposure_reservations')
    if not isinstance(bindings, list) or not bindings or len(bindings) > _MAX_FILES:
        raise RecordsError('Released run lacks a bounded pre-dispatch reservation inventory.')
    entries, names, roles = [], set(), set()
    for binding in bindings:
        if (not isinstance(binding, dict) or set(binding) != {'path', 'sha256'}
                or not isinstance(binding['path'], str) or not _RESERVATION.fullmatch(binding['path'])
                or binding['path'] in names or binding['path'] not in artifacts
                or artifacts[binding['path']]['sha256'] != binding['sha256']):
            raise RecordsError('Released reservation does not match its started/final artifact binding.')
        name = binding['path']
        names.add(name)
        artifact = artifacts[name]
        entries.extend(_reservation(name, artifact['value'], evidence, artifact['sha256']))
        roles.add(artifact['value']['role'])
    if names != {name for name in artifacts if _RESERVATION.fullmatch(name)}:
        raise RecordsError('Released run omitted a reservation from its pre-dispatch inventory.')
    if {int(_RESERVATION.fullmatch(name).group(1)) for name in names} != set(range(1, len(names) + 1)):
        raise RecordsError('Released run reservation sequence contains gaps.')
    expected_roles = {'train', 'validation'} if manifest['kind'] == 'released_adapter_training' else {
        'validation', 'final_test', 'development_screen'}
    if not roles <= expected_roles or (manifest['kind'] == 'released_adapter_training' and roles != expected_roles):
        raise RecordsError('Released run reservation roles disagree with its declared operation.')
    return entries


def build_exposure_inventory(runs_root: Path) -> dict:
    """Read all supported finalized runs under one explicitly scoped local root.

    ``valid`` is false for unknown/unfinished/corrupt evidence. Even failed zero-
    update mechanics attempts reserve smoke exposure. Known non-model engineering
    manifests are classified explicitly; their basename-only external input hashes
    are metadata, not verified local exposure artifacts.
    """
    try:
        root = _safe_root(runs_root)
        files = _scan(root)
        initial_stats = {path: _file_identity(path) for path in files}
    except OSError as exc:
        raise RecordsError('Exposure inventory filesystem cannot be read completely.') from exc
    manifests = sorted(path for path in files if path.name == 'manifest.json')
    roots = {path.parent for path in manifests}
    budget = [0]
    inventory: dict[str, dict] = {}
    entries, errors, classified = [], [], []
    owners = {}
    for path in files:
        parents = [parent for parent in path.parents if parent in roots]
        owners[path] = parents[0] if parents else None
        if _relevant(path) and owners[path] is None:
            errors.append({'path': str(path.relative_to(root)), 'code': 'unfinished_or_orphan_evidence',
                           'message': 'Exposure evidence has no finalized containing run.'})
    for path in manifests:
        relative = str(path.relative_to(root))
        try:
            manifest, checksum, _ = _read(path, budget)
            inventory[relative] = {'path': relative, 'sha256': checksum}
            kind = manifest.get('kind')
            if manifest.get('outcome') not in _FINAL or not isinstance(manifest.get('run_id'), str):
                raise RecordsError('Run manifest is not finalized or has no run identity.')
            owned = {item for item in files if owners[item] == path.parent}
            evidence = {'manifest': relative, 'manifest_sha256': checksum,
                        'run_id': manifest['run_id'], 'kind': kind, 'outcome': manifest['outcome']}
            if kind in _ENGINEERING:
                if manifest.get('schema_version') != '1.0':
                    raise RecordsError('Unknown engineering manifest schema version.')
                if any(_relevant(item) and item != path for item in owned):
                    raise RecordsError('Non-model engineering run contains unclassified exposure evidence.')
                classified.append({**evidence, 'classification': 'known_non_model_engineering',
                    'external_inputs': 'basename-only metadata; not resolved or reverified'})
                continue
            if kind not in {'local_source_question_baseline', 'synthetic_adapter_mechanics'} | _RELEASE_KINDS:
                raise RecordsError('Unknown run kind cannot be ignored by the exposure inventory.')
            artifacts = _load_artifacts(path.parent, manifest, owned, budget, inventory, root,
                                       mechanics=kind != 'local_source_question_baseline',
                                       metadata_only=kind in _RELEASE_KINDS)
            parser = _released if kind in _RELEASE_KINDS else (
                _mechanics if kind == 'synthetic_adapter_mechanics' else _baseline)
            records = parser(manifest, artifacts, evidence)
            entries.extend(records)
            classified.append({**evidence, 'classification': 'verified_exposure_evidence',
                               'exposure_records': len(records)})
        except (RecordsError, OSError, KeyError, TypeError, ValueError) as exc:
            errors.append({'path': relative, 'code': 'invalid_run_evidence', 'message': str(exc)})
    try:
        final_files = _scan(root)
        if final_files != files or any(_file_identity(path) != initial_stats[path] for path in final_files):
            errors.append({'path': '.', 'code': 'inventory_changed_during_scan',
                           'message': 'Run files changed while the exposure inventory was being read.'})
    except (RecordsError, OSError) as exc:
        errors.append({'path': '.', 'code': 'inventory_changed_during_scan', 'message': str(exc)})
    # Merge repeated snapshots and repeated mechanical runs without dropping their
    # distinct immutable evidence or transitive source/group connections.
    merged = {}
    for entry in entries:
        key = tuple(map(tuple, entry['keys']))
        target = merged.setdefault(key, {'keys': entry['keys'], 'exposures': set(), 'evidence': {}})
        target['exposures'].update(entry['exposures'])
        for item in entry['evidence']:
            target['evidence'][record_sha256(item)] = item
    result = [{'keys': value['keys'], 'exposures': sorted(value['exposures']),
               'evidence': sorted(value['evidence'].values(), key=record_sha256)}
              for _, value in sorted(merged.items())]
    return {'schema_version': '1.0', 'kind': 'cumulative_exposure_inventory', 'valid': not errors,
            'errors': errors, 'runs_root': str(root), 'entries': result,
            'inventory': [inventory[key] for key in sorted(inventory)],
            'coverage': {'scope': 'recorded local runs under the supplied runs_root only',
                'classified_runs': classified, 'scanned_files': len(files), 'manifest_count': len(manifests),
                'verified_bytes_read': budget[0], 'external_or_deleted_runs': 'not_observable',
                'permission_granted': False, 'semantic_independence_established': False}}


def reconcile_exposures(dataset: dict, inventory: dict) -> tuple[dict, dict]:
    """Return ``(copied_dataset, provenance_report)``; never change supplied records.

    Historical and current content/group links form one transitive graph. This
    catches an exposed historical bridge even when its connecting sibling is no
    longer present in the submitted dataset. Invalid inventories cannot be used.
    """
    if (not isinstance(inventory, dict) or inventory.get('kind') != 'cumulative_exposure_inventory'
            or inventory.get('valid') is not True or inventory.get('errors') != []
            or not isinstance(inventory.get('entries'), list)):
        raise RecordsError('A valid complete cumulative exposure inventory is required.')
    _historical_dataset(dataset)
    result = deepcopy(dataset)
    historical = inventory['entries']
    nodes = []
    for entry in historical:
        if (not isinstance(entry, dict) or not isinstance(entry.get('keys'), list)
                or not entry['keys'] or not isinstance(entry.get('evidence'), list)
                or any(not isinstance(key, (list, tuple)) or len(key) != 2
                       or any(not isinstance(part, str) or not part for part in key) for key in entry['keys'])):
            raise RecordsError('Malformed cumulative exposure entry.')
        nodes.append((set(map(tuple, entry['keys'])), _roles(entry.get('exposures')), entry['evidence']))
    start = len(nodes)
    nodes.extend((content_keys(example), _roles(example['exposures']), []) for example in result['examples'])
    parents = list(range(len(nodes)))
    def find(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index
    owners = {}
    for index, (keys, _, _) in enumerate(nodes):
        for key in keys:
            if key in owners:
                parents[find(index)] = find(owners[key])
            else:
                owners[key] = index
    components = {}
    for index, (keys, roles, evidence) in enumerate(nodes):
        component = components.setdefault(find(index), {'roles': set(), 'evidence': {}, 'keys': set()})
        component['roles'].update(roles)
        if index < start:
            component['keys'].update(keys)
        for item in evidence:
            component['evidence'][record_sha256(item)] = item
    matches = []
    for index, example in enumerate(result['examples'], start):
        component = components[find(index)]
        added = component['roles'] - set(example['exposures'])
        example['exposures'] = sorted(component['roles'])
        if component['evidence'] or added:
            matches.append({'example_id': example['example_id'], 'added_exposures': sorted(added),
                'effective_exposures': example['exposures'],
                'matched_keys': sorted(map(list, content_keys(example) & component['keys'])),
                'historical_evidence': sorted(component['evidence'].values(), key=record_sha256)})
    report = {'valid': True, 'inventory_sha256': record_sha256(inventory),
              'runs_root': inventory.get('runs_root'), 'matches': matches,
              'matched_example_ids': [item['example_id'] for item in matches],
              'added_exposure_count': sum(len(item['added_exposures']) for item in matches),
              'permission_granted': False, 'unseen_test_claim': False}
    return result, report
