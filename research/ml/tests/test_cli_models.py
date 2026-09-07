from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ht_tibetan.cli import main, parser


class ModelCliTests(unittest.TestCase):
    def test_acquisition_defaults_to_tokenizer_only(self):
        args=parser().parse_args(['acquire','--lock','catalog.json','--candidate','qwen3-4b-mlx-4bit'])
        self.assertFalse(args.weights)

    def test_audit_never_loads_an_unverified_snapshot(self):
        bad={'valid':False,'errors':[{'path':'config.json','message':'hash mismatch'}],'identity':None}
        with patch('ht_tibetan.acquisition.verify_snapshot',return_value=bad), \
             patch('ht_tibetan.token_audit.load_local_tokenizer') as loader, redirect_stdout(StringIO()):
            code=main(['audit-tokens','cases.json','--lock','catalog.json','--candidate','qwen3-4b-mlx-4bit','--snapshot','missing'])
        self.assertEqual(code,2)
        loader.assert_not_called()

    def test_failed_run_manifest_produces_nonzero_cli_status_without_overwriting_directory(self):
        with tempfile.TemporaryDirectory() as d, \
             patch('ht_tibetan.baseline.run_baseline',return_value={'outcome':'failed','cases':[]}), \
             redirect_stdout(StringIO()):
            code=main(['run-baseline','dataset.json','--config','config.json','--lock','catalog.json','--output',d])
            self.assertEqual(code,2)
            self.assertEqual(list(Path(d).iterdir()),[])


if __name__=='__main__': unittest.main()
