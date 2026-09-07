"""Shared task-target rules before released training or evaluation exposure."""
from __future__ import annotations

from .records import RecordsError


def validate_task_target(source, example, condition, study=None):
    """Validate the reference against both its answer type and registered task.

    This checks the declared exact rule only. It does not supply or authenticate
    a native judgment that the reference correctly answers the question.
    """
    from .evaluation_scoring import _reference_index

    answer = example.get("approved_answer")
    kind = condition["task_answer_kind"]
    reference = {"example_id": example["example_id"], "condition_id": condition["condition_id"],
                 "task_answer_kind": kind, "approved_answer": answer, "source_text": source["original_text"]}
    task = None
    if study is not None:
        task = study.get("first_task")
        if not isinstance(task, dict):
            raise RecordsError("A study-bound target requires an explicit registered task.")
        if kind in {"exact_label", "source_span"}:
            reference["abstention_label"] = task["no_answer_label"]
    _reference_index([reference])
    if task is not None:
        if task["answer_kind"] == "exact_label":
            if kind != "exact_label" or answer not in set(task["labels"]) | {task["no_answer_label"]}:
                raise RecordsError("The released answer is outside the reviewed task labels/no-answer rule.")
        elif task["answer_kind"] == "extraction":
            if kind not in {"source_span", "exact_text"} or (
                    answer != task["no_answer_label"] and answer not in source["original_text"]):
                raise RecordsError("The released extraction answer must be an exact source span or reviewed no-answer label.")
        else:
            raise RecordsError("The released target requires a supported reviewed task.")
