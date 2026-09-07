"""Explicit instruction and output-budget conditions shared by train/evaluation.

No English wrapper is added around a declared Tibetan instruction. Text and
language declarations stay inspectable; this module cannot certify translation.
"""
from __future__ import annotations

import re
from .records import RecordsError, content_sha256, record_sha256

_FIELDS = {"condition_id", "instruction_language", "instruction_text", "output_language",
           "task_answer_kind", "max_output_tokens_by_candidate", "context_limit_tokens",
           "budget_basis", "instruction_review"}
_OPTIONAL = {"budget_evidence_sha256", "instruction_review_sha256"}
ENGINEERING_CONDITION = {
    "condition_id": "english-extraction-engineering-v1", "instruction_language": "en",
    "instruction_text": "Read the passage, then answer the question using only the passage. Return only the requested answer text. If the passage does not provide the answer, return UNKNOWN.",
    "output_language": "en", "task_answer_kind": "exact_text",
    "max_output_tokens_by_candidate": {"qwen3-4b-mlx-4bit": 32, "gemma3-4b-it-mlx-4bit": 32},
    "context_limit_tokens": 2048, "budget_basis": "engineering_limit", "instruction_review": "synthetic",
}


def validate_condition(condition: dict) -> None:
    if not isinstance(condition, dict) or not _FIELDS <= condition.keys() or set(condition) - _FIELDS - _OPTIONAL:
        raise RecordsError("A condition must explicitly declare its instruction, languages, task and model-specific budgets.")
    if not isinstance(condition["condition_id"], str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", condition["condition_id"]):
        raise RecordsError("Invalid condition ID.")
    for field in ("instruction_language", "output_language"):
        if condition[field] not in {"en", "zh", "bo"}:
            raise RecordsError("Declare instruction/output language as en, zh or bo.")
    instruction = condition["instruction_text"]
    if not isinstance(instruction, str) or not instruction.strip() or len(instruction) > 8192:
        raise RecordsError("Instruction text must be explicit, nonblank and bounded.")
    content_sha256(instruction)
    if condition["task_answer_kind"] not in {"exact_label", "exact_text", "source_span"}:
        raise RecordsError("Only predeclared constrained answer types are supported.")
    budgets = condition["max_output_tokens_by_candidate"]
    if not isinstance(budgets, dict) or not budgets or set(budgets) - {"qwen3-4b-mlx-4bit", "gemma3-4b-it-mlx-4bit"}:
        raise RecordsError("Supply explicit output token ceilings for supported candidates.")
    if any(type(value) is not int or not 1 <= value <= 512 for value in budgets.values()):
        raise RecordsError("Per-model output token ceilings must be between 1 and 512.")
    limit = condition["context_limit_tokens"]
    if type(limit) is not int or not 2 <= limit <= 8192 or any(value >= limit for value in budgets.values()):
        raise RecordsError("Context must include a nonempty prompt plus output, at most 8192 tokens.")
    if condition["budget_basis"] not in {"engineering_limit", "reviewed_task_budget"}:
        raise RecordsError("Declare whether token budgets are engineering bounds or reviewed task budgets.")
    if condition["instruction_review"] not in {"unreviewed", "reviewed", "synthetic"}:
        raise RecordsError("Instruction review status must be explicit.")
    for field in _OPTIONAL.intersection(condition):
        if not isinstance(condition[field], str) or not re.fullmatch(r"[0-9a-f]{64}", condition[field]):
            raise RecordsError("Condition evidence bindings must be SHA-256 hashes.")
    if condition["budget_basis"] == "reviewed_task_budget" and "budget_evidence_sha256" not in condition:
        raise RecordsError("Reviewed task budgets require an exact calibration evidence hash.")
    if condition["instruction_review"] == "reviewed" and "instruction_review_sha256" not in condition:
        raise RecordsError("Reviewed instructions require an exact review evidence hash.")


def condition_identity(condition: dict) -> dict:
    validate_condition(condition)
    return {"condition_id": condition["condition_id"], "instruction_language": condition["instruction_language"],
            "output_language": condition["output_language"], "instruction_sha256": content_sha256(condition["instruction_text"]),
            "condition_sha256": record_sha256(condition), "rendering_policy": "instruction-passage-question-blank-lines-v1"}


def task_messages(source: dict, example: dict, condition: dict) -> list[dict[str, str]]:
    validate_condition(condition)
    text, question = source["original_text"], example["question"]
    if not isinstance(text, str) or not text.strip() or not isinstance(question, str) or not question.strip():
        raise RecordsError("Task source and question must be nonblank strings.")
    return [{"role": "user", "content": condition["instruction_text"] + "\n\n" + text + "\n\n" + question}]
