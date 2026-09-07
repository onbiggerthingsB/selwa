import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from dataclasses import asdict

from ht_tibetan.inference import InferenceRequest, InferenceResult
from ht_tibetan.mlx_backend import run_local_inference, validate_local_request, validate_worker_response

IDENTITY='owner/model@'+'a'*40


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.model=Path(self.tmp.name)
        (self.model/'config.json').write_text(json.dumps({'model_type':'qwen3'}))
        self.request=InferenceRequest('case-1','prompt',max_output_tokens=8,timeout_seconds=1)

    def test_rejects_remote_paths_custom_model_code_and_unpinned_identity(self):
        with self.assertRaises((OSError,ValueError)):
            validate_local_request(self.request,'owner/remote',IDENTITY,[1],0,0)
        with self.assertRaises(ValueError):
            validate_local_request(self.request,self.model,'owner/model@main',[1],0,0)
        (self.model/'config.json').write_text(json.dumps({'model_type':'qwen3','model_file':'execute.py'}))
        with self.assertRaises(ValueError):
            validate_local_request(self.request,self.model,IDENTITY,[1],0,0)

    def test_rejects_invalid_tokens_seed_and_sampling_before_process_creation(self):
        for tokens,seed,temp in (([True],0,0),([-1],0,0),([],0,0),([1],True,0),([1],2**32,0),([1],0,0.5)):
            with self.subTest(tokens=tokens,seed=seed,temp=temp), self.assertRaises(ValueError):
                validate_local_request(self.request,self.model,IDENTITY,tokens,seed,temp)

    def test_worker_identity_limit_and_completion_mismatches_fail(self):
        base={'result':asdict(InferenceResult('case-1','success','yes','stop',IDENTITY,input_tokens=1,output_tokens=2)),
              'raw_output':'yes','measurements':{}}
        self.assertEqual(validate_worker_response(base,self.request,IDENTITY,[1]),base)
        for field,value in (('run_id','another'),('model_identity','other/model@'+'b'*40),('output_tokens',9),
                            ('input_tokens',2),('termination_reason','length'),('synthetic',True)):
            bad=json.loads(json.dumps(base));bad['result'][field]=value
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_worker_response(bad,self.request,IDENTITY,[1])

    def test_timeout_terminates_process_and_never_returns_an_answer(self):
        with patch('ht_tibetan.mlx_backend.subprocess.Popen') as popen:
            process=popen.return_value.__enter__.return_value
            process.wait.side_effect=[subprocess.TimeoutExpired('worker',1),0]
            result=run_local_inference(self.request,model_path=self.model,model_identity=IDENTITY,prompt_token_ids=[1])
            process.terminate.assert_called_once()
            self.assertEqual(result['result']['outcome'],'timeout')
            self.assertIsNone(result['result']['answer'])
            environment=popen.call_args.kwargs['env']
            self.assertEqual(environment['HF_HUB_OFFLINE'],'1')
            self.assertEqual(environment['TRANSFORMERS_OFFLINE'],'1')

    def test_cancellation_terminates_without_turning_it_into_runtime_success(self):
        with patch('ht_tibetan.mlx_backend.subprocess.Popen') as popen:
            process=popen.return_value.__enter__.return_value
            process.wait.side_effect=[KeyboardInterrupt(),0]
            result=run_local_inference(self.request,model_path=self.model,model_identity=IDENTITY,prompt_token_ids=[1])
            process.terminate.assert_called_once()
            self.assertEqual(result['result']['outcome'],'cancelled')
            self.assertIsNone(result['result']['answer'])

    def test_missing_worker_output_is_a_failure(self):
        with patch('ht_tibetan.mlx_backend.subprocess.Popen') as popen:
            process=popen.return_value.__enter__.return_value
            process.wait.return_value=0;process.returncode=0
            result=run_local_inference(self.request,model_path=self.model,model_identity=IDENTITY,prompt_token_ids=[1])
            self.assertEqual(result['result']['termination_reason'],'invalid_worker_response')
            self.assertIsNone(result['result']['answer'])


if __name__=='__main__': unittest.main()
