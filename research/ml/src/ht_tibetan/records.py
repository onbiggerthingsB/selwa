"""Versioned research records; text is hashed exactly as supplied, never normalized."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from importlib.resources import files
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker


class RecordsError(ValueError):
    """Malformed or inconsistent research data."""


def content_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def record_sha256(record: Any) -> str:
    """Canonical JSON serialization preserves exact Unicode string contents."""
    payload = json.dumps(record, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return content_sha256(payload)


def example_sha256(example: dict[str, Any]) -> str:
    """Bind reviewed content, excluding mutable workflow state and exposure metadata.

    Approval and split assignment must not invalidate the content just reviewed. All
    other fields, including source version, groups, contributor and exact text, bind.
    """
    return record_sha256({key: value for key, value in example.items()
                          if key not in {"review_state", "split", "exposures"}})


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise RecordsError(f"Duplicate JSON object key: {key}")
        value[key] = item
    return value


def load_dataset(path: str | Path) -> dict[str, Any]:
    """Read strict JSON. Validation is explicit through validate_dataset()."""
    def invalid_constant(value: str) -> None:
        raise RecordsError(f"Non-finite JSON number: {value}")

    try:
        return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=_unique_object,
                          parse_constant=invalid_constant)
    except (json.JSONDecodeError, UnicodeError) as exc:
        raise RecordsError(f"Invalid JSON: {exc}") from exc


def atomic_write_json(path: str | Path, value: Any) -> None:
    """Create a private output atomically and refuse to overwrite any existing path."""
    target = Path(path)
    payload = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, target)  # Atomic create-if-absent; unlike replace(), never clobbers.
    finally:
        Path(temporary).unlink(missing_ok=True)


def validate_record(record: Any, definition: str) -> list[dict[str, str]]:
    """Validate one of the shared JSON Schema 2020-12 definitions."""
    try:
        json.dumps(record, allow_nan=False)
    except (TypeError, ValueError) as exc:
        return [{"path": "/", "code": "schema", "message": f"Record must contain finite JSON values: {exc}"}]
    schema = json.loads(files("ht_tibetan_contracts").joinpath("records.schema.json").read_text(encoding="utf-8"))
    if definition not in schema["$defs"]:
        raise RecordsError(f"Unknown contract: {definition}")
    schema["$ref"] = f"#/$defs/{definition}"
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    return [{"path": "/" + "/".join(map(str, error.absolute_path)), "code": "schema",
             "message": error.message}
            for error in sorted(validator.iter_errors(record), key=lambda error: str(list(error.absolute_path)))]


def validate_dataset(dataset: Any) -> dict[str, Any]:
    """Check schema, bindings, permissions and review provenance without approving data.

    Split grouping is a separate audit_splits() operation. Incomplete submissions remain
    valid drafts, but may not grant training eligibility or example approval.
    Adjudication provenance reports reviewer overlap; adjudication is not an
    additional independent review, including when performed by a third person.
    """
    errors = validate_record(dataset, "dataset")
    counts = {key: len(dataset.get(key, [])) if isinstance(dataset, dict) and isinstance(dataset.get(key), list) else 0
              for key in ("sources", "examples", "reviews", "adjudications")}
    adjudication_provenance: list[dict[str, Any]] = []
    if errors:
        return {"valid": False, "errors": errors, "counts": counts,
                "adjudication_provenance": adjudication_provenance}

    def error(path: str, code: str, message: str) -> None:
        errors.append({"path": path, "code": code, "message": message})

    indexes: dict[str, dict[str, Any]] = {}
    for collection, key in (("sources", "source_id"), ("examples", "example_id"),
                            ("reviews", "review_id"), ("adjudications", "adjudication_id")):
        indexes[collection] = {}
        for i, record in enumerate(dataset[collection]):
            if record[key] in indexes[collection]:
                error(f"/{collection}/{i}/{key}", "duplicate_id", f"Duplicate {key}: {record[key]}")
            indexes[collection][record[key]] = record
    sources, examples, reviews = (indexes[key] for key in ("sources", "examples", "reviews"))
    for i, source in enumerate(dataset["sources"]):
        if content_sha256(source["original_text"]) != source["content_sha256"]:
            error(f"/sources/{i}/content_sha256", "source_hash", "Hash does not match exact original UTF-8 text.")
        if source["scope"] == "health" and source["medical_review"] == "not_applicable":
            error(f"/sources/{i}/medical_review", "medical_scope", "Health content requires an explicit medical review state.")
        if source["source_kind"] == "synthetic_fixture" and source["scope"] != "nonclinical":
            error(f"/sources/{i}/scope", "fixture_scope", "Synthetic fixtures must be nonclinical.")

    for i, example in enumerate(dataset["examples"]):
        path = f"/examples/{i}"
        source = sources.get(example["source_id"])
        if source is None:
            error(path + "/source_id", "missing_source", "Source card does not exist.")
            continue
        if (example["source_version"], example["source_sha256"]) != (source["version"], source["content_sha256"]):
            error(path, "stale_source", "Example is not bound to the current source version and hash.")
        if example["split"] != "unassigned" and example["split"] not in source["permitted_uses"]:
            error(path + "/split", "permission", "Source does not permit the assigned use.")
        for exposure in example["exposures"]:
            if exposure not in source["permitted_uses"]:
                error(path + "/exposures", "permission", f"Source does not permit recorded exposure: {exposure}.")
        if example["review_state"] == "approved" and not example["approved_answer"]:
            error(path + "/approved_answer", "missing_answer", "Approved examples require an approved answer.")
        if example["split"] in ("train", "smoke_training"):
            if example["review_state"] != "approved" or source["language_review"] != "approved":
                error(path, "training_review", "Training requires explicit example and source language approval.")
            if source["unresolved_issues"]:
                error(path, "training_issues", "Resolve source issues before training export.")
            if source["scope"] == "health" and source["medical_review"] != "approved":
                error(path, "training_medical", "Pending or rejected health material cannot enter training.")

    identities: set[tuple[str, str, str]] = set()
    superseded: set[str] = set()
    for i, review in enumerate(dataset["reviews"]):
        path = f"/reviews/{i}"
        example = examples.get(review["example_id"])
        if example is None:
            error(path, "missing_example", "Reviewed example does not exist.")
            continue
        if (review["example_version"], review["example_sha256"], review["source_sha256"]) != (
                example["version"], example_sha256(example), example["source_sha256"]):
            error(path, "stale_review", "Review is not bound to the current complete example and source.")
        identity = (review["example_id"], review["reviewer_id"], review["review_type"])
        prior_id = review["supersedes_review_id"]
        if prior_id is None:
            if identity in identities or review["revision"] != 1:
                error(path, "duplicate_reviewer", "Each reviewer/example/type has one initial review and a single revision chain.")
            identities.add(identity)
        else:
            prior = reviews.get(prior_id)
            if prior_id in superseded:
                error(path, "review_revision", "A review may have only one succeeding revision.")
            superseded.add(prior_id)
            if (prior is None or prior["revision"] + 1 != review["revision"] or prior["status"] != "incomplete"
                    or (prior["example_id"], prior["reviewer_id"], prior["review_type"], prior["reviewer_role"], prior["example_sha256"])
                    != (review["example_id"], review["reviewer_id"], review["review_type"], review["reviewer_role"], review["example_sha256"])):
                error(path, "review_revision", "Revision must succeed the same reviewer's incomplete review of unchanged content.")
        if review["review_type"] == "medical" and review["reviewer_role"] not in ("clinician", "dietitian"):
            error(path, "review_role", "Medical review requires a qualified reviewer role.")
        if review["status"] == "complete":
            required = ("naturalness", "fidelity", "comprehension") if review["review_type"] == "language" else ("fidelity", "comprehension")
            if any(review["ratings"][key] is None for key in required) or review["minutes_spent"] is None or review["recommendation"] == "pending":
                error(path, "incomplete_review", "Complete review requires its ratings, recorded time and explicit recommendation.")

    approved_examples: dict[str, dict[str, Any]] = {}
    adjudicated: set[str] = set()
    for i, decision in enumerate(dataset["adjudications"]):
        path = f"/adjudications/{i}"
        example = examples.get(decision["example_id"])
        if example is None:
            error(path, "missing_example", "Adjudicated example does not exist.")
            continue
        if decision["example_id"] in adjudicated:
            error(path, "duplicate_adjudication", "Keep one explicit current adjudication per example.")
        adjudicated.add(decision["example_id"])
        if (decision["example_version"], decision["example_sha256"]) != (example["version"], example_sha256(example)):
            error(path, "stale_adjudication", "Adjudication is not bound to the current example.")
        linked = [reviews[rid] for rid in decision["review_ids"] if rid in reviews]
        if len(linked) != len(decision["review_ids"]) or any(r["example_id"] != example["example_id"] for r in linked):
            error(path, "adjudication_reviews", "Adjudication references missing reviews or reviews of another example.")
        # A stale, incomplete, superseded or unrelated review cannot supply
        # supporting evidence, even though its own validation also fails above.
        completed = [r for r in linked if r["status"] == "complete"
                     and r["review_id"] not in superseded
                     and (r["example_id"], r["example_version"], r["example_sha256"], r["source_sha256"])
                     == (example["example_id"], example["version"], example_sha256(example), example["source_sha256"])
                     and r["minutes_spent"] is not None and r["recommendation"] != "pending"
                     and all(r["ratings"][key] is not None for key in (
                         ("naturalness", "fidelity", "comprehension") if r["review_type"] == "language"
                         else ("fidelity", "comprehension")))]
        language_reviews = [r for r in completed if r["review_type"] == "language"
                            and r["reviewer_id"] != example["contributor_id"]]
        language_reviewer_ids = sorted({r["reviewer_id"] for r in language_reviews})
        overlapping_reviews = sorted(r["review_id"] for r in linked
                                     if r["example_id"] == example["example_id"]
                                     and r["reviewer_id"] == decision["adjudicator_id"])
        adjudication_provenance.append({
            "adjudication_id": decision["adjudication_id"], "example_id": example["example_id"],
            "adjudicator_id": decision["adjudicator_id"],
            "adjudicator_is_contributor": decision["adjudicator_id"] == example["contributor_id"],
            "adjudicator_reviewer_overlap": bool(overlapping_reviews),
            "overlapping_review_ids": overlapping_reviews,
            "complete_independent_language_reviewer_ids": language_reviewer_ids,
            "complete_independent_language_reviewer_count": len(language_reviewer_ids),
        })
        if decision["adjudicator_id"] == example["contributor_id"]:
            error(path + "/adjudicator_id", "adjudicator_independence", "An example contributor cannot adjudicate their own example.")
        if decision["language_review"] == "approved":
            if len(language_reviewer_ids) < 2:
                error(path, "independent_review", "Language approval requires two completed independent non-author language reviews of the current content.")
            if not any(r["recommendation"] == "approve" for r in language_reviews):
                error(path, "language_evidence", "Language approval requires a supporting completed independent language review; unchanged rejected or revision-requested content cannot supply approval.")
        if decision["medical_review"] == "approved" and not any(r["review_type"] == "medical" and r["reviewer_role"] in ("clinician", "dietitian") and r["recommendation"] == "approve" for r in completed):
            error(path, "medical_evidence", "Medical approval requires a completed supporting qualified medical review; a rejected review cannot supply approval.")
        if (decision["decision"] != "pending" or decision["language_review"] == "approved"
                or decision["medical_review"] == "approved") and not decision["rationale"].strip():
            error(path + "/rationale", "adjudication_rationale", "An adjudicated outcome requires a nonblank rationale.")
        if decision["decision"] == "approve":
            if decision["minutes_spent"] is None:
                error(path, "adjudication_time", "Completed approval needs recorded adjudication time.")
            if decision["language_review"] != "approved":
                error(path, "adjudication_state", "Approval requires an explicit approved language outcome.")
            else:
                approved_examples[example["example_id"]] = decision
    for i, example in enumerate(dataset["examples"]):
        if example["review_state"] == "approved" and example["example_id"] not in approved_examples:
            error(f"/examples/{i}/review_state", "missing_adjudication", "Approval requires an explicit adjudication; individual ratings do not approve examples.")
        if example["split"] in ("train", "smoke_training") and sources.get(example["source_id"], {}).get("scope") == "health":
            if approved_examples.get(example["example_id"], {}).get("medical_review") != "approved":
                error(f"/examples/{i}", "training_medical", "Health training requires approved medical adjudication of the example as well as its source.")
    return {"valid": not errors, "errors": errors, "counts": counts,
            "adjudication_provenance": adjudication_provenance}


def require_valid_dataset(dataset: Any) -> None:
    report = validate_dataset(dataset)
    if not report["valid"]:
        raise RecordsError("; ".join(f"{item['path']}: {item['message']}" for item in report["errors"]))
