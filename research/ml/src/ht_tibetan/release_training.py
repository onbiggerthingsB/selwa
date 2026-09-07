"""Bounded adapter training from immutable train/validation releases.

This entry point never opens a final-test payload, downloads a model, or resumes
optimizer state. Reviewed material additionally needs an explicit verified model
selection; synthetic engineering releases remain labelled as such throughout.
"""
from __future__ import annotations

from copy import deepcopy
import math
from pathlib import Path

from .acquisition import verify_snapshot
from .artifacts import hash_file, make_manifest, runtime_record, utc_now, write_json_new
from .preflight import inspect
from .records import RecordsError, example_sha256, load_dataset, record_sha256
from .training_inputs import prepare_training_example
from .training_mechanics import (
    CANDIDATES, PROJECTED_BYTES, _private_directory, resource_violation,
    runtime_sources, sample_resources, supervise_worker, validate_output_path,
)
from .training_worker import validate_config as validate_worker_config


def load_training_config(path, *, engineering_only):
    from .conditions import ENGINEERING_CONDITION, validate_condition

    fields = {'training', 'condition', 'study_path', 'selection_path', 'evaluation_report_path'}
    value = load_dataset(path) if path is not None else {}
    if not isinstance(value, dict) or set(value) - fields:
        raise RecordsError('Released training accepts only the documented configuration fields.')
    if path is not None and not {'training', 'condition'} <= set(value):
        raise RecordsError('An explicit training configuration must contain training and condition.')
    if not engineering_only and (path is None or any(not value.get(key) for key in
                                                  ('study_path', 'selection_path', 'evaluation_report_path'))):
        raise RecordsError('Reviewed training requires explicit study, model-selection and adjudicated evaluation receipts.')
    condition = deepcopy(value.get('condition', ENGINEERING_CONDITION))
    validate_condition(condition)
    if engineering_only and condition['instruction_review'] != 'synthetic':
        raise RecordsError('An engineering release requires an explicitly synthetic instruction condition.')
    if not engineering_only and (condition['instruction_review'] != 'reviewed'
                                 or condition['budget_basis'] != 'reviewed_task_budget'):
        raise RecordsError('Reviewed training requires reviewed instructions and a reviewed task budget.')
    result = {key: value.get(key) for key in ('study_path', 'selection_path', 'evaluation_report_path')}
    for key, entry in result.items():
        if entry is not None and (not isinstance(entry, str) or not Path(entry).is_absolute()):
            raise RecordsError(key + ' must be an absolute local path or null.')
    return {'training': validate_worker_config(value.get('training', {})), 'condition': condition, **result}


def validate_training_target(source, example, condition, study=None):
    """Apply the evaluation reference rules before teaching a released answer."""
    from .task_contract import validate_task_target
    validate_task_target(source, example, condition, study)


def prepare_release_records(dataset, tokenizer, *, candidate, configuration, role, study=None):
    from .conditions import condition_identity, task_messages

    if role not in {'train', 'validation'}:
        raise RecordsError('Training may prepare only train or validation release payloads.')
    examples = dataset['examples']
    if not 1 <= len(examples) <= 16:
        raise RecordsError('The initial bounded release runner accepts one to sixteen examples per role.')
    sources = {source['source_id']: source for source in dataset['sources']}
    condition = configuration['condition']
    if candidate not in condition['max_output_tokens_by_candidate']:
        raise RecordsError('The condition must declare an output budget for the selected candidate.')
    output_budget = condition['max_output_tokens_by_candidate'][candidate]
    records = []
    for example in examples:
        if example['split'] != role:
            raise RecordsError('Release example role differs from the requested training use.')
        answer = example.get('approved_answer')
        if not isinstance(answer, str) or not answer.strip():
            raise RecordsError('Every released training/validation example requires an explicit approved answer.')
        source = sources[example['source_id']]
        if source['language'] != condition['output_language']:
            raise RecordsError('Released training supports same-language comprehension; cross-language targets need reviewed parallel material.')
        validate_training_target(source, example, condition, study)
        messages = task_messages(source, example, condition) + [{'role': 'assistant', 'content': answer}]
        record = prepare_training_example(tokenizer, example_id=example['example_id'], messages=messages,
            max_seq_length=configuration['training']['max_seq_length'],
            template_kwargs={'candidate_id': candidate, 'reasoning_mode': 'disabled'})
        if (record['offset'] + output_budget > condition['context_limit_tokens']
                or len(record['tokens']) - record['offset'] > output_budget):
            raise RecordsError('The exact prompt/target exceeds its declared condition token budget; no truncation is allowed.')
        records.append(record | {
            'dataset_role': role, 'source_id': example['source_id'],
            'source_sha256': source['content_sha256'], 'example_sha256': example_sha256(example),
            'instruction_condition': condition_identity(condition),
        })
    return records


def _valid_loss(value, records):
    if not isinstance(value, dict):
        return False
    rows = value.get('examples')
    loss = value.get('token_weighted_loss')
    expected = {record['example_id']: len(record['tokens']) - record['offset'] for record in records}
    if (type(loss) not in (int, float) or not math.isfinite(loss)
            or not isinstance(rows, list) or len(rows) != len(records)
            or any(not isinstance(row, dict) for row in rows)):
        return False
    if {row.get('example_id') for row in rows} != set(expected):
        return False
    if any(row.get('supervised_tokens') != expected.get(row.get('example_id'))
           or type(row.get('loss')) not in (int, float) or not math.isfinite(row['loss']) for row in rows):
        return False
    total = sum(expected.values())
    return value.get('supervised_tokens') == total and math.isclose(
        loss, sum(row['loss'] * row['supervised_tokens'] for row in rows) / total,
        rel_tol=1e-12, abs_tol=1e-12)


def verify_training_proof(train, reload, *, payload):
    if train.get('outcome') != 'completed' or reload.get('outcome') != 'completed':
        raise RecordsError('Both training and fresh-process reload must complete.')
    before, after = train.get('response', {}), reload.get('response', {})
    evidence, reloaded = before.get('evidence', {}), after.get('evidence', {})
    if (before.get('completed_steps') != payload['config']['steps']
            or after.get('completed_steps') != payload['config']['steps']
            or evidence.get('base_unchanged') is not True
            or evidence.get('changed_tensor_count', 0) < 1
            or reloaded.get('reload_verified') is not True
            or reloaded.get('validation_reload_verified') is not True
            or evidence.get('release_sha256') != payload['release_sha256']
            or reloaded.get('release_sha256') != payload['release_sha256']
            or before.get('model_identity') != payload['model_identity']
            or after.get('model_identity') != payload['model_identity']
            or not before.get('adapter_identity')
            or before['adapter_identity'] != after.get('adapter_identity')):
        raise RecordsError('Released training identity/update/reload proof is incomplete.')
    for value in (evidence.get('validation_before'), evidence.get('validation_after'),
                  reloaded.get('validation_reloaded')):
        if not _valid_loss(value, payload['validation_records']):
            raise RecordsError('Validation must report finite assistant-token-weighted loss over every released example.')
    if not math.isclose(evidence['validation_after']['token_weighted_loss'],
                        reloaded['validation_reloaded']['token_weighted_loss'], rel_tol=1e-5, abs_tol=1e-6):
        raise RecordsError('Fresh-process validation does not reproduce checkpoint loss.')


def run_release_training(release_dir, permissions_path, lock_path, candidate, root, output, *,
                         config_path=None, timeout_seconds=300):
    from .experiment_lock import experiment_lock

    root, output = validate_output_path(Path(root), Path(output))
    if type(timeout_seconds) not in (int, float) or not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= 600:
        raise RecordsError('Released training requires a finite worker deadline of at most 600 seconds.')
    with experiment_lock(root):
        return _run_locked(Path(release_dir), Path(permissions_path) if permissions_path else None,
                           Path(lock_path), candidate, root, output,
                           config_path=Path(config_path) if config_path else None,
                           timeout_seconds=timeout_seconds)


def _selection(configuration, candidate, identity):
    from .study import verify_model_selection
    result = verify_model_selection(configuration['study_path'], configuration['selection_path'],
        candidate, evaluation_report_path=configuration['evaluation_report_path'], model_identity=identity)
    if result.get('valid') is not True or result.get('condition') != configuration['condition']:
        raise RecordsError('The model selection must verify the exact reviewed study and training condition.')
    return result


def _run_locked(release_dir, permissions_path, lock_path, candidate, root, output, *, config_path, timeout_seconds):
    from .conditions import condition_identity
    from .exposure_inventory import reserve_exposure
    from .releases import verify_release
    from .token_audit import load_local_tokenizer

    if candidate not in CANDIDATES:
        raise RecordsError('Select an existing supported pinned local candidate.')
    release = verify_release(release_dir, root=root, permissions_path=permissions_path,
                             purposes=('train', 'validation'), recheck_current=True)
    if release.get('valid') is not True:
        raise RecordsError('Immutable dataset release verification failed.')
    engineering = release['engineering_only']
    if engineering != (release['evidence_kind'] == 'synthetic_test'):
        raise RecordsError('Dataset release engineering/evidence labels conflict.')
    configuration = load_training_config(config_path, engineering_only=engineering)
    lock = load_dataset(lock_path)
    selected = [entry for entry in lock['candidates'] if entry['candidate_id'] == candidate]
    if len(selected) != 1:
        raise RecordsError('The requested model must resolve exactly once in the metadata lock.')
    selected = selected[0]
    identity = selected['repository'] + '@' + selected['revision']
    selection_receipt = None
    if not engineering:
        provenance = selected.get('conversion_provenance', {})
        if (provenance.get('status') == 'publisher_declarations_conflict'
                or not provenance.get('declared_source_repository')):
            raise RecordsError('Resolve conflicting or absent model conversion declarations before reviewed-data training.')
        selection_receipt = _selection(configuration, candidate, identity)
    snapshot = root / 'models' / candidate / selected['revision'] / 'model'
    verified = verify_snapshot(lock_path, candidate, snapshot, include_weights=True)
    if verified.get('valid') is not True:
        raise RecordsError('The local model failed exact pinned snapshot verification.')
    preflight = inspect(root, PROJECTED_BYTES)
    packages = runtime_record()['packages']
    if (not preflight['native_apple_silicon'] or packages['mlx-lm'] != '0.31.3' or packages['mlx'] != '0.32.2'
            or not preflight['storage']['within_budget']):
        raise RecordsError('Released training requires the inspected native runtime and storage reserve.')
    initial = sample_resources(root)
    violation = resource_violation(initial, initial)
    if violation:
        raise RecordsError('Released training preflight failed: ' + violation)
    tokenizer = load_local_tokenizer(snapshot)
    prepared = {role: prepare_release_records(release['datasets'][role], tokenizer, candidate=candidate,
                                              configuration=configuration, role=role,
                                              study=selection_receipt['study'] if selection_receipt else None)
                for role in ('train', 'validation')}
    # Recheck current grants, expiry and exposure after tokenizer preparation but
    # before creating any model-dispatch artifacts. The outer experiment lock
    # prevents another cooperating local run from racing this reservation.
    refreshed = verify_release(release_dir, root=root, permissions_path=permissions_path,
                               purposes=('train', 'validation'), recheck_current=True)
    if (refreshed['release_sha256'] != release['release_sha256']
            or any(record_sha256(refreshed['datasets'][role]) != record_sha256(release['datasets'][role])
                   for role in ('train', 'validation'))):
        raise RecordsError('Dataset release content changed during training preflight.')
    if selection_receipt is not None and record_sha256(_selection(configuration, candidate, identity)) != record_sha256(selection_receipt):
        raise RecordsError('Reviewed model selection changed during training preflight.')
    _private_directory(output)
    write_json_new(output / 'release-verification.json', release)
    write_json_new(output / 'current-release-verification.json', refreshed)
    write_json_new(output / 'model-verification.json', verified)
    write_json_new(output / 'preflight.json', {'preflight': preflight, 'resources': initial})
    for role in ('train', 'validation'):
        write_json_new(output / (role + '-dataset.json'), release['datasets'][role])
        write_json_new(output / (role + '-inputs.json'), {'role': role, 'release_sha256': release['release_sha256'],
            'condition': configuration['condition'], 'engineering_only': engineering, 'records': prepared[role]})
    if selection_receipt is not None:
        write_json_new(output / 'model-selection-verification.json', selection_receipt)
    reservations = []
    for index, role in enumerate(('train', 'validation'), start=1):
        path = reserve_exposure(output, release['datasets'][role], role,
                                [row['example_id'] for row in prepared[role]], index)
        reservations.append({'path': path.name, 'sha256': hash_file(path)})
    inputs = [lock_path, release_dir / 'manifest.json', output / 'train-inputs.json', output / 'validation-inputs.json']
    for path in (permissions_path, config_path):
        if path is not None:
            inputs.append(path)
    for key in ('study_path', 'selection_path', 'evaluation_report_path'):
        if configuration[key] is not None:
            inputs.append(Path(configuration[key]))
    manifest = make_manifest(output.name, 'released_adapter_training', inputs,
        {'training': configuration['training'], 'condition': configuration['condition'],
         'instruction_condition': condition_identity(configuration['condition']),
         'model_identity': identity, 'model_selection': selection_receipt,
         'provenance': selected.get('conversion_provenance'),
         'restart_support': 'none; new optimizer and directory on every run'}, 'started')
    manifest.update(run_directory=str(output), release_sha256=release['release_sha256'],
                    engineering_only=engineering, evidence_kind=release['evidence_kind'],
                    exposure_reservations=reservations, runtime_source_files=runtime_sources())
    write_json_new(output / 'started.json', manifest)
    payload = {'mode': 'train', 'model_path': str(snapshot), 'model_identity': identity,
               'records': prepared['train'], 'validation_records': prepared['validation'],
               'release_sha256': release['release_sha256'], 'config': configuration['training'],
               'checkpoint_dir': str(output / 'checkpoint')}
    train, reload = None, None
    outcome, failure = 'failed', None
    try:
        train = supervise_worker(payload, output / 'train-worker', timeout_seconds=timeout_seconds,
                                 initial_resources=initial, resource_root=root)
        if train['outcome'] == 'completed':
            reload = supervise_worker(payload | {'mode': 'reload',
                'expected_checkpoint_files': train['response']['evidence']['checkpoint_files']},
                output / 'reload-worker', timeout_seconds=min(180, timeout_seconds),
                initial_resources=initial, resource_root=root)
            if reload['outcome'] == 'completed':
                verify_training_proof(train, reload, payload=payload)
                outcome = 'completed'
    except (OSError, ValueError, TypeError, KeyError) as exc:
        failure = type(exc).__name__
    current = make_manifest(output.name, 'released_adapter_training', [], {}, outcome)
    if current['code']['content_sha256'] != manifest['code']['content_sha256']:
        outcome, failure = 'failed', 'code_changed_during_run'
    if runtime_sources() != manifest['runtime_source_files']:
        outcome, failure = 'failed', 'runtime_source_changed_during_run'
    # Bind original exact inputs, including the permission/study receipts, across
    # execution; a later edit cannot quietly become part of the same experiment.
    try:
        if any(hash_file(path) != entry['sha256'] for path, entry in zip(inputs, manifest['inputs'])):
            outcome, failure = 'failed', 'input_changed_during_run'
    except OSError:
        outcome, failure = 'failed', 'input_unavailable_after_run'
    final = manifest | {'outcome': outcome, 'finished_at': utc_now(), 'failure': failure,
        'train': train, 'reload': reload, 'post_resources': sample_resources(root),
        'claims': {'local_adapter_updates_and_reload': outcome == 'completed',
                   'validation_loss_measured': outcome == 'completed', 'tibetan_comprehension': False,
                   'health_correctness': False, 'held_out_improvement': False, 'exact_resume': False,
                   'final_test_opened': False, 'engineering_only': engineering},
        'artifact_inventory': [{'path': str(path.relative_to(output)), 'sha256': hash_file(path),
                                'bytes': path.stat().st_size}
                               for path in sorted(output.rglob('*')) if path.is_file()]}
    write_json_new(output / 'manifest.json', final)
    return final
