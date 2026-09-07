from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ht_tibetan.cli import main, parser
from ht_tibetan.records import atomic_write_json
from test_parallel import synthetic_pair


class PairedCliTests(unittest.TestCase):
    def test_validate_parallel_reports_plumbing_without_model_dispatch(self):
        dataset, parallel = synthetic_pair()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            atomic_write_json(root/'dataset.json', dataset)
            atomic_write_json(root/'parallel.json', parallel)
            with redirect_stdout(StringIO()) as output:
                code = main(['validate-parallel', str(root/'dataset.json'), str(root/'parallel.json'),
                    '--purpose', 'infrastructure_smoke', '--pair-id', 'synthetic-pair-1'])
            self.assertEqual(code, 0)
            self.assertIn('parallel_material_sha256', output.getvalue())
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                code = main(['validate-parallel', str(root/'dataset.json'), str(root/'parallel.json'),
                    '--purpose', 'language_baseline', '--pair-id', 'synthetic-pair-1'])
            self.assertEqual(code, 2)

    def test_run_baseline_forwards_explicit_parallel_file(self):
        with patch('ht_tibetan.baseline.run_baseline', return_value={'outcome':'failed'}) as runner, redirect_stdout(StringIO()):
            code = main(['run-baseline', 'dataset.json', '--config', 'config.json', '--lock', 'models.json',
                         '--parallel', 'parallel.json', '--output', 'new-run'])
        self.assertEqual(code, 2)
        self.assertEqual(runner.call_args.kwargs['parallel_path'], Path('parallel.json'))
        self.assertIsNone(parser().parse_args(['run-baseline', 'data', '--config', 'config', '--lock', 'lock', '--output', 'run']).parallel)


if __name__ == '__main__':
    unittest.main()
