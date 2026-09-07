"""Portable cumulative exposure tests; only temporary synthetic run artifacts."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ht_tibetan.exposure_inventory import build_exposure_inventory, reconcile_exposures, reserve_exposure
from ht_tibetan.records import RecordsError, content_sha256, example_sha256, load_dataset, record_sha256

FIXTURE = Path(__file__).resolve().parents[2] / 'contracts/fixtures/synthetic-dataset.json'


class ExposureInventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.dataset = load_dataset(FIXTURE)

    def write(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def finalize(self, run, manifest, *, mechanics=False):
        files = sorted(path for path in run.rglob('*') if path.is_file() and path.name != 'manifest.json')
        if mechanics:
            manifest['artifact_inventory'] = [{'path': str(path.relative_to(run)),
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size} for path in files]
        else:
            manifest['artifacts'] = [{'name': path.name,
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for path in files]
        self.write(run / 'manifest.json', manifest)

    def baseline(self, *, name='baseline', outcome='completed', version='1.0', attempts=2, dataset=None):
        run = self.root / name
        data = deepcopy(dataset or self.dataset)
        manifest = {'schema_version': version, 'run_id': name, 'kind': 'local_source_question_baseline',
            'config': {}, 'purpose': 'infrastructure_smoke', 'evidence_type': 'infrastructure_smoke',
            'planned_cases': attempts, 'selected_example_ids': [ex['example_id'] for ex in data['examples']],
            'loaded_records_sha256': {'dataset': record_sha256(data)}, 'outcome': 'running', 'cases': []}
        self.write(run / 'manifest.started.json', manifest)
        for index in range(1, attempts + 1):
            example = data['examples'][(index - 1) % len(data['examples'])]
            if 'development_screen' not in example['exposures']:
                example['exposures'].append('development_screen')
            snapshot = f'exposed-dataset.{index:03d}.json'
            self.write(run / snapshot, data)
            case = {'attempted': True, 'example_id': example['example_id'],
                'example_sha256': example_sha256(example), 'source_id': example['source_id'],
                'source_sha256': example['source_sha256'], 'exposure_snapshot': snapshot}
            self.write(run / f'case.{index:03d}.attempt.json', case)
            self.write(run / f'case.{index:03d}.result.json', {**case, 'outcome': outcome})
            manifest['cases'].append({'attempted': True})
        manifest.update(outcome=outcome, finished_at='2026-09-05T00:00:00Z', attempted_case_count=attempts,
            latest_exposure_snapshot=f'exposed-dataset.{attempts:03d}.json' if attempts else None)
        self.finalize(run, manifest)
        return run, manifest

    def mechanics(self, *, name='mechanics', outcome='failed'):
        run = self.root / name
        records = [{'example_id': 'temporary-mechanics', 'messages': [
            {'role': 'user', 'content': 'Return the box color: blue.'},
            {'role': 'assistant', 'content': 'blue'}]}]
        inputs = {'schema_version': '1.0', 'kind': 'synthetic_mechanics_only',
            'exposures': ['smoke_training'], 'eligible_for_unseen_test': False, 'records': records}
        checksum = self.write(run / 'synthetic-inputs.json', inputs)
        manifest = {'schema_version': '1.0', 'run_id': name, 'kind': 'synthetic_adapter_mechanics',
            'config': {}, 'inputs': [{'name': 'synthetic-inputs.json', 'sha256': checksum}],
            'outcome': 'started', 'runtime_source_files': []}
        self.write(run / 'started.json', manifest)
        self.write(run / 'exposure.json', {'kind': 'synthetic_mechanics_exposure', 'input_sha256': checksum,
            'record_hashes': [record_sha256(record) for record in records], 'exposures': ['smoke_training'],
            'eligible_for_unseen_test': False, 'dispatch_state': 'reserved_before_training'})
        manifest.update(outcome=outcome, finished_at='2026-09-05T00:00:00Z', completed_steps=0)
        self.finalize(run, manifest, mechanics=True)
        return run, manifest

    def released(self, *, kind='released_adapter_training', outcome='completed'):
        run = self.root / 'released'
        run.mkdir()
        roles = ['train', 'validation'] if kind == 'released_adapter_training' else ['final_test']
        bindings = []
        for sequence, role in enumerate(roles, 1):
            selected = [self.dataset['examples'][(sequence - 1) % len(self.dataset['examples'])]['example_id']]
            path = reserve_exposure(run, self.dataset, role, selected, sequence)
            bindings.append({'path': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        manifest = {'schema_version': '1.0', 'kind': kind, 'run_id': 'released', 'outcome': 'started',
            'config': {}, 'inputs': [], 'release_sha256': 'a' * 64, 'exposure_reservations': bindings}
        self.write(run / 'started.json', manifest)
        manifest.update(outcome=outcome, finished_at='2026-09-05T00:00:00Z')
        self.finalize(run, manifest, mechanics=True)
        return run, manifest

    def invalid(self):
        inventory = build_exposure_inventory(self.root)
        self.assertFalse(inventory['valid'], inventory)
        self.assertTrue(inventory['errors'])
        with self.assertRaises(RecordsError):
            reconcile_exposures(self.dataset, inventory)
        return inventory

    def test_failed_and_interrupted_attempts_reconcile_without_mutating_inputs(self):
        for name, outcome in [('failed', 'failed'), ('interrupted', 'interrupted')]:
            self.baseline(name=name, outcome=outcome, attempts=1)
        inventory = build_exposure_inventory(self.root)
        self.assertTrue(inventory['valid'], inventory['errors'])
        original = deepcopy(self.dataset)
        copied, report = reconcile_exposures(self.dataset, inventory)
        self.assertEqual(self.dataset, original)
        self.assertEqual(copied['examples'][0]['exposures'], ['development_screen'])
        self.assertEqual(copied['examples'][1]['exposures'], [])
        self.assertEqual(report['added_exposure_count'], 1)
        self.assertEqual({ev['outcome'] for ev in report['matches'][0]['historical_evidence']}, {'failed', 'interrupted'})

    def test_zero_dispatch_baseline_does_not_invent_exposure(self):
        self.baseline(attempts=0, outcome='failed')
        inventory = build_exposure_inventory(self.root)
        self.assertTrue(inventory['valid'], inventory['errors'])
        self.assertEqual(inventory['entries'], [])

    def test_legacy_and_paired_snapshots_are_both_read(self):
        self.baseline(name='legacy', version='1.0')
        self.baseline(name='paired', version='1.1')
        inventory = build_exposure_inventory(self.root)
        self.assertTrue(inventory['valid'], inventory['errors'])
        self.assertEqual(len(inventory['coverage']['classified_runs']), 2)
        self.assertEqual(len(inventory['entries']), 2)

    def test_review_rejections_do_not_erase_historical_exposure(self):
        dataset = deepcopy(self.dataset)
        dataset['sources'][0]['language_review'] = 'rejected'
        dataset['examples'][0].update(review_state='approved', approved_answer='Synthetic answer')
        self.baseline(dataset=dataset, attempts=1)
        inventory = build_exposure_inventory(self.root)
        self.assertTrue(inventory['valid'], inventory['errors'])
        copied, _ = reconcile_exposures(dataset, inventory)
        self.assertIn('development_screen', copied['examples'][0]['exposures'])

    def test_reidentified_duplicate_content_still_matches_history(self):
        dataset = deepcopy(self.dataset)
        dataset['examples'][0]['approved_answer'] = 'Three books.'
        self.baseline(dataset=dataset, attempts=1)
        later = deepcopy(dataset)
        later['examples'] = [later['examples'][0]]
        later['sources'] = [later['sources'][0]]
        source, example = later['sources'][0], later['examples'][0]
        source.update(source_id='new-source', original_text='A new surrounding source paragraph.')
        source['content_sha256'] = content_sha256(source['original_text'])
        example.update(source_id=source['source_id'], source_sha256=source['content_sha256'],
            example_id='new-example', scenario_group='new-scenario', paraphrase_group='new-paraphrase')
        copied, report = reconcile_exposures(later, build_exposure_inventory(self.root))
        self.assertEqual(copied['examples'][0]['exposures'], ['development_screen'])
        self.assertTrue(any(key[0].startswith('task_') for key in report['matches'][0]['matched_keys']))

    def test_historical_transitive_bridge_propagates_to_current_sibling(self):
        dataset = deepcopy(self.dataset)
        dataset['examples'][1]['scenario_group'] = dataset['examples'][0]['scenario_group']
        self.baseline(dataset=dataset, attempts=1)
        later = deepcopy(dataset)
        later['examples'] = [later['examples'][1]]
        later['examples'][0]['scenario_group'] = 'new-scenario'
        copied, report = reconcile_exposures(later, build_exposure_inventory(self.root))
        self.assertEqual(copied['examples'][0]['exposures'], ['development_screen'])
        self.assertEqual(report['matched_example_ids'], [later['examples'][0]['example_id']])

    def test_zero_update_mechanics_reserves_pair_even_with_new_claims_and_ids(self):
        self.mechanics(outcome='failed')
        inventory = build_exposure_inventory(self.root)
        self.assertTrue(inventory['valid'], inventory['errors'])
        self.assertEqual(inventory['entries'][0]['exposures'], ['smoke_training'])
        self.dataset['examples'][0].update(question='Return the box color: blue.', approved_answer='blue',
            allowed_claims=['Different authored claim metadata.'])
        copied, _ = reconcile_exposures(self.dataset, inventory)
        self.assertEqual(copied['examples'][0]['exposures'], ['smoke_training'])

    def test_mechanics_normalized_pair_survives_whitespace_variation(self):
        self.mechanics()
        self.dataset['examples'][0].update(question='Return  the box color:\nblue.', approved_answer='blue')
        copied, _ = reconcile_exposures(self.dataset, build_exposure_inventory(self.root))
        self.assertEqual(copied['examples'][0]['exposures'], ['smoke_training'])

    def test_mechanics_exposure_hash_mismatch_fails_even_after_outer_rehash(self):
        run, manifest = self.mechanics()
        value = load_dataset(run / 'exposure.json')
        value['input_sha256'] = '0' * 64
        self.write(run / 'exposure.json', value)
        self.finalize(run, manifest, mechanics=True)
        self.invalid()

    def test_mechanics_record_hash_mismatch_fails(self):
        run, manifest = self.mechanics()
        value = load_dataset(run / 'exposure.json')
        value['record_hashes'] = ['0' * 64]
        self.write(run / 'exposure.json', value)
        self.finalize(run, manifest, mechanics=True)
        self.invalid()

    def test_changed_artifact_hash_fails(self):
        run, _ = self.baseline()
        with (run / 'exposed-dataset.001.json').open('a') as stream:
            stream.write(' ')
        self.invalid()

    def test_missing_or_unlisted_baseline_artifact_fails(self):
        run, _ = self.baseline()
        self.write(run / 'exposed-dataset.003.json', self.dataset)
        self.invalid()
        (run / 'exposed-dataset.003.json').unlink()
        (run / 'case.001.attempt.json').unlink()
        self.invalid()

    def test_nested_unlisted_mechanics_artifact_fails(self):
        run, _ = self.mechanics()
        self.write(run / 'worker/extra.json', {'messages': []})
        self.invalid()

    def test_snapshot_source_hash_binding_is_verified(self):
        run, manifest = self.baseline()
        dataset = load_dataset(run / 'exposed-dataset.001.json')
        dataset['sources'][0]['original_text'] += ' tampered'
        self.write(run / 'exposed-dataset.001.json', dataset)
        self.finalize(run, manifest)
        self.invalid()

    def test_snapshot_cannot_remove_exposure(self):
        run, manifest = self.baseline()
        dataset = load_dataset(run / 'exposed-dataset.002.json')
        dataset['examples'][0]['exposures'] = []
        self.write(run / 'exposed-dataset.002.json', dataset)
        self.finalize(run, manifest)
        self.invalid()

    def test_attempt_count_cannot_hide_hashed_snapshot(self):
        run, manifest = self.baseline()
        manifest['attempted_case_count'] = 0
        manifest['latest_exposure_snapshot'] = None
        self.finalize(run, manifest)
        self.invalid()

    def test_snapshot_task_cannot_change_mid_run(self):
        run, manifest = self.baseline()
        dataset = load_dataset(run / 'exposed-dataset.002.json')
        dataset['examples'][0]['question'] += ' now changed'
        self.write(run / 'exposed-dataset.002.json', dataset)
        self.finalize(run, manifest)
        self.invalid()

    def test_unfinished_and_orphan_evidence_blocks_inventory(self):
        self.write(self.root / 'unfinished/started.json', {'kind': 'synthetic_adapter_mechanics'})
        self.invalid()

    def test_unknown_run_kind_is_not_ignored(self):
        self.write(self.root / 'unknown/manifest.json', {'kind': 'future_training', 'run_id': 'unknown', 'outcome': 'completed'})
        self.invalid()

    def test_known_engineering_is_classified_and_cannot_hide_exposure(self):
        run = self.root / 'engineering'
        self.write(run / 'manifest.json', {'schema_version': '1.0', 'kind': 'foundation-checks',
            'run_id': 'engineering', 'outcome': 'completed', 'inputs': []})
        inventory = build_exposure_inventory(self.root)
        self.assertTrue(inventory['valid'], inventory['errors'])
        self.assertEqual(inventory['coverage']['classified_runs'][0]['classification'], 'known_non_model_engineering')
        self.write(run / 'exposure.json', {'exposures': ['train']})
        self.invalid()

    def test_path_traversal_in_inventory_fails(self):
        run, manifest = self.baseline()
        manifest['artifacts'][0]['name'] = '../outside.json'
        self.write(run / 'manifest.json', manifest)
        self.invalid()

    def test_symlink_root_and_children_are_rejected_without_traversal(self):
        self.baseline()
        (self.root / 'link').symlink_to(self.root / 'baseline', target_is_directory=True)
        with self.assertRaisesRegex(RecordsError, 'symlink'):
            build_exposure_inventory(self.root)
        with self.assertRaisesRegex(RecordsError, 'symlink'):
            build_exposure_inventory(self.root / 'link')

    def test_read_and_scan_limits_fail_closed(self):
        self.baseline()
        with patch('ht_tibetan.exposure_inventory._MAX_JSON_BYTES', 5):
            self.invalid()
        with patch('ht_tibetan.exposure_inventory._MAX_FILES', 1):
            with self.assertRaises(RecordsError):
                build_exposure_inventory(self.root)

    def test_duplicate_keys_nonfinite_and_nonobject_json_fail(self):
        run = self.root / 'invalid'
        run.mkdir()
        for text in ['{"kind":"x","kind":"y"}', '{"x":NaN}', '[]']:
            with self.subTest(text=text):
                (run / 'manifest.json').write_text(text)
                self.invalid()

    def test_duplicate_artifact_paths_and_wrong_sizes_are_rejected(self):
        run, manifest = self.mechanics()
        manifest['artifact_inventory'].append(deepcopy(manifest['artifact_inventory'][0]))
        self.write(run / 'manifest.json', manifest)
        self.invalid()
        self.finalize(run, manifest, mechanics=True)
        manifest['artifact_inventory'][0]['bytes'] += 1
        self.write(run / 'manifest.json', manifest)
        self.invalid()

    def test_started_identity_and_unknown_versions_are_rejected(self):
        run, manifest = self.baseline()
        started = load_dataset(run / 'manifest.started.json')
        started['run_id'] = 'different-run'
        self.write(run / 'manifest.started.json', started)
        self.finalize(run, manifest)
        self.invalid()
        started['run_id'] = manifest['run_id']
        started['schema_version'] = manifest['schema_version'] = '9.0'
        self.write(run / 'manifest.started.json', started)
        self.finalize(run, manifest)
        self.invalid()

    def test_total_byte_budget_fails_closed(self):
        self.baseline()
        with patch('ht_tibetan.exposure_inventory._MAX_TOTAL_BYTES', 100):
            self.invalid()

    def test_new_file_created_during_scan_cannot_yield_clean_inventory(self):
        self.baseline()
        from ht_tibetan import exposure_inventory as module
        original = module._read
        wrote = False
        def append_evidence(path, budget, **kwargs):
            nonlocal wrote
            result = original(path, budget, **kwargs)
            if not wrote:
                self.write(self.root / 'new-run/started.json', {'kind': 'future-training'})
                wrote = True
            return result
        with patch.object(module, '_read', side_effect=append_evidence):
            inventory = self.invalid()
        self.assertIn('inventory_changed_during_scan', {error['code'] for error in inventory['errors']})

    def test_nonmodel_parent_does_not_hide_nested_model_run(self):
        parent = self.root / 'parent'
        self.write(parent / 'manifest.json', {'schema_version': '1.0', 'kind': 'foundation-checks',
            'run_id': 'parent', 'outcome': 'completed', 'inputs': []})
        self.baseline(name='parent/child')
        inventory = build_exposure_inventory(self.root)
        self.assertTrue(inventory['valid'], inventory['errors'])
        self.assertEqual(inventory['coverage']['manifest_count'], 2)
        self.assertEqual(len(inventory['entries']), 2)

    def test_extra_hashed_baseline_audit_is_supported(self):
        run, manifest = self.baseline()
        manifest['data_use_audit'] = {'valid': True}
        self.write(run / 'data-use-audit.json', {'valid': True, 'purpose': 'test-only'})
        self.finalize(run, manifest)
        inventory = build_exposure_inventory(self.root)
        self.assertTrue(inventory['valid'], inventory['errors'])

    def test_released_training_reserves_train_and_validation(self):
        self.released()
        inventory = build_exposure_inventory(self.root)
        self.assertTrue(inventory['valid'], inventory['errors'])
        copied, _ = reconcile_exposures(self.dataset, inventory)
        self.assertEqual(copied['examples'][0]['exposures'], ['train'])
        self.assertEqual(copied['examples'][1]['exposures'], ['validation'])

    def test_failed_released_attempt_keeps_every_reservation(self):
        self.released(outcome='failed')
        copied, _ = reconcile_exposures(self.dataset, build_exposure_inventory(self.root))
        self.assertEqual(copied['examples'][0]['exposures'], ['train'])
        self.assertEqual(copied['examples'][1]['exposures'], ['validation'])

    def test_final_test_reservation_contains_no_raw_question_or_answer(self):
        self.dataset['examples'][0]['question'] = 'Private test question must remain hidden.'
        self.dataset['examples'][0]['approved_answer'] = 'Private test answer must remain hidden.'
        run, _ = self.released(kind='release_evaluation')
        text = (run / 'exposure.001.json').read_text()
        self.assertNotIn(self.dataset['examples'][0]['question'], text)
        self.assertNotIn(self.dataset['examples'][0]['approved_answer'], text)
        inventory = build_exposure_inventory(self.root)
        self.assertTrue(inventory['valid'], inventory['errors'])
        self.assertNotIn(self.dataset['examples'][0]['approved_answer'], json.dumps(inventory))
        copied, _ = reconcile_exposures(self.dataset, inventory)
        self.assertEqual(copied['examples'][0]['exposures'], ['final_test'])

    def test_reservation_binding_cannot_change_only_in_final_manifest(self):
        run, manifest = self.released()
        manifest['exposure_reservations'][0]['sha256'] = 'b' * 64
        self.finalize(run, manifest, mechanics=True)
        self.invalid()

    def test_unknown_or_wrong_role_rejected_before_reservation_write(self):
        run = self.root / 'reserved'
        run.mkdir()
        for role in ['private_research', 'future_training', None]:
            with self.subTest(role=role), self.assertRaises(RecordsError):
                reserve_exposure(run, self.dataset, role, [self.dataset['examples'][0]['example_id']], 1)
        self.assertEqual(list(run.iterdir()), [])

    def test_reservation_writes_once_and_selection_must_exist(self):
        run = self.root / 'reserved'
        run.mkdir()
        selected = [self.dataset['examples'][0]['example_id']]
        first = reserve_exposure(run, self.dataset, 'train', selected, 1)
        before = first.read_bytes()
        with self.assertRaises(FileExistsError):
            reserve_exposure(run, self.dataset, 'train', selected, 1)
        self.assertEqual(first.read_bytes(), before)
        for ids in [[], selected * 2, ['missing']]:
            with self.subTest(ids=ids), self.assertRaises(RecordsError):
                reserve_exposure(run, self.dataset, 'train', ids, 2)

    def test_orphan_generic_reservation_invalidates_inventory(self):
        run = self.root / 'reserved'
        run.mkdir()
        reserve_exposure(run, self.dataset, 'train', [self.dataset['examples'][0]['example_id']], 1)
        self.invalid()

    def test_extra_generic_reservation_cannot_be_omitted_from_started_bindings(self):
        run, manifest = self.released()
        reserve_exposure(run, self.dataset, 'train', [self.dataset['examples'][0]['example_id']], 3)
        self.finalize(run, manifest, mechanics=True)
        self.invalid()

    def test_generic_key_payload_change_fails_despite_rehashing_artifact_and_bindings(self):
        run, manifest = self.released()
        journal = load_dataset(run / 'exposure.001.json')
        journal['entries'][0]['keys'][0][1] = 'different-group'
        checksum = self.write(run / 'exposure.001.json', journal)
        manifest['exposure_reservations'][0]['sha256'] = checksum
        started = load_dataset(run / 'started.json')
        started['exposure_reservations'] = manifest['exposure_reservations']
        self.write(run / 'started.json', started)
        self.finalize(run, manifest, mechanics=True)
        self.invalid()

    def test_generic_manifest_roles_must_match_operation(self):
        run, manifest = self.released()
        manifest['kind'] = 'release_evaluation'
        started = load_dataset(run / 'started.json')
        started['kind'] = manifest['kind']
        self.write(run / 'started.json', started)
        self.finalize(run, manifest, mechanics=True)
        self.invalid()

    def test_generic_release_identity_must_be_bound_and_valid(self):
        run, manifest = self.released()
        manifest['release_sha256'] = 'not-a-hash'
        self.finalize(run, manifest, mechanics=True)
        self.invalid()

    def test_released_payload_json_is_hashed_without_deserialization(self):
        from ht_tibetan import exposure_inventory as module
        run, manifest = self.released(kind='release_evaluation')
        secret = 'PRIVATE_FINAL_TEST_REFERENCE_ANSWER'
        for name in ['case.0001.result.json', 'evaluation-report.json', 'worker/request.json']:
            self.write(run / name, {'reference_answer': secret, 'raw_output': secret})
        self.finalize(run, manifest, mechanics=True)
        original_read, original_loads = module._read, module.json.loads
        flags = {}
        def read_spy(path, budget, **kwargs):
            flags[str(path.relative_to(self.root))] = kwargs.get('parse', True)
            return original_read(path, budget, **kwargs)
        def parser_guard(text, *args, **kwargs):
            self.assertNotIn(secret, text)
            return original_loads(text, *args, **kwargs)
        with patch.object(module, '_read', side_effect=read_spy), patch.object(module.json, 'loads', side_effect=parser_guard):
            inventory = build_exposure_inventory(self.root)
        self.assertTrue(inventory['valid'], inventory['errors'])
        for name in ['case.0001.result.json', 'evaluation-report.json', 'worker/request.json']:
            path = 'released/' + name
            self.assertIs(flags[path], False)
            self.assertEqual(next(item['sha256'] for item in inventory['inventory'] if item['path'] == path),
                             hashlib.sha256((self.root / path).read_bytes()).hexdigest())
        self.assertTrue(flags['released/started.json'])
        self.assertTrue(flags['released/exposure.001.json'])
        with (run / 'evaluation-report.json').open('a') as stream:
            stream.write(' changed')
        self.invalid()

    def test_released_training_payload_is_also_hash_only(self):
        from ht_tibetan import exposure_inventory as module
        run, manifest = self.released()
        # Inventory verifies bytes and does not need to parse worker payloads,
        # even if a worker died while writing syntactically incomplete JSON.
        (run / 'train-worker').mkdir()
        (run / 'train-worker/request.json').write_text('intentionally incomplete fixture {')
        self.finalize(run, manifest, mechanics=True)
        original_read = module._read
        flags = {}
        def spy(path, budget, **kwargs):
            flags[str(path.relative_to(self.root))] = kwargs.get('parse', True)
            return original_read(path, budget, **kwargs)
        with patch.object(module, '_read', side_effect=spy):
            inventory = build_exposure_inventory(self.root)
        self.assertTrue(inventory['valid'], inventory['errors'])
        self.assertIs(flags['released/train-worker/request.json'], False)

    def test_existing_current_exposure_is_never_erased(self):
        self.mechanics()
        self.dataset['examples'][0].update(question='Return the box color: blue.', approved_answer='blue',
            exposures=['development_screen'])
        copied, _ = reconcile_exposures(self.dataset, build_exposure_inventory(self.root))
        self.assertEqual(copied['examples'][0]['exposures'], ['development_screen', 'smoke_training'])


if __name__ == '__main__':
    unittest.main()
