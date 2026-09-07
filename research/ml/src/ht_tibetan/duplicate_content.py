"""Deterministic content links for split and exposure audits.

These are conservative duplicate screens, not semantic similarity checks. Original
records are never normalized or rewritten; normalized text exists only while
computing a derivative fingerprint.
"""

from __future__ import annotations

import hashlib
import json
import unicodedata
from typing import Any


GROUP_FIELDS = ("source_id", "source_sha256", "scenario_group", "paraphrase_group")
TASK_FINGERPRINT_FIELDS = ("task_exact_sha256", "task_normalized_sha256",
                           "question_answer_sha256", "question_answer_normalized_sha256")


def _normalized_text(text: str) -> str:
    """NFC and Unicode whitespace only: no case, punctuation or script folding."""
    return " ".join(unicodedata.normalize("NFC", text).split())


def _hash_payload(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def question_answer_keys(question: str, approved_answer: str | None) -> set[tuple[str, str]]:
    """Link answered tasks even when older mechanics data has no source/claims.

    Missing or whitespace-only answers produce no pair key, so drafts do not
    connect merely because their unanswered question matches. Both question and
    answer bind; common answers alone cannot merge distinct questions.
    """
    if approved_answer is None or not approved_answer.strip():
        return set()
    return {
        ("question_answer_sha256", _hash_payload({
            "question": question, "approved_answer": approved_answer})),
        ("question_answer_normalized_sha256", _hash_payload({
            "question": _normalized_text(question),
            "approved_answer": _normalized_text(approved_answer)})),
    }


def _task_fingerprint(example: dict[str, Any], *, normalized: bool) -> str:
    question = example["question"]
    answer = example["approved_answer"]
    claims = example["allowed_claims"]
    if normalized:
        question = _normalized_text(question)
        answer = None if answer is None else _normalized_text(answer)
        # Claim ordering is not a new task. Preserve duplicates to avoid silently
        # dropping supplied material, and preserve original order in the record.
        claims = sorted(_normalized_text(claim) for claim in claims)
    payload = {
        "question": question,
        "approved_answer": answer,
        "allowed_claims": claims,
    }
    return _hash_payload(payload)


def content_keys(example: dict[str, Any]) -> set[tuple[str, str]]:
    """Return stable links for an already validated example, across runs or splits.

    Identity, version, contributor and workflow changes cannot disguise identical
    tasks. A common answer alone does not connect different questions. Existing
    source/version-content/scenario/paraphrase links remain part of the result.
    """
    return {(field, example[field]) for field in GROUP_FIELDS} | {
        ("task_exact_sha256", _task_fingerprint(example, normalized=False)),
        ("task_normalized_sha256", _task_fingerprint(example, normalized=True)),
    } | question_answer_keys(example["question"], example["approved_answer"])


def screening_description() -> dict[str, Any]:
    """Machine-readable limits accompany every audit, including invalid input."""
    return {
        "exact_task_content": "question + approved_answer + ordered allowed_claims",
        "normalized_task_content": "NFC + Unicode whitespace collapse; claim order ignored",
        "answered_pair_content": "question + nonblank approved_answer, exact and NFC/whitespace-normalized, independent of claims",
        "near_overlap": "not_screened",
        "semantic_clearance": False,
        "limitation": "Different wording, translations and semantic overlap require human review; a clean audit does not establish semantic independence.",
    }
