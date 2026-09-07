"""Study registration, descriptive reviewer agreement and explicit model decisions.

No computed score selects a model or grants training permission. Human identity,
review independence and consent remain recorded operator declarations.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
from importlib.resources import files
import json
import math
from pathlib import Path
import re
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from .records import RecordsError, content_sha256, load_dataset, record_sha256

AXES = ("fidelity", "comprehension", "naturalness")
CRITICAL_STATES = {"present", "absent", "not_assessed"}


def blank_study(study_id: str = "tibetan-comprehension") -> dict:
    """An honest draft reflecting known scope without inventing a group or task."""
    return {"schema_version": "1.0", "kind": "tibetan_comprehension_study", "study_id": study_id,
        "status": "draft", "evidence_kind": "human_review", "population": "Adults in Tibet",
        "writing_style": "Clear everyday written Tibetan", "community": None, "first_task": None, "condition": None,
        "development_config_sha256": None,
        "critical_failure_categories": [], "pilot": {"planned_item_count": 10, "item_unit": "model_output_case",
            "minimum_reviewers": 2, "expected_item_ids": []},
        "candidate_ids": ["qwen3-4b-mlx-4bit", "gemma3-4b-it-mlx-4bit"],
        "clinical_review_available": False, "registered_by": None, "registered_at": None}


def _object(value: Any, keys: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != keys:
        raise RecordsError(label + " must contain exactly its documented fields.")


def _text(value: Any, label: str, *, maximum: int = 8000) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise RecordsError(label + " must be nonblank bounded text.")
    return value


def _time(value: Any) -> datetime:
    if not isinstance(value, str):
        raise RecordsError("An explicit timezone-aware timestamp is required.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError()
        return parsed.astimezone(timezone.utc)
    except ValueError as exc:
        raise RecordsError("An explicit timezone-aware timestamp is required.") from exc


def _read(value: Any) -> dict:
    result = load_dataset(value) if isinstance(value, (str, Path)) else deepcopy(value)
    if not isinstance(result, dict):
        raise RecordsError("Expected a JSON object.")
    record_sha256(result)
    return result


def validate_study(study: Any) -> dict:
    """A structurally valid draft can remain unready; never invent missing choices."""
    errors: list[dict] = []
    report = {"valid": False, "ready_for_evaluation": False, "errors": errors,
              "missing_preregistration_fields": [], "study_sha256": None,
              "training_authorized": False, "clinical_approval_granted": False}
    try:
        report["study_sha256"] = record_sha256(study)
    except (ValueError, TypeError):
        errors.append({"path": "/", "code": "schema", "message": "Study must be finite JSON."})
        return report
    schema = json.loads(files("ht_tibetan_contracts").joinpath("study.schema.json").read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    for item in sorted(validator.iter_errors(study), key=lambda item: str(list(item.absolute_path))):
        errors.append({"path": "/" + "/".join(map(str, item.absolute_path)), "code": "schema", "message": item.message})
    if errors:
        return report
    def error(path, code, message):
        errors.append({"path": path, "code": code, "message": message})
    def walk(value, path=""):
        if isinstance(value, dict):
            for key, child in value.items():
                walk(child, path + "/" + key)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, path + "/" + str(index))
        elif isinstance(value, str) and not value.strip():
            error(path, "blank_value", "Study text cannot consist only of whitespace.")
    walk(study)
    task = study["first_task"]
    if task is not None:
        if task["answer_kind"] == "exact_label" and (len(task["labels"]) < 2 or task["no_answer_label"] not in task["labels"]):
            error("/first_task/labels", "answer_labels", "Exact-label tasks require at least two labels including the no-answer label.")
        if task["answer_kind"] == "extraction" and task["labels"]:
            error("/first_task/labels", "answer_labels", "Extraction tasks use exact source spans and an explicit no-answer label, without classification labels.")
    categories = [item["category_id"] for item in study["critical_failure_categories"]]
    if len(categories) != len(set(categories)):
        error("/critical_failure_categories", "duplicate_category", "Critical categories must be distinct.")
    missing = [key for key in ("community", "first_task", "condition", "registered_by", "registered_at") if study[key] is None]
    if study["evidence_kind"] == "human_review" and study.get("development_config_sha256") is None:
        missing.append("development_config_sha256")
    if study["condition"] is not None:
        from .conditions import validate_condition
        try:
            validate_condition(study["condition"])
            expected = "exact_label" if task and task["answer_kind"] == "exact_label" else "source_span"
            if task is not None and study["condition"]["task_answer_kind"] != expected:
                error("/condition/task_answer_kind", "task_condition_mismatch", "The condition answer kind must match the registered task.")
            if not set(study["candidate_ids"]) <= study["condition"]["max_output_tokens_by_candidate"].keys():
                error("/condition", "missing_candidate_budget", "The study condition must budget every registered candidate.")
            if study["evidence_kind"] == "human_review":
                if study["condition"]["instruction_review"] != "reviewed":
                    missing.append("condition.instruction_review")
                if study["condition"]["budget_basis"] != "reviewed_task_budget":
                    missing.append("condition.budget_basis")
        except RecordsError as exc:
            error("/condition", "invalid_condition", str(exc))
    if not categories:
        missing.append("critical_failure_categories")
    if len(study["pilot"]["expected_item_ids"]) != study["pilot"]["planned_item_count"]:
        missing.append("pilot.expected_item_ids")
    report["missing_preregistration_fields"] = missing
    if study["status"] == "preregistered" and missing:
        error("/status", "incomplete_preregistration", "A preregistered study requires every declared design field, reviewed human-study conditions and all ten pilot output identifiers.")
    if study["registered_at"] is not None:
        try:
            _time(study["registered_at"])
        except RecordsError as exc:
            error("/registered_at", "study_time", str(exc))
    report["valid"] = not errors
    report["ready_for_evaluation"] = report["valid"] and study["status"] == "preregistered" and not missing
    return report


def _metric(columns: list[list[Any]], reviewer_count: int, planned: int) -> dict:
    eligible = [row for row in columns if all(value is not None for value in row)]
    agreed = sum(len(set(row)) == 1 for row in eligible)
    result = {"planned_items": planned, "eligible_items": len(eligible),
              "ineligible_or_missing_items": planned - len(eligible), "unanimous_items": agreed,
              "raw_agreement": agreed / len(eligible) if eligible else None,
              "cohen_kappa": None, "kappa_unavailable_reason": None}
    if reviewer_count != 2:
        result["kappa_unavailable_reason"] = "requires_exactly_two_reviewers"
    elif not eligible:
        result["kappa_unavailable_reason"] = "no_eligible_paired_ratings"
    else:
        left, right = Counter(row[0] for row in eligible), Counter(row[1] for row in eligible)
        expected = sum(left[key] * right[key] for key in left.keys() | right.keys()) / len(eligible) ** 2
        if expected == 1:
            result["kappa_unavailable_reason"] = "constant_marginals_expected_agreement_one"
        else:
            result["cohen_kappa"] = (result["raw_agreement"] - expected) / (1 - expected)
    return result


def _structured_pilot(value: dict) -> dict:
    _object(value, {"schema_version", "kind", "pilot_id", "evidence_kind", "study_sha256",
                    "planned_item_ids", "reviewer_ids", "critical_categories", "items"}, "Pilot input")
    if value["schema_version"] != "1.0" or value["kind"] != "reviewer_agreement_pilot":
        raise RecordsError("Unsupported reviewer pilot input.")
    if value["evidence_kind"] not in {"human_review", "synthetic_test"}:
        raise RecordsError("Pilot evidence kind must be explicit.")
    _text(value["pilot_id"], "Pilot identity")
    checksum = value["study_sha256"]
    if not isinstance(checksum, str) or len(checksum) != 64 or any(char not in "0123456789abcdef" for char in checksum):
        raise RecordsError("Pilot must bind an exact study hash.")
    for key, minimum, maximum in (("planned_item_ids", 1, 1000), ("reviewer_ids", 2, 8), ("critical_categories", 1, 30)):
        items = value[key]
        if (not isinstance(items, list) or not minimum <= len(items) <= maximum
                or any(not isinstance(item, str) or not item.strip() or len(item) > 128 for item in items)
                or len(set(items)) != len(items)):
            raise RecordsError(key + " requires distinct bounded identifiers.")
    if not isinstance(value["items"], list) or len(value["items"]) > len(value["planned_item_ids"]):
        raise RecordsError("Pilot rows exceed the declared item roster.")
    seen = set()
    for item in value["items"]:
        _object(item, {"item_id", "reviews"}, "Pilot item")
        if item["item_id"] not in value["planned_item_ids"] or item["item_id"] in seen:
            raise RecordsError("Pilot item identities must be distinct and preregistered.")
        seen.add(item["item_id"])
        if not isinstance(item["reviews"], list):
            raise RecordsError("Pilot reviews must be a list.")
        reviewers = set()
        for review in item["reviews"]:
            _object(review, {"reviewer_id", "status", "independent", "blind_compromised", "ratings",
                             "critical_errors", "minutes_spent"}, "Pilot review")
            reviewer = review["reviewer_id"]
            if reviewer not in value["reviewer_ids"] or reviewer in reviewers:
                raise RecordsError("Each declared reviewer may judge each pilot item only once.")
            reviewers.add(reviewer)
            if review["status"] not in {"complete", "incomplete"} or type(review["independent"]) is not bool or type(review["blind_compromised"]) is not bool:
                raise RecordsError("Pilot completion, independence and blinding must be explicit.")
            _object(review["ratings"], set(AXES), "Pilot ratings")
            if any(value is not None and (type(value) is not int or not 1 <= value <= 4) for value in review["ratings"].values()):
                raise RecordsError("Output ratings must be integers from one to four or null.")
            _object(review["critical_errors"], set(value["critical_categories"]), "Critical error judgments")
            if any(not isinstance(state, str) or state not in CRITICAL_STATES for state in review["critical_errors"].values()):
                raise RecordsError("Critical judgments must be present, absent or not_assessed.")
            minutes = review["minutes_spent"]
            if minutes is not None and (type(minutes) not in (int, float) or not 0 <= minutes <= 1_000_000 or not math.isfinite(minutes)):
                raise RecordsError("Review minutes must be finite numbers between zero and 1000000, or null.")
    return value


def _freeze_pilot(path: str | Path, study: dict, supplement: dict | str | Path | None) -> tuple[dict, dict]:
    from .output_review import load_frozen_reviews
    freeze, checksum = load_frozen_reviews(path)
    study_report = validate_study(study)
    if not study_report["valid"]:
        raise RecordsError("Pilot study does not satisfy its contract.")
    ids = study["pilot"]["expected_item_ids"]
    if not ids:
        raise RecordsError("Choose the pilot's expected output cases before analyzing a freeze.")
    cases = {item["case_id"]: item for item in freeze["cases"]}
    excluded = {item["case_id"]: item for item in freeze["excluded_cases"]}
    # An expected but unrecorded request remains missing in the denominator.
    categories = [item["category_id"] for item in study["critical_failure_categories"]]
    extras = {}
    supplement_hash = None
    if supplement is not None:
        sidecar = _read(supplement)
        _object(sidecar, {"schema_version", "kind", "study_sha256", "freeze_file_sha256", "evidence_kind", "entries"}, "Pilot supplement")
        if (sidecar["schema_version"] != "1.0" or sidecar["kind"] != "reviewer_pilot_supplement"
                or sidecar["study_sha256"] != study_report["study_sha256"]
                or sidecar["freeze_file_sha256"] != checksum or sidecar["evidence_kind"] != freeze["evidence_kind"]
                or not isinstance(sidecar["entries"], list)):
            raise RecordsError("Pilot supplement must bind the exact study, freeze and evidence kind.")
        for entry in sidecar["entries"]:
            _object(entry, {"case_id", "reviewer_id", "minutes_spent", "critical_errors"}, "Pilot supplement row")
            key = (entry["case_id"], entry["reviewer_id"])
            if key in extras or key[0] not in ids or key[0] not in cases or key[1] not in freeze["reviewer_ids"]:
                raise RecordsError("Pilot supplement rows must match distinct frozen pilot case/reviewer pairs.")
            extras[key] = entry
        supplement_hash = record_sha256(sidecar)
    rows = []
    for item_id in ids:
        if item_id not in cases:
            continue
        item = cases[item_id]
        reviews = []
        for review in item["reviews"]:
            extra = extras.get((item_id, review["reviewer_id"]), {})
            reviews.append({"reviewer_id": review["reviewer_id"], "status": "complete", "independent": True,
                "blind_compromised": review["blind_compromised"], "ratings": deepcopy(review["ratings"]),
                "minutes_spent": extra.get("minutes_spent"),
                "critical_errors": deepcopy(extra.get("critical_errors", {key: "not_assessed" for key in categories}))})
        rows.append({"item_id": item_id, "reviews": reviews})
    pilot = {"schema_version": "1.0", "kind": "reviewer_agreement_pilot", "pilot_id": study["study_id"] + "-pilot",
        "evidence_kind": freeze["evidence_kind"], "study_sha256": study_report["study_sha256"],
        "planned_item_ids": ids, "reviewer_ids": freeze["reviewer_ids"], "critical_categories": categories, "items": rows}
    provenance = {"kind": "verified_frozen_reviews", "freeze_path": str(Path(path).resolve()),
        "freeze_file_sha256": checksum, "supplement_sha256": supplement_hash,
        "generation_failures_in_pilot": [item_id for item_id in ids if item_id in excluded],
        "unrecorded_pilot_items": [item_id for item_id in ids if item_id not in cases and item_id not in excluded],
        "candidate_counts": deepcopy(freeze["candidate_counts"]),
        "connected_cluster_count": freeze["connected_cluster_count"]}
    return _structured_pilot(pilot), provenance


def analyze_agreement(review_freeze_or_ratings: dict | str | Path, *, study: dict | str | Path | None = None,
                      supplement: dict | str | Path | None = None) -> dict:
    """Report exact unanimity, nominal two-reviewer kappa and observed timing only.

Structured input supports missing/incomplete reviews. A freeze path is rebuilt
against its immutable provenance. Frozen legacy reviews have no timings or
structured critical labels unless supplied in a separately bound supplement.
"""
    if isinstance(review_freeze_or_ratings, (str, Path)):
        if study is None:
            raise RecordsError("Analyzing frozen reviews requires the pilot study roster.")
        pilot, provenance = _freeze_pilot(review_freeze_or_ratings, _read(study), supplement)
    else:
        if supplement is not None:
            raise RecordsError("Structured pilot rows already carry their own timings and critical judgments.")
        pilot = _structured_pilot(_read(review_freeze_or_ratings))
        provenance = {"kind": "structured_ratings_declaration", "independent_source_artifacts_verified": False}
        if study is not None:
            current = _read(study)
            report = validate_study(current)
            if (not report["valid"] or report["study_sha256"] != pilot["study_sha256"]
                    or current["pilot"]["expected_item_ids"] != pilot["planned_item_ids"]
                    or [item["category_id"] for item in current["critical_failure_categories"]] != pilot["critical_categories"]):
                raise RecordsError("Structured pilot does not bind the exact declared study roster and categories.")
    reviewers = pilot["reviewer_ids"]
    planned = len(pilot["planned_item_ids"])
    rows = {item["item_id"]: {review["reviewer_id"]: review for review in item["reviews"]} for item in pilot["items"]}
    rating_columns = {axis: [] for axis in AXES}
    critical_columns = {key: [] for key in pilot["critical_categories"]}
    status_counts = Counter()
    times = {reviewer: [] for reviewer in reviewers}
    critical_counts = {key: Counter() for key in pilot["critical_categories"]}
    for item_id in pilot["planned_item_ids"]:
        values, flags = {axis: [] for axis in AXES}, {key: [] for key in pilot["critical_categories"]}
        for reviewer in reviewers:
            review = rows.get(item_id, {}).get(reviewer)
            if review is None:
                status_counts["missing"] += 1
                for axis in AXES:
                    values[axis].append(None)
                for key in flags:
                    flags[key].append(None)
                    critical_counts[key]["not_assessed"] += 1
                continue
            status_counts[review["status"]] += 1
            if review["blind_compromised"]:
                status_counts["blinding_compromised"] += 1
            if not review["independent"]:
                status_counts["not_independent"] += 1
            eligible = review["status"] == "complete" and review["independent"] and not review["blind_compromised"]
            for axis in AXES:
                values[axis].append(review["ratings"][axis] if eligible else None)
            for key in flags:
                state = review["critical_errors"][key]
                critical_counts[key][state] += 1
                flags[key].append(state if eligible and state != "not_assessed" else None)
            if review["minutes_spent"] is not None:
                times[reviewer].append(review["minutes_spent"])
        for axis in AXES:
            rating_columns[axis].append(values[axis])
        for key in flags:
            critical_columns[key].append(flags[key])
    timing = [{"reviewer_id": reviewer, "recorded_item_count": len(times[reviewer]),
        "missing_item_count": planned - len(times[reviewer]),
        "recorded_minutes_total": sum(times[reviewer]) if times[reviewer] else None,
        "recorded_minutes_mean": sum(times[reviewer]) / len(times[reviewer]) if times[reviewer] else None}
        for reviewer in reviewers]
    recorded = [minute for values in times.values() for minute in values]
    return {"schema_version": "1.0", "kind": "reviewer_agreement_report", "status": "descriptive_only",
        "pilot_id": pilot["pilot_id"], "evidence_kind": pilot["evidence_kind"], "study_sha256": pilot["study_sha256"],
        "input_sha256": record_sha256(pilot), "provenance": provenance, "reviewer_ids": reviewers,
        "planned_item_count": planned, "intended_pilot_item_count": 10, "matches_ten_item_plan": planned == 10,
        "observed_item_count": len(rows), "planned_review_count": planned * len(reviewers),
        "review_status_counts": {key: status_counts[key] for key in ("complete", "incomplete", "missing", "blinding_compromised", "not_independent")},
        "rating_agreement": {axis: _metric(rating_columns[axis], len(reviewers), planned) for axis in AXES},
        "critical_error_agreement": {key: {**_metric(critical_columns[key], len(reviewers), planned),
            "judgment_counts": {state: critical_counts[key][state] for state in sorted(CRITICAL_STATES)}} for key in critical_columns},
        "timing": {"reviewers": timing, "recorded_review_count": len(recorded),
            "missing_review_count": planned * len(reviewers) - len(recorded),
            "recorded_minutes_total": sum(recorded) if recorded else None,
            "complete_coverage": len(recorded) == planned * len(reviewers)},
        "model_selected": None, "training_authorized": False,
        "limitations": ["Descriptive pilot only; output cases can share sources and are not independent observations.",
            "Kappa is nominal exact-category agreement, not a weighted ordinal score or competence measure.",
            "Missing timing and unassessed critical categories are never zero or absence.",
            "Declared human identity and independence are not authenticated by this report."]}


def _evaluation(path: str | Path) -> tuple[dict, dict, str]:
    """Verify a complete local artifact set, not a supplied score summary."""
    from .artifacts import hash_file
    from .conditions import condition_identity, task_messages
    from .evaluation import validate_evaluation_config
    from .inference import InferenceResult
    path = Path(path).expanduser().absolute()
    if path.name != "report.json" or path.resolve() != path or any(part.is_symlink() for part in (path, *path.parents)):
        raise RecordsError("Evaluation evidence must be the canonical report.json in its immutable run.")
    report, manifest = _read(path), _read(path.parent / "manifest.json")
    if (report.get("schema_version") != "1.0" or report.get("kind") != "release_evaluation_report"
            or manifest.get("kind") != "release_evaluation" or manifest.get("schema_version") != "1.0"
            or manifest.get("run_id") != report.get("run_id") or manifest.get("outcome") != report.get("outcome")
            or not manifest.get("finished_at") or type(report.get("engineering_only")) is not bool
            or manifest.get("engineering_only") != report["engineering_only"]
            or manifest.get("release_sha256") != report.get("release_sha256")):
        raise RecordsError("Evaluation report and finalized run identities differ.")
    inventory = manifest.get("artifact_inventory")
    if not isinstance(inventory, list) or not 1 <= len(inventory) <= 2000:
        raise RecordsError("Evaluation requires its complete bounded artifact inventory.")
    expected = set()
    for entry in inventory:
        _object(entry, {"path", "sha256", "bytes"}, "Evaluation artifact")
        name = entry["path"]
        if (not isinstance(name, str) or not name or Path(name).is_absolute() or ".." in Path(name).parts
                or str(Path(name)) != name or name == "manifest.json" or name in expected):
            raise RecordsError("Evaluation artifact paths must be distinct relative run paths.")
        target = path.parent / name
        if target.resolve() != target or any(part.is_symlink() for part in (target, *target.parents)) or not target.is_file():
            raise RecordsError("Evaluation artifacts may not be missing or redirected.")
        if type(entry["bytes"]) is not int or target.stat().st_size != entry["bytes"] or hash_file(target) != entry["sha256"]:
            raise RecordsError("An evaluation artifact differs from its recorded hash or size.")
        expected.add(name)
    entries = list(path.parent.rglob("*"))
    if any(item.is_symlink() for item in entries):
        raise RecordsError("Evaluation artifact tree cannot contain symlinks.")
    actual = {str(item.relative_to(path.parent)) for item in entries if item.is_file() and item != path.parent / "manifest.json"}
    if actual != expected or "report.json" not in expected or "started.json" not in expected:
        raise RecordsError("Evaluation artifact inventory omits or adds run contents.")
    checksum = hash_file(path)
    if checksum != manifest.get("report_sha256"):
        raise RecordsError("Evaluation report differs from its manifest hash.")
    config = manifest.get("config")
    validate_evaluation_config(config)
    started = _read(path.parent / "started.json")
    for field in ("schema_version", "kind", "run_id", "config", "release_sha256", "engineering_only", "planned_cases", "study_sha256"):
        if started.get(field) != manifest.get(field):
            raise RecordsError("Evaluation changed identity after starting.")
    conditions = config["conditions"]
    if report.get("conditions") != conditions or report.get("condition_identities") != [condition_identity(item) for item in conditions]:
        raise RecordsError("Evaluation conditions differ from their exact registered instructions and budgets.")
    planned = [{"candidate_id": arm["candidate_id"], "arm_id": arm["arm_id"],
                "condition_id": condition["condition_id"], "instruction_language": condition["instruction_language"], "example_id": eid}
               for condition in conditions for eid in config["example_ids"] for arm in config["arms"]]
    if report.get("planned_cases") != planned or manifest.get("planned_cases") != planned:
        raise RecordsError("Evaluation's complete comparison roster differs from its configuration.")
    candidates = report.get("candidates")
    if not isinstance(candidates, list) or len(candidates) != len(config["arms"]):
        raise RecordsError("Evaluation candidate identities are incomplete.")
    identities = {}
    for candidate in candidates:
        _object(candidate, {"candidate_id", "arm_id", "model_identity", "adapter_identity"}, "Evaluated candidate")
        key = candidate["candidate_id"], candidate["arm_id"]
        if key in identities or key not in {(arm["candidate_id"], arm["arm_id"]) for arm in config["arms"]}:
            raise RecordsError("Evaluation candidate identities are duplicated or unexpected.")
        if not isinstance(candidate["model_identity"], str) or not re.fullmatch(r".+@[a-f0-9]{40}", candidate["model_identity"]):
            raise RecordsError("Model selection requires an exact pinned model revision.")
        if (candidate["arm_id"] == "base") != (candidate["adapter_identity"] is None):
            raise RecordsError("Base and adapter identities disagree.")
        identities[key] = candidate
    cases = report.get("cases")
    if not isinstance(cases, list) or len(cases) > len(planned):
        raise RecordsError("Evaluation cases must follow their complete planned roster.")
    indexed_conditions = {item["condition_id"]: condition_identity(item) for item in conditions}
    full_conditions = {item["condition_id"]: item for item in conditions}
    case_indexes = []
    for sequence, case in enumerate(cases, 1):
        if not isinstance(case, dict) or any(case.get(key) != value for key, value in planned[sequence - 1].items()):
            raise RecordsError("Evaluation case identity differs from its planned position.")
        if case.get("case_id") != config["run_id"] + f"-{sequence:04d}" or case.get("case_sha256") != record_sha256({key: value for key, value in case.items() if key != "case_sha256"}):
            raise RecordsError("Evaluation case does not bind its exact full content.")
        if case != _read(path.parent / f"case.{sequence:04d}.result.json"):
            raise RecordsError("Evaluation report case differs from its immutable result artifact.")
        if any(case.get(key) != value for key, value in indexed_conditions[case["condition_id"]].items()):
            raise RecordsError("Evaluation case changed its exact condition.")
        for field in ("contributor_id", "source_text", "question", "source_id", "example_sha256"):
            _text(case.get(field), "Evaluation case " + field, maximum=1_000_000)
        for field in ("source_contributor_ids", "example_contributor_ids"):
            authors = case.get(field, [] if report["engineering_only"] else None)
            if (not isinstance(authors, list) or any(not isinstance(author, str) or not author.strip() for author in authors)
                    or len(authors) != len(set(authors))):
                raise RecordsError("Real evaluation cases must explicitly bind their known source and example author rosters.")
        if not report["engineering_only"] and case["contributor_id"] not in case["example_contributor_ids"]:
            raise RecordsError("The evaluated example author roster must include its primary contributor.")
        if (content_sha256(case["source_text"]) != case.get("source_sha256")
                or case.get("messages") != task_messages({"original_text": case["source_text"]},
                    {"question": case["question"]}, full_conditions[case["condition_id"]])):
            raise RecordsError("Evaluation source, question and exact rendered instruction do not agree.")
        identity = identities[(case["candidate_id"], case["arm_id"])]
        try:
            result = InferenceResult(**case["result"])
        except (KeyError, TypeError, ValueError) as exc:
            raise RecordsError("Evaluation case has an invalid inference result.") from exc
        if (result.model_identity != identity["model_identity"] or result.adapter_identity != identity["adapter_identity"]
                or case.get("model_identity") != identity["model_identity"] or case.get("adapter_identity") != identity["adapter_identity"]
                or result.run_id != case["case_id"] or (result.outcome == "success" and result.answer != case.get("raw_output"))
                or (not report["engineering_only"] and result.synthetic)):
            raise RecordsError("Evaluation response differs from the exact candidate, adapter or answer.")
        case_indexes.append({"case_id": case["case_id"], "case_sha256": case["case_sha256"], "outcome": result.outcome})
    if case_indexes != manifest.get("cases"):
        raise RecordsError("Evaluation finalized case inventory differs from its report.")
    scoring = report.get("scoring", {})
    if (not isinstance(scoring, dict) or scoring.get("kind") != "constrained_evaluation_scores"
            or scoring.get("cases_sha256") != record_sha256(cases)):
        raise RecordsError("Evaluation scores are not bound to the exact case outputs.")
    if report.get("outcome") == "completed" and (len(cases) != len(planned) or any(item["result"]["outcome"] != "success" for item in cases)
            or report.get("error") is not None or scoring.get("valid") is not True or scoring.get("complete") is not True):
        raise RecordsError("A completed evaluation must include every planned successful case and valid complete scoring.")
    return report, manifest, checksum


def _review_template(report: dict, report_path: str | Path, checksum: str, reviewer_id: str, study: dict) -> dict:
    _text(reviewer_id, "Reviewer identity", maximum=128)
    if not validate_study(study)["valid"] or not study["critical_failure_categories"]:
        raise RecordsError("Evaluation review requires a valid study with explicit critical categories.")
    if any(case.get("contributor_id") == reviewer_id or reviewer_id in case.get("source_contributor_ids", [])
           or reviewer_id in case.get("example_contributor_ids", []) for case in report["cases"]):
        raise RecordsError("An author cannot independently review their own evaluated contribution.")
    categories = [item["category_id"] for item in study["critical_failure_categories"]]
    return {"schema_version": "1.0", "kind": "evaluation_native_review", "evidence_kind": "synthetic_test" if report["engineering_only"] else "human_review",
        "evaluation_report_path": str(Path(report_path).resolve()), "evaluation_report_sha256": checksum,
        "study_sha256": record_sha256(study), "reviewer_id": reviewer_id, "status": "incomplete", "independent": False,
        "items": [{"case_id": case["case_id"], "case_sha256": case["case_sha256"],
            "candidate_id": case["candidate_id"], "arm_id": case["arm_id"], "condition_sha256": case["condition_sha256"],
            "source_text": case.get("source_text"), "question": case.get("question"), "messages": deepcopy(case["messages"]),
            "answer": case["result"]["answer"], "outcome": case["result"]["outcome"],
            "status": "incomplete", "ratings": {axis: None for axis in AXES},
            "critical_errors": {key: "not_assessed" for key in categories}, "minutes_spent": None,
            "blind_compromised": True, "notes": ""} for case in report["cases"] if case["result"]["outcome"] == "success"],
        "candidate_decisions": [{"candidate_id": item["candidate_id"], "arm_id": item["arm_id"],
            "condition_sha256": condition["condition_sha256"], "recommendation": "pending", "rationale": ""}
            for condition in report["condition_identities"] for item in report["candidates"]],
        "limitations": ["This packet exposes model identity and is not blinded; do not relabel it as blinded evidence.",
            "Approve means suitable for the registered bounded adaptation experiment, not deployment or health advice.",
            "Ratings and candidate suitability are independent human judgments; numeric scores do not supply them."]}


def export_evaluation_review(report_path, reviewer_id, output, *, study, root=None, permissions_path=None, release_dir=None,
                             key_path=None) -> dict:
    """Export exact outputs with blank judgments; real material rechecks review rights."""
    from .output_review import _write_output
    report, _, checksum = _evaluation(report_path)
    current_study = _read(study)
    if not report["engineering_only"]:
        if root is None or permissions_path is None or release_dir is None:
            raise RecordsError("Real evaluation review requires root, current permissions and the original release directory.")
        from .data_use import audit_data_use
        from .releases import verify_release
        released = verify_release(Path(release_dir), root=Path(root), permissions_path=Path(permissions_path),
                                  purposes=[report["purpose"]], recheck_current=False)
        if released["release_sha256"] != report["release_sha256"]:
            raise RecordsError("Review must use the exact release evaluated by this report.")
        _, audit = audit_data_use(released["dataset"], load_dataset(permissions_path), Path(root) / "runs",
            purpose="review", example_ids=sorted({item["example_id"] for item in report["cases"]}))
        if not audit["valid"]:
            raise RecordsError("Current review-use permissions or exposure evidence do not clear this export.")
    packet = _review_template(report, report_path, checksum, reviewer_id, current_study)
    if key_path is None:
        _write_output(output, packet, Path(report_path).parent)
    else:
        from .blind_review import _encoded, _path, _publish_pair
        from .evaluation_review_blinding import blind_packet
        packet_file, key_file, run = map(_path, (output, key_path, Path(report_path).parent))
        if packet_file == key_file or packet_file.parent == key_file.parent:
            raise RecordsError("Reviewer packet and sealed operator key require different directories.")
        for target in (packet_file, key_file):
            if target.is_relative_to(run) or target.is_relative_to((Path.home() / "Desktop").resolve()):
                raise RecordsError("Reviewer packet and operator key must remain outside Desktop and the immutable run.")
            if any((parent / "manifest.json").exists() or (parent / "started.json").exists()
                   or (parent / "manifest.started.json").exists() for parent in target.parents):
                raise RecordsError("Reviewer packet and key must remain outside all immutable run directories.")
            if target.exists():
                raise FileExistsError(target)
        public, key = blind_packet(packet)
        _publish_pair(packet_file, _encoded(public), key_file, _encoded(key))
    return {"status": "awaiting_independent_review", "output": str(output), "reviewer_id": reviewer_id,
            "evidence_kind": packet["evidence_kind"], "item_count": len(packet["items"]),
            "blinded": key_path is not None, "private_key_path": str(key_path) if key_path is not None else None,
            "approval_granted": False}


def load_evaluation_review(path, *, study, evaluation_report_path=None, key_path=None) -> tuple[dict, str]:
    """Revalidate returned judgments against every immutable report-bound field."""
    from .artifacts import hash_file
    from .output_review import _private_input
    path = _private_input(path)
    packet = _read(path)
    key = None
    if key_path is not None:
        from .evaluation_review_blinding import decode_blinded_review
        key = _read(_private_input(key_path))
        packet = decode_blinded_review(packet, key)
    elif packet.get("kind") == "blinded_evaluation_native_review":
        raise RecordsError("Blinded evaluation review requires its separately held sealed operator key.")
    selected_path = evaluation_report_path if evaluation_report_path is not None else packet.get("evaluation_report_path")
    if not isinstance(selected_path, (str, Path)):
        raise RecordsError("Evaluation review lacks its source report path.")
    report, _, checksum = _evaluation(selected_path)
    template = _review_template(report, selected_path, checksum, packet.get("reviewer_id"), _read(study))
    if key is not None and key.get("original_packet") != template:
        raise RecordsError("Sealed review key does not bind the exact current report, study and original blank packet.")
    _object(packet, set(template), "Evaluation review")
    for field in set(template) - {"status", "independent", "items", "candidate_decisions"}:
        if packet[field] != template[field]:
            raise RecordsError("Evaluation review changed its report, study or immutable packet fields.")
    if packet["status"] not in {"complete", "incomplete"} or type(packet["independent"]) is not bool:
        raise RecordsError("Evaluation review status and independence must be explicit.")
    if not isinstance(packet["items"], list) or len(packet["items"]) != len(template["items"]):
        raise RecordsError("Evaluation review must retain every exact successful output row.")
    mutable = {"status", "ratings", "critical_errors", "minutes_spent", "blind_compromised", "notes"}
    categories = [item["category_id"] for item in _read(study)["critical_failure_categories"]]
    for row, expected in zip(packet["items"], template["items"]):
        _object(row, set(expected), "Evaluation review row")
        if any(row[field] != expected[field] for field in set(expected) - mutable):
            raise RecordsError("Evaluation review changed an exact case, instruction, source or answer.")
        if ((key is None and row["blind_compromised"] is not True)
                or type(row["blind_compromised"]) is not bool or not isinstance(row["notes"], str) or len(row["notes"]) > 8000):
            raise RecordsError("Review must preserve its recorded blinding status and bounded notes.")
        probe = {"schema_version": "1.0", "kind": "reviewer_agreement_pilot", "pilot_id": "validation-only",
            "evidence_kind": packet["evidence_kind"], "study_sha256": packet["study_sha256"],
            "planned_item_ids": [row["case_id"]], "reviewer_ids": [packet["reviewer_id"], "validation-placeholder"],
            "critical_categories": categories, "items": [{"item_id": row["case_id"], "reviews": [{
                "reviewer_id": packet["reviewer_id"], "status": row["status"], "independent": packet["independent"],
                **{field: row[field] for field in ("ratings", "critical_errors", "minutes_spent", "blind_compromised")}}]}]}
        if packet["reviewer_id"] == "validation-placeholder":
            probe["reviewer_ids"][1] = "validation-placeholder-2"
        _structured_pilot(probe)
        if packet["status"] == "complete" and (row["status"] != "complete" or any(value is None for value in row["ratings"].values())
                or any(value == "not_assessed" for value in row["critical_errors"].values()) or row["minutes_spent"] is None):
            raise RecordsError("Complete evaluation review requires all ratings, critical judgments and observed review times.")
    if not isinstance(packet["candidate_decisions"], list) or len(packet["candidate_decisions"]) != len(template["candidate_decisions"]):
        raise RecordsError("Evaluation review must retain every candidate/arm/condition suitability judgment.")
    for row, expected in zip(packet["candidate_decisions"], template["candidate_decisions"]):
        _object(row, set(expected), "Candidate suitability judgment")
        if any(row[field] != expected[field] for field in ("candidate_id", "arm_id", "condition_sha256")):
            raise RecordsError("Candidate judgment changed its evaluated identity or condition.")
        if row["recommendation"] not in {"approve", "reject", "revise", "pending"} or not isinstance(row["rationale"], str) or len(row["rationale"]) > 8000:
            raise RecordsError("Candidate judgments require explicit bounded recommendations and rationale.")
        if packet["status"] == "complete" and (row["recommendation"] == "pending" or not row["rationale"].strip()):
            raise RecordsError("Complete candidate suitability judgments require a recommendation and rationale.")
    if packet["status"] == "complete" and not packet["independent"]:
        raise RecordsError("Completed native review must explicitly declare independent judgment.")
    return packet, hash_file(path)


def _evaluation_pilot(study: dict, review_paths: list, report_path, *, review_keys=None,
                      require_blinded=False, require_complete=False) -> tuple[dict, list[dict]]:
    from .artifacts import hash_file
    if not isinstance(review_paths, list) or not 2 <= len(review_paths) <= 8:
        raise RecordsError("A selection requires two to eight independent native review records.")
    if review_keys is None:
        review_keys = [None] * len(review_paths)
    if not isinstance(review_keys, list) or len(review_keys) != len(review_paths):
        raise RecordsError("Review keys must align exactly with reviewer record paths.")
    if require_blinded and any(key is None for key in review_keys):
        raise RecordsError("Real model selection requires sealed blinded native reviews.")
    reviews, bindings, reviewers = [], [], set()
    for path, key_path in zip(review_paths, review_keys):
        review, checksum = load_evaluation_review(path, study=study, evaluation_report_path=report_path, key_path=key_path)
        if review["reviewer_id"] in reviewers:
            raise RecordsError("Native review records require distinct reviewers.")
        if require_complete and (review["status"] != "complete" or not review["independent"]):
            raise RecordsError("Selection reviewers must be distinct and their independent reviews complete.")
        reviewers.add(review["reviewer_id"])
        reviews.append(review)
        if require_blinded and any(row["blind_compromised"] for row in review["items"]):
            raise RecordsError("Compromised blinded review cannot supply an eligible model-selection judgment.")
        bindings.append({"path": str(Path(path).resolve()), "sha256": checksum, "reviewer_id": review["reviewer_id"],
            "key_path": str(Path(key_path).resolve()) if key_path is not None else None,
            "key_sha256": hash_file(Path(key_path)) if key_path is not None else None})
    if len(reviewers) < study["pilot"]["minimum_reviewers"]:
        raise RecordsError("The registered minimum number of independent reviewers is not met.")
    if any(review["evidence_kind"] != study["evidence_kind"] for review in reviews):
        raise RecordsError("Study and reviews must preserve their explicit evidence kind.")
    ids = study["pilot"]["expected_item_ids"]
    indexed = [{row["case_id"]: row for row in review["items"]} for review in reviews]
    if require_complete and any(not set(ids) <= set(items) for items in indexed):
        raise RecordsError("Every reviewer must cover all ten preregistered pilot output cases.")
    pilot = {"schema_version": "1.0", "kind": "reviewer_agreement_pilot", "pilot_id": study["study_id"] + "-pilot",
        "evidence_kind": study["evidence_kind"], "study_sha256": record_sha256(study), "planned_item_ids": ids,
        "reviewer_ids": [review["reviewer_id"] for review in reviews],
        "critical_categories": [item["category_id"] for item in study["critical_failure_categories"]],
        "items": [{"item_id": case_id, "reviews": [{"reviewer_id": review["reviewer_id"],
            "status": items[case_id]["status"], "independent": review["independent"],
            **{field: items[case_id][field] for field in ("ratings", "critical_errors", "minutes_spent", "blind_compromised")}}
            for review, items in zip(reviews, indexed) if case_id in items]}
            for case_id in ids if any(case_id in items for items in indexed)]}
    summary = analyze_agreement(pilot, study=study)
    # Reviewer disagreement remains visible, without fabricating blind judgments.
    summary["provenance"] = {"kind": "verified_evaluation_native_reviews", "review_inputs": bindings,
        "blinded": all(key is not None for key in review_keys) and not any(row["blind_compromised"] for review in reviews for row in review["items"]),
        "unblinded_agreement_available_separately": True}
    unblinded = deepcopy(pilot)
    for item in unblinded["items"]:
        for review in item["reviews"]:
            review["blind_compromised"] = False
    descriptive = analyze_agreement(unblinded)
    summary["unblinded_independent_rating_agreement"] = descriptive["rating_agreement"]
    summary["unblinded_independent_critical_error_agreement"] = descriptive["critical_error_agreement"]
    return {"summary": summary, "reviews": reviews}, bindings


def analyze_evaluation_reviews(study, review_paths: list, report_path, *, review_keys=None) -> dict:
    """Describe verified independent review; this operation makes no selection."""
    current = _read(study)
    report, _, _ = _evaluation(report_path)
    if not validate_study(current)["valid"]:
        raise RecordsError("Pilot analysis requires a valid declared study.")
    pilot, _ = _evaluation_pilot(current, review_paths, report_path, review_keys=review_keys)
    result = pilot["summary"]
    result["evaluation_outcome"] = report["outcome"]
    result["comparison_case_counts"] = {"planned": len(report["planned_cases"]), "recorded": len(report["cases"]),
        "successful": sum(item["result"]["outcome"] == "success" for item in report["cases"])}
    cases = {item["case_id"]: item for item in report["cases"]}
    ids = current["pilot"]["expected_item_ids"]
    result["pilot_generation_failures"] = [{"case_id": case_id,
        "outcome": cases[case_id]["result"]["outcome"],
        "termination_reason": cases[case_id]["result"]["termination_reason"]}
        for case_id in ids if case_id in cases and cases[case_id]["result"]["outcome"] != "success"]
    result["unrecorded_pilot_case_ids"] = [case_id for case_id in ids if case_id not in cases]
    return result


def record_model_decision(study, evaluation_report, decision: dict) -> dict:
    """Record an explicit reviewed base-model choice; no numbers auto-select it."""
    current = _read(study)
    readiness = validate_study(current)
    if not readiness["ready_for_evaluation"] or current["evidence_kind"] != "human_review":
        raise RecordsError("Real model selection requires a complete preregistered human-review study.")
    if not isinstance(evaluation_report, (str, Path)):
        raise RecordsError("Model selection requires an immutable evaluation report path, never a numeric summary.")
    # Read only run metadata before deciding whether inspecting this report is
    # permissible for selection. Final-test answers must not influence training.
    metadata = _read(Path(evaluation_report).parent / "manifest.json")
    if metadata.get("config", {}).get("purpose") != "development_screen":
        raise RecordsError("Model selection requires development_screen evidence; validation and final_test reports cannot choose training models.")
    if record_sha256(metadata["config"]) != current["development_config_sha256"]:
        raise RecordsError("Model selection requires the exact preregistered development configuration; case IDs may not be remapped.")
    report, manifest, checksum = _evaluation(evaluation_report)
    if report["outcome"] != "completed" or report["engineering_only"]:
        raise RecordsError("Model selection requires a completed real-material comparison.")
    if (report.get("purpose") != "development_screen" or report.get("study_sha256") != readiness["study_sha256"]
            or manifest.get("study_sha256") != readiness["study_sha256"]):
        raise RecordsError("Selection requires development-screen evidence originally bound to this exact preregistered study.")
    _object(decision, {"decision_id", "selected_candidate_id", "study_sha256", "evaluation_report_sha256",
                       "review_paths", "review_keys", "reviewed_by", "reviewed_at", "user_reviewed", "rationale",
                       "criteria_reviewed", "pilot_reviewed"}, "Model selection decision")
    for field in ("decision_id", "reviewed_by", "rationale", "criteria_reviewed"):
        _text(decision[field], "Decision " + field)
    reviewed_at = _time(decision["reviewed_at"])
    registered_at = _time(current["registered_at"])
    started_at = _time(manifest.get("created_at"))
    finished_at = _time(manifest["finished_at"])
    if not registered_at <= started_at <= finished_at <= reviewed_at:
        raise RecordsError("Study registration must precede evaluation, and explicit review must follow its completion.")
    if (decision["user_reviewed"] is not True or decision["pilot_reviewed"] is not True
            or decision["study_sha256"] != readiness["study_sha256"] or decision["evaluation_report_sha256"] != checksum):
        raise RecordsError("The explicit decision must bind and acknowledge this exact study, evaluation and pilot.")
    from .conditions import condition_identity
    condition = current["condition"]
    identity = condition_identity(condition)
    if (condition["instruction_review"] != "reviewed" or condition["budget_basis"] != "reviewed_task_budget"
            or condition not in report["conditions"]):
        raise RecordsError("Selection requires the exact reviewed study instruction and calibrated candidate budgets.")
    selected = decision["selected_candidate_id"]
    if selected not in current["candidate_ids"]:
        raise RecordsError("Selected model must belong to the preregistered candidate set.")
    compared = {item["candidate_id"] for item in report["candidates"] if item["arm_id"] == "base"}
    if not set(current["candidate_ids"]) <= compared:
        raise RecordsError("The completed comparison must include every preregistered base candidate.")
    model = next(item for item in report["candidates"] if item["candidate_id"] == selected and item["arm_id"] == "base")
    pilot, bindings = _evaluation_pilot(current, decision["review_paths"], evaluation_report,
                                      review_keys=decision["review_keys"], require_blinded=True, require_complete=True)
    support = []
    for review in pilot["reviews"]:
        rows = [item for item in review["candidate_decisions"] if item["candidate_id"] == selected
                and item["arm_id"] == "base" and item["condition_sha256"] == identity["condition_sha256"]]
        if len(rows) != 1:
            raise RecordsError("Every native reviewer must judge the selected base candidate under the exact study condition.")
        support.append({"reviewer_id": review["reviewer_id"], **rows[0]})
    if not any(item["recommendation"] == "approve" for item in support):
        raise RecordsError("Unchanged unanimous rejection or revision requests cannot support model selection.")
    return {"schema_version": "1.0", "kind": "explicit_model_selection", "status": "recorded",
        "evidence_kind": "human_review", "study_sha256": readiness["study_sha256"],
        "evaluation_report_path": str(Path(evaluation_report).resolve()), "evaluation_report_sha256": checksum,
        "selected_candidate_id": selected, "selected_model_identity": model["model_identity"],
        "condition": condition, **identity, "review_inputs": bindings, "native_candidate_judgments": support,
        "pilot_report": pilot["summary"], "decision": deepcopy(decision),
        "training_authorized": False, "clinical_approval_granted": False, "production_promotion": False,
        "limitations": ["This selects a base model for the declared bounded research task; separate release/consent gates still apply.",
            "Recorded reviewer identity, independence and user acknowledgment are not authenticated signatures.",
            "Candidate conversion provenance and runtime compatibility are separate checks, not waived here."]}


def verify_model_selection(study_path, receipt_path, candidate_id, *, evaluation_report_path=None, model_identity=None) -> dict:
    """Rebuild a real selection gate from its still-current exact source artifacts."""
    current, receipt = _read(study_path), _read(receipt_path)
    path = evaluation_report_path if evaluation_report_path is not None else receipt.get("evaluation_report_path")
    if not isinstance(path, (str, Path)) or not isinstance(receipt.get("decision"), dict):
        raise RecordsError("Selection receipt lacks its immutable comparison and explicit decision.")
    rebuilt = record_model_decision(current, path, receipt["decision"])
    if record_sha256(rebuilt) != record_sha256(receipt):
        raise RecordsError("Selection receipt changed or no longer binds current study/review/comparison evidence.")
    if receipt["selected_candidate_id"] != candidate_id or (model_identity is not None and receipt["selected_model_identity"] != model_identity):
        raise RecordsError("Training candidate or exact model revision differs from the reviewed selection.")
    return {"valid": True, "study": current, "receipt": receipt,
        "selected_candidate_id": candidate_id, "selected_model_identity": receipt["selected_model_identity"],
        "condition": receipt["condition"], "condition_sha256": receipt["condition_sha256"],
        "evaluation_report_sha256": receipt["evaluation_report_sha256"],
        "review_evidence_sha256": record_sha256(receipt["review_inputs"]), "training_authorized": False}
