from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from ht_tibetan.artifacts import write_json_new
from ht_tibetan.cli import parser
from ht_tibetan.training_mechanics import (GIB, DEFAULT_RESERVE, MAX_RSS, MAX_SWAP_GROWTH,
    parse_swap_used, resource_violation, supervise_worker, validate_output_path)


SAMPLE = {'free_disk_bytes': 22 * GIB, 'swap_used_bytes': 5 * GIB,
          'worker_rss_bytes': 3 * GIB, 'pressure_level': 1}
IDENTITY = 'owner/model@' + 'a' * 40


class FinishedProcess:
    pid = 42
    returncode = 0

    def poll(self):
        return self.returncode


class RunningProcess(FinishedProcess):
    returncode = None

    def __init__(self):
        self.terminated = False

    def terminate(self):
        self.terminated = True
        self.returncode = -15

    def wait(self, timeout):
        if self.returncode is None:
            raise subprocess.TimeoutExpired('worker', timeout)
        return self.returncode


class TrainingMechanicsTests(unittest.TestCase):
    def test_swap_units_and_unavailable(self):
        self.assertEqual(parse_swap_used('total = 8000.00M used = 5120.00M free = 2880.00M'), 5 * GIB)
        self.assertEqual(parse_swap_used('used = 1.5G'), int(1.5 * GIB))
        for value in (None, '', 'permission denied', 'used = unknown', 'used = 100'):
            self.assertIsNone(parse_swap_used(value))

    def test_each_resource_stop_and_boundary(self):
        self.assertIsNone(resource_violation(SAMPLE, SAMPLE))
        for field, value, reason in (
            ('free_disk_bytes', DEFAULT_RESERVE - 1, 'disk_reserve'),
            ('swap_used_bytes', SAMPLE['swap_used_bytes'] + MAX_SWAP_GROWTH + 1, 'swap_growth'),
            ('worker_rss_bytes', MAX_RSS + 1, 'worker_rss'),
            ('pressure_level', 4, 'critical_memory_pressure'),
            ('swap_used_bytes', None, 'swap_telemetry_unavailable'),
        ):
            with self.subTest(reason=reason):
                self.assertEqual(resource_violation({**SAMPLE, field: value}, SAMPLE), reason)
        self.assertIsNone(resource_violation({**SAMPLE, 'free_disk_bytes': DEFAULT_RESERVE,
            'swap_used_bytes': SAMPLE['swap_used_bytes'] + MAX_SWAP_GROWTH,
            'worker_rss_bytes': MAX_RSS}, SAMPLE))

    def test_unknown_initial_swap_does_not_become_zero(self):
        self.assertEqual(resource_violation(SAMPLE, {**SAMPLE, 'swap_used_bytes': None}),
                         'swap_telemetry_unavailable')

    def test_timeout_stops_child_and_preserves_incomplete_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, process = Path(tmp).resolve(), RunningProcess()
            with patch('ht_tibetan.training_mechanics.subprocess.Popen', return_value=process), \
                 patch('ht_tibetan.training_mechanics.sample_resources', return_value=SAMPLE):
                result = supervise_worker({'model_identity': IDENTITY, 'mode': 'train'}, root / 'worker',
                    timeout_seconds=.000000001, initial_resources=SAMPLE, resource_root=root)
            self.assertTrue(process.terminated)
            self.assertEqual(result['outcome'], 'failed')
            self.assertEqual(result['stop_reason'], 'timeout')
            self.assertIsNone(result['response'])
            self.assertTrue((root / 'worker/request.json').exists())
            self.assertTrue((root / 'worker/supervisor.json').exists())
            self.assertEqual((root / 'worker/worker.log').stat().st_mode & 0o777, 0o600)

    def test_memory_limit_stops_worker(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, process = Path(tmp).resolve(), RunningProcess()
            with patch('ht_tibetan.training_mechanics.subprocess.Popen', return_value=process), \
                 patch('ht_tibetan.training_mechanics.sample_resources',
                       return_value={**SAMPLE, 'worker_rss_bytes': MAX_RSS + 1}):
                result = supervise_worker({'model_identity': IDENTITY, 'mode': 'train'}, root / 'worker',
                    timeout_seconds=30, initial_resources=SAMPLE, resource_root=root)
            self.assertTrue(process.terminated)
            self.assertEqual(result['stop_reason'], 'worker_rss')

    def test_keyboard_interrupt_stops_worker_and_never_reports_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, process = Path(tmp).resolve(), RunningProcess()
            with patch('ht_tibetan.training_mechanics.subprocess.Popen', return_value=process), \
                 patch('ht_tibetan.training_mechanics.sample_resources', side_effect=[KeyboardInterrupt(), SAMPLE]):
                result = supervise_worker({'model_identity': IDENTITY, 'mode': 'train'}, root / 'worker',
                    timeout_seconds=30, initial_resources=SAMPLE, resource_root=root)
            self.assertTrue(process.terminated)
            self.assertEqual(result['outcome'], 'failed')
            self.assertEqual(result['stop_reason'], 'interrupted')
            self.assertIsNone(result['response'])

    def test_missing_live_rss_stops_worker(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, process = Path(tmp).resolve(), RunningProcess()
            with patch('ht_tibetan.training_mechanics.subprocess.Popen', return_value=process), \
                 patch('ht_tibetan.training_mechanics.sample_resources',
                       return_value={**SAMPLE, 'worker_rss_bytes': None}):
                result = supervise_worker({'model_identity': IDENTITY, 'mode': 'train'}, root / 'worker',
                    timeout_seconds=30, initial_resources=SAMPLE, resource_root=root)
            self.assertTrue(process.terminated)
            self.assertEqual(result['stop_reason'], 'rss_telemetry_unavailable')

    def test_malformed_or_wrong_identity_output_is_not_success(self):
        for response in ({'mode': 'train', 'outcome': 'success', 'model_identity': 'wrong'},
                         {'mode': 'reload', 'outcome': 'success', 'model_identity': IDENTITY},
                         {'mode': 'train', 'outcome': 'looks_good', 'model_identity': IDENTITY}, []):
            with self.subTest(response=response), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp).resolve()

                def start(command, **kwargs):
                    self.assertEqual(kwargs['env']['HF_HUB_OFFLINE'], '1')
                    self.assertEqual(kwargs['env']['TRANSFORMERS_OFFLINE'], '1')
                    write_json_new(Path(command[-1]) / 'response.json', response)
                    return FinishedProcess()

                with patch('ht_tibetan.training_mechanics.subprocess.Popen', side_effect=start), \
                     patch('ht_tibetan.training_mechanics.sample_resources', return_value=SAMPLE):
                    result = supervise_worker({'model_identity': IDENTITY, 'mode': 'train'}, root / 'worker',
                        timeout_seconds=30, initial_resources=SAMPLE, resource_root=root)
                self.assertEqual(result['outcome'], 'failed')
                self.assertEqual(result['stop_reason'], 'invalid_worker_response')

    def test_existing_output_and_invalid_deadline_rejected_before_dispatch(self):
        with tempfile.TemporaryDirectory() as tmp, \
             patch('ht_tibetan.training_mechanics.subprocess.Popen') as start:
            root = Path(tmp).resolve()
            for deadline in (0, -1, True, float('nan'), 601):
                with self.subTest(deadline=deadline), self.assertRaises(ValueError):
                    supervise_worker({}, root / 'worker', timeout_seconds=deadline,
                                     initial_resources=SAMPLE, resource_root=root)
            with self.assertRaises(FileExistsError):
                supervise_worker({}, root, timeout_seconds=1, initial_resources=SAMPLE, resource_root=root)
            start.assert_not_called()

    def test_cli_is_explicit_and_does_not_accept_a_contributor_dataset(self):
        args = parser().parse_args(['train-mechanics', '--lock', 'lock.json', '--candidate',
                                   'gemma3-4b-it-mlx-4bit', '--output', 'run'])
        self.assertEqual(args.steps, 20)
        self.assertFalse(hasattr(args, 'dataset'))

    def test_output_cannot_escape_private_runs_via_parent_or_link(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            (root / 'runs').mkdir()
            self.assertEqual(validate_output_path(root, root / 'runs' / 'new'), (root, root / 'runs' / 'new'))
            (root / 'runs' / 'linked').symlink_to(root, target_is_directory=True)
            for output in (root / 'runs' / '..' / '..' / 'escaped', root / 'runs',
                           root / 'other', root / 'runs' / 'linked' / 'new'):
                with self.subTest(output=output), self.assertRaises(ValueError):
                    validate_output_path(root, output)

    def test_desktop_root_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            pretend_home = Path(tmp).resolve()
            root = pretend_home / 'Desktop' / 'research'
            root.mkdir(parents=True)
            with patch('ht_tibetan.training_mechanics.Path.home', return_value=pretend_home):
                with self.assertRaises(ValueError):
                    validate_output_path(root, root / 'runs' / 'new')


if __name__ == '__main__':
    unittest.main()
