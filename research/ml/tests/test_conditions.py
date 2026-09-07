from copy import deepcopy
import unittest

from ht_tibetan.conditions import ENGINEERING_CONDITION, condition_identity, task_messages, validate_condition
from ht_tibetan.records import RecordsError


class ConditionTests(unittest.TestCase):
    def test_rendering_adds_no_hidden_language_instruction_or_reference(self):
        condition = {**deepcopy(ENGINEERING_CONDITION), "instruction_text": "ཀ", "instruction_language": "bo"}
        result = task_messages({"original_text": "ཁ"}, {"question": "ག", "approved_answer": "never enter prompt"}, condition)
        self.assertEqual(result, [{"role": "user", "content": "ཀ\n\nཁ\n\nག"}])

    def test_language_budget_or_instruction_change_changes_identity(self):
        first = condition_identity(ENGINEERING_CONDITION)["condition_sha256"]
        for field, value in (("instruction_language", "zh"), ("instruction_text", "Return a label."),
                             ("max_output_tokens_by_candidate", {"qwen3-4b-mlx-4bit": 64})):
            with self.subTest(field=field):
                self.assertNotEqual(first, condition_identity({**deepcopy(ENGINEERING_CONDITION), field: value})["condition_sha256"])

    def test_context_overflow_and_implicit_budget_are_refused(self):
        for changes in ({"context_limit_tokens": 9000}, {"context_limit_tokens": 32},
                        {"max_output_tokens_by_candidate": {}}, {"max_output_tokens_by_candidate": {"qwen3-4b-mlx-4bit": True}}):
            with self.subTest(changes=changes), self.assertRaises(RecordsError):
                validate_condition({**deepcopy(ENGINEERING_CONDITION), **changes})

    def test_reviewed_declarations_need_exact_evidence_bindings(self):
        for change in ({"instruction_review": "reviewed"}, {"budget_basis": "reviewed_task_budget"}):
            with self.subTest(change=change), self.assertRaises(RecordsError):
                validate_condition({**deepcopy(ENGINEERING_CONDITION), **change})
        validate_condition({**deepcopy(ENGINEERING_CONDITION), "instruction_review": "reviewed",
            "instruction_review_sha256": "a" * 64, "budget_basis": "reviewed_task_budget", "budget_evidence_sha256": "b" * 64})
