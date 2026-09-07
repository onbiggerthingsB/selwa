"""Synthetic reviewer declarations exercise tooling; none are actual human ratings."""
from copy import deepcopy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import test_blind_review as fixture_module
from ht_tibetan.blind_review import export_blind_packet
from ht_tibetan.output_review import (adjudicate_output_reviews, export_output_adjudication,
                                     freeze_output_reviews, load_frozen_reviews)
from ht_tibetan.output_review_import import import_output_review
from ht_tibetan.records import RecordsError, load_dataset


class OutputReviewTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture_module.BlindReviewTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root
        self.run = self.fixture.run
        self.dataset = self.fixture.dataset_path
        self.frozen = self.root / 'frozen' / 'ratings.json'
        self.blank = self.root / 'decisions' / 'blank.json'
        self.decisions = self.root / 'decisions' / 'returned.json'
        self.adjudicated = self.root / 'adjudicated' / 'decisions.json'

    def write(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        path.chmod(0o600)

    def review(self, reviewer, *, evidence='synthetic_test', independent=True, incomplete=False,
               compromised=False, value=4):
        packet = self.root / 'packets' / (reviewer + '.json')
        key = self.root / 'keys' / (reviewer + '.json')
        returned = self.root / 'returned' / (reviewer + '.json')
        imported = self.root / 'imports' / (reviewer + '.json')
        export_blind_packet(self.run, self.dataset, reviewer, packet, key)
        record = load_dataset(packet)
        for row in record['items']:
            row['ratings'] = dict.fromkeys(('fidelity', 'comprehension', 'naturalness'), value)
            row['issues'] = ['Synthetic test judgment; not a human review.'] if value < 4 else []
            row['blind_compromised'] = compromised
        if incomplete:
            record['items'][0]['ratings']['fidelity'] = None
        self.write(returned, record)
        import_output_review(packet, returned, key, imported, evidence_kind=evidence, independent=independent)
        return imported

    def freeze(self, **kwargs):
        self.fixture.build(**kwargs)
        self.a, self.b = self.review('fixture-a'), self.review('fixture-b', value=3)
        return freeze_output_reviews(self.run, self.dataset, [self.a, self.b], self.frozen)

    def fill_decisions(self, decision='unresolved', addressed=False):
        export_output_adjudication(self.frozen, self.blank)
        record = load_dataset(self.blank)
        record['adjudicator_id'] = 'synthetic-adjudicator'
        for row in record['decisions']:
            row.update(decision=decision, rationale='Synthetic decision for a software check only.',
                       issues_addressed=addressed)
        self.write(self.decisions, record)

    def test_round_trip_retains_ratings_disagreements_clusters_and_no_approval(self):
        summary = self.freeze()
        self.assertEqual(summary['reviewed_output_count'], 4)
        self.assertFalse(summary['approval_granted'])
        frozen, checksum = load_frozen_reviews(self.frozen)
        self.assertEqual(frozen['evidence_kind'], 'synthetic_test')
        self.assertEqual(frozen['input_evidence_type'], 'infrastructure_smoke')
        self.assertEqual(frozen['source_count'], 2)
        self.assertEqual(frozen['connected_cluster_count'], 2)
        for row in frozen['cases']:
            self.assertEqual(row['rating_disagreement_axes'], ['fidelity', 'comprehension', 'naturalness'])
            self.assertEqual(row['answer'], self.fixture.answer)
            self.assertEqual([r['ratings']['fidelity'] for r in row['reviews']], [4, 3])
        before = self.dataset.read_bytes()
        self.fill_decisions()
        result = adjudicate_output_reviews(self.frozen, self.decisions, self.adjudicated)
        self.assertEqual(result['status'], 'recorded_with_unresolved_cases')
        self.assertFalse(result['approval_granted'])
        self.assertIsNone(result['model_selected'])
        self.assertEqual(self.dataset.read_bytes(), before)
        self.assertEqual(load_frozen_reviews(self.frozen)[1], checksum)

    def test_partial_or_nonindependent_review_cannot_freeze(self):
        self.fixture.build()
        a = self.review('fixture-a')
        for index, kwargs in enumerate(({'incomplete': True}, {'independent': False})):
            b = self.review('fixture-b' + str(index), **kwargs)
            with self.assertRaisesRegex(RecordsError, 'finish|independent'):
                freeze_output_reviews(self.run, self.dataset, [a, b], self.frozen)
        self.assertFalse(self.frozen.exists())

    def test_duplicate_reviewer_and_missing_second_review_fail(self):
        self.fixture.build()
        a = self.review('fixture-a')
        with self.assertRaisesRegex(RecordsError, '2-8'):
            freeze_output_reviews(self.run, self.dataset, [a], self.frozen)
        with self.assertRaisesRegex(RecordsError, 'distinct'):
            freeze_output_reviews(self.run, self.dataset, [a, a], self.frozen)

    def test_synthetic_and_declared_human_evidence_cannot_mix(self):
        self.fixture.build()
        a, b = self.review('fixture-a'), self.review('fixture-b', evidence='human_review')
        with self.assertRaisesRegex(RecordsError, 'Synthetic'):
            freeze_output_reviews(self.run, self.dataset, [a, b], self.frozen)

    def test_generation_failure_remains_in_denominator(self):
        self.freeze(outcomes={2: 'timeout'})
        frozen, _ = load_frozen_reviews(self.frozen)
        self.assertEqual(len(frozen['cases']), 3)
        counts = frozen['candidate_counts'][0]
        self.assertEqual(counts['planned_requests'], 2)
        self.assertEqual(counts['reviewed_successful_outputs'], 1)
        self.assertEqual(counts['generation_outcomes'], {'success': 1, 'timeout': 1})
        self.assertEqual(len(frozen['excluded_cases']), 1)

    def test_interruption_keeps_undispatched_candidate_in_denominator(self):
        self.freeze(outcomes={2: 'cancelled'})
        frozen, _ = load_frozen_reviews(self.frozen)
        self.assertEqual(len(frozen['cases']), 1)
        self.assertEqual(frozen['candidate_counts'][1]['planned_requests'], 2)
        self.assertEqual(frozen['candidate_counts'][1]['unrecorded_requests'], 2)
        self.assertEqual(frozen['candidate_counts'][1]['reviewed_successful_outputs'], 0)

    def test_frozen_content_tampering_and_changed_imports_are_rejected(self):
        self.freeze()
        original = load_dataset(self.frozen)
        changed = deepcopy(original)
        changed['cases'][0]['reviews'][0]['ratings']['fidelity'] = 1
        self.write(self.frozen, changed)
        with self.assertRaisesRegex(RecordsError, 'differ'):
            load_frozen_reviews(self.frozen)
        self.write(self.frozen, original)
        self.a.write_bytes(self.a.read_bytes() + b' ')
        with self.assertRaisesRegex(RecordsError, 'differ'):
            load_frozen_reviews(self.frozen)

    def test_run_artifact_change_after_freeze_is_rejected(self):
        self.freeze()
        result_file = self.run / 'case.001.result.json'
        result_file.write_bytes(result_file.read_bytes() + b' ')
        with self.assertRaisesRegex(RecordsError, 'hash'):
            load_frozen_reviews(self.frozen)

    def test_blank_decisions_are_not_adjudication(self):
        self.freeze()
        export_output_adjudication(self.frozen, self.blank)
        with self.assertRaisesRegex(RecordsError, 'adjudicator'):
            adjudicate_output_reviews(self.frozen, self.blank, self.adjudicated)
        self.assertFalse(self.adjudicated.exists())

    def test_acceptance_requires_addressing_issues_and_keeps_original_ratings(self):
        self.freeze()
        self.fill_decisions('meets_task_criteria', addressed=False)
        with self.assertRaisesRegex(RecordsError, 'address'):
            adjudicate_output_reviews(self.frozen, self.decisions, self.adjudicated)
        record = load_dataset(self.decisions)
        for row in record['decisions']:
            row['issues_addressed'] = True
        self.write(self.decisions, record)
        result = adjudicate_output_reviews(self.frozen, self.decisions, self.adjudicated)
        self.assertEqual(result['status'], 'recorded')
        self.assertFalse(result['approval_granted'])
        frozen, _ = load_frozen_reviews(self.frozen)
        self.assertEqual(frozen['cases'][0]['reviews'][1]['ratings']['fidelity'], 3)

    def test_compromised_blinding_is_retained_and_cannot_be_accepted(self):
        self.fixture.build()
        a, b = self.review('fixture-a'), self.review('fixture-b', compromised=True)
        freeze_output_reviews(self.run, self.dataset, [a, b], self.frozen)
        frozen, _ = load_frozen_reviews(self.frozen)
        self.assertEqual(frozen['candidate_counts'][0]['outputs_with_compromised_blinding'], 2)
        self.fill_decisions('meets_task_criteria', addressed=True)
        with self.assertRaisesRegex(RecordsError, 'Compromised'):
            adjudicate_output_reviews(self.frozen, self.decisions, self.adjudicated)

    def test_wrong_freeze_duplicate_case_unknown_fields_and_missing_case_fail(self):
        self.freeze()
        self.fill_decisions()
        original = load_dataset(self.decisions)
        variants = []
        record = deepcopy(original); record['freeze_file_sha256'] = 'a' * 64; variants.append(record)
        record = deepcopy(original); record['decisions'][1] = record['decisions'][0]; variants.append(record)
        record = deepcopy(original); record['decisions'][0]['approval_granted'] = True; variants.append(record)
        record = deepcopy(original); record['decisions'].pop(); variants.append(record)
        for record in variants:
            self.write(self.decisions, record)
            with self.assertRaises(RecordsError):
                adjudicate_output_reviews(self.frozen, self.decisions, self.adjudicated)
        self.assertFalse(self.adjudicated.exists())

    def test_private_output_create_only_and_run_separation(self):
        self.freeze()
        with self.assertRaises(FileExistsError):
            freeze_output_reviews(self.run, self.dataset, [self.a, self.b], self.frozen)
        with self.assertRaisesRegex(RecordsError, 'immutable'):
            freeze_output_reviews(self.run, self.dataset, [self.a, self.b], self.run / 'extra.json')
        self.frozen.chmod(0o644)
        with self.assertRaisesRegex(RecordsError, '0600'):
            load_frozen_reviews(self.frozen)

    def test_oversized_output_is_rejected_before_publication(self):
        self.fixture.build()
        a, b = self.review('fixture-a'), self.review('fixture-b')
        with patch('ht_tibetan.output_review._MAX_REVIEW_BYTES', 256):
            with self.assertRaisesRegex(RecordsError, 'bounded JSON'):
                freeze_output_reviews(self.run, self.dataset, [a, b], self.frozen)
        self.assertFalse(self.frozen.exists())
        self.assertFalse(self.frozen.parent.exists())


if __name__ == '__main__':
    unittest.main()
