"""Offline tests: fake public bytes only; no model imports or network calls."""
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from ht_tibetan.acquisition import (CHUNK_BYTES, RECEIPT_NAME, SCRATCH_MIN_BYTES,
    _PublicRedirects, _rename_no_replace, _public_download, acquire_snapshot, verify_snapshot)
from urllib.request import Request


class AcquisitionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / 'private-model-data'
        self.lock = self.base / 'models.lock.json'
        self.candidate = 'candidate-4bit'
        self.revision = 'a' * 40
        self.repository = 'example/model'
        self.payloads = {
            'config.json': b'{"model_type":"fixture"}',
            'tokenizer_config.json': b'{"tokenizer_class":"fixture"}',
            'tokenizer.json': b'{"fixture":"tokenizer bytes"}',
            'chat_template.json': b'{"chat_template":"fixture only"}',
            'README.md': b'Synthetic fixture, not a real model.',
            'model.safetensors': b'FAKE-SAFETENSORS-FIXTURE',
            'model.safetensors.index.json': b'{"weight_map":{}}',
            'processor_config.json': b'{}',
            'unsafe.py': b'raise RuntimeError("must never be executed")',
        }
        inventory = []
        for name, data in self.payloads.items():
            lfs = name in ('model.safetensors', 'tokenizer.json')
            inventory.append({'path': name, 'size_bytes': len(data),
                'git_blob_sha1': 'b' * 40 if lfs else hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest(),
                'lfs_sha256': hashlib.sha256(data).hexdigest() if lfs else None,
                'content_sha256': hashlib.sha256(data).hexdigest() if name == 'config.json' else None})
        self.catalogue = {'schema_version':'1.0', 'candidates':[
            {'candidate_id': self.candidate, 'repository':self.repository, 'revision':self.revision}],
            'repositories':[{'repository':self.repository, 'revision':self.revision, 'files':inventory}]}
        self.write_lock()
        self.urls = []
        self.free = lambda _path: 100 * 1024 ** 3

    def write_lock(self):
        self.lock.write_text(json.dumps(self.catalogue), encoding='utf-8')

    def download(self, url, spec):
        self.urls.append(url)
        data = self.payloads[spec['path']]
        for offset in range(0, len(data), 7):
            yield data[offset:offset+7]

    def acquire(self, **kwargs):
        return acquire_snapshot(self.lock, self.candidate, self.root,
                                downloader=self.download, free_bytes=self.free, **kwargs)

    def snapshot(self, mode='tokenizer'):
        return self.root / 'models' / self.candidate / self.revision / mode

    def assert_no_stage(self):
        self.assertEqual(list(self.root.rglob('*staging*')) if self.root.exists() else [], [])

    def test_tokenizer_selection_pins_urls_and_records_locally_measured_hashes(self):
        result = self.acquire()
        self.assertTrue(result['valid'])
        self.assertFalse(result['reused'])
        self.assertEqual(Path(result['snapshot_dir']), self.snapshot())
        self.assertEqual(result['identity']['mode'], 'tokenizer')
        names = {row['path'] for row in result['files']}
        self.assertEqual(names, {'config.json','tokenizer_config.json','tokenizer.json',
                                 'chat_template.json','README.md'})
        self.assertTrue(all(url.startswith(f'https://huggingface.co/{self.repository}/resolve/{self.revision}/')
                            for url in self.urls))
        tokenizer = next(row for row in result['files'] if row['path'] == 'tokenizer.json')
        self.assertNotEqual(tokenizer['git_blob_sha1'], 'b' * 40)
        self.assertEqual(tokenizer['content_sha256'], hashlib.sha256(self.payloads['tokenizer.json']).hexdigest())
        receipt = json.loads(Path(result['receipt_path']).read_text())
        self.assertFalse(receipt['credentials_read'])
        self.assertFalse(receipt['terms_acceptance_performed'])
        self.assertEqual(receipt['model_quality'], 'not_tested')
        self.assert_no_stage()

    def test_weight_selection_is_explicit_and_excludes_repository_code(self):
        result = self.acquire(include_weights=True)
        names = {row['path'] for row in result['files']}
        self.assertIn('model.safetensors', names)
        self.assertIn('model.safetensors.index.json', names)
        self.assertIn('processor_config.json', names)
        self.assertNotIn('unsafe.py', names)
        self.assertEqual(result['identity']['mode'], 'model')
        self.assertTrue(verify_snapshot(self.lock,self.candidate,self.snapshot('model'),include_weights=True)['valid'])
        self.assertFalse(verify_snapshot(self.lock,self.candidate,self.snapshot('model'))['valid'])

    def test_existing_snapshot_is_fully_verified_and_reused_without_transfer(self):
        first = self.acquire()
        self.urls.clear()
        second = self.acquire()
        self.assertTrue(second['valid'])
        self.assertTrue(second['reused'])
        self.assertEqual(first['files'], second['files'])
        self.assertEqual(self.urls, [])

    def test_reuse_does_not_trust_receipt_when_payload_has_changed(self):
        self.acquire()
        path = self.snapshot() / 'tokenizer.json'
        path.write_bytes(b'x' * path.stat().st_size)
        self.urls.clear()
        result = verify_snapshot(self.lock,self.candidate,self.snapshot())
        self.assertFalse(result['valid'])
        self.assertIn('LFS payload SHA-256 mismatch',str(result['errors']))
        with self.assertRaisesRegex(ValueError, 'left unchanged'):
            self.acquire()
        self.assertEqual(self.urls, [])
        self.assertEqual(path.read_bytes(), b'x' * path.stat().st_size)

    def test_incomplete_directory_and_unexpected_file_are_never_repaired(self):
        self.snapshot().mkdir(parents=True)
        (self.snapshot() / 'do-not-delete').write_text('keep')
        with self.assertRaises(ValueError):
            self.acquire()
        self.assertEqual((self.snapshot() / 'do-not-delete').read_text(), 'keep')
        self.assertEqual(self.urls, [])

    def test_receipt_missing_or_changed_or_wrong_identity_fails_verification(self):
        self.acquire()
        receipt_path = self.snapshot() / RECEIPT_NAME
        original = receipt_path.read_bytes()
        for mutate in (
            lambda r:r.update(status='interrupted'),
            lambda r:r['identity'].update(revision='c'*40),
            lambda r:r['files'][0].update(content_sha256='0'*64),
        ):
            receipt = json.loads(original)
            mutate(receipt)
            receipt_path.write_text(json.dumps(receipt))
            self.assertFalse(verify_snapshot(self.lock,self.candidate,self.snapshot())['valid'])
        receipt_path.unlink()
        self.assertFalse(verify_snapshot(self.lock,self.candidate,self.snapshot())['valid'])

    def test_missing_or_extra_or_symlink_file_and_directory_are_rejected(self):
        self.acquire()
        for path in (self.snapshot()/'extra.py', self.snapshot()/'nested'):
            if path.name.endswith('.py'):
                path.write_text('do not execute')
            else:
                path.mkdir()
            self.assertFalse(verify_snapshot(self.lock,self.candidate,self.snapshot())['valid'])
            path.unlink() if path.is_file() else path.rmdir()
        external = self.base/'external'
        external.write_text('external')
        extra = self.snapshot()/'extra-link'
        extra.symlink_to(external)
        self.assertFalse(verify_snapshot(self.lock,self.candidate,self.snapshot())['valid'])
        extra.unlink()
        artifact = self.snapshot()/'README.md'
        artifact.unlink()
        artifact.symlink_to(external)
        self.assertFalse(verify_snapshot(self.lock,self.candidate,self.snapshot())['valid'])

    def test_root_or_artifact_ancestor_symlinks_are_rejected(self):
        external = self.base/'other'
        external.mkdir()
        self.root.symlink_to(external, target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'Symlink'):
            self.acquire()
        self.assertEqual(list(external.iterdir()), [])
        self.root.unlink()
        self.root.mkdir()
        (self.root/'models').symlink_to(external, target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'Symlink'):
            self.acquire()
        self.assertEqual(list(external.iterdir()), [])

    def test_lexical_desktop_root_is_refused_before_any_write(self):
        with patch('ht_tibetan.acquisition.Path.home',return_value=self.base):
            with self.assertRaisesRegex(ValueError,'outside Desktop'):
                acquire_snapshot(self.lock,self.candidate,self.base/'Desktop'/'models',
                                 downloader=self.download,free_bytes=self.free)
        self.assertFalse((self.base/'Desktop').exists())

    def test_insufficient_budget_aborts_before_transfer_or_directory_creation(self):
        self.free = lambda _path: SCRATCH_MIN_BYTES
        with self.assertRaisesRegex(ValueError,'reserve'):
            self.acquire(reserve_bytes=0)
        self.assertFalse(self.root.exists())
        self.assertEqual(self.urls, [])

    def test_storage_projection_includes_payload_and_scratch_in_addition_to_reserve(self):
        result = self.acquire(reserve_bytes=123)
        storage = result['storage']
        self.assertEqual(storage['reserve_bytes'],123)
        self.assertEqual(storage['projected_additional_bytes'],storage['payload_bytes']+storage['scratch_bytes'])
        self.assertGreaterEqual(storage['scratch_bytes'],SCRATCH_MIN_BYTES)
        self.assertEqual(storage['publication_duplicate_bytes'],0)

    def test_disk_drop_during_streaming_cleans_own_staging_without_publishing(self):
        calls = 0
        def free(_path):
            nonlocal calls
            calls += 1
            return 100*1024**3 if calls == 1 else 0
        self.free = free
        with self.assertRaisesRegex(ValueError,'during transfer'):
            self.acquire()
        self.assertFalse(self.snapshot().exists())
        self.assert_no_stage()

    def test_truncated_oversized_wrong_hash_and_bad_chunks_never_publish(self):
        for kind in ('short','long','hash','type','chunk_size'):
            with self.subTest(kind=kind):
                def bad(_url,spec):
                    data = self.payloads[spec['path']]
                    if kind == 'short': yield data[:-1]
                    elif kind == 'long': yield data + b'x'
                    elif kind == 'hash': yield b'x'*len(data)
                    elif kind == 'type': yield 'not bytes'
                    else: yield b'x'*(CHUNK_BYTES+1)
                with self.assertRaises(ValueError):
                    acquire_snapshot(self.lock,self.candidate,self.root,downloader=bad,free_bytes=self.free)
                self.assertFalse(self.snapshot().exists())
                self.assert_no_stage()

    def test_interruption_cleans_only_own_staging(self):
        parent = self.snapshot().parent
        parent.mkdir(parents=True)
        orphan = parent/'.tokenizer-staging-from-prior-abrupt-exit'
        orphan.mkdir()
        (orphan/'keep').write_text('keep')
        def interrupted(_url,_spec):
            raise KeyboardInterrupt()
            yield b'unreachable'
        with self.assertRaises(KeyboardInterrupt):
            acquire_snapshot(self.lock,self.candidate,self.root,downloader=interrupted,free_bytes=self.free)
        self.assertFalse(self.snapshot().exists())
        self.assertEqual(list(parent.glob('*staging*')), [orphan])
        self.assertEqual((orphan/'keep').read_text(),'keep')

    def test_os_publication_does_not_overwrite_even_an_empty_existing_directory(self):
        source, target = self.base/'source', self.base/'target'
        source.mkdir()
        (source/'file').write_text('payload')
        target.mkdir()
        with self.assertRaises(OSError):
            _rename_no_replace(source,target)
        self.assertTrue(source.is_dir())
        self.assertEqual(list(target.iterdir()),[])

    def test_concurrent_invalid_destination_is_preserved_and_own_stage_removed(self):
        native = _rename_no_replace
        def contender(source,target):
            target.mkdir()
            native(source,target)
        with patch('ht_tibetan.acquisition._rename_no_replace',side_effect=contender):
            with self.assertRaisesRegex(ValueError,'Concurrent destination'):
                self.acquire()
        self.assertEqual(list(self.snapshot().iterdir()),[])
        self.assert_no_stage()

    def test_invalid_catalogue_is_rejected_before_transfer(self):
        cases = [
            lambda c:c['candidates'][0].update(revision='main'),
            lambda c:c['candidates'][0].update(repository='https://evil.invalid/model'),
            lambda c:c['candidates'][0].update(repository='org/../model'),
            lambda c:c['repositories'][0]['files'][0].update(path='../config.json'),
            lambda c:c['repositories'][0]['files'][0].update(path='/config.json'),
            lambda c:c['repositories'][0]['files'][0].update(path='a\\config.json'),
            lambda c:c['repositories'][0]['files'][0].update(path='x//config.json'),
            lambda c:c['repositories'][0]['files'][0].update(path='a/%2e%2e/config.json'),
            lambda c:c['repositories'][0]['files'][0].update(size_bytes=True),
            lambda c:c['repositories'][0]['files'][0].update(size_bytes=-1),
            lambda c:c['repositories'][0]['files'][0].update(size_bytes=1.5),
            lambda c:c['repositories'][0]['files'][0].update(git_blob_sha1='not-a-hash'),
            lambda c:c['repositories'][0]['files'][0].update(content_sha256='f'*63),
            lambda c:c['repositories'][0]['files'][0].update(git_blob_sha1=None,lfs_sha256=None),
            lambda c:c['repositories'][0]['files'].append(dict(c['repositories'][0]['files'][0],path='CONFIG.JSON')),
            lambda c:c['candidates'].append(dict(c['candidates'][0])),
        ]
        original = copy.deepcopy(self.catalogue)
        for index, mutate in enumerate(cases):
            with self.subTest(case=index):
                self.catalogue = copy.deepcopy(original)
                mutate(self.catalogue)
                self.write_lock()
                with self.assertRaises(ValueError): self.acquire()
                self.assertFalse(verify_snapshot(self.lock,self.candidate,self.snapshot())['valid'])
                self.assertEqual(self.urls,[])
        self.assertFalse(self.root.exists())

    def test_duplicate_json_keys_and_missing_tokenizer_are_not_accepted(self):
        self.lock.write_text('{"schema_version":"1.0","schema_version":"1.0"}')
        with self.assertRaisesRegex(ValueError,'Duplicate'):
            self.acquire()
        self.catalogue['repositories'][0]['files'] = [row for row in self.catalogue['repositories'][0]['files']
                                                     if row['path'] != 'tokenizer.json']
        self.write_lock()
        with self.assertRaisesRegex(ValueError,'tokenizer payload'):
            self.acquire()

    def test_redirect_policy_rejects_http_foreign_hosts_credentials_and_ports(self):
        policy = _PublicRedirects()
        req = Request('https://huggingface.co/org/model/resolve/'+'a'*40+'/config.json')
        for url in ('http://huggingface.co/file','https://evil.invalid/file',
                    'https://user:pass@huggingface.co/file','https://huggingface.co:8443/file',
                    'https://huggingface.co.evil.invalid/file'):
            with self.subTest(url=url),self.assertRaises(ValueError):
                policy.redirect_request(req,None,302,'redirect',{},url)
        redirect = policy.redirect_request(req,None,302,'redirect',{},
                                            'https://cas-bridge.xethub.hf.co/path?opaque=signature')
        self.assertTrue(redirect.full_url.startswith('https://cas-bridge.xethub.hf.co/'))

    def test_default_transport_has_no_credentials_or_proxies_and_uses_timeout(self):
        class Response(io.BytesIO):
            status = 200
            headers = {'Content-Length':'3'}
            fp = SimpleNamespace(raw=SimpleNamespace(_sock=SimpleNamespace(settimeout=lambda seconds: None)))
        with patch('ht_tibetan.acquisition.build_opener') as factory:
            factory.return_value.open.return_value = Response(b'abc')
            result = b''.join(_public_download('https://huggingface.co/org/model/resolve/'+'a'*40+'/config.json',
                                               {'path':'config.json','size_bytes':3}))
            self.assertEqual(result,b'abc')
            handlers = factory.call_args.args
            self.assertEqual(handlers[0].proxies,{})
            req = factory.return_value.open.call_args.args[0]
            self.assertFalse(req.has_header('Authorization'))
            self.assertFalse(req.has_header('Proxy-Authorization'))
            self.assertEqual(req.get_header('Accept-encoding'),'identity')
            self.assertEqual(factory.return_value.open.call_args.kwargs['timeout'],30)

    def test_slow_drip_body_uses_read1_and_shrinks_socket_timeout_to_deadline(self):
        clock = [0.0]
        timeouts = []
        class Drip(io.BytesIO):
            status = 200
            headers = {'Content-Length':'100'}
            fp = SimpleNamespace(raw=SimpleNamespace(_sock=SimpleNamespace(settimeout=timeouts.append)))
            reads = 0
            def read(self, _size=-1):
                raise AssertionError('A filling read can drip indefinitely')
            def read1(self, _size=-1):
                self.reads += 1
                clock[0] += 1.0
                return b'x'
        response = Drip()
        with patch('ht_tibetan.acquisition.build_opener') as factory, \
             patch('ht_tibetan.acquisition.time.monotonic',side_effect=lambda:clock[0]), \
             patch('ht_tibetan.acquisition.FILE_TIMEOUT_SECONDS',3):
            factory.return_value.open.return_value = response
            stream = _public_download('https://huggingface.co/file',{'path':'tokenizer.json','size_bytes':100})
            self.assertEqual(next(stream),b'x')
            self.assertEqual(next(stream),b'x')
            with self.assertRaisesRegex(OSError,'TimeoutError'):
                next(stream)
        self.assertEqual(response.reads,3)
        self.assertEqual(timeouts,[3,2,1])
        self.assertTrue(response.closed)

    def test_unsupported_socket_wrapper_or_chunked_response_fails_without_read(self):
        class Response(io.BytesIO):
            status = 200
            headers = {'Content-Length':'3'}
            def read1(self,_size=-1):
                raise AssertionError('Unsupported stream must fail before reading')
        for chunked in (False,True):
            with self.subTest(chunked=chunked),patch('ht_tibetan.acquisition.build_opener') as factory:
                response = Response(b'abc')
                response.chunked = chunked
                factory.return_value.open.return_value = response
                with self.assertRaises(OSError):
                    list(_public_download('https://huggingface.co/file',{'path':'tokenizer.json','size_bytes':3}))

    def test_http_errors_do_not_expose_signed_redirect_or_credential_details(self):
        with patch('ht_tibetan.acquisition.build_opener') as factory:
            factory.return_value.open.side_effect = OSError('https://delivery.hf.co/file?secret=DO-NOT-LEAK')
            with self.assertRaises(OSError) as context:
                list(_public_download('https://huggingface.co/file', {'path':'tokenizer.json','size_bytes':3}))
            self.assertNotIn('DO-NOT-LEAK',str(context.exception))
            self.assertIn('tokenizer.json',str(context.exception))

    def test_deadline_expiry_does_not_publish_partial_snapshot(self):
        with patch('ht_tibetan.acquisition.time.monotonic',side_effect=[0,7201]):
            with self.assertRaises(TimeoutError):
                self.acquire()
        self.assertFalse(self.snapshot().exists())
        self.assert_no_stage()

    def test_current_real_lock_selects_both_candidates_without_fetching(self):
        from ht_tibetan.acquisition import _selection
        real_lock = Path(__file__).resolve().parents[2]/'config'/'models.lock.json'
        for candidate in ('qwen3-4b-mlx-4bit','gemma3-4b-it-mlx-4bit'):
            metadata = _selection(real_lock,candidate,False)
            model = _selection(real_lock,candidate,True)
            self.assertFalse(any(row['path'].endswith('.safetensors') for row in metadata['files']))
            self.assertTrue(any(row['path'].endswith('.safetensors') for row in model['files']))
            self.assertNotEqual(metadata['inventory_sha256'],model['inventory_sha256'])


if __name__ == '__main__':
    unittest.main()
