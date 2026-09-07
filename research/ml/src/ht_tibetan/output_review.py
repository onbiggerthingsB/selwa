"""Freeze independent output ratings and record separate, explicit adjudication.

These are private local research records. No score selects a model, changes source
permissions, approves a training example, or establishes clinical validity.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
import os
from pathlib import Path
import re
import stat

from .artifacts import utc_now
from .blind_review import (_encoded, _manifest, _MAX_JSON_BYTES, _path, PAIR_FIELDS,
                          _private_directory, _read, _validated_cases)
from .baseline import jobs_for
from .records import RecordsError, atomic_write_json, record_sha256
from .splits import audit_splits

AXES = ('fidelity', 'comprehension', 'naturalness')
DECISIONS = {'meets_task_criteria', 'does_not_meet_task_criteria', 'unresolved'}
_MAX_REVIEW_BYTES = _MAX_JSON_BYTES
_LIMITATIONS = [
    'Reviewer identity, independence and qualifications are operator declarations, not authenticated facts.',
    'Ordinal ratings are shown separately. No automatic score threshold or model selection is applied.',
    'Questions sharing sources, scenarios or paraphrases are clustered observations, not independent samples.',
    'Generation failures and unrecorded requests remain in the denominators.',
    'Language ratings and adjudication grant no clinical approval or training permission.',
]


def _private_input(path):
    path = _path(path)
    info = path.stat()
    parent = path.parent.stat()
    if (info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077
            or parent.st_uid != os.getuid() or stat.S_IMODE(parent.st_mode) & 0o077
            or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1):
        raise RecordsError('Operator review records must be owned by this user with mode 0600 or stricter.')
    return path


def _write_output(path, record, run):
    path, run = _path(path), _path(run)
    if path.is_relative_to((Path.home() / 'Desktop').resolve()) or path.is_relative_to(run):
        raise RecordsError('Review records must be outside Desktop and the immutable model run.')
    if any((parent / 'manifest.started.json').exists() or (parent / 'manifest.json').exists() for parent in path.parents):
        raise RecordsError('Review records must be outside all immutable source run directories.')
    if path.exists():
        raise FileExistsError(path)
    if len(_encoded(record)) > _MAX_REVIEW_BYTES:
        raise RecordsError('Review output exceeds its bounded JSON file size; no record was written.')
    _private_directory(path.parent)
    info = path.parent.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise RecordsError('Operator review output directories require mode 0700 or stricter.')
    atomic_write_json(path, record)


def _freeze_content(run_dir, dataset_path, review_paths):
    from .output_review_import import load_imported_review

    run, data_path = _path(run_dir), _path(dataset_path)
    if not isinstance(review_paths, list) or not 2 <= len(review_paths) <= 8:
        raise RecordsError('Freeze requires 2-8 distinct independently completed reviewer packets.')
    dataset, _ = _read(data_path)
    manifest, manifest_hash, inventory = _manifest(run, dataset)
    paired = manifest['schema_version'] == '1.1'
    jobs = jobs_for(dataset, manifest['config'], manifest.get('parallel_material'))
    cases = _validated_cases(manifest, inventory, dataset)
    successful = {item['case']['case_id']: item for item in cases
                  if item['result'].outcome == 'success' and not item['result'].synthetic}
    if not successful:
        raise RecordsError('There are no actual successful model outputs to review.')
    reviews, reviewers, evidence_kinds, inputs = {}, set(), set(), []
    for review_path in review_paths:
        path = _private_input(review_path)
        record, file_hash = load_imported_review(path)
        reviewer = record['reviewer_id']
        if reviewer in reviewers:
            raise RecordsError('Each frozen reviewer must be distinct, even across different packets or revisions.')
        if record['status'] != 'complete' or record['independent'] is not True:
            raise RecordsError('Every reviewer must finish the packet and explicitly declare independent review before freeze.')
        key = record['private_key']
        if (key['run_manifest_sha256'] != manifest_hash
                or key['dataset_canonical_sha256'] != record_sha256(dataset)
                or key['run_id'] != manifest['run_id'] or record['purpose'] != manifest['purpose']
                or record['input_evidence_type'] != manifest['evidence_type']):
            raise RecordsError('Review provenance does not match this exact finalized run and dataset.')
        if (record['schema_version'] != manifest['schema_version']
                or (paired and key.get('parallel_material_sha256') != manifest['loaded_records_sha256']['parallel_material'])):
            raise RecordsError('Review version or paired-material identity differs from the finalized run.')
        rows = {item['binding']['case_id']: item for item in record['items']}
        if len(rows) != len(record['items']) or set(rows) != set(successful):
            raise RecordsError('Every reviewer must cover exactly the same complete model outputs.')
        for case_id, row in rows.items():
            source = successful[case_id]
            binding, case, example = row['binding'], source['case'], source['example']
            expected = {'case_id': case_id, 'candidate_id': case['candidate_id'],
                'model_identity': source['result'].model_identity,
                'result_file': source['result_file'], 'result_file_sha256': source['result_file_sha256'],
                'example_id': example['example_id'], 'example_version': example['version'],
                'example_sha256': case['example_sha256'], 'source_id': source['source']['source_id'],
                'source_version': source['source']['version'], 'source_sha256': source['source']['content_sha256']}
            if paired:
                expected.update({field: case[field] for field in PAIR_FIELDS})
            if (any(binding.get(field) != value for field, value in expected.items())
                    or row['source_text'] != source['source']['original_text']
                    or row['question'] != example['question'] or row['answer'] != source['result'].answer
                    or row['complete'] is not True):
                raise RecordsError('Reviewed text or case binding differs from the finalized model output.')
        reviews[reviewer] = rows
        reviewers.add(reviewer)
        evidence_kinds.add(record['evidence_kind'])
        inputs.append({'path': str(path), 'file_sha256': file_hash, 'reviewer_id': reviewer,
                       'import_id': record['import_id']})
    if len(evidence_kinds) != 1:
        raise RecordsError('Synthetic test ratings must never be combined with declared human reviews.')
    evidence_kind = evidence_kinds.pop()
    rows = []
    for case_id, item in successful.items():
        ratings = [{'reviewer_id': reviewer, **{field: deepcopy(reviews[reviewer][case_id][field])
                    for field in ('ratings', 'issues', 'blind_compromised')}} for reviewer in sorted(reviewers)]
        disagreements = [axis for axis in AXES if len({r['ratings'][axis] for r in ratings}) > 1]
        rows.append({'case_id': case_id, 'candidate_id': item['case']['candidate_id'],
                     'model_identity': item['result'].model_identity,
                     'example_id': item['example']['example_id'], 'source_id': item['source']['source_id'],
                     'scenario_group': item['example']['scenario_group'],
                     'paraphrase_group': item['example']['paraphrase_group'],
                     'source_text': item['source']['original_text'], 'question': item['example']['question'],
                     'answer': item['result'].answer, 'reviews': ratings,
                     'rating_disagreement_axes': disagreements,
                     'issue_reports_present': any(r['issues'] for r in ratings),
                     'blinding_compromised': any(r['blind_compromised'] for r in ratings)})
        if paired:
            rows[-1].update({field: item['case'][field] for field in PAIR_FIELDS})
    counts = []
    for candidate in manifest['config']['candidate_ids']:
        generated = [item for item in cases if item['case']['candidate_id'] == candidate]
        rated = [row for row in rows if row['candidate_id'] == candidate]
        counts.append({'candidate_id': candidate, 'planned_requests': len(jobs),
            'recorded_requests': len(generated), 'unrecorded_requests': len(jobs) - len(generated),
            'attempted_requests': sum(item['case']['attempted'] for item in generated),
            'generation_outcomes': dict(sorted(Counter(item['result'].outcome for item in generated).items())),
            'reviewed_successful_outputs': len(rated),
            'outputs_with_rating_disagreement': sum(bool(row['rating_disagreement_axes']) for row in rated),
            'outputs_with_reported_issues': sum(row['issue_reports_present'] for row in rated),
            'outputs_with_compromised_blinding': sum(row['blinding_compromised'] for row in rated),
            'ratings_by_axis': {axis: {str(value): sum(review['ratings'][axis] == value
                for row in rated for review in row['reviews']) for value in range(1, 5)} for axis in AXES}})
    selected = set(manifest['selected_example_ids'])
    # Recompute cluster membership from the checked dataset, not a producer's
    # descriptive manifest field. No statistical independence is inferred here.
    audit = audit_splits(dataset, manifest['config']['contributor_policy'])
    clusters = [sorted(selected.intersection(component['example_ids']))
                for component in audit['components'] if selected.intersection(component['example_ids'])]
    record = {'schema_version': manifest['schema_version'], 'kind': 'frozen_model_output_reviews',
        'status': 'frozen', 'evidence_kind': evidence_kind, 'input_evidence_type': manifest['evidence_type'],
        'purpose': manifest['purpose'], 'run_id': manifest['run_id'],
        'provenance': {'run_dir': str(run), 'dataset_path': str(data_path),
            'run_manifest_sha256': manifest_hash, 'dataset_canonical_sha256': record_sha256(dataset),
            'imports': sorted(inputs, key=lambda item: item['reviewer_id'])},
        'reviewer_ids': sorted(reviewers), 'review_criteria': manifest['config']['review_criteria'],
        'selected_example_count': len(selected), 'source_count': len({example['source_id'] for example in dataset['examples'] if example['example_id'] in selected}),
        'connected_example_clusters': clusters, 'connected_cluster_count': len(clusters),
        'candidate_counts': counts, 'cases': rows,
        'excluded_cases': [{'case_id': item['case']['case_id'], 'candidate_id': item['case']['candidate_id'],
            'example_id': item['case']['example_id'], 'outcome': item['result'].outcome,
            'reason': 'synthetic_backend' if item['result'].synthetic else 'generation_not_successful'}
            for item in cases if item['case']['case_id'] not in successful],
        'limitations': _LIMITATIONS, 'approval_granted': False, 'dataset_modified': False,
        'model_selected': None, 'adjudication_status': 'pending'}
    if paired:
        record['parallel_material_sha256'] = manifest['loaded_records_sha256']['parallel_material']
        record['pair_count'] = len(manifest['config']['pair_ids'])
        record['condition_counts'] = []
        for candidate in manifest['config']['candidate_ids']:
            for condition in manifest['config']['conditions']:
                generated = [item for item in cases if item['case']['candidate_id'] == candidate and item['case']['condition_id'] == condition]
                rated = [row for row in rows if row['candidate_id'] == candidate and row['condition_id'] == condition]
                planned = sum(job['condition_id'] == condition for job in jobs)
                record['condition_counts'].append({'candidate_id': candidate, 'condition_id': condition,
                    'input_language': condition.split('_to_')[0], 'output_language': condition.split('_to_')[1],
                    'planned_requests': planned, 'recorded_requests': len(generated),
                    'unrecorded_requests': planned - len(generated),
                    'generation_outcomes': dict(sorted(Counter(item['result'].outcome for item in generated).items())),
                    'reviewed_successful_outputs': len(rated),
                    'outputs_with_rating_disagreement': sum(bool(row['rating_disagreement_axes']) for row in rated),
                    'outputs_with_reported_issues': sum(row['issue_reports_present'] for row in rated),
                    'outputs_with_compromised_blinding': sum(row['blinding_compromised'] for row in rated),
                    'ratings_by_axis': {axis: {str(value): sum(review['ratings'][axis] == value
                        for row in rated for review in row['reviews']) for value in range(1, 5)} for axis in AXES}})
    return record


def freeze_output_reviews(run_dir, dataset_path, review_paths, output_path):
    record = _freeze_content(run_dir, dataset_path, review_paths)
    record['frozen_at'] = utc_now()
    _write_output(output_path, record, run_dir)
    return {'status': 'frozen', 'evidence_kind': record['evidence_kind'],
            'input_evidence_type': record['input_evidence_type'], 'reviewer_count': len(record['reviewer_ids']),
            'reviewed_output_count': len(record['cases']), 'approval_granted': False,
            'adjudication_status': 'pending', 'output': str(output_path)}


def load_frozen_reviews(path):
    record, file_hash = _read(_private_input(path))
    try:
        provenance = record['provenance']
        rebuilt = _freeze_content(provenance['run_dir'], provenance['dataset_path'],
                                  [item['path'] for item in provenance['imports']])
        if not isinstance(record['frozen_at'], str) or not record['frozen_at'].strip():
            raise RecordsError('Missing freeze timestamp.')
        rebuilt['frozen_at'] = record['frozen_at']
        if record_sha256(record) != record_sha256(rebuilt):
            raise RecordsError('Frozen ratings or provenance differ from their immutable inputs.')
    except (KeyError, TypeError) as exc:
        raise RecordsError('Malformed frozen review record.') from exc
    return record, file_hash


def _blank_decisions(freeze, checksum):
    return {'schema_version': freeze['schema_version'], 'kind': 'model_output_adjudication_decisions',
        'freeze_file_sha256': checksum, 'evidence_kind': freeze['evidence_kind'],
        'adjudicator_id': None, 'decisions': [{'case_id': row['case_id'], 'decision': None,
            'rationale': None, 'issues_addressed': None} for row in freeze['cases']]}


def export_output_adjudication(freeze_path, output_path):
    freeze, checksum = load_frozen_reviews(freeze_path)
    _write_output(output_path, _blank_decisions(freeze, checksum), freeze['provenance']['run_dir'])
    return {'status': 'awaiting_explicit_adjudication', 'case_count': len(freeze['cases']),
            'evidence_kind': freeze['evidence_kind'], 'approval_granted': False, 'output': str(output_path)}


def adjudicate_output_reviews(freeze_path, decisions_path, output_path):
    freeze, checksum = load_frozen_reviews(freeze_path)
    decisions, decisions_sha = _read(_private_input(decisions_path))
    blank = _blank_decisions(freeze, checksum)
    if not isinstance(decisions, dict) or set(decisions) != set(blank):
        raise RecordsError('Adjudication requires exactly the documented decision fields.')
    for field in ('schema_version', 'kind', 'freeze_file_sha256', 'evidence_kind'):
        if decisions[field] != blank[field]:
            raise RecordsError('Adjudication must bind the unchanged freeze and evidence kind.')
    if not isinstance(decisions['adjudicator_id'], str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', decisions['adjudicator_id']):
        raise RecordsError('Adjudication requires an explicit stable adjudicator pseudonym.')
    if not isinstance(decisions['decisions'], list) or len(decisions['decisions']) != len(blank['decisions']):
        raise RecordsError('Adjudicate every frozen output; keep unresolved decisions explicit.')
    rows = {row['case_id']: row for row in freeze['cases']}
    seen = set()
    for entry in decisions['decisions']:
        if not isinstance(entry, dict) or set(entry) != {'case_id', 'decision', 'rationale', 'issues_addressed'}:
            raise RecordsError('Malformed case adjudication.')
        cid, decision = entry['case_id'], entry['decision']
        if not isinstance(cid, str) or cid not in rows or cid in seen:
            raise RecordsError('Adjudications must cover each frozen case exactly once.')
        seen.add(cid)
        if not isinstance(decision, str) or decision not in DECISIONS:
            raise RecordsError('Choose meets_task_criteria, does_not_meet_task_criteria or unresolved explicitly.')
        if not isinstance(entry['rationale'], str) or not entry['rationale'].strip() or len(entry['rationale']) > 8000:
            raise RecordsError('Every adjudication needs a nonempty rationale up to 8000 characters.')
        if type(entry['issues_addressed']) is not bool:
            raise RecordsError('Explicitly record whether reviewer issues and disagreements were addressed.')
        if decision == 'meets_task_criteria':
            if not entry['issues_addressed']:
                raise RecordsError('An accepted task result must explicitly address reviewer issues and disagreements.')
            if rows[cid]['blinding_compromised']:
                raise RecordsError('Compromised blinding cannot be accepted as a blinded task result; record unresolved or failure.')
    counts = []
    for candidate in freeze['candidate_counts']:
        cid = candidate['candidate_id']
        counts.append({'candidate_id': cid, 'planned_requests': candidate['planned_requests'],
            'reviewed_successful_outputs': candidate['reviewed_successful_outputs'],
            'decisions': {outcome: sum(entry['decision'] == outcome and rows[entry['case_id']]['candidate_id'] == cid
                for entry in decisions['decisions']) for outcome in sorted(DECISIONS)}})
    result = {'schema_version': freeze['schema_version'], 'kind': 'adjudicated_model_output_reviews',
        'status': 'recorded_with_unresolved_cases' if any(row['decision'] == 'unresolved' for row in decisions['decisions']) else 'recorded',
        'created_at': utc_now(), 'freeze_path': str(_path(freeze_path)), 'freeze_file_sha256': checksum,
        'decisions_file_sha256': decisions_sha, 'evidence_kind': freeze['evidence_kind'],
        'input_evidence_type': freeze['input_evidence_type'], 'adjudicator_id': decisions['adjudicator_id'],
        'decisions': decisions['decisions'], 'candidate_counts': counts,
        'approval_granted': False, 'dataset_modified': False, 'model_selected': None,
        'limitations': _LIMITATIONS}
    if freeze['schema_version'] == '1.1':
        result['condition_counts'] = [{
            'candidate_id': group['candidate_id'], 'condition_id': group['condition_id'],
            'planned_requests': group['planned_requests'],
            'reviewed_successful_outputs': group['reviewed_successful_outputs'],
            'decisions': {outcome: sum(entry['decision'] == outcome
                and rows[entry['case_id']]['candidate_id'] == group['candidate_id']
                and rows[entry['case_id']]['condition_id'] == group['condition_id']
                for entry in decisions['decisions']) for outcome in sorted(DECISIONS)}
            } for group in freeze['condition_counts']]
    _write_output(output_path, result, freeze['provenance']['run_dir'])
    return {field: result[field] for field in ('status', 'evidence_kind', 'input_evidence_type', 'approval_granted', 'model_selected')}
