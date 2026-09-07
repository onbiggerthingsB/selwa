from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch
import unittest

from ht_tibetan.cli import main, parser


class ReleaseCliTests(unittest.TestCase):
    def test_release_verification_requires_explicit_selected_purpose(self):
        with self.assertRaises(SystemExit), patch('sys.stderr', StringIO()):
            parser().parse_args(['verify-release', 'release'])
        args = parser().parse_args(['verify-release', 'release', '--purpose', 'train', '--purpose', 'validation'])
        self.assertEqual(args.purpose, ['train', 'validation'])
        self.assertFalse(args.offline_integrity_only)

    def test_training_and_evaluation_propagate_failure_without_writing_directory_as_json(self):
        for command, target, extra in (
            ('train-release', 'ht_tibetan.release_training.run_release_training', ['--candidate', 'qwen3-4b-mlx-4bit']),
            ('evaluate-release', 'ht_tibetan.evaluation.run_evaluation', ['--config', 'evaluation.json'])):
            with self.subTest(command=command), patch(target, return_value={'outcome': 'failed'}) as run, redirect_stdout(StringIO()):
                code = main([command, 'release', '--permissions', 'permissions.json', '--lock', 'lock.json',
                             '--output', '/unused/new-run', *extra])
                self.assertEqual(code, 2)
                run.assert_called_once()

    def test_new_evaluation_forwards_explicit_preregistered_study(self):
        with patch('ht_tibetan.evaluation.run_evaluation', return_value={'outcome': 'completed'}) as run, redirect_stdout(StringIO()):
            code = main(['evaluate-release', 'release', '--permissions', 'permissions.json', '--lock', 'lock.json',
                         '--config', 'evaluation.json', '--study', 'study.json', '--output', '/unused/new-run'])
        self.assertEqual(code, 0)
        self.assertEqual(run.call_args.kwargs['study_path'], Path('study.json'))

    def test_verification_does_not_echo_raw_training_payloads(self):
        report = {'valid': True, 'dataset': {'secret': 'raw contribution'}, 'datasets': {},
                  'current_eligibility_checked': False}
        output = StringIO()
        with patch('ht_tibetan.releases.verify_release', return_value=report) as verify, redirect_stdout(output):
            code = main(['verify-release', 'release', '--purpose', 'train', '--offline-integrity-only'])
        self.assertEqual(code, 0)
        self.assertFalse(verify.call_args.kwargs['recheck_current'])
        self.assertNotIn('raw contribution', output.getvalue())

    def test_structured_agreement_input_is_loaded_as_data(self):
        data = {'kind': 'reviewer_agreement_pilot'}
        with patch('ht_tibetan.records.load_dataset', return_value=data), \
             patch('ht_tibetan.study.analyze_agreement', return_value={}) as analyze, redirect_stdout(StringIO()):
            self.assertEqual(main(['analyze-agreement', 'pilot.json']), 0)
        self.assertEqual(analyze.call_args.args[0], data)
        self.assertEqual(analyze.call_args.kwargs, {'study': None, 'supplement': None})

    def test_default_study_is_valid_but_not_preregistered(self):
        from ht_tibetan.records import load_dataset
        from ht_tibetan.study import validate_study
        path = Path(__file__).resolve().parents[2] / 'config/study.template.json'
        report = validate_study(load_dataset(path))
        self.assertTrue(report['valid'], report)
        self.assertFalse(report['ready_for_evaluation'])
        self.assertIn('community', report['missing_preregistration_fields'])

    def test_plan_reports_study_mismatch_as_nonzero_without_executing(self):
        from test_evaluation_plan import config_fixture
        from test_study import study_fixture
        study = study_fixture()
        study['pilot']['expected_item_ids'][0] = 'not-in-this-run'
        with patch('ht_tibetan.records.load_dataset', side_effect=[config_fixture(), study]), \
             patch('ht_tibetan.evaluation.run_evaluation') as run, redirect_stdout(StringIO()):
            code = main(['plan-evaluation', 'evaluation.json', '--study', 'study.json'])
        self.assertEqual(code, 2)
        run.assert_not_called()

    def test_offline_form_requires_separate_key_and_does_not_overwrite_html_with_json(self):
        argv = ['evaluation-review-form', 'packet.json', '--study', 'study.json',
                '--report', 'report.json', '--output', '/unused/reviewer.html']
        with self.assertRaises(SystemExit), patch('sys.stderr', StringIO()):
            parser().parse_args(argv)
        with patch('ht_tibetan.evaluation_review_form.export_evaluation_review_form',
                   return_value={'approval_granted': False}) as export, redirect_stdout(StringIO()):
            self.assertEqual(main([*argv, '--key', 'key.json']), 0)
        self.assertEqual(export.call_args.args, (Path('packet.json'), Path('/unused/reviewer.html')))
        self.assertEqual(export.call_args.kwargs, {'study_path': Path('study.json'),
            'report_path': Path('report.json'), 'key_path': Path('key.json')})
