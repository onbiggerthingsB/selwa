"""Pre-execution configuration checks; fabricated study declarations only."""
from copy import deepcopy
import unittest
from unittest.mock import patch

from ht_tibetan.evaluation_plan import build_evaluation_plan, validate_evaluation_study, case_id_for
from ht_tibetan.records import RecordsError
from test_study import study_fixture, CID, OTHER


def config_fixture():
    study = study_fixture()
    return {"schema_version": "1.0", "run_id": "test-evaluation", "purpose": "development_screen",
            "conditions": [deepcopy(study["condition"])], "arms": [
                {"candidate_id": cid, "arm_id": "base", "checkpoint_dir": None} for cid in (CID, OTHER)],
            "example_ids": [f"example-{index}" for index in range(5)], "seed": 0, "timeout_seconds": 20}


class EvaluationPlanTests(unittest.TestCase):
    def test_planning_has_no_dataset_model_or_authorization_side_effect(self):
        config = config_fixture()
        before = deepcopy(config)
        with patch('ht_tibetan.records.load_dataset', side_effect=AssertionError('No file reads')), \
             patch('ht_tibetan.acquisition.verify_snapshot', side_effect=AssertionError('No model checks')), \
             patch('ht_tibetan.exposure_inventory.reserve_exposure', side_effect=AssertionError('No exposure')):
            plan = build_evaluation_plan(config, study=study_fixture())
        self.assertEqual(config, before)
        self.assertEqual(plan['planned_output_count'], 10)
        self.assertEqual(plan['distinct_example_id_count'], 5)
        self.assertIsNone(plan['independent_source_count'])
        self.assertTrue(plan['study_alignment']['valid'])
        for key in ('model_executed', 'dataset_opened', 'exposure_reserved', 'evaluation_authorized',
                    'training_authorized', 'pilot_cases_selected'):
            self.assertFalse(plan[key], key)

    def test_order_and_identity_bind_candidate_example_and_instruction_changes(self):
        config = config_fixture()
        plan = build_evaluation_plan(config)
        rows = plan['planned_cases']
        self.assertEqual([(row['case_id'], row['candidate_id'], row['example_id']) for row in rows[:3]],
            [('test-evaluation-0001', CID, 'example-0'), ('test-evaluation-0002', OTHER, 'example-0'),
             ('test-evaluation-0003', CID, 'example-1')])
        config['arms'].reverse()
        changed = build_evaluation_plan(config)
        self.assertNotEqual(plan['config_sha256'], changed['config_sha256'])
        self.assertEqual(changed['planned_cases'][0]['candidate_id'], OTHER)
        config['conditions'][0]['instruction_text'] += ' Another explicit instruction.'
        self.assertNotEqual(changed['condition_identities'], build_evaluation_plan(config)['condition_identities'])

    def test_wrong_pilot_ids_and_missing_base_fail_before_execution(self):
        for change, code in ((lambda c: c.update(run_id='different-run'), 'pilot_cases_not_planned'),
                             (lambda c: c['arms'].pop(), 'missing_registered_base')):
            config = config_fixture()
            change(config)
            plan = build_evaluation_plan(config, study=study_fixture())
            self.assertIn(code, [item['code'] for item in plan['study_alignment']['issues']])
            with self.assertRaisesRegex(RecordsError, code):
                validate_evaluation_study(config, study_fixture())

    def test_final_and_validation_evaluations_do_not_reuse_development_pilot_roster(self):
        for purpose in ('validation', 'final_test'):
            config = config_fixture()
            config.update(purpose=purpose, run_id='later-selected-model-evaluation')
            config['arms'] = config['arms'][:1]
            plan = build_evaluation_plan(config, study=study_fixture())
            self.assertTrue(plan['study_alignment']['valid'])
            self.assertFalse(plan['study_alignment']['pilot_roster_checked'])
            validate_evaluation_study(config, study_fixture())

    def test_draft_unknowns_remain_unready_without_mutation(self):
        study = study_fixture()
        study.update(status='draft', community=None)
        before = deepcopy(study)
        plan = build_evaluation_plan(config_fixture(), study=study)
        self.assertTrue(plan['study_alignment']['study_valid'])
        self.assertFalse(plan['study_alignment']['study_ready_for_evaluation'])
        self.assertIn('community', plan['study_alignment']['missing_preregistration_fields'])
        self.assertEqual(study, before)
        with self.assertRaisesRegex(RecordsError, 'preregistered'):
            validate_evaluation_study(config_fixture(), study)

    def test_condition_mismatch_and_unregistered_candidate_are_visible(self):
        config, study = config_fixture(), study_fixture()
        config['conditions'][0]['instruction_text'] += ' changed'
        self.assertIn('condition_mismatch', [item['code'] for item in build_evaluation_plan(config, study=study)['study_alignment']['issues']])
        config = config_fixture()
        study['candidate_ids'] = [CID]
        self.assertIn('unregistered_candidate', [item['code'] for item in build_evaluation_plan(config, study=study)['study_alignment']['issues']])

    def test_future_registration_cannot_start_evaluation(self):
        study = study_fixture()
        study['registered_at'] = '2099-01-01T00:00:00Z'
        with self.assertRaisesRegex(RecordsError, 'future'):
            validate_evaluation_study(config_fixture(), study)

    def test_stable_case_ids_cannot_hide_changed_preregistered_mapping(self):
        from ht_tibetan.records import record_sha256
        study = study_fixture()
        config = config_fixture()
        study['development_config_sha256'] = record_sha256(config)
        original = build_evaluation_plan(config, study=study)
        validate_evaluation_study(config, study)
        for field in ('arms', 'example_ids'):
            changed = deepcopy(config)
            changed[field].reverse()
            new_plan = build_evaluation_plan(changed, study=study)
            self.assertEqual([item['case_id'] for item in original['planned_cases']],
                             [item['case_id'] for item in new_plan['planned_cases']])
            self.assertFalse(new_plan['study_alignment']['valid'])
            with self.assertRaisesRegex(RecordsError, 'development_config_changed'):
                validate_evaluation_study(changed, study)

    def test_invalid_config_and_sequence_are_refused(self):
        config = config_fixture()
        config['timeout_seconds'] = 301
        with self.assertRaises(RecordsError):
            build_evaluation_plan(config)
        for sequence in (0, 401, True):
            with self.assertRaises(RecordsError):
                case_id_for(config_fixture(), sequence)
