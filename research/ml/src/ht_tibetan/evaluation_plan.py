"""Plan stable evaluation case identities without opening data or running models.

This is a configuration check, not permission to evaluate. Dataset eligibility,
token budgets, model payloads and current rights are checked by the actual runner.
"""
from __future__ import annotations

from collections import Counter

from .conditions import condition_identity
from .records import RecordsError, record_sha256


def enumerate_cases(config: dict) -> list[dict]:
    """Keep the historical condition/example/arm order used by native runs."""
    from .evaluation import validate_evaluation_config
    validate_evaluation_config(config)
    return [{"candidate_id": arm["candidate_id"], "arm_id": arm["arm_id"],
             "condition_id": condition["condition_id"], "instruction_language": condition["instruction_language"],
             "example_id": example_id}
            for condition in config["conditions"] for example_id in config["example_ids"] for arm in config["arms"]]


def case_id_for(config: dict, sequence: int) -> str:
    if type(sequence) is not int or not 1 <= sequence <= 400:
        raise RecordsError("Evaluation case sequence must be between one and 400.")
    return config["run_id"] + f"-{sequence:04d}"


def study_alignment(config: dict, study: dict) -> dict:
    """Check the predeclared pilot roster for development comparisons only."""
    from .study import validate_study
    readiness = validate_study(study)
    issues = []
    if not readiness["valid"]:
        issues.append({"code": "invalid_study", "message": "The study contains invalid design fields."})
    else:
        if any(condition != study["condition"] for condition in config["conditions"]):
            issues.append({"code": "condition_mismatch", "message": "Every condition must match the registered study condition exactly."})
        actual = {arm["candidate_id"] for arm in config["arms"]}
        if not actual <= set(study["candidate_ids"]):
            issues.append({"code": "unregistered_candidate", "message": "The plan contains a candidate outside the study."})
        if config["purpose"] == "development_screen":
            declared_config = study.get("development_config_sha256")
            if declared_config is not None and declared_config != record_sha256(config):
                issues.append({"code": "development_config_changed", "message": "The development configuration differs from its preregistered hash; pilot IDs cannot be remapped."})
            bases = {arm["candidate_id"] for arm in config["arms"] if arm["arm_id"] == "base"}
            if not set(study["candidate_ids"]) <= bases:
                issues.append({"code": "missing_registered_base", "message": "A development comparison must include every registered base candidate."})
            available = {case_id_for(config, index) for index, _ in enumerate(enumerate_cases(config), 1)}
            missing = [value for value in study["pilot"]["expected_item_ids"] if value not in available]
            if missing:
                issues.append({"code": "pilot_cases_not_planned", "message": "Pilot output IDs must belong to this development comparison.", "case_ids": missing})
    return {"valid": not issues, "study_sha256": readiness["study_sha256"],
            "study_valid": readiness["valid"], "study_ready_for_evaluation": readiness["ready_for_evaluation"],
            "missing_preregistration_fields": readiness["missing_preregistration_fields"],
            "study_errors": readiness["errors"], "issues": issues,
            "pilot_roster_checked": config["purpose"] == "development_screen"}


def validate_evaluation_study(config: dict, study: dict) -> None:
    alignment = study_alignment(config, study)
    if not alignment["study_ready_for_evaluation"] or study.get("evidence_kind") != "human_review":
        raise RecordsError("A real comparison requires a complete preregistered human-review study.")
    if not alignment["valid"]:
        raise RecordsError("Evaluation/study mismatch: " + "; ".join(item["code"] for item in alignment["issues"]))
    from .artifacts import utc_now
    from .study import _time
    if _time(study["registered_at"]) > _time(utc_now()):
        raise RecordsError("Study registration must precede evaluation; its timestamp is in the future.")


def build_evaluation_plan(config: dict, *, study: dict | None = None) -> dict:
    jobs = enumerate_cases(config)
    cases = [{"case_id": case_id_for(config, index), **job} for index, job in enumerate(jobs, 1)]
    counts = Counter((job["candidate_id"], job["arm_id"]) for job in jobs)
    alignment = study_alignment(config, study) if study is not None else None
    return {"schema_version": "1.0", "kind": "evaluation_case_plan", "configuration_valid": True,
            "run_id": config["run_id"], "purpose": config["purpose"], "config_sha256": record_sha256(config),
            "case_order_policy": "condition-example-arm-v1", "planned_cases": cases,
            "planned_output_count": len(cases), "distinct_example_id_count": len(config["example_ids"]),
            "independent_source_count": None,
            "per_arm": [{"candidate_id": candidate, "arm_id": arm, "planned_output_count": count}
                        for (candidate, arm), count in sorted(counts.items())],
            "condition_identities": [condition_identity(condition) for condition in config["conditions"]],
            "study_alignment": alignment, "pilot_cases_selected": False,
            "model_executed": False, "dataset_opened": False, "exposure_reserved": False,
            "evaluation_authorized": False, "training_authorized": False,
            "limitations": ["This plan checks configuration and optional study alignment only.",
                "Select the ten pilot output IDs before evaluating; the planner does not choose them for you.",
                "Bind config_sha256 as development_config_sha256 in the study before preregistration; case IDs alone do not freeze their meaning.",
                "Different outputs can share an example or source and are not independent observations.",
                "Release membership, permissions, exposure, exact token lengths and model payloads still require the execution checks."]}
