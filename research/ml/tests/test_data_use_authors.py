"""Recorded-authorship approval tests; all people, consent and reviews are fixtures."""
from copy import deepcopy
import unittest

from ht_tibetan.data_use import audit_data_use
from ht_tibetan.records import RecordsError, example_sha256, validate_dataset
import test_baseline as baseline_fixtures
from test_contribution_permissions import NOW, synthetic_grant


class DataUseAuthorTests(unittest.TestCase):
    def setUp(self):
        self.fixture = baseline_fixtures.BaselineTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.approved_contract_stub()
        self.dataset = self.fixture.dataset
        self.permissions = baseline_fixtures.permission_contract_stub(self.dataset)
        self.example = self.dataset["examples"][0]
        self.decision = self.dataset["adjudications"][0]

    def audit(self, *, purpose="development_screen"):
        return audit_data_use(self.dataset, self.permissions, self.fixture.directory,
            purpose=purpose, example_ids=[self.example["example_id"]], as_of=NOW)[1]

    def assert_blocked(self, code):
        self.assertTrue(validate_dataset(self.dataset)["valid"], "Standalone legacy validation remains compatible.")
        report = self.audit()
        self.assertFalse(report["valid"], report)
        self.assertIn(code, {item["code"] for item in report["errors"]}, report)
        return report

    def source_author(self, author_id):
        source = self.dataset["sources"][0]
        declaration = next(item for item in self.permissions["source_contributors"] if item["source_id"] == source["source_id"])
        declaration["contributor_ids"] = [author_id]
        grant = next(item for item in self.permissions["grants"] if item["contribution_kind"] == "source_text" and item["source_id"] == source["source_id"])
        grant["contributor_id"] = author_id

    def coauthor(self, author_id, *, declare=True):
        if declare:
            self.permissions["example_contributors"] = [{"example_id": self.example["example_id"],
                "example_version": self.example["version"], "example_sha256": example_sha256(self.example),
                "contributor_ids": [self.example["contributor_id"], author_id]}]
        grant = synthetic_grant(self.example, grant_id="additional-author-grant")
        grant["contributor_id"] = author_id
        self.permissions["grants"].append(grant)

    def third_review(self, *, reviewer_id="independent-reviewer-3", recommendation="approve"):
        review = {**deepcopy(self.dataset["reviews"][0]), "review_id": "additional-independent-review",
                  "reviewer_id": reviewer_id, "recommendation": recommendation}
        self.dataset["reviews"].append(review)
        self.decision["review_ids"].append(review["review_id"])
        return review

    def test_source_author_cannot_supply_one_of_two_independent_reviews(self):
        self.source_author("contract-reviewer-1")
        report = self.assert_blocked("known_author_review_independence")
        provenance = report["author_independence"][0]
        self.assertEqual(provenance["complete_independent_language_reviewer_ids"], ["contract-reviewer-2"])
        self.assertEqual(provenance["excluded_author_review_ids"], ["contract-review-0-1"])

    def test_additional_example_author_is_excluded_even_if_declaration_was_removed(self):
        for declare in (True, False):
            with self.subTest(declare=declare):
                self.permissions = baseline_fixtures.permission_contract_stub(self.dataset)
                self.coauthor("contract-reviewer-1", declare=declare)
                self.assert_blocked("known_author_review_independence")

    def test_source_author_and_coauthor_cannot_adjudicate(self):
        for kind in ("source", "example"):
            with self.subTest(kind=kind):
                self.permissions = baseline_fixtures.permission_contract_stub(self.dataset)
                if kind == "source":
                    self.source_author("contract-adjudicator")
                else:
                    self.coauthor("contract-adjudicator")
                self.assert_blocked("known_author_adjudicator")

    def test_only_author_approval_cannot_support_two_independent_rejections(self):
        self.coauthor("contract-reviewer-1")
        self.dataset["reviews"][1]["recommendation"] = "reject"
        self.third_review(recommendation="reject")
        report = self.assert_blocked("known_author_language_evidence")
        self.assertEqual(report["author_independence"][0]["complete_independent_language_reviewer_count"], 2)

    def test_two_other_reviewers_supply_independence_and_one_may_support_approval(self):
        self.source_author("contract-reviewer-1")
        self.third_review(recommendation="reject")
        report = self.audit()
        self.assertTrue(report["valid"], report)
        self.assertEqual(report["author_independence"][0]["complete_independent_language_reviewer_count"], 2)

    def test_real_baseline_rejects_author_review_before_model_or_tokenizer_loading(self):
        self.source_author("contract-reviewer-1")
        self.fixture.permissions = self.permissions
        with self.assertRaisesRegex(RecordsError, "known_author_review_independence"):
            self.fixture.run_case()
        self.fixture.verifier.assert_not_called()
        self.fixture.loader.assert_not_called()
        self.assertEqual(self.fixture.calls, [])

    def test_unrelated_source_and_example_authors_do_not_block_selected_reviewers(self):
        other_example = self.dataset["examples"][1]
        self.permissions["grants"][1]["contributor_id"] = "contract-reviewer-1"
        self.permissions["source_contributors"][1]["contributor_ids"] = ["contract-reviewer-2"]
        self.permissions["grants"][3]["contributor_id"] = "contract-reviewer-2"
        # The unrelated grant need not clear the unselected example's contributor;
        # selected source/example ownership is the only applicable identity scope.
        self.assertNotEqual(other_example["example_id"], self.example["example_id"])
        report = self.audit()
        self.assertTrue(report["valid"], report)
        self.assertNotIn("contract-reviewer-1", report["author_independence"][0]["known_author_ids"])
        self.assertNotIn("contract-reviewer-2", report["author_independence"][0]["known_author_ids"])

    def test_non_author_reviewer_can_adjudicate_with_overlap_disclosed(self):
        self.decision["adjudicator_id"] = "contract-reviewer-1"
        report = self.audit()
        self.assertTrue(report["valid"], report)
        provenance = report["author_independence"][0]
        self.assertTrue(provenance["adjudicator_reviewer_overlap"])
        self.assertEqual(provenance["overlapping_review_ids"], ["contract-review-0-1"])
        self.assertFalse(provenance["adjudicator_is_known_author"])

    def test_review_purpose_still_accepts_permissioned_drafts(self):
        self.source_author("contract-reviewer-1")
        self.coauthor("contract-adjudicator")
        self.example["review_state"] = "pending"
        self.dataset["sources"][0]["language_review"] = "pending"
        self.dataset["reviews"] = []
        self.dataset["adjudications"] = []
        for example in self.dataset["examples"]:
            example["review_state"] = "pending"
        report = self.audit(purpose="review")
        self.assertTrue(report["valid"], report)
        self.assertEqual(report["author_independence"], [])

    def test_private_research_is_also_a_real_nonreview_approval_gate(self):
        self.coauthor("contract-reviewer-1")
        report = self.audit(purpose="private_research")
        self.assertFalse(report["valid"], report)
        self.assertIn("known_author_review_independence", {item["code"] for item in report["errors"]})


if __name__ == "__main__":
    unittest.main()
