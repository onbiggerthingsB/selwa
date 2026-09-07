"""Real release boundaries with synthetic fixtures and a mocked GPU subprocess."""
from contextlib import ExitStack
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ht_tibetan.artifacts import hash_file, write_json_new
from ht_tibetan.conditions import ENGINEERING_CONDITION
from ht_tibetan.exposure_inventory import build_exposure_inventory
from ht_tibetan.records import RecordsError, load_dataset
from ht_tibetan.release_training import (
    load_training_config, prepare_release_records, run_release_training, verify_training_proof,
    validate_training_target,
)
from ht_tibetan.releases import build_release, verify_release
from ht_tibetan.training_worker import checkpoint_config, token_weighted_loss, validate_payload
from test_training_inputs import ExactTokenizer

FIXTURES = Path(__file__).resolve().parents[2] / 'contracts' / 'fixtures'
CID = 'gemma3-4b-it-mlx-4bit'
IDENTITY = 'fixture/pinned@' + 'a' * 40
RESOURCES = {'free_disk_bytes': 50 * 1024**3, 'swap_used_bytes': 0,
             'pressure_level': 1, 'worker_rss_bytes': None}


def validation_result(records, loss):
    rows = [{'example_id': record['example_id'], 'loss': loss,
             'supervised_tokens': len(record['tokens']) - record['offset'],
             'complete_tokens': len(record['tokens'])} for record in records]
    return {'token_weighted_loss': loss, 'examples': rows,
            'supervised_tokens': sum(row['supervised_tokens'] for row in rows),
            'complete_tokens': sum(row['complete_tokens'] for row in rows),
            'quality_claim': None}


class ReleaseTrainingTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        (self.root / 'runs').mkdir()
        self.release = self.root / 'releases' / 'synthetic-engineering'
        self.permissions = FIXTURES / 'synthetic-release-permissions.json'
        build_release(FIXTURES / 'synthetic-release-dataset.json', self.permissions,
                      self.root, self.release, release_id=self.release.name, evidence_kind='synthetic_test')
        self.lock = self.root / 'model-lock.json'
        write_json_new(self.lock, {'schema_version': '1.0', 'candidates': [{
            'candidate_id': CID, 'repository': 'fixture/pinned', 'revision': 'a' * 40,
            'conversion_provenance': {'status': 'publisher_declared_not_reproduced',
                                     'declared_source_repository': 'fixture/base'}}]})
        self.config = self.root / 'training-config.json'
        write_json_new(self.config, {'training': {'max_seq_length': 512, 'steps': 2},
                                    'condition': deepcopy(ENGINEERING_CONDITION)})
        self.calls = []

    def worker(self, payload, scratch, **kwargs):
        # Assertions run exactly where a real supervisor would receive model data.
        run = scratch.parent
        self.assertTrue((run / 'started.json').is_file())
        self.assertTrue((run / 'exposure.001.json').is_file())
        self.assertTrue((run / 'exposure.002.json').is_file())
        self.assertTrue((run / 'train-dataset.json').is_file())
        self.assertTrue((run / 'validation-dataset.json').is_file())
        self.calls.append(deepcopy(payload))
        evidence = {'base_unchanged': True, 'changed_tensor_count': 8,
                    'adapter_tensor_count': 8, 'release_sha256': payload['release_sha256'],
                    'checkpoint_files': {name: 'd' * 64 for name in
                        ('adapter_config.json', 'adapters.safetensors', 'checkpoint-evidence.json')}}
        if payload['mode'] == 'train':
            evidence.update(reload_verified=False,
                validation_before=validation_result(payload['validation_records'], 4.0),
                validation_after=validation_result(payload['validation_records'], 3.0))
        else:
            evidence.update(reload_verified=True, validation_reload_verified=True,
                            validation_reloaded=validation_result(payload['validation_records'], 3.0))
        response = {'outcome': 'success', 'mode': payload['mode'], 'model_identity': payload['model_identity'],
                    'completed_steps': payload['config']['steps'], 'adapter_identity': 'sha256:' + 'd' * 64,
                    'evidence': evidence}
        scratch.mkdir(mode=0o700)
        write_json_new(scratch / 'request.json', payload)
        write_json_new(scratch / 'response.json', response)
        result = {'outcome': 'completed', 'response': response, 'stop_reason': None}
        write_json_new(scratch / 'supervisor.json', result)
        return result

    def run_case(self, *, worker=None, output_name='adapter-test', verifier=None):
        import ht_tibetan.releases as releases
        original_read = releases._read

        def no_final_test(path):
            self.assertNotIn('locked', Path(path).parts, 'Training opened protected final-test bytes')
            return original_read(path)

        with ExitStack() as stack:
            stack.enter_context(patch('ht_tibetan.release_training.verify_snapshot', return_value={'valid': True}))
            stack.enter_context(patch('ht_tibetan.release_training.inspect', return_value={
                'native_apple_silicon': True, 'storage': {'within_budget': True}}))
            stack.enter_context(patch('ht_tibetan.release_training.runtime_record', return_value={
                'packages': {'mlx': '0.32.2', 'mlx-lm': '0.31.3'}}))
            stack.enter_context(patch('ht_tibetan.release_training.runtime_sources', return_value=[]))
            stack.enter_context(patch('ht_tibetan.release_training.sample_resources', return_value=RESOURCES))
            stack.enter_context(patch('ht_tibetan.token_audit.load_local_tokenizer', return_value=ExactTokenizer()))
            stack.enter_context(patch('ht_tibetan.release_training.supervise_worker', side_effect=worker or self.worker))
            stack.enter_context(patch('ht_tibetan.releases._read', side_effect=no_final_test))
            if verifier is not None:
                stack.enter_context(patch('ht_tibetan.releases.verify_release', side_effect=verifier))
            return run_release_training(self.release, self.permissions, self.lock, CID, self.root,
                                        self.root / 'runs' / output_name, config_path=self.config)

    def test_end_to_end_reserves_both_roles_without_opening_final_test(self):
        result = self.run_case()
        self.assertEqual(result['outcome'], 'completed')
        self.assertEqual([call['mode'] for call in self.calls], ['train', 'reload'])
        self.assertEqual(len(self.calls[0]['records']), 2)
        self.assertEqual(len(self.calls[0]['validation_records']), 1)
        self.assertEqual(result['kind'], 'released_adapter_training')
        self.assertTrue(result['engineering_only'])
        self.assertEqual(result['evidence_kind'], 'synthetic_test')
        self.assertFalse(result['claims']['tibetan_comprehension'])
        self.assertFalse(result['claims']['final_test_opened'])
        self.assertFalse(result['claims']['held_out_improvement'])
        self.assertTrue(result['claims']['validation_loss_measured'])
        self.assertEqual({entry['path'] for entry in result['exposure_reservations']},
                         {'exposure.001.json', 'exposure.002.json'})
        self.assertTrue(any(entry['path'] == 'reload-worker/response.json' for entry in result['artifact_inventory']))
        inventory = build_exposure_inventory(self.root / 'runs')
        self.assertTrue(inventory['valid'], inventory)
        for record in self.calls[0]['records'] + self.calls[0]['validation_records']:
            self.assertEqual(record['instruction_condition']['instruction_language'], 'en')
            self.assertEqual(record['messages'][0]['content'].split('\n\n')[0], ENGINEERING_CONDITION['instruction_text'])
        for artifact in result['artifact_inventory']:
            self.assertEqual(hash_file(Path(result['run_directory']) / artifact['path']), artifact['sha256'])

    def test_worker_failure_retains_complete_exposure_and_no_success_claim(self):
        def failed(payload, scratch, **kwargs):
            response = self.worker(payload, scratch, **kwargs)
            response['outcome'] = 'failed'
            response['stop_reason'] = 'timeout'
            return response
        result = self.run_case(worker=failed)
        self.assertEqual(result['outcome'], 'failed')
        self.assertEqual(len(self.calls), 1)
        self.assertFalse(result['claims']['local_adapter_updates_and_reload'])
        inventory = build_exposure_inventory(self.root / 'runs')
        self.assertTrue(inventory['valid'], inventory)
        self.assertEqual({role for item in inventory['entries'] for role in item['exposures']}, {'train', 'validation'})

    def test_revocation_or_changed_eligibility_after_render_prevents_dispatch(self):
        count = 0
        def verifier(*args, **kwargs):
            nonlocal count
            count += 1
            if count == 2:
                raise RecordsError('synthetic changed-permission test')
            return verify_release(*args, **kwargs)
        with self.assertRaisesRegex(RecordsError, 'changed-permission'):
            self.run_case(verifier=verifier)
        self.assertEqual(self.calls, [])
        self.assertFalse((self.root / 'runs' / 'adapter-test').exists())

    def test_immutable_release_change_blocks_before_tokenizer_or_worker(self):
        selected = self.release / 'datasets' / 'train.json'
        selected.write_text('{}')
        with self.assertRaises(RecordsError):
            self.run_case()
        self.assertEqual(self.calls, [])

    def test_real_material_without_reviewed_receipts_cannot_use_default_config(self):
        with self.assertRaisesRegex(RecordsError, 'model-selection'):
            load_training_config(None, engineering_only=False)
        with self.assertRaisesRegex(RecordsError, 'model-selection'):
            load_training_config(self.config, engineering_only=False)

    def test_unknown_configuration_or_resume_is_rejected(self):
        for value in [{'training': {}, 'condition': ENGINEERING_CONDITION, 'resume': True},
                      {'training': {'resume': True}, 'condition': ENGINEERING_CONDITION},
                      {'training': {}}]:
            self.config.write_text(json.dumps(value))
            with self.subTest(value=value), self.assertRaises(ValueError):
                load_training_config(self.config, engineering_only=True)

    def test_final_role_and_missing_answer_never_reach_renderer(self):
        release = verify_release(self.release, root=self.root, permissions_path=self.permissions,
                                 purposes=('train', 'validation'))
        configuration = load_training_config(self.config, engineering_only=True)
        with self.assertRaises(RecordsError):
            prepare_release_records(release['datasets']['train'], ExactTokenizer(), candidate=CID,
                                    configuration=configuration, role='final_test')
        data = deepcopy(release['datasets']['train'])
        data['examples'][0]['approved_answer'] = None
        with self.assertRaisesRegex(RecordsError, 'approved answer'):
            prepare_release_records(data, ExactTokenizer(), candidate=CID,
                                    configuration=configuration, role='train')

    def test_target_budget_and_length_overflow_refuse_instead_of_truncate(self):
        release = verify_release(self.release, root=self.root, permissions_path=self.permissions,
                                 purposes=('train', 'validation'))
        configuration = load_training_config(self.config, engineering_only=True)
        configuration['condition'] = deepcopy(configuration['condition'])
        configuration['condition']['max_output_tokens_by_candidate'][CID] = 1
        with self.assertRaisesRegex(RecordsError, 'token budget'):
            prepare_release_records(release['datasets']['train'], ExactTokenizer(), candidate=CID,
                                    configuration=configuration, role='train')
        configuration['training']['max_seq_length'] = 16
        with self.assertRaisesRegex(ValueError, 'truncation is forbidden'):
            prepare_release_records(release['datasets']['train'], ExactTokenizer(), candidate=CID,
                                    configuration=configuration, role='train')

    def test_source_span_training_obeys_the_same_reference_rule_as_evaluation(self):
        release = verify_release(self.release, root=self.root, permissions_path=self.permissions,
                                 purposes=('train', 'validation'))
        configuration = load_training_config(self.config, engineering_only=True)
        configuration['condition']['task_answer_kind'] = 'source_span'
        with self.assertRaisesRegex(RecordsError, 'exact span'):
            prepare_release_records(release['datasets']['train'], ExactTokenizer(), candidate=CID,
                                    configuration=configuration, role='train')
        source = {'original_text': 'A blue box is here.'}
        example = {'example_id': 'span', 'approved_answer': 'blue box'}
        validate_training_target(source, example, configuration['condition'])

    def test_reviewed_labels_and_extraction_no_answer_rules_bind_training(self):
        source = {'original_text': 'A blue box is here.'}
        condition = deepcopy(ENGINEERING_CONDITION)
        condition['task_answer_kind'] = 'exact_label'
        study = {'first_task': {'answer_kind': 'exact_label', 'labels': ['YES', 'NO'],
                                'no_answer_label': 'UNKNOWN'}}
        for answer in ('YES', 'NO', 'UNKNOWN'):
            validate_training_target(source, {'example_id': 'label', 'approved_answer': answer}, condition, study)
        with self.assertRaisesRegex(RecordsError, 'outside the reviewed task'):
            validate_training_target(source, {'example_id': 'label', 'approved_answer': 'MAYBE'}, condition, study)
        condition['task_answer_kind'] = 'source_span'
        study['first_task'] = {'answer_kind': 'extraction', 'labels': [], 'no_answer_label': 'UNKNOWN'}
        for answer in ('blue box', 'UNKNOWN'):
            validate_training_target(source, {'example_id': 'extract', 'approved_answer': answer}, condition, study)
        with self.assertRaisesRegex(RecordsError, 'exact span'):
            validate_training_target(source, {'example_id': 'extract', 'approved_answer': 'a red box'}, condition, study)

    def test_undeclared_cross_language_training_is_rejected(self):
        release = verify_release(self.release, root=self.root, permissions_path=self.permissions,
                                 purposes=('train', 'validation'))
        configuration = load_training_config(self.config, engineering_only=True)
        configuration['condition']['output_language'] = 'bo'
        with self.assertRaisesRegex(RecordsError, 'same-language comprehension'):
            prepare_release_records(release['datasets']['train'], ExactTokenizer(), candidate=CID,
                                    configuration=configuration, role='train')

    def test_removed_configuration_after_dispatch_preserves_failed_run_evidence(self):
        def remove_configuration(payload, scratch, **kwargs):
            response = self.worker(payload, scratch, **kwargs)
            if payload['mode'] == 'reload':
                self.config.unlink()
            return response
        result = self.run_case(worker=remove_configuration)
        self.assertEqual(result['outcome'], 'failed')
        self.assertEqual(result['failure'], 'input_unavailable_after_run')
        self.assertTrue((Path(result['run_directory']) / 'manifest.json').is_file())
        self.assertTrue(build_exposure_inventory(self.root / 'runs')['valid'])

    def test_loss_report_tampering_prevents_success(self):
        # Test proof directly: a nonfinite backend response cannot be a successful
        # result or serialized final manifest (the real supervisor rejects it).
        result = self.run_case()
        train, reload = deepcopy(result['train']), deepcopy(result['reload'])
        reload['response']['evidence']['validation_reloaded']['token_weighted_loss'] = float('nan')
        with self.assertRaisesRegex(RecordsError, 'finite assistant-token'):
            verify_training_proof(train, reload, payload=self.calls[0])
        reload = deepcopy(result['reload'])
        reload['response']['adapter_identity'] = 'sha256:' + 'e' * 64
        with self.assertRaises(RecordsError):
            verify_training_proof(train, reload, payload=self.calls[0])

    def test_training_and_validation_share_token_weighting_not_example_mean(self):
        rows = [{'loss': 2.0, 'supervised_tokens': 1}, {'loss': 4.0, 'supervised_tokens': 3}]
        self.assertEqual(token_weighted_loss(rows), 3.5)
        for rows in ([], [{'loss': 2.0, 'supervised_tokens': 0}],
                     [{'loss': float('nan'), 'supervised_tokens': 1}],
                     [{'loss': float('inf'), 'supervised_tokens': 1}]):
            with self.subTest(rows=rows), self.assertRaises((ValueError, FloatingPointError)):
                token_weighted_loss(rows)

    def test_worker_requires_release_identity_disjoint_roles_and_binds_validation(self):
        result = self.run_case()
        payload = deepcopy(self.calls[0])
        model = Path(payload['model_path'])
        model.mkdir(parents=True)
        write_json_new(model / 'config.json', {'model_type': 'qwen3', 'vocab_size': 1000,
                                             'quantization': {'bits': 4, 'group_size': 64}})
        payload['checkpoint_dir'] = str(self.root / 'new-checkpoint')
        validate_payload(payload)
        before = checkpoint_config(payload)
        changed = deepcopy(payload)
        changed['validation_records'][0]['decoded_prompt'] += 'mutated'
        self.assertNotEqual(before['validation_records_sha256'], checkpoint_config(changed)['validation_records_sha256'])
        for update in ({'release_sha256': 'bad'}, {'validation_records': []},
                       {'validation_records': [payload['records'][0]]}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                validate_payload(payload | update)
        payload.pop('release_sha256')
        with self.assertRaises(ValueError):
            validate_payload(payload)


if __name__ == '__main__':
    unittest.main()
