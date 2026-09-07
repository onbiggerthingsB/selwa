import copy
from pathlib import Path
import unittest

from ht_tibetan.duplicate_content import content_keys, question_answer_keys
from ht_tibetan.records import load_dataset
from ht_tibetan.splits import audit_splits


FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "fixtures"


class DuplicateContentTests(unittest.TestCase):
    def setUp(self):
        self.dataset = load_dataset(FIXTURES / "synthetic-dataset.json")

    def task_keys(self, example):
        return {key: value for key, value in content_keys(example) if key.startswith("task_")}

    def copy_task(self):
        first, second = self.dataset["examples"]
        for field in ("question", "approved_answer", "allowed_claims"):
            second[field] = copy.deepcopy(first[field])
        second["split"] = "final_test"
        return first, second

    def test_identical_task_cannot_hide_under_new_ids_source_or_groups(self):
        first, second = self.copy_task()
        self.assertFalse({key for key in content_keys(first) if not key[0].startswith("task_")} &
                         {key for key in content_keys(second) if not key[0].startswith("task_")})
        report = audit_splits(self.dataset)
        self.assertFalse(report["valid"])
        self.assertEqual(len(report["components"]), 1)
        self.assertFalse(report["components"][0]["unseen_final_test"])
        self.assertIn("duplicate_content_cross_split", {error["code"] for error in report["errors"]})
        self.assertEqual({group["method"] for group in report["duplicate_groups"]},
                         {"task_exact_sha256", "task_normalized_sha256"})

    def test_nfc_whitespace_and_claim_order_are_derivative_links_only(self):
        first, second = self.copy_task()
        first.update(question="Where is the cafe\u0301?", approved_answer="On\tthe table.",
                     allowed_claims=["The cafe\u0301 is open.", "Hours\t vary."])
        second.update(question="  Where\n is the caf\u00e9? ", approved_answer="On the\n table.  ",
                      allowed_claims=["Hours vary.", "The caf\u00e9 is open."])
        original = copy.deepcopy(self.dataset)
        first_keys, second_keys = self.task_keys(first), self.task_keys(second)
        self.assertNotEqual(first_keys["task_exact_sha256"], second_keys["task_exact_sha256"])
        self.assertEqual(first_keys["task_normalized_sha256"], second_keys["task_normalized_sha256"])
        report = audit_splits(self.dataset)
        self.assertFalse(report["valid"])
        self.assertEqual({group["method"] for group in report["duplicate_groups"]},
                         {"task_normalized_sha256", "question_answer_normalized_sha256"})
        self.assertEqual(self.dataset, original)

    def test_common_answer_does_not_merge_distinct_questions(self):
        first, second = self.dataset["examples"]
        first.update(approved_answer="Yes.", allowed_claims=["Yes."])
        second.update(approved_answer="Yes.", allowed_claims=["Yes."], split="final_test")
        report = audit_splits(self.dataset)
        self.assertTrue(report["valid"])
        self.assertEqual(len(report["components"]), 2)
        self.assertEqual(report["duplicate_groups"], [])

    def test_claim_and_answer_changes_do_not_have_exact_fingerprints(self):
        first = self.dataset["examples"][0]
        for field, value in (("question", "Different question?"),
                             ("approved_answer", "New answer."),
                             ("allowed_claims", ["A different claim."])):
            changed = copy.deepcopy(first)
            changed[field] = value
            with self.subTest(field=field):
                self.assertNotEqual(self.task_keys(first), self.task_keys(changed))

    def test_case_punctuation_and_script_are_not_folded(self):
        first = self.dataset["examples"][0]
        for question in (first["question"].upper(), first["question"].replace("?", "."), "\u0f56\u0f7c\u0f51\u0f0d"):
            changed = copy.deepcopy(first)
            changed["question"] = question
            self.assertNotEqual(self.task_keys(first)["task_normalized_sha256"],
                                self.task_keys(changed)["task_normalized_sha256"])

    def test_task_keys_ignore_identity_permissions_and_review_workflow(self):
        first = self.dataset["examples"][0]
        changed = copy.deepcopy(first)
        changed.update(example_id="another-example", version=99, source_id="another-source",
                       source_version=99, source_sha256="a" * 64, contributor_id="another-author",
                       scenario_group="another-scenario", paraphrase_group="another-paraphrase",
                       register="another register", review_state="approved", split="final_test",
                       exposures=["smoke_training"])
        self.assertEqual(self.task_keys(first), self.task_keys(changed))
        self.assertEqual(len(content_keys(first)), 6)

    def test_duplicate_content_propagates_exposure_transitively(self):
        first, second = self.copy_task()
        first["exposures"] = ["development_screen"]
        third = copy.deepcopy(second)
        third.update(example_id="fixture-example-3", question="A different third question?")
        self.dataset["examples"].append(third)
        report = audit_splits(self.dataset)
        self.assertIn("test_leakage", {error["code"] for error in report["errors"]})
        self.assertEqual(len(report["components"]), 1)
        self.assertEqual(report["components"][0]["exposures"], ["development_screen"])

    def test_clean_audit_explicitly_does_not_clear_semantic_overlap(self):
        report = audit_splits(self.dataset)
        self.assertTrue(report["valid"])
        self.assertFalse(report["screening"]["semantic_clearance"])
        self.assertEqual(report["screening"]["near_overlap"], "not_screened")
        self.assertIn("semantic_overlap_not_screened", {warning["code"] for warning in report["warnings"]})

    def test_invalid_input_is_never_claimed_screened(self):
        self.dataset["examples"][0]["question"] = None
        report = audit_splits(self.dataset)
        self.assertFalse(report["valid"])
        self.assertEqual(report["duplicate_groups"], [])
        self.assertFalse(report["screening"]["semantic_clearance"])

    def test_null_answer_and_literal_null_string_are_not_identical(self):
        first, second = self.copy_task()
        second["approved_answer"] = "null"
        self.assertNotEqual(self.task_keys(first), self.task_keys(second))

    def test_answered_pair_matches_mechanics_without_source_or_claims(self):
        first = self.dataset["examples"][0]
        first["approved_answer"] = "It opens at nine."
        keys = question_answer_keys(first["question"], first["approved_answer"])
        self.assertEqual(len(keys), 2)
        self.assertTrue(keys <= content_keys(first))
        changed = copy.deepcopy(first)
        changed["allowed_claims"] = ["Additional allowed claim."]
        self.assertTrue(keys <= content_keys(changed))
        self.assertNotEqual(self.task_keys(first), self.task_keys(changed))

    def test_pair_derivative_normalizes_whitespace_without_mutating_inputs(self):
        exact = dict(question_answer_keys("Where is the cafe\u0301?", "On\tthe table."))
        changed = dict(question_answer_keys("Where is the caf\u00e9?", "On the table. "))
        self.assertNotEqual(exact["question_answer_sha256"], changed["question_answer_sha256"])
        self.assertEqual(exact["question_answer_normalized_sha256"],
                         changed["question_answer_normalized_sha256"])

    def test_empty_answers_do_not_produce_pair_keys(self):
        for answer in (None, "", " \n\t"):
            self.assertEqual(question_answer_keys("Same question?", answer), set())

    def test_pair_common_answer_does_not_connect_different_questions(self):
        self.assertFalse(question_answer_keys("Is the library open?", "Yes.") &
                         question_answer_keys("Is the notebook blue?", "Yes."))

    def test_answered_pair_cross_split_is_blocked_even_if_claims_change(self):
        first, second = self.copy_task()
        first["approved_answer"] = second["approved_answer"] = "It opens at nine."
        second["allowed_claims"] = ["It closes on Monday."]
        report = audit_splits(self.dataset)
        self.assertFalse(report["valid"])
        self.assertEqual({group["method"] for group in report["duplicate_groups"]},
                         {"question_answer_sha256", "question_answer_normalized_sha256"})


if __name__ == "__main__":
    unittest.main()
