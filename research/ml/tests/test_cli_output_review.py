from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
import unittest
from unittest.mock import patch

from ht_tibetan.cli import main, parser
from ht_tibetan.records import RecordsError


class OutputReviewCliTests(unittest.TestCase):
    def test_import_requires_explicit_evidence_kind_and_independence(self):
        args = ['import-output-review', 'original.json', 'returned.json', '--key', 'key.json', '--output', 'import.json']
        with redirect_stderr(StringIO()), self.assertRaises(SystemExit):
            parser().parse_args(args)
        declared = parser().parse_args(args + ['--evidence-kind', 'synthetic_test', '--no-independent'])
        self.assertFalse(declared.independent)
        self.assertEqual(declared.evidence_kind, 'synthetic_test')

    def test_incomplete_freeze_returns_nonzero_without_creating_a_result(self):
        out, err = StringIO(), StringIO()
        with patch('ht_tibetan.output_review.freeze_output_reviews', side_effect=RecordsError('Incomplete review.')), \
             redirect_stdout(out), redirect_stderr(err):
            code = main(['freeze-output-reviews', 'run', 'data.json', '--review', 'a.json',
                         '--review', 'b.json', '--output', 'frozen.json'])
        self.assertEqual(code, 2)
        self.assertEqual(out.getvalue(), '')
        self.assertIn('Incomplete review', err.getvalue())

    def test_adjudication_cli_prints_only_operation_summary(self):
        out = StringIO()
        summary = {'status': 'recorded_with_unresolved_cases', 'evidence_kind': 'synthetic_test',
                   'input_evidence_type': 'infrastructure_smoke', 'approval_granted': False, 'model_selected': None}
        with patch('ht_tibetan.output_review.adjudicate_output_reviews', return_value=summary) as mocked, \
             redirect_stdout(out):
            code = main(['adjudicate-output-reviews', 'frozen.json', 'decisions.json', '--output', 'record.json'])
        self.assertEqual(code, 0)
        self.assertEqual(mocked.call_count, 1)
        self.assertNotIn('source_text', out.getvalue())
        self.assertNotIn('ratings', out.getvalue())


if __name__ == '__main__':
    unittest.main()
