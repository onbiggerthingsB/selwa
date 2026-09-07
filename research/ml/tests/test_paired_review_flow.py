"""Versioned paired review plumbing with synthetic backend contract stubs only."""
from dataclasses import asdict
import json
import unittest
from unittest.mock import Mock

import test_paired_baseline as paired_fixture
from ht_tibetan.artifacts import hash_file
from ht_tibetan.blind_review import export_blind_packet
from ht_tibetan.inference import InferenceResult
from ht_tibetan.output_review import (adjudicate_output_reviews, export_output_adjudication,
                                     freeze_output_reviews, load_frozen_reviews)
from ht_tibetan.output_review_import import import_output_review, load_imported_review
from ht_tibetan.records import RecordsError, load_dataset


class PairedReviewFlowTests(unittest.TestCase):
    def setUp(self):
        self.fixture = paired_fixture.PairedBaselineTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.directory
        self.fixture.config['candidate_ids'].append(paired_fixture.OTHER_CID)
        self.run = self.root / 'run'
        self.dataset = self.root / 'dataset.json'
        self.frozen = self.root / 'frozen' / 'reviews.json'
        def verify(lock_path, candidate_id, model, **kwargs):
            candidate = next(item for item in self.fixture.lock['candidates'] if item['candidate_id'] == candidate_id)
            return {'valid': True, 'errors': [], 'identity': dict(candidate, mode='model', inventory_sha256='c' * 64)}
        self.fixture.verifier = Mock(side_effect=verify)

    def build(self, *, cancel_at=None):
        def backend(request, **kwargs):
            # This is explicitly a unit-test contract stub for actual-output review
            # records. It is never run as a native benchmark or a human judgment.
            cancelled = int(request.run_id[-3:]) == cancel_at
            answer = None if cancelled else ' Exact synthetic contract answer ཀ་ 中文\n'
            return {'result': asdict(InferenceResult(request.run_id,
                'cancelled' if cancelled else 'success', answer, 'cancelled' if cancelled else 'stop',
                kwargs['model_identity'], input_tokens=3, output_tokens=0 if cancelled else 4, synthetic=False)),
                'raw_output': answer, 'measurements': {}}
        return self.fixture.run_case(backend)

    def write(self, path, record):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
        path.chmod(0o600)

    def export(self, reviewer='test-reviewer-a'):
        packet = self.root / 'packets' / (reviewer + '.json')
        key = self.root / 'keys' / (reviewer + '.json')
        export_blind_packet(self.run, self.dataset, reviewer, packet, key)
        return packet, key

    def import_completed(self, reviewer):
        packet, key = self.export(reviewer)
        returned = self.root / 'returned' / (reviewer + '.json')
        imported = self.root / 'imports' / (reviewer + '.json')
        value = load_dataset(packet)
        for row in value['items']:
            row['ratings'] = {'fidelity': 3, 'comprehension': 3, 'naturalness': 3}
            row['issues'] = ['Synthetic review contract test only.']
            row['blind_compromised'] = False
        self.write(returned, value)
        import_output_review(packet, returned, key, imported, evidence_kind='synthetic_test', independent=True)
        self.assertEqual(load_imported_review(imported)[0]['schema_version'], '1.1')
        return imported

    def freeze(self):
        imports = [self.import_completed(reviewer) for reviewer in ('test-reviewer-a', 'test-reviewer-b')]
        return freeze_output_reviews(self.run, self.dataset, imports, self.frozen)

    def rehash_artifact(self, filename):
        manifest = load_dataset(self.run / 'manifest.json')
        for row in manifest['artifacts']:
            if row['name'] == filename:
                row['sha256'] = hash_file(self.run / filename)
        self.write(self.run / 'manifest.json', manifest)

    def test_packet_language_labels_and_private_condition_identity(self):
        self.build()
        packet, key = self.export()
        public, private = load_dataset(packet), load_dataset(key)
        self.assertEqual(public['schema_version'], '1.1')
        self.assertEqual(len(public['items']), 8)
        self.assertEqual(private['schema_version'], '1.1')
        self.assertEqual(len({(row['candidate_id'], row['pair_id'], row['condition_id']) for row in private['items']}), 8)
        self.assertEqual({(row['input_language'], row['requested_output_language']) for row in public['items']},
                         {('bo', 'bo'), ('bo', 'zh'), ('zh', 'bo'), ('zh', 'zh')})
        self.assertNotIn('candidate_id', packet.read_text())
        self.assertNotIn('pair_id', packet.read_text())
        self.assertNotIn('condition_id', packet.read_text())
        self.assertTrue(all(row['ratings']['fidelity'] is None for row in public['items']))

    def test_full_import_freeze_adjudication_reports_each_condition(self):
        self.build()
        self.freeze()
        frozen, _ = load_frozen_reviews(self.frozen)
        self.assertEqual(frozen['schema_version'], '1.1')
        self.assertEqual(frozen['pair_count'], 1)
        self.assertEqual(frozen['connected_cluster_count'], 1)
        self.assertEqual(len(frozen['condition_counts']), 8)
        self.assertTrue(all(row['planned_requests'] == 4 for row in frozen['candidate_counts']))
        self.assertTrue(all(row['planned_requests'] == 1 for row in frozen['condition_counts']))
        self.assertEqual(len(frozen['cases']), 8)
        blank, returned, result = [self.root / 'adjudication' / name for name in ('blank.json', 'returned.json', 'recorded.json')]
        export_output_adjudication(self.frozen, blank)
        decision = load_dataset(blank)
        self.assertEqual(decision['schema_version'], '1.1')
        decision['adjudicator_id'] = 'synthetic-test-adjudicator'
        for row in decision['decisions']:
            row.update(decision='unresolved', rationale='Synthetic plumbing check only.', issues_addressed=False)
        self.write(returned, decision)
        summary = adjudicate_output_reviews(self.frozen, returned, result)
        self.assertEqual(summary['status'], 'recorded_with_unresolved_cases')
        self.assertIsNone(summary['model_selected'])
        record = load_dataset(result)
        self.assertEqual(record['schema_version'], '1.1')
        self.assertEqual(len(record['condition_counts']), 8)
        self.assertTrue(all(row['decisions']['unresolved'] == 1 for row in record['condition_counts']))

    def test_cancellation_keeps_each_unrecorded_condition_visible(self):
        self.build(cancel_at=3)
        self.freeze()
        frozen, _ = load_frozen_reviews(self.frozen)
        self.assertEqual(len(frozen['cases']), 2)
        self.assertEqual(sum(row['planned_requests'] for row in frozen['condition_counts']), 8)
        self.assertEqual(sum(row['unrecorded_requests'] for row in frozen['condition_counts']), 5)
        self.assertEqual(sum(row['generation_outcomes'].get('cancelled', 0) for row in frozen['condition_counts']), 1)

    def test_preregistered_condition_subset_retains_its_true_denominator(self):
        self.fixture.config['conditions'] = ['bo_to_zh', 'zh_to_bo']
        self.build()
        self.freeze()
        frozen, _ = load_frozen_reviews(self.frozen)
        self.assertEqual(len(frozen['condition_counts']), 4)
        self.assertTrue(all(row['planned_requests'] == 2 for row in frozen['candidate_counts']))
        self.assertEqual({row['condition_id'] for row in frozen['cases']}, {'bo_to_zh', 'zh_to_bo'})

    def test_parallel_material_hash_or_started_binding_tampering_fails(self):
        self.build()
        path = self.run / 'manifest.json'
        original = load_dataset(path)
        changed = load_dataset(path)
        changed['loaded_records_sha256']['parallel_material'] = 'a' * 64
        self.write(path, changed)
        with self.assertRaisesRegex(RecordsError, 'Parallel-material'):
            self.export()
        self.write(path, original)
        started = load_dataset(self.run / 'manifest.started.json')
        started['parallel_material']['evidence_kind'] = 'human_review'
        self.write(self.run / 'manifest.started.json', started)
        self.rehash_artifact('manifest.started.json')
        with self.assertRaisesRegex(RecordsError, 'Started'):
            self.export()

    def test_rehashed_case_condition_or_requested_language_change_fails(self):
        self.build()
        path = self.run / 'case.001.result.json'
        original = load_dataset(path)
        for field, value in [('condition_id', 'bo_to_zh'), ('output_language', 'zh'), ('parallel_pair_sha256', 'b' * 64)]:
            changed = dict(original, **{field: value})
            self.write(path, changed)
            self.rehash_artifact(path.name)
            with self.subTest(field=field), self.assertRaisesRegex(RecordsError, 'paired-language'):
                self.export()

    def test_result_rendered_prompt_must_match_the_sealed_dispatch_attempt(self):
        self.build()
        path = self.run / 'case.001.result.json'
        record = load_dataset(path)
        record['prompt']['rendered_text'] = 'Different passage. Answer in Chinese.'
        self.write(path, record)
        self.rehash_artifact(path.name)
        with self.assertRaisesRegex(RecordsError, 'pre-dispatch'):
            self.export()


if __name__ == '__main__':
    unittest.main()
