"""Shared pre-exposure task checks with fabricated text and study declarations."""
from copy import deepcopy
import unittest
from unittest.mock import patch

from ht_tibetan.conditions import ENGINEERING_CONDITION
from ht_tibetan.records import RecordsError
from ht_tibetan.release_training import validate_training_target
from ht_tibetan.task_contract import validate_task_target


class TaskContractTests(unittest.TestCase):
    def setUp(self):
        self.source = {"original_text": "The room lends maps for three days."}
        self.example = {"example_id": "fabricated-example", "approved_answer": "YES"}
        self.condition = {**deepcopy(ENGINEERING_CONDITION), "task_answer_kind": "exact_label"}
        self.study = {"first_task": {"answer_kind": "exact_label", "labels": ["YES", "UNKNOWN"],
                                     "no_answer_label": "UNKNOWN"}}

    def test_registered_labels_and_no_answer_are_accepted(self):
        for answer in ("YES", "UNKNOWN"):
            self.example["approved_answer"] = answer
            validate_task_target(self.source, self.example, self.condition, self.study)

    def test_nonblank_reference_outside_registered_labels_is_rejected(self):
        for answer in ("NO", "yes", " YES ", "three days"):
            self.example["approved_answer"] = answer
            with self.subTest(answer=answer), self.assertRaisesRegex(RecordsError, "outside.*labels"):
                validate_task_target(self.source, self.example, self.condition, self.study)

    def test_extraction_requires_exact_span_or_declared_abstention(self):
        self.study["first_task"].update(answer_kind="extraction", labels=[])
        self.condition["task_answer_kind"] = "source_span"
        for answer in ("three days", "UNKNOWN"):
            self.example["approved_answer"] = answer
            validate_task_target(self.source, self.example, self.condition, self.study)
        self.example["approved_answer"] = "four days"
        with self.assertRaisesRegex(RecordsError, "exact span"):
            validate_task_target(self.source, self.example, self.condition, self.study)

    def test_task_kind_mismatch_and_missing_task_are_rejected(self):
        self.example["approved_answer"] = "three days"
        self.condition["task_answer_kind"] = "source_span"
        with self.assertRaisesRegex(RecordsError, "labels"):
            validate_task_target(self.source, self.example, self.condition, self.study)
        self.study["first_task"] = None
        with self.assertRaisesRegex(RecordsError, "explicit registered task"):
            validate_task_target(self.source, self.example, self.condition, self.study)

    def test_engineering_exact_text_remains_available_without_study(self):
        validate_task_target(self.source, self.example, ENGINEERING_CONDITION)

    def test_training_uses_shared_reference_rule(self):
        with patch("ht_tibetan.task_contract.validate_task_target") as validate:
            validate_training_target(self.source, self.example, self.condition, self.study)
        validate.assert_called_once_with(self.source, self.example, self.condition, self.study)
