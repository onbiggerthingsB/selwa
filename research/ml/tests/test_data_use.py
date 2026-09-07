"""Integration tests use synthetic labels, mocked inference and no human consent."""
from copy import deepcopy
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import unittest
from unittest.mock import patch

from ht_tibetan.cli import main
from ht_tibetan.data_use import audit_data_use
from ht_tibetan.exposure_inventory import build_exposure_inventory
from ht_tibetan.records import RecordsError, atomic_write_json, content_sha256, load_dataset
import test_baseline as baseline_fixtures
from test_contribution_permissions import NOW, synthetic_permissions


class DataUseTests(unittest.TestCase):
    def setUp(self):
        self.fixture = baseline_fixtures.BaselineTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.dataset = deepcopy(self.fixture.dataset)
        self.runs = self.fixture.directory

    def permission_fixture(self):
        # Deliberate contract labels only; these are never persisted as real grants.
        for source in self.dataset["sources"]:
            source["source_kind"] = "publication"
        permissions = synthetic_permissions(self.dataset)
        permissions["evidence_kind"] = "operator_recorded"
        return permissions

    def audit(self, permissions=None, **kwargs):
        return audit_data_use(self.dataset, permissions, self.runs,
                              purpose=kwargs.pop("purpose", "review"), as_of=NOW, **kwargs)

    def test_review_audit_does_not_grant_release_or_training(self):
        permissions = self.permission_fixture()
        before = deepcopy(self.dataset)
        reconciled, report = self.audit(permissions)
        self.assertTrue(report["valid"], report)
        self.assertFalse(report["dataset_release_created"])
        self.assertFalse(report["training_authorized"])
        self.assertFalse(report["semantic_independence_verified"])
        self.assertEqual(self.dataset, before)
        self.assertIsNot(reconciled, self.dataset)
        self.assertEqual([item["purpose"] for item in report["permission_checks"]], ["review", "private_research"])

    def test_synthetic_permissions_cannot_clear_real_data(self):
        permissions = self.permission_fixture()
        permissions["evidence_kind"] = "synthetic_test"
        _, report = self.audit(permissions)
        self.assertFalse(report["valid"])
        self.assertIn("human_permission_evidence_required", {item["code"] for item in report["errors"]})

    def test_synthetic_escape_path_rejects_real_source(self):
        self.permission_fixture()
        _, report = self.audit(synthetic_only=True)
        self.assertFalse(report["valid"])
        self.assertIn("synthetic_only", {item["code"] for item in report["errors"]})

    def test_permission_audit_can_select_subset_without_requiring_unselected_grants(self):
        permissions = self.permission_fixture()
        permissions["grants"].pop()
        _, report = self.audit(permissions, example_ids=[self.dataset["examples"][0]["example_id"]])
        self.assertTrue(report["valid"], report)

    def test_historical_baseline_exposure_survives_fresh_input_and_new_ids(self):
        self.fixture.run_case()
        for index, example in enumerate(self.dataset["examples"]):
            source = self.dataset["sources"][index]
            source["source_id"] = "new-source-" + str(index)
            source["original_text"] += " Fresh source card label."
            source["content_sha256"] = content_sha256(source["original_text"])
            example.update(example_id="fresh-example-" + str(index), source_id=source["source_id"],
                source_sha256=source["content_sha256"], scenario_group="fresh-scenario-" + str(index),
                paraphrase_group="fresh-paraphrase-" + str(index), split="final_test", exposures=[])
        reconciled, report = self.audit(purpose="final_test", synthetic_only=True)
        self.assertFalse(report["valid"], report)
        self.assertIn("test_leakage", {item["code"] for item in report["errors"]})
        self.assertTrue(all("development_screen" in item["exposures"] for item in reconciled["examples"]))
        self.assertTrue(all(not item["exposures"] for item in self.dataset["examples"]))

    def test_new_baseline_audit_is_hashed_and_read_by_next_run(self):
        first = self.fixture.run_case()
        self.assertIn("data-use-audit.json", {item["name"] for item in first["artifacts"]})
        inventory = build_exposure_inventory(self.runs)
        self.assertTrue(inventory["valid"], inventory)
        second = self.fixture.run_case(output_dir=self.runs / "run-2")
        self.assertEqual(second["outcome"], "completed")
        self.assertTrue(all(item["exposures"] == ["development_screen"] for item in second["split_audit"]["components"]))

    def test_corrupt_history_blocks_before_tokenizer_or_verifier(self):
        self.fixture.run_case()
        (self.runs / "run" / "case.001.result.json").write_text("{}", encoding="utf-8")
        self.fixture.verifier.reset_mock()
        self.fixture.loader.reset_mock()
        with self.assertRaisesRegex(RecordsError, "data-use audit failed"):
            self.fixture.run_case(output_dir=self.runs / "run-2")
        self.fixture.verifier.assert_not_called()
        self.fixture.loader.assert_not_called()
        self.assertFalse((self.runs / "run-2").exists())

    def test_real_baseline_without_contributor_permissions_never_loads_model(self):
        self.fixture.approved_contract_stub()
        with self.assertRaisesRegex(RecordsError, "missing_permissions"):
            self.fixture.run_case()
        self.fixture.verifier.assert_not_called()
        self.fixture.loader.assert_not_called()
        self.assertFalse((self.runs / "run").exists())

    def test_expired_ledger_refuses_real_baseline(self):
        self.fixture.approved_contract_stub()
        self.dataset = self.fixture.dataset
        permissions = self.permission_fixture()
        permissions["grants"][0]["expires_at"] = "2026-09-04T13:00:00Z"
        path = self.runs / "permissions.json"
        atomic_write_json(path, permissions)
        with self.assertRaisesRegex(RecordsError, "expired_contributor_permission"):
            self.fixture.run_case(permissions_path=path)
        self.fixture.loader.assert_not_called()

    def test_permission_change_after_snapshot_verification_blocks_dispatch(self):
        self.fixture.approved_contract_stub()
        self.dataset = self.fixture.dataset
        permissions = self.permission_fixture()
        path = self.runs / "permissions.json"
        atomic_write_json(path, permissions)
        def revoke(*args, **kwargs):
            changed = deepcopy(permissions)
            changed["grants"][0]["status"] = "revoked"
            path.unlink()
            atomic_write_json(path, changed)
            return {"valid": True}
        self.fixture.verifier.side_effect = revoke
        result = self.fixture.run_case(permissions_path=path)
        self.assertEqual(result["outcome"], "failed")
        self.assertEqual(result["attempted_case_count"], 0)
        self.assertFalse(self.fixture.calls)

    def test_permission_change_during_rendering_blocks_dispatch(self):
        self.fixture.approved_contract_stub()
        self.dataset = self.fixture.dataset
        permissions = self.permission_fixture()
        path = self.runs / "permissions.json"
        atomic_write_json(path, permissions)
        def render(messages, tokenizer, **kwargs):
            path.write_text("{}", encoding="utf-8")
            return {"rendered_text": messages[0]["content"], "input_ids": [1, 2, 3]}
        self.fixture.renderer.side_effect = render
        result = self.fixture.run_case(permissions_path=path)
        self.assertEqual(result["attempted_case_count"], 0)
        self.assertFalse(self.fixture.calls)

    def test_outputs_outside_inventory_root_are_refused(self):
        with self.assertRaisesRegex(RecordsError, "root/runs"):
            self.fixture.run_case(output_dir=self.runs.parent / "unrecorded")
        self.fixture.loader.assert_not_called()

    def test_cli_audit_never_calls_model(self):
        permissions = self.permission_fixture()
        dataset_path, permission_path = self.runs / "review.json", self.runs / "permissions.json"
        atomic_write_json(dataset_path, self.dataset)
        atomic_write_json(permission_path, permissions)
        output = self.runs / "audit.json"
        with patch("ht_tibetan.baseline.run_baseline") as run, redirect_stdout(StringIO()):
            code = main(["audit-data-use", str(dataset_path), "--permissions", str(permission_path),
                "--purpose", "review", "--root", str(self.runs.parent), "--output", str(output)])
        self.assertEqual(code, 0)
        run.assert_not_called()
        self.assertTrue(load_dataset(output)["valid"])
