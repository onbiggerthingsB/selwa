"""Create private, blind review packets from finalized baseline output artifacts.

This is export-only. It never imports ratings, adjudicates outputs, grants source
permissions, changes a dataset, or treats generation as language-quality evidence.
"""
from __future__ import annotations

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
from .baseline import (check_eligibility, conversation_for_job, jobs_for, validate_config)
from .inference import InferenceResult
from .records import RecordsError, content_sha256, example_sha256, record_sha256

_MAX_JSON_BYTES = 32 * 1024 * 1024
_HASH = re.compile(r'[0-9a-f]{64}')
_REVISION = re.compile(r'[0-9a-f]{40}')
_FINAL_OUTCOMES = {'completed', 'failed', 'interrupted'}
PAIR_FIELDS = {'pair_id', 'condition_id', 'input_language', 'output_language', 'parallel_pair_sha256'}


def _path(value: str | Path) -> Path:
    path = Path(value).expanduser().absolute()
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise RecordsError('Symlink paths are not allowed for blind review inputs or outputs.')
    if path.resolve() != path:
        raise RecordsError('Review paths must have an unambiguous resolved location.')
    return path


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RecordsError('Duplicate JSON object keys are not allowed.')
        result[key] = value
    return result


def _read(path: Path) -> tuple[dict, str]:
    _path(path)
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor, 'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise RecordsError('Review inputs must be regular files.')
        data = stream.read(_MAX_JSON_BYTES + 1)
    if len(data) > _MAX_JSON_BYTES:
        raise RecordsError('Review input exceeds its bounded JSON file size.')
    try:
        def nonfinite(value):
            raise RecordsError('Non-finite JSON values are not allowed.')
        value = json.loads(data.decode('utf-8'), object_pairs_hook=_unique, parse_constant=nonfinite)
        if not isinstance(value, dict):
            raise RecordsError('Review input must be a JSON object.')
        record_sha256(value)
    except (UnicodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise RecordsError('Review input contains invalid finite UTF-8 JSON.') from exc
    return value, hashlib.sha256(data).hexdigest()


def _hash(value: Any) -> bool:
    return isinstance(value, str) and _HASH.fullmatch(value) is not None


def _manifest(run: Path, dataset: dict) -> tuple[dict, str, dict[str, tuple[dict, str]]]:
    manifest, manifest_hash = _read(run / 'manifest.json')
    if (manifest.get('schema_version') not in ('1.0', '1.1')
            or manifest.get('kind') != 'local_source_question_baseline'
            or manifest.get('outcome') not in _FINAL_OUTCOMES
            or not isinstance(manifest.get('finished_at'), str) or not manifest['finished_at']):
        raise RecordsError('Blind export requires a finalized local baseline manifest.')
    config = manifest.get('config')
    validate_config(config)
    paired = config['schema_version'] == '1.1'
    if manifest['schema_version'] != config['schema_version']:
        raise RecordsError('Manifest and configuration versions disagree.')
    if not paired and 'parallel_material' in manifest:
        raise RecordsError('Legacy manifests cannot contain paired-material records.')
    parallel = manifest.get('parallel_material')
    check_eligibility(dataset, config, parallel)
    loaded = manifest.get('loaded_records_sha256')
    hash_fields = {'dataset', 'config', 'lock'} | ({'parallel_material'} if paired else set())
    if (not isinstance(loaded, dict) or set(loaded) != hash_fields or not all(_hash(loaded.get(key)) for key in hash_fields)
            or loaded['dataset'] != record_sha256(dataset) or loaded['config'] != record_sha256(config)):
        raise RecordsError('Dataset or configuration does not match the finalized run identity.')
    if paired and loaded['parallel_material'] != record_sha256(parallel):
        raise RecordsError('Parallel-material identity differs from its recorded hash.')
    if (manifest.get('run_id') != config['run_id'] or manifest.get('purpose') != config['purpose']
            or manifest.get('selected_example_ids') != config['example_ids']):
        raise RecordsError('Manifest selection and run identity disagree with its configuration.')
    expected_evidence = 'infrastructure_smoke' if config['purpose'] == 'infrastructure_smoke' else 'unscored_language_generation'
    if manifest.get('evidence_type') != expected_evidence:
        raise RecordsError('Manifest evidence type disagrees with its configured purpose.')
    planned = len(config['candidate_ids']) * len(jobs_for(dataset, config, parallel))
    if type(manifest.get('planned_cases')) is not int or manifest['planned_cases'] != planned:
        raise RecordsError('Manifest planned-case count is inconsistent.')
    cases = manifest.get('cases')
    if not isinstance(cases, list) or len(cases) > planned:
        raise RecordsError('Manifest case list is malformed.')
    if type(manifest.get('all_cases_recorded')) is not bool or manifest['all_cases_recorded'] != (len(cases) == planned):
        raise RecordsError('Manifest completion count is inconsistent.')
    if manifest['outcome'] == 'completed' and (len(cases) != planned or any(case.get('outcome') != 'success' for case in cases if isinstance(case, dict))):
        raise RecordsError('Completed manifests must contain every successful planned case.')
    entries = manifest.get('artifacts')
    if not isinstance(entries, list) or len(entries) > 4 * planned + 2:
        raise RecordsError('Manifest artifact inventory is missing or oversized.')
    inventory = {}
    for entry in entries:
        if (not isinstance(entry, dict) or set(entry) != {'name', 'sha256'}
                or not isinstance(entry['name'], str)
                or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*\.json', entry['name'])
                or entry['name'] == 'manifest.json' or entry['name'] in inventory or not _hash(entry['sha256'])):
            raise RecordsError('Manifest artifact identities must be unique local JSON filenames and hashes.')
        value, checksum = _read(run / entry['name'])
        if checksum != entry['sha256']:
            raise RecordsError('A finalized run artifact no longer matches its recorded hash.')
        inventory[entry['name']] = (value, checksum)
    if {item.name for item in run.glob('*.json')} != set(inventory) | {'manifest.json'}:
        raise RecordsError('Run JSON artifacts differ from the finalized inventory.')
    started = inventory.get('manifest.started.json', (None, None))[0]
    immutable_keys = ('schema_version', 'run_id', 'kind', 'purpose', 'evidence_type', 'config',
                      'planned_cases', 'selected_example_ids', 'loaded_records_sha256')
    if paired:
        immutable_keys += ('parallel_material',)
    if (not isinstance(started, dict) or started.get('outcome') != 'running'
            or any(started.get(key) != manifest.get(key) for key in immutable_keys)):
        raise RecordsError('Started and final manifests do not bind the same run.')
    return manifest, manifest_hash, inventory


def _model_identities(manifest: dict) -> dict[str, str]:
    snapshots = manifest.get('snapshots')
    if not isinstance(snapshots, list):
        raise RecordsError('Manifest snapshot verification evidence is missing.')
    result = {}
    for snapshot in snapshots:
        if not isinstance(snapshot, dict):
            raise RecordsError('Malformed snapshot verification evidence.')
        cid = snapshot.get('candidate_id')
        verification = snapshot.get('verification')
        if not isinstance(cid, str) or cid not in manifest['config']['candidate_ids'] or cid in result:
            raise RecordsError('Snapshot candidate identity is inconsistent.')
        if not isinstance(verification, dict) or verification.get('valid') is not True:
            continue
        identity = verification.get('identity')
        if (not isinstance(identity, dict) or identity.get('candidate_id') != cid
                or identity.get('mode') != 'model' or not _hash(identity.get('inventory_sha256'))
                or not isinstance(identity.get('repository'), str) or not identity['repository'].strip()
                or not isinstance(identity.get('revision'), str) or not _REVISION.fullmatch(identity['revision'])):
            raise RecordsError('Verified snapshot lacks an exact model payload identity.')
        result[cid] = identity['repository'] + '@' + identity['revision']
    return result


def _validated_cases(manifest: dict, inventory: dict, dataset: dict) -> list[dict]:
    examples = {item['example_id']: item for item in dataset['examples']}
    sources = {item['source_id']: item for item in dataset['sources']}
    model_ids = _model_identities(manifest)
    config = manifest['config']
    paired = config['schema_version'] == '1.1'
    jobs = jobs_for(dataset, config, manifest.get('parallel_material'))
    planned_jobs = [(candidate, job) for candidate in config['candidate_ids'] for job in jobs]
    cases = []
    seen = set()
    for sequence, entry in enumerate(manifest['cases'], 1):
        entry_fields = {'case_id', 'candidate_id', 'example_id', 'attempted', 'outcome', 'result_file'} | (PAIR_FIELDS | {'schema_version'} if paired else set())
        if not isinstance(entry, dict) or set(entry) != entry_fields:
            raise RecordsError('Malformed case entry in final manifest.')
        if paired and entry['schema_version'] != '1.1':
            raise RecordsError('Paired case index requires version 1.1.')
        file = f'case.{sequence:03d}.result.json'
        if entry['result_file'] != file or file not in inventory:
            raise RecordsError('A final case is missing its exact hashed result artifact.')
        case, checksum = inventory[file]
        candidate, job = planned_jobs[sequence - 1]
        if (entry['candidate_id'] != candidate or entry['example_id'] != job['example_id']
                or (paired and any(entry[field] != job[field] for field in PAIR_FIELDS))):
            raise RecordsError('Case condition or dispatch order differs from the planned comparison.')
        pair = ((entry['candidate_id'], entry['pair_id'], entry['condition_id']) if paired
                else (entry['candidate_id'], entry['example_id']))
        if (any(not isinstance(item, str) for item in pair) or pair in seen
                or pair[0] not in config['candidate_ids'] or entry['example_id'] not in config['example_ids']):
            raise RecordsError('A final case has an unknown or duplicate candidate/example/condition binding.')
        seen.add(pair)
        if (case.get('schema_version') != config['schema_version'] or type(case.get('sequence')) is not int or case['sequence'] != sequence
                or case.get('case_id') != f"{config['run_id']}-{sequence:03d}"
                or any(case.get(key) != entry[key] for key in ('case_id', 'candidate_id', 'example_id', 'attempted'))
                or type(case.get('attempted')) is not bool or type(entry['attempted']) is not bool
                or case.get('purpose') != config['purpose']):
            raise RecordsError('Case identity or attempt status differs from the finalized index.')
        if paired and any(case.get(field) != job[field] for field in PAIR_FIELDS):
            raise RecordsError('Case paired-language identity differs from its planned condition.')
        if not paired and PAIR_FIELDS.intersection(case):
            raise RecordsError('Legacy cases cannot contain paired-condition identities.')
        example = examples[entry['example_id']]
        source = sources[example['source_id']]
        if (type(case.get('example_version')) is not int or case['example_version'] != example['version']
                or case.get('example_sha256') != example_sha256(example)
                or case.get('source_id') != source['source_id'] or case.get('source_sha256') != source['content_sha256']
                or case.get('messages') != conversation_for_job(source, example, job)):
            raise RecordsError('Case source, question or example hash binding is inconsistent.')
        if case.get('settings') != {key: config[key] for key in ('max_output_tokens', 'context_limit_tokens', 'timeout_seconds', 'seed', 'temperature', 'reasoning_mode')}:
            raise RecordsError('Case settings differ from the finalized configuration.')
        response = case.get('response')
        if not isinstance(response, dict) or not isinstance(response.get('result'), dict):
            raise RecordsError('Case does not contain a valid inference result.')
        try:
            result = InferenceResult(**response['result'])
        except (TypeError, ValueError) as exc:
            raise RecordsError('Case inference result is malformed.') from exc
        if (result.run_id != case['case_id'] or result.model_identity != case.get('model_identity')
                or result.outcome != entry['outcome'] or result.adapter_identity is not None):
            raise RecordsError('Case response identity or outcome differs from its bound case.')
        if result.outcome == 'success':
            if (not case['attempted'] or model_ids.get(pair[0]) != result.model_identity
                    or result.termination_reason != 'stop' or response.get('raw_output') != result.answer):
                raise RecordsError('Successful output lacks a complete stopped raw answer and verified model binding.')
            attempt_file = f'case.{sequence:03d}.attempt.json'
            attempt = inventory.get(attempt_file, (None, None))[0]
            if (not isinstance(attempt, dict) or attempt.get('attempted') is not True
                    or not isinstance(attempt.get('prompt'), dict)
                    or any(record_sha256(case.get(field)) != record_sha256(value) for field, value in attempt.items())):
                raise RecordsError('Successful result differs from its hashed pre-dispatch attempt or rendered prompt.')
            # Prompt, condition and exposure were sealed before the worker call.
            required_attempt = {'schema_version', 'case_id', 'sequence', 'candidate_id', 'model_identity',
                'example_id', 'example_version', 'example_sha256', 'source_id', 'source_sha256',
                'purpose', 'settings', 'messages', 'attempted', 'created_at', 'prompt', 'exposure_snapshot'}
            if paired:
                required_attempt |= PAIR_FIELDS
            if not required_attempt <= set(attempt) or attempt['exposure_snapshot'] not in inventory:
                raise RecordsError('Successful output lacks its complete pre-dispatch identity and exposure record.')
        cases.append({'case': case, 'result': result, 'source': source, 'example': example,
                      'result_file': file, 'result_file_sha256': checksum})
    if (type(manifest.get('attempted_case_count')) is not int
            or manifest['attempted_case_count'] != sum(item['case']['attempted'] for item in cases)):
        raise RecordsError('Attempted-case count differs from the finalized case records.')
    return cases


def _encoded(value: dict) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')


def _private_directory(path: Path) -> None:
    if not path.exists():
        _private_directory(path.parent)
        path.mkdir(mode=0o700)
    _path(path)
    if not path.is_dir():
        raise RecordsError('Review output parents must be directories.')


def _publish_pair(packet_path: Path, packet_bytes: bytes, key_path: Path, key_bytes: bytes) -> None:
    _private_directory(packet_path.parent)
    _private_directory(key_path.parent)
    key_stat = key_path.parent.stat()
    if key_stat.st_uid != os.getuid() or stat.S_IMODE(key_stat.st_mode) & 0o077:
        raise RecordsError('The private key directory must be owned by the operator and have mode 0700 or stricter.')
    temporary = []
    published_key = None
    try:
        for path, payload in ((packet_path, packet_bytes), (key_path, key_bytes)):
            descriptor, name = tempfile.mkstemp(prefix='.blind-', dir=path.parent)
            temporary.append(Path(name))
            with os.fdopen(descriptor, 'wb') as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
        for path in (packet_path, key_path):
            _path(path)
            if path.exists():
                raise FileExistsError(path)
        # Publish the private key first: a visible review packet always has its key.
        os.link(temporary[1], key_path, follow_symlinks=False)
        published_key = key_path.stat()
        os.link(temporary[0], packet_path, follow_symlinks=False)
    except BaseException:
        # An interruption may arrive immediately after the second link succeeds.
        # Keep a complete pair in that case; never leave a published packet keyless.
        packet_published = False
        if temporary and packet_path.exists():
            packet_stat, staged_stat = packet_path.lstat(), temporary[0].stat()
            packet_published = (packet_stat.st_dev, packet_stat.st_ino) == (staged_stat.st_dev, staged_stat.st_ino)
        if not packet_published and published_key is not None and key_path.exists():
            current = key_path.lstat()
            if (current.st_dev, current.st_ino) == (published_key.st_dev, published_key.st_ino):
                key_path.unlink()
        raise
    finally:
        for path in temporary:
            path.unlink(missing_ok=True)


def export_blind_packet(run_dir: str | Path, dataset_path: str | Path, reviewer_id: str,
                        output_path: str | Path, key_path: str | Path) -> dict:
    """Export raw completed answers for one reviewer, with a separate private key.

    Output and key paths must be new, in different directories outside the run.
    The key directory must be private to the current operator. Finalized failures
    and interrupted runs are allowed, but only non-synthetic successful responses
    are shown; exclusions and not-yet-recorded cases remain explicit in the key.
    """
    if not isinstance(reviewer_id, str) or not reviewer_id.strip() or len(reviewer_id) > 128:
        raise RecordsError('reviewer_id must contain 1-128 nonblank characters.')
    run, dataset_file, packet_file, key_file = map(_path, (run_dir, dataset_path, output_path, key_path))
    if not run.is_dir():
        raise RecordsError('Baseline run directory does not exist.')
    if (packet_file == key_file or packet_file.parent == key_file.parent
            or packet_file.is_relative_to(run) or key_file.is_relative_to(run)
            or packet_file == dataset_file or key_file == dataset_file):
        raise RecordsError('Packet and operator key need different directories outside the immutable run and dataset.')
    for path in (packet_file, key_file):
        if path.exists():
            raise FileExistsError(path)
    dataset, dataset_file_sha = _read(dataset_file)
    manifest, manifest_sha, inventory = _manifest(run, dataset)
    verified = _validated_cases(manifest, inventory, dataset)
    paired = manifest['schema_version'] == '1.1'
    rows, bindings, excluded = [], [], []
    rng = secrets.SystemRandom()
    used_ids = set()
    for item in verified:
        case, result, source, example = (item[key] for key in ('case', 'result', 'source', 'example'))
        if result.outcome != 'success' or result.synthetic:
            excluded.append({'case_id': case['case_id'], 'outcome': result.outcome,
                             'reason': 'synthetic_backend' if result.synthetic else 'inference_not_successful'})
            continue
        if 'review' not in source['permitted_uses']:
            raise RecordsError('Every exported source requires explicit review permission.')
        blind_id = secrets.token_urlsafe(24)
        while blind_id in used_ids:
            blind_id = secrets.token_urlsafe(24)
        used_ids.add(blind_id)
        row = {'blind_id': blind_id, 'source_text': source['original_text'],
               'question': example['question'], 'answer': result.answer,
               'ratings': {'fidelity': None, 'comprehension': None, 'naturalness': None},
               'issues': [], 'blind_compromised': None}
        if paired:
            row.update(input_language=case['input_language'], requested_output_language=case['output_language'])
        rows.append(row)
        bindings.append({'blind_id': blind_id, 'case_id': case['case_id'],
                         'candidate_id': case['candidate_id'], 'model_identity': result.model_identity,
                         'result_file': item['result_file'], 'result_file_sha256': item['result_file_sha256'],
                         'example_id': example['example_id'], 'example_version': example['version'],
                         'example_sha256': example_sha256(example), 'source_id': source['source_id'],
                         'source_version': source['version'], 'source_sha256': source['content_sha256'],
                         'question_sha256': content_sha256(example['question']),
                         'answer_sha256': content_sha256(result.answer), 'review_item_sha256': record_sha256(row)})
        if paired:
            bindings[-1].update({field: case[field] for field in PAIR_FIELDS})
    if not rows:
        raise RecordsError('No actual successful model outputs are available for blind review.')
    rng.shuffle(rows)
    binding_index = {item['blind_id']: item for item in bindings}
    packet_id = secrets.token_urlsafe(24)
    packet = {
        'schema_version': manifest['schema_version'], 'kind': 'blind_model_output_review', 'packet_id': packet_id,
        'reviewer_id': reviewer_id, 'status': 'unfilled',
        'input_evidence_type': manifest['evidence_type'],
        'instructions': [
            'Review each exact answer against its original passage and question, independently of other reviewers.',
            'Rate fidelity to the passage, comprehension of the question, and naturalness of the answer from 1 to 4. Leave a rating blank if you cannot assess it and explain why in issues.',
            'List unsupported claims, contradictions, omissions, confusing wording, wrong language, or other problems in issues.',
            'Set blind_compromised to true if you recognize or infer the model or have seen its identity; otherwise set it to false. An answer may reveal its model identity, and its wording has deliberately not been altered.',
            'This packet contains unscored model outputs. Completing it does not approve the source material, certify health safety, or authorize training. A separate import and adjudication process is still required.',
        ],
        'rating_scale': {'1': 'Major failure', '2': 'Substantial problems', '3': 'Minor problems', '4': 'No identified problems'},
        'items': rows,
    }
    if paired:
        packet['instructions'].append('Assess the requested output language for each answer: bo means Tibetan, zh means Chinese. Input and requested answer languages can differ. Only bilingual reviewers who can assess both should rate cross-language meaning.')
    packet_bytes = _encoded(packet)
    key = {
        'schema_version': manifest['schema_version'], 'kind': 'private_blind_model_output_key', 'packet_id': packet_id,
        'reviewer_id': reviewer_id, 'created_at': utc_now(), 'run_id': manifest['run_id'],
        'run_manifest_sha256': manifest_sha, 'dataset_canonical_sha256': record_sha256(dataset),
        'dataset_input_file_sha256': dataset_file_sha,
        'packet_file_sha256': hashlib.sha256(packet_bytes).hexdigest(),
        'purpose': manifest['purpose'], 'status': 'exported_awaiting_independent_review',
        'items': [binding_index[row['blind_id']] for row in rows],
        'excluded_cases': excluded, 'unrecorded_case_count': manifest['planned_cases'] - len(verified),
        'operator_instructions': 'Keep this file private. Give the reviewer only the packet file. No review import or adjudication has occurred.',
        'approval_granted': False,
    }
    if paired:
        key['parallel_material_sha256'] = manifest['loaded_records_sha256']['parallel_material']
    _publish_pair(packet_file, packet_bytes, key_file, _encoded(key))
    return {'schema_version': manifest['schema_version'], 'status': 'exported_awaiting_independent_review',
            'packet_id': packet_id, 'exported_count': len(rows), 'excluded_count': len(excluded),
            'unrecorded_case_count': key['unrecorded_case_count'],
            'packet_path': str(packet_file), 'private_key_path': str(key_file),
            'approval_granted': False, 'dataset_modified': False}
