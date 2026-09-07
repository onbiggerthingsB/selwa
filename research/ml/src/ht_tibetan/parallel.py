"""Bind permissioned Tibetan/Chinese material without asserting semantic equivalence.

This validator checks recorded review provenance, not the truth of a translation.
Synthetic contract fixtures never become human or language-quality evidence.
"""
from __future__ import annotations

from importlib.resources import files
import json
from typing import Any

from jsonschema import Draft202012Validator

from .records import RecordsError, example_sha256, record_sha256, require_valid_dataset
from .splits import audit_splits

CONDITIONS = ("bo_to_bo", "bo_to_zh", "zh_to_bo", "zh_to_zh")
PRESERVATION_CHECKS = ("facts", "numbers", "negation", "question_intent", "answerability",
                       "allowed_claims", "reference_answer_meaning")
_LANGUAGES = {"bo": "Tibetan", "zh": "Chinese"}


def pair_sha256(pair: dict) -> str:
    """Bind all pair content, member versions, authors, groups and permission IDs."""
    return record_sha256(pair)


def _schema_check(parallel: Any) -> None:
    try:
        record_sha256(parallel)
    except (TypeError, ValueError) as exc:
        raise RecordsError("Parallel material must contain finite JSON values.") from exc
    schema = json.loads(files("ht_tibetan_contracts").joinpath("parallel-material.schema.json").read_text(encoding="utf-8"))
    errors = sorted(Draft202012Validator(schema).iter_errors(parallel), key=lambda e: str(list(e.absolute_path)))
    if errors:
        raise RecordsError("Parallel material schema: " + "; ".join(
            "/" + "/".join(map(str, error.absolute_path)) + ": " + error.message for error in errors))


def _index(records: list[dict], key: str) -> dict[str, dict]:
    result = {}
    for record in records:
        if record[key] in result:
            raise RecordsError(f"Duplicate parallel {key}: {record[key]}.")
        result[record[key]] = record
    return result


def _selected_ids(values: Any, available: dict, name: str) -> list[str]:
    if (not isinstance(values, list) or not values or any(not isinstance(v, str) for v in values)
            or len(set(values)) != len(values) or not set(values) <= available.keys()):
        raise RecordsError(f"{name} must select existing unique identifiers.")
    return values


def _binding_matches(binding: dict, source: dict, example: dict) -> bool:
    return binding == {"source_id": source["source_id"], "source_version": source["version"],
        "source_sha256": source["content_sha256"], "example_id": example["example_id"],
        "example_version": example["version"], "example_sha256": example_sha256(example)}


def validate_parallel_material(dataset: Any, parallel: Any, *, purpose: str, pair_ids: list[str]) -> dict:
    """Raise before inference on stale material, missing permissions or review evidence.

All supplied sidecar records are checked, including unselected pair bindings and
review references. Only selected pairs need run eligibility. This does not assign
splits, translate text, resolve disagreements or grant any approval itself.
"""
    if purpose not in {"infrastructure_smoke", "language_baseline"}:
        raise RecordsError("Unknown parallel material purpose.")
    require_valid_dataset(dataset)
    _schema_check(parallel)
    pairs = _index(parallel["pairs"], "pair_id")
    permissions = _index(parallel["permissions"], "permission_id")
    reviews = _index(parallel["equivalence_reviews"], "review_id")
    decisions = _index(parallel["equivalence_adjudications"], "adjudication_id")
    _selected_ids(pair_ids, pairs, "pair_ids")
    sources = {s["source_id"]: s for s in dataset["sources"]}
    examples = {e["example_id"]: e for e in dataset["examples"]}
    source_decisions = {d["example_id"]: d for d in dataset["adjudications"]}
    required_kind = "synthetic_test" if purpose == "infrastructure_smoke" else "human_review"
    if parallel["evidence_kind"] != required_kind:
        raise RecordsError(f"{purpose} requires parallel evidence_kind {required_kind}.")
    bound_examples: set[str] = set()
    contributors: dict[str, set[str]] = {}
    for pair in pairs.values():
        contributors[pair["pair_id"]] = set(pair["translation_contributor_ids"])
        member_scopes = set()
        for language, binding in pair["members"].items():
            source = sources.get(binding["source_id"])
            example = examples.get(binding["example_id"])
            if source is None or example is None or example["source_id"] != source["source_id"]:
                raise RecordsError("Parallel member references missing or mismatched source/example records.")
            if not _binding_matches(binding, source, example):
                raise RecordsError("Stale parallel member: source/example version or exact hash changed.")
            if source["language"] != language:
                raise RecordsError("Parallel member source language must match its bo/zh declaration.")
            if any(example[field] != pair[field] for field in ("scenario_group", "paraphrase_group")):
                raise RecordsError("Both pair members must share the pair scenario_group and paraphrase_group.")
            if example["example_id"] in bound_examples:
                raise RecordsError("An example may belong to only one current parallel pair.")
            bound_examples.add(example["example_id"])
            contributors[pair["pair_id"]].add(example["contributor_id"])
            member_scopes.add(source["scope"])
        if len(member_scopes) != 1:
            raise RecordsError("Parallel versions must share clinical scope; health medical approval cannot be bypassed by relabeling a translation.")
        if set(pair["permission_record_ids"]) - permissions.keys():
            raise RecordsError("Parallel pair references an unknown derivative permission record.")
    for permission in permissions.values():
        source = sources.get(permission["source_id"])
        if source is None or (permission["source_version"], permission["source_sha256"]) != (
                source["version"], source["content_sha256"]):
            raise RecordsError("Derivative permission is bound to a missing or stale source.")
        if permission["evidence_kind"] != parallel["evidence_kind"]:
            raise RecordsError("Derivative permission evidence kind must match the material declaration.")
        if permission["status"] == "granted" and (not permission["granted_by"] or not permission["permission_evidence"].strip()):
            raise RecordsError("Granted derivative permissions need an explicit grantor and evidence reference.")
    identities = set()
    for review in reviews.values():
        pair = pairs.get(review["pair_id"])
        if pair is None or (review["pair_version"], review["parallel_pair_sha256"]) != (pair["version"], pair_sha256(pair)):
            raise RecordsError("Equivalence review is bound to a missing or stale pair.")
        if review["evidence_kind"] != parallel["evidence_kind"]:
            raise RecordsError("Equivalence review evidence kind must match the material declaration.")
        identity = (review["pair_id"], review["reviewer_id"])
        if identity in identities:
            raise RecordsError("Each pair requires distinct equivalence reviewers; duplicate reviewer identity.")
        identities.add(identity)
        if review["reviewer_id"] in contributors[review["pair_id"]]:
            raise RecordsError("Equivalence reviewers must be independent of source/question and translation contributors.")
        if review["status"] == "complete" and (review["independent_judgment"] is not True
                or set(review["reviewer_languages"]) != {"bo", "zh"}
                or any(review["checks"][key] is None for key in PRESERVATION_CHECKS)
                or review["minutes_spent"] is None or review["recommendation"] == "pending"):
            raise RecordsError("Complete equivalence review requires independent bilingual judgment and every preservation check.")
        if review["recommendation"] == "approve" and (review["status"] != "complete"
                or not all(review["checks"].values()) or review["issues"]):
            raise RecordsError("Equivalence approval requires every preservation check and no unresolved review issues.")
    decisions_by_pair = {}
    for decision in decisions.values():
        pair = pairs.get(decision["pair_id"])
        if pair is None or (decision["pair_version"], decision["parallel_pair_sha256"]) != (pair["version"], pair_sha256(pair)):
            raise RecordsError("Equivalence adjudication is bound to a missing or stale pair.")
        if decision["pair_id"] in decisions_by_pair:
            raise RecordsError("Keep one explicit current equivalence adjudication per pair.")
        decisions_by_pair[decision["pair_id"]] = decision
        if decision["evidence_kind"] != parallel["evidence_kind"]:
            raise RecordsError("Equivalence adjudication evidence kind must match the material declaration.")
        if decision["adjudicator_id"] in contributors[decision["pair_id"]]:
            raise RecordsError("Equivalence adjudicator must be independent of material contributors.")
        linked = []
        linked_ids = set()
        for binding in decision["review_bindings"]:
            review = reviews.get(binding["review_id"])
            if (review is None or review["pair_id"] != decision["pair_id"]
                    or record_sha256(review) != binding["review_sha256"] or review["review_id"] in linked_ids):
                raise RecordsError("Adjudication must bind distinct exact reviews of its current pair.")
            linked_ids.add(review["review_id"])
            linked.append(review)
        if decision["decision"] == "approve":
            supporters = [r for r in linked if r["status"] == "complete" and r["recommendation"] == "approve"]
            if len(supporters) < 2 or len(supporters) != len(linked) or decision["minutes_spent"] is None:
                raise RecordsError("Pair approval requires two independent supporting equivalence reviews and recorded adjudication time.")
            if not decision["rationale"].strip():
                raise RecordsError("Pair approval requires an explicit adjudication rationale.")
    audit = audit_splits(dataset)
    if not audit["valid"]:
        raise RecordsError("Parallel material split/exposure audit failed.")
    selected_examples = [pairs[pid]["members"][language]["example_id"] for pid in pair_ids for language in ("bo", "zh")]
    for component in audit["components"]:
        if set(selected_examples).intersection(component["example_ids"]):
            if component["splits"] != ["development_screen"] or any(
                    examples[eid]["split"] != "development_screen" for eid in component["example_ids"]):
                raise RecordsError("Every connected selected pair member needs a fixed development_screen split.")
            if any(role != "development_screen" for role in component["exposures"]):
                raise RecordsError("Selected parallel groups have prior training, validation or test exposure.")
    for pid in pair_ids:
        pair = pairs[pid]
        linked_permissions = [permissions[rid] for rid in pair["permission_record_ids"]]
        member_sources = {binding["source_id"] for binding in pair["members"].values()}
        if any(p["source_id"] not in member_sources for p in linked_permissions):
            raise RecordsError("A pair may reference derivative permissions only for its own member sources.")
        for binding in pair["members"].values():
            example, source = examples[binding["example_id"]], sources[binding["source_id"]]
            if not {"development_screen", "private_research", "review"} <= set(source["permitted_uses"]):
                raise RecordsError("Both sources need development_screen, private_research and review permission.")
            grants = [p for p in linked_permissions if p["source_id"] == source["source_id"] and p["status"] == "granted"]
            if not any({"translation", "parallel_evaluation"} <= set(p["permitted_derivatives"]) for p in grants):
                raise RecordsError("Both sources require explicit translation and parallel_evaluation derivative permission.")
            if source["unresolved_issues"]:
                raise RecordsError("Resolve source issues before a paired baseline.")
            if purpose == "infrastructure_smoke":
                if source["source_kind"] != "synthetic_fixture" or source["scope"] != "nonclinical":
                    raise RecordsError("Infrastructure smoke accepts declared synthetic nonclinical parallel fixtures only.")
            else:
                if source["source_kind"] == "synthetic_fixture":
                    raise RecordsError("Language baselines require actual reviewed material, not synthetic fixtures.")
                decision = source_decisions.get(example["example_id"], {})
                if (source["language_review"] != "approved" or example["review_state"] != "approved"
                        or decision.get("decision") != "approve" or decision.get("language_review") != "approved"):
                    raise RecordsError("Both language versions need approved source language and separately adjudicated examples.")
                if source["scope"] == "health" and (source["medical_review"] != "approved" or decision.get("medical_review") != "approved"):
                    raise RecordsError("Health pairs require qualified source and example medical approval for both versions.")
        if purpose == "language_baseline" and decisions_by_pair.get(pid, {}).get("decision") != "approve":
            raise RecordsError("Language baselines require separate approved bilingual equivalence adjudication.")
    return {"valid": True, "pair_ids": list(pair_ids), "example_ids": selected_examples,
        "parallel_material_sha256": record_sha256(parallel),
        "pairs": [{"pair_id": pid, "parallel_pair_sha256": pair_sha256(pairs[pid])} for pid in pair_ids],
        "split_audit": audit}


def condition_jobs(dataset: dict, parallel: dict, pair_ids: list[str], conditions: list[str]) -> list[dict]:
    """Expand already-validated material in pair-major, requested-condition order."""
    pairs = _index(parallel["pairs"], "pair_id")
    _selected_ids(pair_ids, pairs, "pair_ids")
    _selected_ids(conditions, dict.fromkeys(CONDITIONS), "conditions")
    examples = {e["example_id"] for e in dataset["examples"]}
    jobs = []
    for pid in pair_ids:
        pair = pairs[pid]
        for condition in conditions:
            input_language, output_language = condition.split("_to_")
            eid = pair["members"][input_language]["example_id"]
            if eid not in examples:
                raise RecordsError("Parallel condition references an unknown example.")
            jobs.append({"example_id": eid, "pair_id": pid, "condition_id": condition,
                "input_language": input_language, "output_language": output_language,
                "parallel_pair_sha256": pair_sha256(pair)})
    return jobs


def conversation_for_condition(source: dict, example: dict, output_language: str) -> list[dict[str, str]]:
    """Keep exact source/question bytes and request a language without leaking gold."""
    if output_language not in _LANGUAGES:
        raise RecordsError("Paired output language must be bo or zh.")
    instruction = ("Read the following passage and answer the question using only that passage. "
        "If the passage does not answer it, say that it does not provide the answer. "
        f"Answer in {_LANGUAGES[output_language]}.")
    return [{"role": "user", "content": instruction + "\n\nPassage:\n" + source["original_text"]
             + "\n\nQuestion:\n" + example["question"]}]
