"""Audit connected source/scenario/paraphrase groups and declared data exposure."""

from __future__ import annotations

from typing import Any

from .duplicate_content import TASK_FINGERPRINT_FIELDS, content_keys, screening_description
from .records import RecordsError, validate_dataset


def audit_splits(dataset: dict[str, Any], contributor_policy: str = "report") -> dict[str, Any]:
    """Do not assign or silently repair splits. Report all connected conflicts.

    Source, scenario, paraphrase and duplicate task-content edges are transitive.
    Contributor disjointness is an explicit study choice. This function audits
    supplied exposure declarations; it cannot recover unrecorded historical use.
    """
    if contributor_policy not in {"report", "disjoint"}:
        raise RecordsError("contributor_policy must be 'report' or 'disjoint'.")
    validation = validate_dataset(dataset)
    if not validation["valid"]:
        return {**validation, "contributor_policy": contributor_policy,
                "contributor_overlap": [], "components": [], "warnings": [],
                "duplicate_groups": [], "screening": screening_description()}
    examples = dataset["examples"]
    parents = list(range(len(examples)))

    def find(item: int) -> int:
        while parents[item] != item:
            parents[item] = parents[parents[item]]
            item = parents[item]
        return item

    seen: dict[tuple[str, str], int] = {}
    duplicate_members: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for index, example in enumerate(examples):
        for key in sorted(content_keys(example)):
            if key in seen:
                parents[find(index)] = find(seen[key])
            else:
                seen[key] = index
            if key[0] in TASK_FINGERPRINT_FIELDS:
                duplicate_members.setdefault(key, []).append(example)
    groups: dict[int, list[dict[str, Any]]] = {}
    for index, example in enumerate(examples):
        groups.setdefault(find(index), []).append(example)

    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = [{
        "path": "/examples", "code": "semantic_overlap_not_screened",
        "message": screening_description()["limitation"],
    }]
    duplicate_groups = []
    for (method, fingerprint), members in sorted(duplicate_members.items()):
        if len(members) < 2:
            continue
        ids = sorted(item["example_id"] for item in members)
        splits = sorted({item["split"] for item in members if item["split"] != "unassigned"})
        duplicate_groups.append({"method": method, "fingerprint": fingerprint,
                                 "example_ids": ids, "splits": splits})
        if len(splits) > 1:
            errors.append({"path": "/examples/" + ",".join(ids),
                           "code": "duplicate_content_cross_split", "message":
                           f"{method} duplicate task content spans splits: {', '.join(splits)}."})
    components = []
    for members in groups.values():
        ids = sorted(item["example_id"] for item in members)
        splits = sorted({item["split"] for item in members if item["split"] != "unassigned"})
        exposure = sorted({role for item in members for role in item["exposures"]})
        path = "/examples/" + ",".join(ids)
        if len(splits) > 1:
            errors.append({"path": path, "code": "connected_split", "message":
                           f"Connected source/scenario/paraphrase/task-content group spans splits: {', '.join(splits)}. Do not weaken grouping to fit a target."})
        if "final_test" in splits and any(role != "final_test" for role in exposure):
            errors.append({"path": path, "code": "test_leakage", "message":
                           f"Final-test group has prior non-test exposure: {', '.join(exposure)}."})
        if "validation" in splits and any(role in {"train", "smoke_training", "development_screen", "final_test"} for role in exposure):
            errors.append({"path": path, "code": "validation_leakage", "message":
                           "Validation group was exposed in another study role."})
        if "final_test" in exposure and any(role != "final_test" for role in splits):
            errors.append({"path": path, "code": "test_reassignment", "message":
                           "Previously evaluated final-test material must remain identified as test-exposed; create a new study release to reuse it."})
        if "final_test" in splits and "final_test" in exposure:
            warnings.append({"path": path, "code": "test_exposed", "message":
                             "This test group has already been evaluated; it is not new unseen evidence for another iteration."})
        if any(item["split"] == "unassigned" for item in members):
            warnings.append({"path": path, "code": "unassigned", "message": "Assign every group member before releasing an experiment dataset."})
        components.append({"example_ids": ids, "splits": splits, "exposures": exposure,
                           "unseen_final_test": splits == ["final_test"] and not exposure})

    contributors: dict[str, dict[str, set[str]]] = {}
    for example in examples:
        info = contributors.setdefault(example["contributor_id"], {"splits": set(), "example_ids": set()})
        if example["split"] != "unassigned":
            info["splits"].add(example["split"])
        info["example_ids"].add(example["example_id"])
    overlap = [{"contributor_id": cid, "splits": sorted(info["splits"]), "example_ids": sorted(info["example_ids"])}
               for cid, info in sorted(contributors.items()) if len(info["splits"]) > 1]
    if contributor_policy == "disjoint":
        for item in overlap:
            errors.append({"path": "/contributors/" + item["contributor_id"], "code": "contributor_overlap",
                           "message": "Contributor crosses assigned splits under the disjoint policy."})
    return {"valid": not errors, "errors": errors, "counts": validation["counts"],
            "contributor_policy": contributor_policy, "contributor_overlap": overlap,
            "components": sorted(components, key=lambda item: item["example_ids"]), "warnings": warnings,
            "duplicate_groups": duplicate_groups, "screening": screening_description()}
