"""Blind-export contracts with synthetic test runs; no real model or human ratings."""
from copy import deepcopy
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

from ht_tibetan.artifacts import hash_file
from ht_tibetan.baseline import run_baseline
from ht_tibetan.blind_review import export_blind_packet
from ht_tibetan.inference import InferenceResult
from ht_tibetan.records import RecordsError, atomic_write_json, load_dataset

FIXTURE = Path(__file__).resolve().parents[2] / 'contracts' / 'fixtures' / 'synthetic-dataset.json'
CIDS = ['qwen3-4b-mlx-4bit', 'gemma3-4b-it-mlx-4bit']


class BlindReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.dataset = load_dataset(FIXTURE)
        self.dataset_path = self.root / 'dataset.json'
        self.run = self.root / 'runs' / 'run'
        self.packet = self.root / 'reviewer' / 'packet.json'
        self.key = self.root / 'operator' / 'key.json'
        self.config = {'schema_version': '1.0', 'run_id': 'PRIVATE-RUN-IDENTITY', 'purpose': 'infrastructure_smoke',
            'candidate_ids': CIDS, 'example_ids': ['fixture-example-1', 'fixture-example-2'],
            'max_output_tokens': 16, 'context_limit_tokens': 128, 'timeout_seconds': 10,
            'seed': 0, 'temperature': 0.0, 'reasoning_mode': 'disabled', 'contributor_policy': 'report',
            'community_id': None, 'task_id': None, 'review_criteria': None}
        self.lock = {'schema_version': '1.0', 'candidates': [
            {'candidate_id': cid, 'repository': 'fixture/' + cid, 'revision': ('a' if i == 0 else 'b') * 40}
            for i, cid in enumerate(CIDS)]}
        self.answer = '  Exact test answer ཀ་\n'

    def build(self, *, outcomes=None, synthetic=False, answer=None):
        atomic_write_json(self.dataset_path, self.dataset)
        atomic_write_json(self.root/'config.json', self.config)
        atomic_write_json(self.root/'lock.json', self.lock)
        def verifier(lock_path, candidate_id, path, **kwargs):
            candidate = next(item for item in self.lock['candidates'] if item['candidate_id'] == candidate_id)
            return {'valid': True, 'errors': [], 'identity': dict(candidate, mode='model', inventory_sha256='c'*64)}
        def backend(request, **kwargs):
            number = int(request.run_id[-3:])
            outcome = (outcomes or {}).get(number, 'success')
            text = self.answer if answer is None else answer
            return {'result': asdict(InferenceResult(request.run_id, outcome, text if outcome == 'success' else None,
                        'stop' if outcome == 'success' else 'timeout', kwargs['model_identity'],
                        input_tokens=2, output_tokens=4, synthetic=synthetic)),
                    'raw_output': text, 'measurements': {}}
        self.manifest = run_baseline(self.dataset_path, self.root/'config.json', self.root/'lock.json',
            self.root, self.run, backend=backend, snapshot_verifier=verifier,
            tokenizer_loader=lambda path: object(), renderer=lambda messages, tokenizer, **kwargs: {
                'rendered_text': messages[0]['content'], 'input_ids': [1, 2]})
        return self.manifest

    def export(self, **kwargs):
        return export_blind_packet(self.run, self.dataset_path, 'reviewer-a',
                                  kwargs.get('output_path', self.packet), kwargs.get('key_path', self.key))

    def write(self, path, value):
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

    def rewrite_artifact_hash(self, filename):
        manifest = load_dataset(self.run/'manifest.json')
        for item in manifest['artifacts']:
            if item['name'] == filename:
                item['sha256'] = hash_file(self.run/filename)
        self.write(self.run/'manifest.json', manifest)

    def test_packet_is_blind_unfilled_exact_and_key_is_private(self):
        self.build()
        original = self.dataset_path.read_bytes()
        with patch('ht_tibetan.blind_review.secrets.SystemRandom') as rng:
            rng.return_value.shuffle.side_effect = lambda rows: rows.reverse()
            result = self.export()
            rng.return_value.shuffle.assert_called_once()
        packet, key = load_dataset(self.packet), load_dataset(self.key)
        self.assertEqual(result['exported_count'], 4)
        self.assertEqual(result['excluded_count'], 0)
        self.assertFalse(result['approval_granted'])
        self.assertEqual(self.dataset_path.read_bytes(), original)
        packet_text = self.packet.read_text()
        for private in CIDS + [self.config['run_id'], 'fixture-example-1', 'fixture-source-1', 'fixture/', 'case.001.result.json']:
            self.assertNotIn(private, packet_text)
        self.assertNotIn('approved_answer', packet_text)
        self.assertNotIn('allowed_claims', packet_text)
        self.assertEqual(packet['input_evidence_type'], 'infrastructure_smoke')
        self.assertEqual(len({item['blind_id'] for item in packet['items']}), 4)
        for item in packet['items']:
            self.assertEqual(item['answer'], self.answer)
            self.assertEqual(item['ratings'], {'fidelity': None, 'comprehension': None, 'naturalness': None})
            self.assertEqual(item['issues'], [])
            self.assertIsNone(item['blind_compromised'])
            self.assertIn(item['source_text'], [source['original_text'] for source in self.dataset['sources']])
        self.assertEqual(key['items'][0]['case_id'], self.config['run_id']+'-004')
        self.assertEqual(key['packet_file_sha256'], hashlib.sha256(self.packet.read_bytes()).hexdigest())
        self.assertEqual(key['run_manifest_sha256'], hash_file(self.run/'manifest.json'))
        self.assertEqual(stat.S_IMODE(self.packet.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.key.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.key.parent.stat().st_mode), 0o700)

    def test_failed_outputs_are_excluded_and_kept_in_original_run(self):
        self.build(outcomes={2: 'timeout'})
        failure_before = (self.run/'case.002.result.json').read_bytes()
        result = self.export()
        self.assertEqual(result['exported_count'], 3)
        self.assertEqual(result['excluded_count'], 1)
        self.assertEqual(result['unrecorded_case_count'], 0)
        self.assertEqual((self.run/'case.002.result.json').read_bytes(), failure_before)
        self.assertEqual(load_dataset(self.key)['excluded_cases'][0]['outcome'], 'timeout')

    def test_no_synthetic_backend_output_can_become_actual_model_review(self):
        self.build(synthetic=True)
        with self.assertRaisesRegex(RecordsError, 'No actual successful'): self.export()
        self.assertFalse(self.packet.exists())
        self.assertFalse(self.key.exists())

    def test_identity_disclosed_inside_an_answer_is_preserved_and_flag_instruction_present(self):
        answer = 'I am Qwen.  ཀ་\n'
        self.build(answer=answer)
        self.export()
        packet = load_dataset(self.packet)
        self.assertTrue(all(item['answer'] == answer for item in packet['items']))
        self.assertTrue(any('blind_compromised' in text for text in packet['instructions']))

    def test_artifact_byte_tampering_fails_before_export(self):
        self.build()
        path = self.run/'case.001.result.json'
        path.write_bytes(path.read_bytes()+b' ')
        with self.assertRaisesRegex(RecordsError, 'recorded hash'): self.export()
        self.assertFalse(self.packet.exists())
        self.assertFalse(self.key.exists())

    def test_dataset_canonical_tampering_fails_but_formatting_change_is_allowed(self):
        self.build()
        dataset = load_dataset(self.dataset_path)
        self.dataset_path.write_text(json.dumps(dataset, separators=(',', ':')))
        self.export()
        dataset['examples'][0]['question'] += ' Changed question.'
        self.write(self.dataset_path, dataset)
        with self.assertRaisesRegex(RecordsError, 'run identity'):
            self.export(output_path=self.root/'reviewer-b'/'packet.json', key_path=self.root/'operator-b'/'key.json')

    def test_review_permission_is_required_even_when_baseline_permission_exists(self):
        self.dataset['sources'][0]['permitted_uses'].remove('review')
        self.build()
        with self.assertRaisesRegex(RecordsError, 'review permission'): self.export()
        self.assertFalse(self.packet.exists())
        self.assertFalse(self.key.exists())

    def test_rehashed_wrong_source_binding_still_fails(self):
        self.build()
        filename = 'case.001.result.json'
        case = load_dataset(self.run/filename)
        case['source_id'] = 'fixture-source-2'
        self.write(self.run/filename, case)
        self.rewrite_artifact_hash(filename)
        with self.assertRaisesRegex(RecordsError, 'binding'): self.export()

    def test_unhashed_extra_case_and_running_manifest_are_rejected(self):
        self.build()
        extra = self.run/'unlisted.json'
        extra.write_text('{}')
        with self.assertRaisesRegex(RecordsError, 'inventory'): self.export()
        extra.unlink()
        manifest = load_dataset(self.run/'manifest.json')
        manifest['outcome'] = 'running'
        self.write(self.run/'manifest.json', manifest)
        with self.assertRaisesRegex(RecordsError, 'finalized'): self.export()

    def test_create_only_and_path_separation(self):
        self.build()
        with self.assertRaises(RecordsError): self.export(key_path=self.packet)
        with self.assertRaises(RecordsError): self.export(key_path=self.packet.parent/'key.json')
        with self.assertRaises(RecordsError): self.export(output_path=self.run/'packet.json')
        self.export()
        packet_before, key_before = self.packet.read_bytes(), self.key.read_bytes()
        with self.assertRaises(FileExistsError): self.export()
        self.assertEqual(self.packet.read_bytes(), packet_before)
        self.assertEqual(self.key.read_bytes(), key_before)

    def test_symlinks_and_nonprivate_key_directory_are_rejected(self):
        self.build()
        self.key.parent.mkdir(mode=0o755)
        self.key.parent.chmod(0o755)
        with self.assertRaisesRegex(RecordsError, '0700'): self.export()
        self.key.parent.chmod(0o700)
        redirect = self.root/'redirect'
        redirect.symlink_to(self.key.parent, target_is_directory=True)
        with self.assertRaisesRegex(RecordsError, 'Symlink'):
            self.export(key_path=redirect/'key.json')
        self.assertFalse(self.key.exists())

    def test_pair_failure_rolls_back_only_its_new_private_key(self):
        self.build()
        original_link = os.link
        def fail_packet(source, destination, **kwargs):
            if Path(destination) == self.packet:
                raise OSError('simulated packet publication failure')
            return original_link(source, destination, **kwargs)
        with patch('ht_tibetan.blind_review.os.link', side_effect=fail_packet):
            with self.assertRaisesRegex(OSError, 'simulated'): self.export()
        self.assertFalse(self.packet.exists())
        self.assertFalse(self.key.exists())
        self.assertFalse(list(self.root.rglob('.blind-*')))

    def test_interruption_after_packet_publication_keeps_a_complete_pair(self):
        self.build()
        original_link = os.link
        def interrupt_after_link(source, destination, **kwargs):
            original_link(source, destination, **kwargs)
            if Path(destination) == self.packet:
                raise KeyboardInterrupt()
        with patch('ht_tibetan.blind_review.os.link', side_effect=interrupt_after_link):
            with self.assertRaises(KeyboardInterrupt): self.export()
        self.assertTrue(self.packet.exists())
        self.assertTrue(self.key.exists())
        self.assertEqual(load_dataset(self.key)['packet_file_sha256'], hash_file(self.packet))
        self.assertFalse(list(self.root.rglob('.blind-*')))


if __name__ == '__main__':
    unittest.main()
