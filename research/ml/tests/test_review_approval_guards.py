"""Fabricated review provenance only; these ratings are not native-speaker evidence."""

from copy import deepcopy
from pathlib import Path
import unittest

from ht_tibetan.records import example_sha256, load_dataset, validate_dataset


FIXTURE = Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "synthetic-dataset.json"


class ReviewApprovalGuardTests(unittest.TestCase):
    def setUp(self):
        self.dataset = load_dataset(FIXTURE)
        self.example = self.dataset["examples"][0]
        self.example.update(approved_answer="It opens at nine.", review_state="approved")
        self.reviews = self.dataset["reviews"]
        for index in (1, 2):
            self.reviews.append({
                "review_id": f"synthetic-review-{index}", "example_id": self.example["example_id"],
                "example_version": self.example["version"], "example_sha256": example_sha256(self.example),
                "source_sha256": self.example["source_sha256"], "reviewer_id": f"synthetic-reviewer-{index}",
                "reviewer_role": "language_reviewer", "review_type": "language",
                "ratings": {"naturalness": 4, "fidelity": 4, "comprehension": 4}, "issues": [],
                "minutes_spent": 1, "status": "complete", "recommendation": "approve",
                "revision": 1, "supersedes_review_id": None,
            })
        self.decision = {
            "adjudication_id": "synthetic-decision", "example_id": self.example["example_id"],
            "example_version": self.example["version"], "example_sha256": example_sha256(self.example),
            "review_ids": [r["review_id"] for r in self.reviews],
            "adjudicator_id": self.reviews[0]["reviewer_id"], "decision": "approve",
            "language_review": "approved", "medical_review": "not_applicable",
            "rationale": "Fabricated contract test of an explicit decision; never a human judgment.",
            "minutes_spent": 1,
        }
        self.dataset["adjudications"].append(self.decision)

    def report(self):
        return validate_dataset(self.dataset)

    def codes(self):
        return {item["code"] for item in self.report()["errors"]}

    def test_two_unanimous_rejects_cannot_approve_unchanged_training_example(self):
        source = self.dataset["sources"][0]
        source["language_review"] = "approved"
        source["permitted_uses"].append("train")
        self.example["split"] = "train"
        for review in self.reviews:
            review["recommendation"] = "reject"
        report = self.report()
        self.assertFalse(report["valid"])
        self.assertEqual({item["code"] for item in report["errors"]}, {"language_evidence"})

    def test_two_revision_requests_also_do_not_support_approval(self):
        for review in self.reviews:
            review["recommendation"] = "revise"
        self.assertIn("language_evidence", self.codes())

    def test_disagreement_can_be_adjudicated_by_one_of_two_reviewers(self):
        self.reviews[1]["recommendation"] = "reject"
        before = deepcopy(self.dataset)
        report = self.report()
        self.assertTrue(report["valid"], report)
        self.assertEqual(self.dataset, before)
        provenance = report["adjudication_provenance"][0]
        self.assertTrue(provenance["adjudicator_reviewer_overlap"])
        self.assertEqual(provenance["overlapping_review_ids"], [self.reviews[0]["review_id"]])
        self.assertEqual(provenance["complete_independent_language_reviewer_count"], 2)
        self.assertEqual(provenance["complete_independent_language_reviewer_ids"],
                         [review["reviewer_id"] for review in self.reviews])
        self.assertFalse(provenance["adjudicator_is_contributor"])

    def test_separate_adjudicator_is_reported_without_creating_third_review(self):
        self.decision["adjudicator_id"] = "synthetic-coordinator"
        report = self.report()
        self.assertTrue(report["valid"], report)
        provenance = report["adjudication_provenance"][0]
        self.assertFalse(provenance["adjudicator_reviewer_overlap"])
        self.assertEqual(provenance["overlapping_review_ids"], [])
        self.assertEqual(provenance["complete_independent_language_reviewer_count"], 2)
        self.assertEqual(report["counts"], {"sources": 2, "examples": 2, "reviews": 2, "adjudications": 1})

    def test_author_cannot_adjudicate_even_with_two_supporting_reviews(self):
        self.decision["adjudicator_id"] = self.example["contributor_id"]
        report = self.report()
        self.assertFalse(report["valid"])
        self.assertIn("adjudicator_independence", self.codes())
        self.assertTrue(report["adjudication_provenance"][0]["adjudicator_is_contributor"])

    def test_author_support_cannot_override_two_independent_rejections(self):
        author = deepcopy(self.reviews[0])
        author.update(review_id="synthetic-author-review", reviewer_id=self.example["contributor_id"])
        for review in self.reviews:
            review["recommendation"] = "reject"
        self.reviews.append(author)
        self.decision["review_ids"].append(author["review_id"])
        self.assertIn("language_evidence", self.codes())
        self.assertNotIn("independent_review", self.codes())

    def test_author_review_does_not_supply_second_independent_person(self):
        self.reviews[1]["reviewer_id"] = self.example["contributor_id"]
        self.assertIn("independent_review", self.codes())

    def test_unlinked_supporting_review_cannot_supply_approval(self):
        self.decision["review_ids"].pop(0)
        self.reviews[1]["recommendation"] = "reject"
        self.assertTrue({"independent_review", "language_evidence"}.issubset(self.codes()))

    def test_stale_supporting_review_is_rejected_and_not_counted(self):
        self.reviews[0]["example_sha256"] = "0" * 64
        self.reviews[1]["recommendation"] = "reject"
        self.assertTrue({"stale_review", "independent_review", "language_evidence"}.issubset(self.codes()))
        self.assertEqual(self.report()["adjudication_provenance"][0]["complete_independent_language_reviewer_count"], 1)

    def test_incomplete_or_unrated_supporting_review_is_not_counted(self):
        for field, value in (("status", "incomplete"), ("minutes_spent", None),
                             ("ratings", {"naturalness": None, "fidelity": 4, "comprehension": 4})):
            with self.subTest(field=field):
                prior = self.reviews[0][field]
                self.reviews[0][field] = value
                self.reviews[1]["recommendation"] = "reject"
                self.assertTrue({"independent_review", "language_evidence"}.issubset(self.codes()))
                self.reviews[0][field] = prior

    def test_missing_or_other_example_review_is_not_counted(self):
        self.decision["review_ids"][0] = "nonexistent-review"
        self.reviews[1]["recommendation"] = "reject"
        self.assertTrue({"adjudication_reviews", "independent_review", "language_evidence"}.issubset(self.codes()))
        self.decision["review_ids"][0] = self.reviews[0]["review_id"]
        other = self.dataset["examples"][1]
        self.reviews[0].update(example_id=other["example_id"], example_version=other["version"],
                               example_sha256=example_sha256(other), source_sha256=other["source_sha256"])
        self.assertTrue({"adjudication_reviews", "independent_review", "language_evidence"}.issubset(self.codes()))

    def test_duplicate_reviewer_does_not_supply_two_independent_people(self):
        self.reviews[1]["reviewer_id"] = self.reviews[0]["reviewer_id"]
        self.assertTrue({"duplicate_reviewer", "independent_review"}.issubset(self.codes()))

    def test_blank_rationale_cannot_resolve_disagreement(self):
        self.reviews[1]["recommendation"] = "reject"
        self.decision["rationale"] = " \t\n"
        self.assertIn("adjudication_rationale", self.codes())

    def test_language_approval_preserves_separate_source_scope_and_training_medical_gates(self):
        source = self.dataset["sources"][0]
        source.update(source_kind="community", scope="health", language_review="approved")
        self.assertIn("medical_scope", self.codes())
        source["medical_review"] = "pending"
        # Language-only adjudication does not pretend clinical review happened.
        self.assertTrue(self.report()["valid"], self.report())
        source["permitted_uses"].append("train")
        self.example["split"] = "train"
        self.assertIn("training_medical", self.codes())

    def test_stale_adjudication_and_other_validation_errors_remain_visible(self):
        self.decision["example_sha256"] = "0" * 64
        self.dataset["sources"][0]["version"] = 2
        self.assertTrue({"stale_adjudication", "stale_source"}.issubset(self.codes()))

    def test_schema_failure_keeps_existing_report_fields_and_empty_provenance(self):
        self.decision["unknown"] = True
        report = self.report()
        self.assertFalse(report["valid"])
        self.assertTrue(report["errors"])
        self.assertEqual(report["counts"]["adjudications"], 1)
        self.assertEqual(report["adjudication_provenance"], [])


if __name__ == "__main__":
    unittest.main()
