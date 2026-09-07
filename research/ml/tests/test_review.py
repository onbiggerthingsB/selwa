import copy
import json
from pathlib import Path
import tempfile
import unittest

from ht_tibetan.records import RecordsError, example_sha256, load_dataset, validate_dataset
from ht_tibetan.review import export_review_packet, import_review_packet

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "fixtures"


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.dataset = load_dataset(FIXTURES / "synthetic-dataset.json")
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "speaker-a.json"

    def write(self, packet, path=None):
        (path or self.path).write_text(json.dumps(packet, ensure_ascii=False), encoding="utf-8")

    def export(self, path=None, reviewer="synthetic-reviewer-a"):
        return export_review_packet(self.dataset, path or self.path, reviewer, example_ids=["fixture-example-1"])

    def complete(self, packet, score=4):
        for item in packet["items"]:
            item["review"].update(ratings={"naturalness": score, "fidelity": score, "comprehension": score},
                                  minutes_spent=2.5, status="complete", recommendation="approve")
        return packet

    def test_blank_roundtrip_preserves_incomplete_and_original(self):
        before = copy.deepcopy(self.dataset)
        self.export()
        updated = import_review_packet(self.dataset, self.path)
        self.assertEqual(self.dataset, before)
        self.assertEqual(updated["reviews"][0]["status"], "incomplete")
        self.assertIsNone(updated["reviews"][0]["ratings"]["fidelity"])
        self.assertEqual(updated["examples"][0]["review_state"], "pending")
        self.assertTrue(validate_dataset(updated)["valid"])

    def test_independent_ratings_and_explicit_adjudication_roundtrip(self):
        # All ratings in this test are fabricated plumbing fixtures, never speaker evidence.
        self.dataset["examples"][0]["approved_answer"] = "It opens at nine."
        first = self.complete(self.export(), 5)
        second_path = Path(self.temp.name) / "speaker-b.json"
        second = self.complete(self.export(second_path, "synthetic-reviewer-b"), 3)
        self.write(first)
        self.write(second, second_path)
        updated = import_review_packet(self.dataset, self.path)
        updated = import_review_packet(updated, second_path)
        self.assertEqual([r["ratings"]["fidelity"] for r in updated["reviews"]], [5, 3])
        self.assertEqual(updated["examples"][0]["review_state"], "pending")
        example = updated["examples"][0]
        updated["adjudications"].append({"adjudication_id": "synthetic-decision-1", "example_id": example["example_id"],
            "example_version": example["version"], "example_sha256": example_sha256(example),
            "review_ids": [r["review_id"] for r in updated["reviews"]], "adjudicator_id": "synthetic-coordinator",
            "decision": "approve", "language_review": "approved", "medical_review": "not_applicable",
            "rationale": "Synthetic test of explicit adjudication; not a real language assessment.", "minutes_spent": 1})
        example["review_state"] = "approved"
        self.assertTrue(validate_dataset(updated)["valid"], validate_dataset(updated))
        self.assertEqual([r["ratings"]["fidelity"] for r in updated["reviews"]], [5, 3])

    def test_duplicate_import_and_overwrite_are_rejected(self):
        self.export()
        updated = import_review_packet(self.dataset, self.path)
        with self.assertRaises(RecordsError):
            import_review_packet(updated, self.path)
        with self.assertRaises(FileExistsError):
            self.export()

    def test_partial_review_can_complete_without_overwriting_history(self):
        packet = self.export()
        partial = import_review_packet(self.dataset, self.path)
        self.write(self.complete(packet))
        completed = import_review_packet(partial, self.path)
        self.assertEqual([r["status"] for r in completed["reviews"]], ["incomplete", "complete"])
        self.assertEqual([r["revision"] for r in completed["reviews"]], [1, 2])
        self.assertEqual(completed["reviews"][1]["supersedes_review_id"], completed["reviews"][0]["review_id"])
        self.assertIsNone(completed["reviews"][0]["ratings"]["fidelity"])
        with self.assertRaises(RecordsError):
            import_review_packet(completed, self.path)

    def test_partial_review_can_be_reexported_and_old_branch_rejected(self):
        original_packet = self.export()
        partial = import_review_packet(self.dataset, self.path)
        new_path = Path(self.temp.name) / "partial-followup.json"
        followup = export_review_packet(partial, new_path, "synthetic-reviewer-a", example_ids=["fixture-example-1"])
        self.write(self.complete(followup), new_path)
        completed = import_review_packet(partial, new_path)
        self.assertEqual(completed["reviews"][-1]["revision"], 2)
        self.write(self.complete(original_packet))
        with self.assertRaises(RecordsError):
            import_review_packet(completed, self.path)

    def test_medical_rejection_cannot_be_used_as_approval_evidence(self):
        packet = export_review_packet(self.dataset, self.path, "synthetic-clinician", "clinician", "medical", ["fixture-example-1"])
        self.complete(packet)
        packet["items"][0]["review"]["recommendation"] = "reject"
        self.write(packet)
        updated = import_review_packet(self.dataset, self.path)
        example = updated["examples"][0]
        updated["adjudications"].append({"adjudication_id": "synthetic-medical-decision", "example_id": example["example_id"],
            "example_version": example["version"], "example_sha256": example_sha256(example),
            "review_ids": [updated["reviews"][0]["review_id"]], "adjudicator_id": "synthetic-coordinator",
            "decision": "pending", "language_review": "pending", "medical_review": "approved",
            "rationale": "Intentionally invalid test override of a medical rejection.", "minutes_spent": 1})
        self.assertIn("medical_evidence", {e["code"] for e in validate_dataset(updated)["errors"]})

    def test_tampering_rejected_even_when_submitted_hash_is_recomputed(self):
        packet = self.export()
        for change in (lambda p: p.update(reviewer_id="replacement"),
                       lambda p: p["items"][0]["example"].update(question="Changed?"),
                       lambda p: p["items"][0]["source"].update(version=2),
                       lambda p: p["items"][0]["review"].update(example_version=2),
                       lambda p: p["items"].append(copy.deepcopy(p["items"][0]))):
            altered = copy.deepcopy(packet)
            change(altered)
            self.write(altered)
            with self.assertRaises(RecordsError):
                import_review_packet(self.dataset, self.path)

    def test_stale_source_metadata_rejected(self):
        self.export()
        self.dataset["sources"][0]["title"] = "An updated source title"
        with self.assertRaises(RecordsError):
            import_review_packet(self.dataset, self.path)

    def test_unrated_complete_and_unqualified_medical_are_rejected(self):
        packet = self.export()
        packet["items"][0]["review"]["status"] = "complete"
        self.write(packet)
        with self.assertRaises(RecordsError):
            import_review_packet(self.dataset, self.path)
        with self.assertRaises(RecordsError):
            export_review_packet(self.dataset, Path(self.temp.name) / "medical.json", "speaker", review_type="medical")

    def test_explicit_review_permission_required(self):
        self.dataset["sources"][0]["permitted_uses"].remove("review")
        with self.assertRaises(RecordsError):
            self.export()
        self.assertFalse(self.path.exists())

    def test_output_is_new_file_and_receipt_can_be_separate(self):
        self.export()
        submission = Path(self.temp.name) / "returned.json"
        submission.write_bytes(self.path.read_bytes())
        output = Path(self.temp.name) / "merged.json"
        updated = import_review_packet(self.dataset, submission, output, str(self.path) + ".receipt.json")
        self.assertEqual(load_dataset(output), updated)
        with self.assertRaises(FileExistsError):
            import_review_packet(self.dataset, submission, output, str(self.path) + ".receipt.json")


if __name__ == "__main__":
    unittest.main()
