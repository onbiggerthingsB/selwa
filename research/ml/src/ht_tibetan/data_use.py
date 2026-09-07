"""Pre-dispatch checks against recorded permissions and cumulative local exposure.

This is not a dataset release builder or a claim of semantic test independence.
The inventory covers recorded runs under one configured private research root.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

from .permissions import PERMITTED_USES, validate_permissions
from .records import RecordsError, example_sha256, record_sha256, validate_dataset
from .splits import audit_splits


def selected_dataset(dataset: dict, example_ids: list[str]) -> dict:
    """Keep exact selected material and current provenance without changing bindings."""
    selected = deepcopy(dataset)
    ids = set(example_ids)
    selected["examples"] = [item for item in selected["examples"] if item["example_id"] in ids]
    for field in ("reviews", "adjudications"):
        selected[field] = [item for item in selected[field] if item["example_id"] in ids]
    sources = {item["source_id"] for item in selected["examples"]}
    selected["sources"] = [item for item in selected["sources"] if item["source_id"] in sources]
    return selected


def permission_checks(dataset: dict, permissions: dict | None, *, purpose: str,
                      as_of: str | datetime) -> list[dict]:
    if permissions is None:
        return [{"valid": False, "errors": [{"path": "/permissions",
            "code": "missing_permissions", "message": "A current contributor permission ledger is required."}]}]
    reports = [validate_permissions(dataset, permissions, purpose=role, as_of=as_of)
               for role in dict.fromkeys((purpose, "private_research"))]
    for report in reports:
        if report.get("evidence_kind") != "operator_recorded":
            report["valid"] = False
            report["errors"].append({"path": "/permissions/evidence_kind",
                "code": "human_permission_evidence_required",
                "message": "Synthetic permission fixtures cannot establish permission for real material."})
    return reports


def _author_independence(dataset: dict, checks: list[dict]) -> tuple[list[dict], list[dict]]:
    """Apply all recorded authorship to real-data approval after permission checks.

    Permission clearances already reconcile declared authors with known bound grant
    history, including additional example authors and source-text authors. They do
    not discover omitted authors or establish a person's actual identity.
    """
    errors, provenance = [], []
    clearances = [entry for check in checks for entry in check.get("clearances", [])]
    reviews = {item["review_id"]: item for item in dataset["reviews"]}
    superseded = {item["supersedes_review_id"] for item in dataset["reviews"]
                  if item["supersedes_review_id"] is not None}
    decisions = {item["example_id"]: item for item in dataset["adjudications"]}
    for example in dataset["examples"]:
        known_authors = {example["contributor_id"]}
        for clearance in clearances:
            if ((clearance["contribution_kind"] == "example_bundle"
                    and clearance["example_id"] == example["example_id"])
                    or (clearance["contribution_kind"] == "source_text"
                        and clearance["source_id"] == example["source_id"])):
                known_authors.add(clearance["contributor_id"])
        decision = decisions.get(example["example_id"], {})
        linked = [reviews[rid] for rid in decision.get("review_ids", []) if rid in reviews]
        current_language = [item for item in linked if item["review_type"] == "language"
            and item["status"] == "complete" and item["review_id"] not in superseded
            and (item["example_id"], item["example_version"], item["example_sha256"], item["source_sha256"])
                == (example["example_id"], example["version"], example_sha256(example), example["source_sha256"])
            and item["minutes_spent"] is not None and item["recommendation"] != "pending"
            and all(item["ratings"][axis] is not None for axis in ("naturalness", "fidelity", "comprehension"))]
        independent = [item for item in current_language if item["reviewer_id"] not in known_authors]
        independent_ids = sorted({item["reviewer_id"] for item in independent})
        support_ids = sorted({item["reviewer_id"] for item in independent if item["recommendation"] == "approve"})
        adjudicator = decision.get("adjudicator_id")
        overlap_ids = sorted(item["review_id"] for item in linked if item["reviewer_id"] == adjudicator)
        provenance.append({"example_id": example["example_id"], "source_id": example["source_id"],
            "known_author_ids": sorted(known_authors),
            "excluded_author_review_ids": sorted(item["review_id"] for item in current_language if item["reviewer_id"] in known_authors),
            "complete_independent_language_reviewer_ids": independent_ids,
            "complete_independent_language_reviewer_count": len(independent_ids),
            "supporting_independent_language_reviewer_ids": support_ids,
            "adjudicator_id": adjudicator, "adjudicator_is_known_author": adjudicator in known_authors,
            "adjudicator_reviewer_overlap": bool(overlap_ids), "overlapping_review_ids": overlap_ids})
        path = "/examples/" + example["example_id"]
        if decision.get("language_review") == "approved":
            if len(independent_ids) < 2:
                errors.append({"path": path, "code": "known_author_review_independence",
                    "message": "Language approval requires two completed current reviewers outside every known example and source author."})
            if not support_ids:
                errors.append({"path": path, "code": "known_author_language_evidence",
                    "message": "Language approval requires a supporting completed reviewer outside every known example and source author."})
        if adjudicator in known_authors:
            errors.append({"path": path, "code": "known_author_adjudicator",
                "message": "A known example or source author cannot adjudicate that example."})
    return errors, provenance


def audit_data_use(dataset: dict, permissions: dict | None, runs_root: Path, *, purpose: str,
                   example_ids: list[str] | None = None, contributor_policy: str = "report",
                   as_of: str | datetime | None = None, synthetic_only: bool = False) -> tuple[dict, dict]:
    """Return a reconciled copy and a scoped, non-authorizing audit receipt.

Old input records remain untouched. New baseline dispatches consume this audit;
standalone validation and legacy review do not silently gain release authority.
"""
    from .exposure_inventory import build_exposure_inventory, reconcile_exposures

    if purpose not in PERMITTED_USES:
        raise RecordsError("Unknown data-use purpose.")
    now = as_of if as_of is not None else datetime.now(timezone.utc)
    validation = validate_dataset(dataset)
    errors = list(validation["errors"])
    report = {"schema_version": "1.0", "kind": "recorded_data_use_audit", "valid": False,
              "purpose": purpose, "synthetic_only": synthetic_only,
              "dataset_sha256": record_sha256(dataset), "errors": errors,
              "dataset_release_created": False, "training_authorized": False,
              "semantic_independence_verified": False,
              "history_scope": "Recorded artifacts in the configured runs root; undisclosed, deleted or external history cannot be recovered."}
    reconciled = deepcopy(dataset)
    if errors:
        return reconciled, report
    ids = example_ids if example_ids is not None else [item["example_id"] for item in dataset["examples"]]
    if not ids or len(ids) != len(set(ids)) or not set(ids) <= {item["example_id"] for item in dataset["examples"]}:
        raise RecordsError("Select at least one existing, distinct example for a data-use audit.")
    report["selected_example_ids"] = sorted(ids)
    inventory = build_exposure_inventory(Path(runs_root))
    report["exposure_inventory"] = inventory
    if not inventory["valid"]:
        errors.extend(inventory["errors"])
        return reconciled, report
    reconciled, reconciliation = reconcile_exposures(dataset, inventory)
    report["exposure_reconciliation"] = reconciliation
    report["reconciled_dataset_sha256"] = record_sha256(reconciled)
    split_audit = audit_splits(reconciled, contributor_policy)
    report["split_audit"] = split_audit
    errors.extend(split_audit["errors"])
    selected = selected_dataset(reconciled, ids)
    sources = {item["source_id"]: item for item in selected["sources"]}
    decisions = {item["example_id"]: item for item in selected["adjudications"]}
    for example in selected["examples"]:
        source = sources[example["source_id"]]
        path = "/examples/" + example["example_id"]
        def error(code, message):
            errors.append({"path": path, "code": code, "message": message})
        if purpose not in {"review", "private_research"} and example["split"] != purpose:
            error("purpose_split_mismatch", "The example must be assigned to the requested use before dispatch.")
        if synthetic_only:
            if source["source_kind"] != "synthetic_fixture" or source["scope"] != "nonclinical":
                error("synthetic_only", "The permission-free engineering path accepts only nonclinical synthetic fixtures.")
            continue
        if source["source_kind"] == "synthetic_fixture":
            error("synthetic_material", "Synthetic fixtures cannot supply real study evidence.")
        if source["unresolved_issues"]:
            error("unresolved_source", "Resolve source issues before using the contribution.")
        if purpose != "review":
            decision = decisions.get(example["example_id"], {})
            if (source["language_review"] != "approved" or example["review_state"] != "approved"
                    or decision.get("decision") != "approve" or decision.get("language_review") != "approved"):
                error("language_approval_required", "Current source and example language approval is required.")
            if source["scope"] == "health" and (source["medical_review"] != "approved"
                    or decision.get("medical_review") != "approved"):
                error("medical_approval_required", "Health material requires separate source and example medical approval.")
    if purpose == "final_test":
        for component in split_audit["components"]:
            if set(ids).intersection(component["example_ids"]) and component["exposures"]:
                errors.append({"path": "/examples", "code": "test_already_exposed",
                    "message": "A final-test audit cannot clear previously exposed groups as unseen."})
    report["permission_checks"] = [] if synthetic_only else permission_checks(selected, permissions, purpose=purpose, as_of=now)
    for check in report["permission_checks"]:
        errors.extend(check["errors"])
    report["author_independence"] = []
    if (not synthetic_only and purpose != "review" and report["permission_checks"]
            and all(check["valid"] for check in report["permission_checks"])):
        author_errors, report["author_independence"] = _author_independence(selected, report["permission_checks"])
        errors.extend(author_errors)
    report["valid"] = not errors
    return reconciled, report
