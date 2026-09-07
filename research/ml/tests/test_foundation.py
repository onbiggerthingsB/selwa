import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ht_tibetan.artifacts import hash_file, write_json_new
from ht_tibetan.inference import FakeInference, InferenceRequest, InferenceResult
from ht_tibetan.preflight import GIB, storage_budget, inspect
from ht_tibetan.cli import main


class FoundationTests(unittest.TestCase):
    def test_disk_projection_includes_reserve_and_rejects_bad_values(self):
        self.assertTrue(storage_budget(35*GIB,20*GIB)['within_budget'])
        self.assertFalse(storage_budget(35*GIB,20*GIB+1)['within_budget'])
        for bad in (-1, 0.5, True):
            with self.assertRaises(ValueError): storage_budget(35*GIB,bad)

    def test_preflight_does_not_create_missing_root_or_claim_model_fit(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/'new'/'root'
            with patch('ht_tibetan.preflight._sysctl',return_value=None):
                result=inspect(root,0,0)
            self.assertFalse(root.exists())
            self.assertIsNone(result['hardware']['memory_bytes'])
            self.assertEqual(result['model_fit'],'not_tested')
            self.assertEqual(result['metal_execution'],'not_tested')

    def test_failure_states_never_become_answers_or_token_measurements(self):
        request=InferenceRequest('run-1','Hello')
        for outcome in ('timeout','cancelled','context_overflow','runtime_failure'):
            result=FakeInference(outcome).generate(request)
            self.assertIsNone(result.answer)
            self.assertTrue(result.synthetic)
            self.assertIsNone(result.input_tokens)
            self.assertEqual(result.run_id,request.run_id)
        with self.assertRaises(ValueError):
            InferenceResult('r','timeout','plausible but wrong','timeout','m')
        with self.assertRaises(ValueError):
            InferenceResult('r','success','','stop','m')

    def test_request_bounds(self):
        for kwargs in ({'max_output_tokens':True},{'timeout_seconds':float('nan')},{'timeout_seconds':0}):
            with self.assertRaises(ValueError): InferenceRequest('r','hello',**kwargs)
        with self.assertRaises(ValueError): InferenceRequest('r',' ')

    def test_artifact_refuses_overwrite_and_preserves_unicode(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'run.json'
            write_json_new(p,{'text':'ཀ་ ཁ།  '})
            old=hash_file(p)
            with self.assertRaises(FileExistsError): write_json_new(p,{'text':'changed'})
            self.assertEqual(hash_file(p),old)
            self.assertEqual(json.loads(p.read_text())['text'],'ཀ་ ཁ།  ')
            self.assertEqual(list(Path(d).glob('.ht-*')),[])

    def test_fake_cli_writes_real_fixture_with_nonzero_failure_exit(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'result.json'
            with patch('sys.stdout'):
                code=main(['fake-inference','--run-id','demo','--outcome','timeout','--output',str(p)])
            self.assertEqual(code,2)
            self.assertIsNone(json.loads(p.read_text())['answer'])

class ProvenanceTests(unittest.TestCase):
    def test_result_rejects_wrong_provenance_and_measurement_types(self):
        base=dict(run_id='r',outcome='success',answer='answer',termination_reason='stop',model_identity='m')
        for bad in ({'run_id':True},{'model_identity':42},{'termination_reason':[]},
                    {'adapter_identity':7},{'elapsed_seconds':True},{'synthetic':'false'}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                InferenceResult(**(base | bad))

    def test_manifest_binds_package_code_independently_of_calling_directory(self):
        from ht_tibetan.artifacts import make_manifest
        import os
        with tempfile.TemporaryDirectory() as d:
            previous=Path.cwd()
            try:
                os.chdir(d)
                result=make_manifest('r','fixture',[],{},'completed')
            finally:
                os.chdir(previous)
        self.assertTrue(result['code']['content_sha256'])
        self.assertTrue(any(f['name']=='ht_tibetan/artifacts.py' for f in result['code']['files']))
        self.assertEqual(result['evidence_type'],'infrastructure_manifest')


if __name__ == '__main__': unittest.main()
