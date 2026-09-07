"""Synthetic release exercises only; no grants or reviews here are human evidence."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ht_tibetan.records import RecordsError, atomic_write_json, content_sha256, example_sha256, load_dataset, record_sha256
from ht_tibetan.releases import build_release, verify_release
from test_contribution_permissions import synthetic_permissions

FIXTURE = Path(__file__).resolve().parents[2] / "contracts/fixtures/synthetic-dataset.json"


def release_fixture(*, human_labels=False):
    data = load_dataset(FIXTURE)
    source, example = deepcopy(data["sources"][0]), deepcopy(data["examples"][0])
    source.update(source_id="fixture-source-3", original_text="A green cup is on the shelf.")
    source["content_sha256"] = content_sha256(source["original_text"])
    example.update(example_id="fixture-example-3", source_id=source["source_id"], source_sha256=source["content_sha256"],
        scenario_group="fixture-scenario-3", paraphrase_group="fixture-paraphrase-3", contributor_id="synthetic-contributor-3",
        question="What color is the cup?", allowed_claims=["The cup is green."])
    data["sources"].append(source)
    data["examples"].append(example)
    for index, (source, example, split) in enumerate(zip(data["sources"], data["examples"], ("train", "validation", "final_test"))):
        source.update(language_review="approved", source_kind="publication" if human_labels else "synthetic_fixture")
        source["permitted_uses"] += ["train", "smoke_training"]
        example.update(split=split, approved_answer=example["allowed_claims"][0], review_state="approved")
        checksum = example_sha256(example)
        reviews = []
        for reviewer in (1, 2):
            review_id = f"synthetic-review-{index}-{reviewer}"
            reviews.append(review_id)
            data["reviews"].append({"review_id": review_id, "example_id": example["example_id"],
                "example_version": example["version"], "example_sha256": checksum, "source_sha256": source["content_sha256"],
                "reviewer_id": f"synthetic-reviewer-{reviewer}", "reviewer_role": "language_reviewer", "review_type": "language",
                "ratings": {"naturalness": 4, "fidelity": 4, "comprehension": 4}, "issues": [], "minutes_spent": 1,
                "status": "complete", "recommendation": "approve", "revision": 1, "supersedes_review_id": None})
        data["adjudications"].append({"adjudication_id": f"synthetic-adjudication-{index}", "example_id": example["example_id"],
            "example_version": example["version"], "example_sha256": checksum, "review_ids": reviews,
            "adjudicator_id": "synthetic-adjudicator", "decision": "approve", "language_review": "approved",
            "medical_review": "not_applicable", "rationale": "Synthetic software fixture only.", "minutes_spent": 1})
    permissions = synthetic_permissions(data)
    if human_labels:
        permissions["evidence_kind"] = "operator_recorded"
    for grant in permissions["grants"]:
        grant["permitted_uses"] += ["train", "smoke_training", "validation", "final_test"]
    return data, permissions


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        (self.root / "runs").mkdir()
        self.dataset, self.permissions = release_fixture()
        self.dataset_path = self.root / "input.json"
        self.permissions_path = self.root / "input-permissions.json"
        self.output = self.root / "releases" / "engineering-release"

    def save(self):
        self.dataset_path.write_text(json.dumps(self.dataset), encoding="utf-8")
        self.permissions_path.write_text(json.dumps(self.permissions), encoding="utf-8")

    def build(self, *, human=False):
        self.save()
        return build_release(self.dataset_path, self.permissions_path, self.root, self.output,
            release_id=self.output.name, evidence_kind="human_review" if human else "synthetic_test")

    def load(self, purposes=("train", "validation"), **kwargs):
        return verify_release(self.output, root=self.root, purposes=purposes, **kwargs)

    def marker(self, name="previous"):
        path = self.root / "runs" / name
        path.mkdir()
        atomic_write_json(path / "manifest.json", {"schema_version": "1.0", "kind": "foundation-checks",
            "outcome": "completed", "run_id": name})
        return path / "manifest.json"

    def test_build_fixes_splits_and_records_engineering_identity(self):
        original = deepcopy(self.dataset)
        manifest = self.build()
        result = self.load()
        self.assertTrue(result["engineering_only"])
        self.assertEqual(result["release_sha256"], record_sha256(manifest))
        self.assertEqual(set(result["datasets"]), {"train", "validation"})
        self.assertEqual([item["split"] for item in result["dataset"]["examples"]], ["train", "validation"])
        self.assertEqual(result["unopened_splits"], ["final_test"])
        self.assertTrue(result["current_eligibility_checked"])
        self.assertEqual(load_dataset(self.dataset_path), original)
        self.assertEqual((self.output / "manifest.json").stat().st_mode & 0o077, 0)
        with self.assertRaisesRegex(RecordsError, "already exists"):
            self.build()

    def test_training_verification_never_opens_or_returns_final_content(self):
        self.build()
        from ht_tibetan import releases
        original_read, opened = releases._read, []
        def tracking(path):
            opened.append(str(path))
            if "/locked/" in str(path):
                self.fail("Training loader opened locked test content.")
            return original_read(path)
        with patch.object(releases, "_read", side_effect=tracking):
            result = self.load()
        self.assertNotIn("The cup is green.", json.dumps(result))
        self.assertNotIn("What color is the cup?", json.dumps(result))
        self.assertNotIn("A green cup is on the shelf.", json.dumps(result))
        self.assertTrue(opened)

    def test_final_references_are_separate_and_restored_only_for_explicit_test_load(self):
        self.build()
        stored = load_dataset(self.output / "locked/final_test.dataset.json")
        self.assertIsNone(stored["examples"][0]["approved_answer"])
        self.assertEqual(stored["examples"][0]["allowed_claims"], [])
        result = self.load(purposes=("final_test",))
        self.assertEqual(result["dataset"]["examples"][0]["approved_answer"], "The cup is green.")
        self.assertEqual(result["unopened_splits"], ["train", "validation"])

    def test_no_implicit_all_split_load_or_unknown_purpose(self):
        self.build()
        for purposes in (None, (), ("train", "train"), ("review",), (["train"],)):
            with self.subTest(purposes=purposes), self.assertRaises(RecordsError):
                self.load(purposes=purposes)

    def test_selected_content_corruption_and_manifest_corruption_block(self):
        self.build()
        path = self.output / "datasets/train.json"
        text = path.read_text()
        path.write_text(text.replace("nine", "zero"))
        with self.assertRaisesRegex(RecordsError, "hash"):
            self.load()
        path.write_text(text)
        manifest = load_dataset(self.output / "manifest.json")
        manifest["release_id"] = "changed-release"
        (self.output / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(RecordsError, "digest|identity"):
            self.load()

    def test_unselected_same_size_corruption_is_reported_as_unopened_then_caught_on_test_load(self):
        self.build()
        path = self.output / "locked/final_test.references.json"
        path.write_text(path.read_text().replace("green", "black"))
        self.assertEqual(self.load()["unopened_splits"], ["final_test"])
        with self.assertRaisesRegex(RecordsError, "hash"):
            self.load(purposes=("final_test",))

    def test_symlink_extra_file_and_missing_locked_file_block_without_loading_test(self):
        self.build()
        target = self.output / "locked/final_test.references.json"
        original = target.read_bytes()
        target.unlink()
        with self.assertRaisesRegex(RecordsError, "inventory"):
            self.load()
        (self.root / "redirect.json").write_bytes(original)
        target.symlink_to(self.root / "redirect.json")
        with self.assertRaisesRegex(RecordsError, "symlink"):
            self.load()
        target.unlink()
        target.write_bytes(original)
        (self.output / "extra.json").write_text("{}")
        with self.assertRaisesRegex(RecordsError, "inventory"):
            self.load()

    def test_assignment_pending_reviews_cross_split_duplicates_and_health_gates(self):
        original = deepcopy(self.dataset)
        self.dataset["examples"][0]["split"] = "unassigned"
        with self.assertRaisesRegex(RecordsError, "Assign"):
            self.build()
        self.dataset = deepcopy(original)
        self.dataset["examples"][1]["scenario_group"] = self.dataset["examples"][0]["scenario_group"]
        # Rebind the synthetic review hashes so the targeted grouping audit, rather
        # than a stale-review rejection, establishes the conflict.
        changed = self.dataset["examples"][1]
        for field in ("reviews", "adjudications"):
            for item in self.dataset[field]:
                if item["example_id"] == changed["example_id"]:
                    item["example_sha256"] = example_sha256(changed)
        with self.assertRaisesRegex(RecordsError, "connected_split"):
            self.build()
        self.dataset, self.permissions = release_fixture(human_labels=True)
        self.dataset["sources"][1].update(scope="health", medical_review="pending")
        with self.assertRaisesRegex(RecordsError, "medical_approval_required"):
            self.build(human=True)
        self.assertFalse(self.output.exists())

    def test_real_release_rechecks_current_permission_and_rejects_revocation(self):
        self.dataset, self.permissions = release_fixture(human_labels=True)
        self.build(human=True)
        with self.assertRaisesRegex(RecordsError, "Current permission ledger"):
            self.load()
        self.assertFalse(self.load(permissions_path=self.permissions_path)["engineering_only"])
        original = self.permissions["grants"][0]
        self.permissions["grants"].append({**deepcopy(original), "grant_id": "revoked-after-release",
            "revision": 2, "supersedes_grant_id": original["grant_id"], "status": "revoked",
            "recorded_at": "2026-09-05T00:00:00Z"})
        self.save()
        with self.assertRaisesRegex(RecordsError, "inactive_contributor_permission"):
            self.load(permissions_path=self.permissions_path)

    def test_offline_inspection_explicitly_does_not_assert_current_eligibility(self):
        self.dataset, self.permissions = release_fixture(human_labels=True)
        self.build(human=True)
        self.permissions_path.unlink()
        result = self.load(recheck_current=False)
        self.assertFalse(result["current_eligibility_checked"])

    def test_synthetic_material_cannot_become_human_evidence_by_changing_flags(self):
        with self.assertRaisesRegex(RecordsError, "synthetic_material|human_permission"):
            self.build(human=True)
        self.build()
        manifest = load_dataset(self.output / "manifest.json")
        manifest.update(evidence_kind="human_review", engineering_only=False)
        (self.output / "manifest.json").write_text(json.dumps(manifest))
        (self.output / "release.sha256.json").write_text(json.dumps({"schema_kind": "dataset_release_digest",
            "schema_version": "1.0", "release_sha256": record_sha256(manifest)}))
        with self.assertRaisesRegex(RecordsError, "source material|operator-recorded"):
            self.load(recheck_current=False)

    def test_prior_history_cannot_disappear_or_change_after_release(self):
        marker = self.marker()
        self.build()
        marker.unlink()
        with self.assertRaisesRegex(RecordsError, "removed or changed"):
            self.load()

    def test_new_valid_unrelated_history_is_reaudited_and_corrupt_history_blocks(self):
        self.build()
        marker = self.marker()
        self.assertTrue(self.load()["valid"])
        marker.write_text("{}")
        with self.assertRaisesRegex(RecordsError, "invalid_run_evidence"):
            self.load()

    def test_private_canonical_output_and_input_paths_are_required(self):
        self.save()
        with self.assertRaisesRegex(RecordsError, "root/releases"):
            build_release(self.dataset_path, self.permissions_path, self.root, self.root / "runs/no",
                release_id="no", evidence_kind="synthetic_test")
        link = self.root / "input-link.json"
        link.symlink_to(self.dataset_path)
        with self.assertRaisesRegex(RecordsError, "symlink"):
            build_release(link, self.permissions_path, self.root, self.output,
                release_id=self.output.name, evidence_kind="synthetic_test")

    def test_input_mutation_during_audit_blocks_before_publication(self):
        self.save()
        from ht_tibetan import releases
        original = releases.audit_data_use
        def change_input(*args, **kwargs):
            result = original(*args, **kwargs)
            self.dataset_path.write_text(self.dataset_path.read_text() + " ")
            return result
        with patch.object(releases, "audit_data_use", side_effect=change_input), self.assertRaisesRegex(RecordsError, "changed during"):
            build_release(self.dataset_path, self.permissions_path, self.root, self.output,
                release_id=self.output.name, evidence_kind="synthetic_test")
        self.assertFalse(self.output.exists())

    def test_shipped_four_case_fixture_builds_without_human_evidence_and_has_exact_roles(self):
        self.dataset = load_dataset(FIXTURE.parent / "synthetic-release-dataset.json")
        self.permissions = load_dataset(FIXTURE.parent / "synthetic-release-permissions.json")
        manifest = self.build()
        self.assertEqual({item["purpose"]: item["example_count"] for item in manifest["splits"]},
                         {"train": 2, "validation": 1, "final_test": 1})
        self.assertEqual(len(self.load()["dataset"]["examples"]), 3)
        self.assertTrue(manifest["engineering_only"])

    def test_permission_snapshot_must_retain_its_recorded_evidence_identity(self):
        self.dataset, self.permissions = release_fixture(human_labels=True)
        self.build(human=True)
        # Even if a caller recalculates ordinary integrity hashes, changing the
        # permission evidence marker cannot leave a human release semantically valid.
        snapshot = load_dataset(self.output / "permissions.json")
        snapshot["evidence_kind"] = "synthetic_test"
        path = self.output / "permissions.json"
        path.write_text(json.dumps(snapshot))
        from ht_tibetan.releases import _read
        manifest = load_dataset(self.output / "manifest.json")
        manifest["inputs"]["permissions_canonical_sha256"] = record_sha256(snapshot)
        for entry in manifest["artifacts"]:
            if entry["path"] == "permissions.json":
                entry.update(_read(path)[1])
        (self.output / "manifest.json").write_text(json.dumps(manifest))
        (self.output / "release.sha256.json").write_text(json.dumps({"schema_kind": "dataset_release_digest",
            "schema_version": "1.0", "release_sha256": record_sha256(manifest)}))
        with self.assertRaisesRegex(RecordsError, "operator-recorded"):
            self.load(recheck_current=False)

    def test_orphan_source_cannot_smuggle_test_text_into_training_dataset(self):
        self.build()
        path = self.output / "datasets/train.json"
        data = load_dataset(path)
        orphan = deepcopy(self.dataset["sources"][2])
        orphan.update(source_id="renamed-orphan-source", permitted_uses=["review"], language_review="pending")
        data["sources"].append(orphan)
        path.write_text(json.dumps(data))
        from ht_tibetan.releases import _read
        manifest = load_dataset(self.output / "manifest.json")
        split = next(item for item in manifest["splits"] if item["purpose"] == "train")
        split["source_ids"].append(orphan["source_id"])
        split["source_ids"].sort()
        split["dataset_canonical_sha256"] = record_sha256(data)
        for entry in manifest["artifacts"]:
            if entry["path"] == "datasets/train.json":
                entry.update(_read(path)[1])
        (self.output / "manifest.json").write_text(json.dumps(manifest))
        (self.output / "release.sha256.json").write_text(json.dumps({"schema_kind": "dataset_release_digest",
            "schema_version": "1.0", "release_sha256": record_sha256(manifest)}))
        with self.assertRaisesRegex(RecordsError, "content or fixed split"):
            self.load()

    def test_engineering_permission_sidecar_cannot_be_unchecked_shared_text(self):
        self.permissions["extra_note"] = "Unstructured material does not belong in a permission ledger."
        with self.assertRaisesRegex(RecordsError, "Synthetic permission fixture is invalid.*schema"):
            self.build()
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
