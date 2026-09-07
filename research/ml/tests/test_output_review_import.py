"""Fabricated review responses exercise contracts only; no human evidence is created."""
from copy import deepcopy
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

from ht_tibetan.output_review_import import import_output_review, load_imported_review
from ht_tibetan.records import RecordsError, content_sha256, record_sha256


class OutputReviewImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        for name in ('reviewer', 'operator', 'imports'):
            (self.root / name).mkdir(mode=0o700)
        self.original = self.root / 'reviewer' / 'original.json'
        self.returned = self.root / 'reviewer' / 'returned.json'
        self.key_path = self.root / 'operator' / 'key.json'
        self.output = self.root / 'imports' / 'first.json'
        self.packet = {'schema_version': '1.0', 'kind': 'blind_model_output_review',
            'packet_id': 'test-packet', 'reviewer_id': 'synthetic-reviewer', 'status': 'unfilled',
            'input_evidence_type': 'infrastructure_smoke', 'instructions': ['Synthetic contract fixture.'],
            'rating_scale': {'1': 'Major failure', '2': 'Substantial problems', '3': 'Minor problems', '4': 'No identified problems'},
            'items': [{'blind_id': f'blind-{n}', 'source_text': '  ཀ་ Source\n',
                       'question': 'Question? ', 'answer': f' Exact answer {n}\n',
                       'ratings': {'fidelity': None, 'comprehension': None, 'naturalness': None},
                       'issues': [], 'blind_compromised': None} for n in range(2)]}
        self.write(self.original, self.packet)
        self.key = {'schema_version': '1.0', 'kind': 'private_blind_model_output_key',
            'packet_id': 'test-packet', 'reviewer_id': 'synthetic-reviewer',
            'created_at': '2026-09-05T00:00:00+00:00', 'run_id': 'fixture-run',
            'run_manifest_sha256': 'a' * 64, 'dataset_canonical_sha256': 'b' * 64,
            'dataset_input_file_sha256': 'c' * 64,
            'packet_file_sha256': content_sha256(self.original.read_text()),
            'purpose': 'infrastructure_smoke', 'status': 'exported_awaiting_independent_review',
            'items': [], 'excluded_cases': [], 'unrecorded_case_count': 0,
            'operator_instructions': 'Private synthetic key.', 'approval_granted': False}
        for n, row in enumerate(self.packet['items'], 1):
            self.key['items'].append({'blind_id': row['blind_id'], 'case_id': f'fixture-run-{n:03}',
                'candidate_id': f'candidate-{n}', 'model_identity': f'fixture/candidate-{n}@' + 'a' * 40,
                'result_file': f'case.{n:03}.result.json', 'result_file_sha256': 'd' * 64,
                'example_id': 'example-1', 'example_version': 1, 'example_sha256': 'e' * 64,
                'source_id': 'source-1', 'source_version': 1,
                'source_sha256': content_sha256(row['source_text']),
                'question_sha256': content_sha256(row['question']),
                'answer_sha256': content_sha256(row['answer']), 'review_item_sha256': record_sha256(row)})
        self.write(self.key_path, self.key)
        self.response = deepcopy(self.packet)
        self.write(self.returned, self.response)

    def write(self, path, value):
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        path.chmod(0o600)

    def fill(self, index=None):
        for n, item in enumerate(self.response['items']):
            if index is None or n == index:
                item['ratings'] = {'fidelity': 4, 'comprehension': 3, 'naturalness': 2}
                item['issues'] = ['Synthetic test issue; not an actual reviewer observation.']
                item['blind_compromised'] = False
        self.write(self.returned, self.response)

    def import_(self, **kwargs):
        return import_output_review(self.original, self.returned, self.key_path,
            kwargs.pop('output_path', self.output), evidence_kind=kwargs.pop('evidence_kind', 'synthetic_test'),
            independent=kwargs.pop('independent', False), **kwargs)

    def test_complete_synthetic_capture_preserves_exact_bytes_and_private_bindings(self):
        self.fill()
        originals = [path.read_bytes() for path in (self.original, self.returned, self.key_path)]
        result = self.import_()
        record, checksum = load_imported_review(self.output)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['completed_item_count'], 2)
        self.assertEqual(record['evidence_kind'], 'synthetic_test')
        self.assertFalse(record['independent'])
        self.assertFalse(record['approval_granted'])
        self.assertFalse(record['dataset_modified'])
        self.assertEqual(checksum, content_sha256(self.output.read_text()))
        self.assertEqual(record['private_key'], self.key)
        for before, after in zip(self.packet['items'], record['items']):
            for field in ('blind_id', 'source_text', 'question', 'answer'):
                self.assertEqual(after[field], before[field])
        self.assertEqual([path.read_bytes() for path in (self.original, self.returned, self.key_path)], originals)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)
        # Embedded submissions keep the import independently readable after handoff files move.
        for path in (self.original, self.returned, self.key_path):
            path.unlink()
        self.assertEqual(load_imported_review(self.output)[1], checksum)

    def test_blank_and_partial_are_incomplete(self):
        result = self.import_()
        self.assertEqual((result['status'], result['completed_item_count']), ('incomplete', 0))
        self.response['items'][0]['ratings']['fidelity'] = 4
        self.write(self.returned, self.response)
        result = self.import_(output_path=self.output.with_name('partial.json'), previous_path=self.output)
        self.assertEqual((result['status'], result['completed_item_count']), ('incomplete', 0))

    def test_human_declaration_does_not_imply_independence(self):
        self.fill()
        # Fabricated data here tests declarations only, never real human evidence.
        result = self.import_(evidence_kind='human_review', independent=False)
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(result['completed_item_count'], 2)
        result = self.import_(evidence_kind='human_review', independent=True,
                              output_path=self.output.with_name('declared.json'))
        self.assertEqual(result['status'], 'complete')
        self.assertFalse(result['approval_granted'])

    def test_explicit_valid_evidence_declarations_required(self):
        for evidence, independent in ((None, False), ('guessed', True), ([], True), ('human_review', None),
                                      ('synthetic_test', 1), ('human_review', 'true')):
            with self.subTest(evidence=evidence, independent=independent):
                with self.assertRaises(RecordsError):
                    self.import_(evidence_kind=evidence, independent=independent)
        with self.assertRaises(TypeError):
            import_output_review(self.original, self.returned, self.key_path, self.output)

    def test_returned_metadata_text_ids_order_and_extra_fields_cannot_change(self):
        mutations = [lambda p: p.update(status='complete'), lambda p: p.update(reviewer_id='other'),
            lambda p: p.update(instructions=['Changed']), lambda p: p.update(approval=True),
            lambda p: p['items'].reverse(), lambda p: p['items'].pop(),
            lambda p: p['items'][0].update(answer=p['items'][0]['answer'].strip()),
            lambda p: p['items'][0].update(source_text='changed'),
            lambda p: p['items'][0].update(question='changed'),
            lambda p: p['items'][0].update(blind_id='changed'),
            lambda p: p['items'][0].update(unexpected='extra')]
        for mutate in mutations:
            value = deepcopy(self.packet)
            mutate(value)
            self.write(self.returned, value)
            with self.subTest(value=value):
                with self.assertRaises(RecordsError): self.import_()

    def test_strict_response_types(self):
        mutations = [lambda row: row['ratings'].update(fidelity=True),
            lambda row: row['ratings'].update(fidelity=4.0),
            lambda row: row['ratings'].update(fidelity=5),
            lambda row: row['ratings'].update(fidelity='4'),
            lambda row: row['ratings'].update(extra=3),
            lambda row: row.update(issues='problem'), lambda row: row.update(issues=[{}]),
            lambda row: row.update(issues=[' ']), lambda row: row.update(blind_compromised=0),
            lambda row: row.update(blind_compromised='false')]
        for mutate in mutations:
            value = deepcopy(self.packet)
            mutate(value['items'][0])
            self.write(self.returned, value)
            with self.subTest(value=value):
                with self.assertRaises(RecordsError): self.import_()

    def test_duplicate_json_keys_and_nonfinite_values_rejected(self):
        for text in ('{"packet_id":"a","packet_id":"b"}', '{"number":NaN}',
                     '{"number":Infinity}', '{"number":1e999}'):
            self.returned.write_text(text)
            with self.subTest(text=text):
                with self.assertRaises(RecordsError): self.import_()

    def test_original_byte_hash_and_private_key_binding_required(self):
        self.original.write_bytes(self.original.read_bytes() + b' ')
        with self.assertRaisesRegex(RecordsError, 'trusted private key'): self.import_()
        self.write(self.original, self.packet)
        self.key['items'][0]['answer_sha256'] = 'f' * 64
        self.write(self.key_path, self.key)
        with self.assertRaisesRegex(RecordsError, 'exact review text'): self.import_()

    def test_key_unknown_fields_duplicate_bindings_and_boolean_versions_rejected(self):
        original = deepcopy(self.key)
        mutations = [lambda key: key.update(extra=True),
            lambda key: key['items'][0].update(extra=True),
            lambda key: key['items'][0].update(example_version=True),
            lambda key: key['items'][1].update(case_id=key['items'][0]['case_id']),
            lambda key: key['items'][1].update(result_file=key['items'][0]['result_file']),
            lambda key: key['items'][1].update(candidate_id=key['items'][0]['candidate_id']),
            lambda key: key.update(excluded_cases=[{'case_id': 'x', 'outcome': 'success', 'reason': 'inference_not_successful'}])]
        for mutate in mutations:
            key = deepcopy(original)
            mutate(key)
            self.write(self.key_path, key)
            with self.subTest(key=key):
                with self.assertRaises(RecordsError): self.import_()

    def test_context_overflow_exclusion_is_preserved(self):
        self.key['excluded_cases'] = [{'case_id': 'failed-case', 'outcome': 'context_overflow', 'reason': 'inference_not_successful'}]
        self.write(self.key_path, self.key)
        self.import_()
        self.assertEqual(load_imported_review(self.output)[0]['private_key']['excluded_cases'], self.key['excluded_cases'])

    def test_append_only_revision_preserves_completed_items_and_old_files(self):
        self.fill(0)
        self.import_()
        before = self.output.read_bytes()
        self.fill(1)
        revision = self.output.with_name('second.json')
        result = self.import_(output_path=revision, previous_path=self.output)
        record, _ = load_imported_review(revision)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(self.output.read_bytes(), before)
        self.assertEqual(record['provenance']['previous_import']['file_sha256'], content_sha256(before.decode()))
        with self.assertRaisesRegex(RecordsError, 'fully complete'):
            self.import_(output_path=self.output.with_name('third.json'), previous_path=revision)

    def test_partial_revision_cannot_change_completed_response_or_declarations(self):
        self.fill(0)
        self.import_()
        self.response['items'][0]['ratings']['fidelity'] = 1
        self.write(self.returned, self.response)
        with self.assertRaisesRegex(RecordsError, 'already completed'):
            self.import_(output_path=self.output.with_name('second.json'), previous_path=self.output)
        self.fill(0)
        with self.assertRaisesRegex(RecordsError, 'declarations'):
            self.import_(output_path=self.output.with_name('second.json'), previous_path=self.output,
                         evidence_kind='human_review')

    def test_loader_rejects_tampered_normalized_responses_and_embedded_bytes(self):
        self.fill()
        self.import_()
        original = json.loads(self.output.read_text())
        mutations = [lambda r: r.update(approval_granted=True), lambda r: r.update(status='incomplete'),
            lambda r: r.update(completed_item_count=True), lambda r: r.update(extra=True),
            lambda r: r['items'][0]['ratings'].update(fidelity=1),
            lambda r: r['items'][0].update(complete=False),
            lambda r: r['private_key'].update(run_manifest_sha256='f'*64),
            lambda r: r['embedded_evidence'].update(key=r['embedded_evidence']['key']+' '),
            lambda r: r['provenance'].update(extra=True)]
        for mutate in mutations:
            record = deepcopy(original)
            mutate(record)
            self.write(self.output, record)
            with self.subTest(record=record):
                with self.assertRaises(RecordsError): load_imported_review(self.output)

    def test_loader_validates_previous_hash_cycles_and_depth_bound(self):
        self.import_()
        revision = self.output.with_name('second.json')
        self.import_(output_path=revision, previous_path=self.output)
        valid = json.loads(revision.read_text())
        self.output.write_bytes(self.output.read_bytes() + b' ')
        with self.assertRaisesRegex(RecordsError, 'Previous import bytes'): load_imported_review(revision)
        valid['provenance']['previous_import']['path'] = str(revision)
        self.write(revision, valid)
        with self.assertRaisesRegex(RecordsError, 'cyclic'): load_imported_review(revision)
        with patch('ht_tibetan.output_review_import._MAX_CHAIN', 1):
            with self.assertRaisesRegex(RecordsError, 'bound'):
                self.import_(output_path=self.output.with_name('third.json'), previous_path=self.output)

    def test_private_key_output_and_import_permissions_are_enforced(self):
        self.key_path.chmod(0o644)
        with self.assertRaisesRegex(RecordsError, 'owner-private'): self.import_()
        self.key_path.chmod(0o600)
        self.key_path.parent.chmod(0o755)
        with self.assertRaisesRegex(RecordsError, 'owner-private'): self.import_()
        self.key_path.parent.chmod(0o700)
        self.output.parent.chmod(0o755)
        with self.assertRaisesRegex(RecordsError, 'owner-private'): self.import_()
        self.output.parent.chmod(0o700)
        self.import_()
        self.output.chmod(0o644)
        with self.assertRaisesRegex(RecordsError, 'owner-private'): load_imported_review(self.output)

    def test_no_overwrite_symlinks_hardlinks_desktop_or_run_outputs(self):
        self.import_()
        before = self.output.read_bytes()
        with self.assertRaises(FileExistsError): self.import_()
        self.assertEqual(self.output.read_bytes(), before)
        with self.assertRaisesRegex(RecordsError, 'outside Desktop'):
            self.import_(output_path=Path.home() / 'Desktop' / 'review-import-denied.json')
        run = self.root / 'run'
        run.mkdir(mode=0o700)
        (run/'manifest.json').write_text('{}')
        with self.assertRaisesRegex(RecordsError, 'outside source run'):
            self.import_(output_path=run/'review.json')
        redirect = self.root/'redirect'
        redirect.symlink_to(self.output.parent, target_is_directory=True)
        with self.assertRaisesRegex(RecordsError, 'Symlink'):
            self.import_(output_path=redirect/'review.json')
        os.link(self.returned, self.returned.with_name('hardlink.json'))
        with self.assertRaisesRegex(RecordsError, 'non-hardlinked'):
            self.import_(output_path=self.output.with_name('second.json'))

    def test_size_bound_and_atomic_publication_failure_leave_no_artifact(self):
        with patch('ht_tibetan.output_review_import._MAX_RECORD_BYTES', 16):
            with self.assertRaisesRegex(RecordsError, 'bounded record'): self.import_()
        with patch('ht_tibetan.output_review_import.os.link', side_effect=OSError('Synthetic publication failure')):
            with self.assertRaises(OSError): self.import_()
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.output.parent.glob('.output-review-*')), [])

    def test_fifo_input_rejected_without_open_and_chain_aggregate_bounded(self):
        self.returned.unlink()
        os.mkfifo(self.returned)
        with self.assertRaisesRegex(RecordsError, 'regular'):
            self.import_()
        self.returned.unlink()
        self.write(self.returned, self.response)
        self.import_()
        with patch('ht_tibetan.output_review_import._MAX_CHAIN_BYTES', self.output.stat().st_size + 1):
            with self.assertRaisesRegex(RecordsError, 'aggregate byte bound'):
                self.import_(output_path=self.output.with_name('second.json'), previous_path=self.output)
        self.assertFalse(self.output.with_name('second.json').exists())


if __name__ == '__main__':
    unittest.main()
