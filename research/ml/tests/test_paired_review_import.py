"""Synthetic v1.1 packet returns test bindings, never Tibetan/Chinese quality."""
from copy import deepcopy
import json
import unittest

import test_output_review_import as legacy
from ht_tibetan.output_review_import import load_imported_review
from ht_tibetan.records import RecordsError, content_sha256, record_sha256


class PairedReviewImportTests(unittest.TestCase):
    # Reuse only the local file fixture helpers, without inheriting its test cases.
    write = legacy.OutputReviewImportTests.write
    fill = legacy.OutputReviewImportTests.fill
    import_ = legacy.OutputReviewImportTests.import_

    def setUp(self):
        legacy.OutputReviewImportTests.setUp(self)
        row_template = deepcopy(self.packet['items'][0])
        binding_template = deepcopy(self.key['items'][0])
        self.packet['schema_version'] = '1.1'
        self.packet['items'] = []
        self.key['schema_version'] = '1.1'
        self.key['parallel_material_sha256'] = 'b' * 64
        self.key['items'] = []
        for n, (input_language, output_language) in enumerate(
                (('bo', 'bo'), ('bo', 'zh'), ('zh', 'bo'), ('zh', 'zh')), 1):
            row = dict(deepcopy(row_template), blind_id=f'paired-blind-{n}',
                       answer=f' Exact synthetic answer {n}\n',
                       input_language=input_language,
                       requested_output_language=output_language)
            binding = dict(deepcopy(binding_template), blind_id=row['blind_id'],
                           case_id=f'fixture-run-{n:03}', result_file=f'case.{n:03}.result.json',
                           example_id=f'example-{input_language}', source_id=f'source-{input_language}',
                           pair_id='synthetic-pair-1', condition_id=f'{input_language}_to_{output_language}',
                           input_language=input_language, output_language=output_language,
                           parallel_pair_sha256='c' * 64,
                           answer_sha256=content_sha256(row['answer']))
            self.packet['items'].append(row)
            self.key['items'].append(binding)
        self.refresh()

    def refresh(self):
        """Rebind deliberately fabricated originals, before any import is written."""
        self.write(self.original, self.packet)
        self.key['packet_file_sha256'] = content_sha256(self.original.read_text())
        for row, binding in zip(self.packet['items'], self.key['items']):
            binding['review_item_sha256'] = record_sha256(row)
        self.write(self.key_path, self.key)
        self.response = deepcopy(self.packet)
        self.write(self.returned, self.response)

    def test_roundtrip_preserves_four_conditions_and_same_example_in_two_output_languages(self):
        self.fill()
        originals = [p.read_bytes() for p in (self.original, self.returned, self.key_path)]
        summary = self.import_()
        record, checksum = load_imported_review(self.output)
        self.assertEqual((summary['schema_version'], record['schema_version']), ('1.1', '1.1'))
        self.assertEqual((record['status'], record['completed_item_count']), ('complete', 4))
        self.assertEqual(record['private_key'], self.key)
        self.assertEqual(len({item['binding']['example_id'] for item in record['items']}), 2)
        self.assertEqual(len({item['binding']['candidate_id'] for item in record['items']}), 1)
        self.assertEqual({item['binding']['condition_id'] for item in record['items']},
                         {'bo_to_bo', 'bo_to_zh', 'zh_to_bo', 'zh_to_zh'})
        self.assertFalse(record['approval_granted'])
        self.assertFalse(record['dataset_modified'])
        self.assertEqual([p.read_bytes() for p in (self.original, self.returned, self.key_path)], originals)
        for p in (self.original, self.returned, self.key_path):
            p.unlink()
        self.assertEqual(load_imported_review(self.output)[1], checksum)

    def test_packet_and_key_versions_must_match_exactly(self):
        for target in ('original', 'returned', 'key_path'):
            for version in ('1.0', '1.2', 1.1, [], None):
                self.refresh()
                path = getattr(self, target)
                value = json.loads(path.read_text())
                value['schema_version'] = version
                self.write(path, value)
                with self.subTest(target=target, version=version):
                    with self.assertRaises(RecordsError):
                        self.import_()

    def test_language_labels_cannot_be_changed_in_returned_packet(self):
        for field in ('input_language', 'requested_output_language'):
            for value in ('zh', '', 'en', None, []):
                returned = deepcopy(self.packet)
                returned['items'][0][field] = value
                self.write(self.returned, returned)
                with self.subTest(field=field, value=value):
                    with self.assertRaisesRegex(RecordsError, 'was changed'):
                        self.import_()

    def test_new_packet_key_and_binding_fields_are_required_and_strict(self):
        for target, fields in (
                ('packet', ('input_language', 'requested_output_language')),
                ('binding', ('pair_id', 'condition_id', 'input_language', 'output_language', 'parallel_pair_sha256')),
                ('key', ('parallel_material_sha256',))):
            for field in (*fields, 'unexpected'):
                self.refresh()
                original = deepcopy(self.packet)
                key = deepcopy(self.key)
                obj = original['items'][0] if target == 'packet' else key['items'][0] if target == 'binding' else key
                if field == 'unexpected':
                    obj[field] = 'extra'
                else:
                    del obj[field]
                self.write(self.original, original)
                self.write(self.returned, original)
                key['packet_file_sha256'] = content_sha256(self.original.read_text())
                self.write(self.key_path, key)
                with self.subTest(target=target, field=field):
                    with self.assertRaisesRegex(RecordsError, 'missing or unknown'):
                        self.import_()

    def test_condition_binding_and_public_languages_must_agree(self):
        mutations = [lambda key: key['items'][0].update(condition_id='zh_to_bo'),
                     lambda key: key['items'][0].update(condition_id='unsupported'),
                     lambda key: key['items'][0].update(condition_id=[]),
                     lambda key: key['items'][0].update(input_language='zh'),
                     lambda key: key['items'][0].update(output_language='zh'),
                     lambda key: key['items'][0].update(input_language=[]),
                     lambda key: key['items'][0].update(output_language=None)]
        for mutate in mutations:
            key = deepcopy(self.key)
            mutate(key)
            self.write(self.key_path, key)
            with self.assertRaisesRegex(RecordsError, 'languages disagree'):
                self.import_()
        for field in ('input_language', 'requested_output_language'):
            for value in ('en', '', [], None):
                packet, key = deepcopy(self.packet), deepcopy(self.key)
                packet['items'][0][field] = value
                self.write(self.original, packet)
                self.write(self.returned, packet)
                key['packet_file_sha256'] = content_sha256(self.original.read_text())
                key['items'][0]['review_item_sha256'] = record_sha256(packet['items'][0])
                self.write(self.key_path, key)
                with self.subTest(field=field, value=value):
                    with self.assertRaisesRegex(RecordsError, 'languages disagree'):
                        self.import_()

    def test_pair_ids_and_parallel_hashes_are_bounded_and_valid(self):
        for value in ('', ' ', '../pair', '/pair', '-pair', 'p' * 97, [], None):
            key = deepcopy(self.key)
            key['items'][0]['pair_id'] = value
            self.write(self.key_path, key)
            with self.subTest(pair_id=value):
                with self.assertRaisesRegex(RecordsError, 'Pair ID'):
                    self.import_()
        for field in ('parallel_material_sha256', 'parallel_pair_sha256'):
            for value in ('', 'x' * 64, 'A' * 64, 'a' * 63, None, []):
                key = deepcopy(self.key)
                (key if field == 'parallel_material_sha256' else key['items'][0])[field] = value
                self.write(self.key_path, key)
                with self.subTest(field=field, value=value):
                    with self.assertRaisesRegex(RecordsError, 'hash'):
                        self.import_()

    def test_duplicate_candidate_pair_condition_is_rejected(self):
        self.packet['items'][1]['requested_output_language'] = 'bo'
        self.key['items'][1].update(condition_id='bo_to_bo', output_language='bo')
        self.refresh()
        with self.assertRaisesRegex(RecordsError, 'Duplicate private'):
            self.import_()
        # A second candidate on that same pair/condition is a separate comparison.
        self.key['items'][1]['candidate_id'] = 'candidate-2'
        self.key['items'][1]['model_identity'] = 'fixture/candidate-2@' + 'a' * 40
        self.refresh()
        self.assertEqual(self.import_()['item_count'], 4)

    def test_loader_rejects_changes_to_every_new_derived_field(self):
        self.fill()
        self.import_()
        original = json.loads(self.output.read_text())
        mutations = [lambda r: r.update(schema_version='1.0'),
                     lambda r: r.update(parallel_material_sha256='b' * 64),
                     lambda r: r['private_key'].update(parallel_material_sha256='f' * 64)]
        for field, value in (('input_language', 'zh'), ('requested_output_language', 'zh')):
            mutations.append(lambda r, f=field, v=value: r['items'][0].update({f: v}))
        for field, value in (('pair_id', 'different-pair'), ('condition_id', 'zh_to_bo'),
                             ('input_language', 'zh'), ('output_language', 'zh'),
                             ('parallel_pair_sha256', 'f' * 64)):
            mutations.append(lambda r, f=field, v=value: r['items'][0]['binding'].update({f: v}))
        for mutate in mutations:
            record = deepcopy(original)
            mutate(record)
            self.write(self.output, record)
            with self.assertRaises(RecordsError):
                load_imported_review(self.output)

    def test_paired_partial_revision_is_append_only_and_preserves_material_binding(self):
        self.fill(0)
        self.import_()
        original_bytes = self.output.read_bytes()
        self.fill()
        revision = self.output.with_name('complete.json')
        summary = self.import_(output_path=revision, previous_path=self.output)
        record, _ = load_imported_review(revision)
        self.assertEqual((summary['schema_version'], record['schema_version']), ('1.1', '1.1'))
        self.assertEqual(summary['completed_item_count'], 4)
        self.assertEqual(self.output.read_bytes(), original_bytes)
        self.key['parallel_material_sha256'] = 'f' * 64
        self.write(self.key_path, self.key)
        with self.assertRaisesRegex(RecordsError, 'declarations'):
            self.import_(output_path=self.output.with_name('changed-material.json'), previous_path=self.output)


if __name__ == '__main__':
    unittest.main()
