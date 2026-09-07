"""Immutable private releases with explicit purpose loading and isolated test answers.

A release records current review, permission and known-exposure eligibility. It is
not a signature proving consent, a study-selection decision or training approval.
Callers must select purposes explicitly. Training callers never open test payloads.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from importlib.resources import files
import hashlib
import json
import os
from pathlib import Path
import re
import stat

from jsonschema import Draft202012Validator, FormatChecker

from .artifacts import write_json_new
from .data_use import audit_data_use, selected_dataset
from .permissions import validate_permissions
from .records import RecordsError, example_sha256, record_sha256, validate_dataset

SPLITS = ("development_screen", "smoke_training", "train", "validation", "final_test")
_MAX_JSON_BYTES = 32 * 1024 * 1024
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,95}")


def _safe_path(value, *, directory=False):
    path = Path(value).expanduser().absolute()
    if any(part.is_symlink() for part in (path, *path.parents)) or path.resolve() != path:
        raise RecordsError("Release paths must be canonical and cannot contain symlinks.")
    if directory and not path.is_dir():
        raise RecordsError("The private research root must already exist.")
    return path


def _read(path):
    path = _safe_path(path)
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_size > _MAX_JSON_BYTES:
                raise RecordsError("Release artifacts must be bounded regular JSON files.")
            raw = stream.read(_MAX_JSON_BYTES + 1)
            after = os.fstat(stream.fileno())
        if len(raw) > _MAX_JSON_BYTES or (before.st_ino, before.st_size, before.st_mtime_ns) != (
                after.st_ino, after.st_size, after.st_mtime_ns):
            raise RecordsError("Release artifact changed while reading.")
        def unique(pairs):
            value = {}
            for key, item in pairs:
                if key in value:
                    raise RecordsError("Duplicate JSON keys in release artifact.")
                value[key] = item
            return value
        def nonfinite(value):
            raise RecordsError("Nonfinite JSON in release artifact.")
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique, parse_constant=nonfinite)
        return value, {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RecordsError("Release artifact cannot be read as strict UTF-8 JSON.") from exc


def _require_valid(report, label):
    if report.get("valid") is not True:
        raise RecordsError(label + ": " + ", ".join(sorted({item["code"] for item in report.get("errors", [])})))


def _manifest_check(manifest):
    schema = json.loads(files("ht_tibetan_contracts").joinpath("dataset-release.schema.json").read_text())
    errors = list(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(manifest))
    if errors:
        raise RecordsError("Dataset release manifest schema is invalid.")
    expected = {"permissions.json", "history.json"}
    purposes, ids, sources = set(), set(), set()
    for item in manifest["splits"]:
        purpose = item["purpose"]
        expected_dataset = "locked/final_test.dataset.json" if purpose == "final_test" else f"datasets/{purpose}.json"
        references = "locked/final_test.references.json" if purpose == "final_test" else None
        if (purpose in purposes or ids.intersection(item["example_ids"])
                or sources.intersection(item["source_ids"])
                or item["example_count"] != len(item["example_ids"])
                or item["dataset_path"] != expected_dataset
                or item["audit_path"] != f"audits/{purpose}.json"
                or item["references_path"] != references):
            raise RecordsError("Release split identities or artifact locations are inconsistent.")
        purposes.add(purpose)
        ids.update(item["example_ids"])
        sources.update(item["source_ids"])
        expected.update((item["dataset_path"], item["audit_path"]))
        if references:
            expected.add(references)
    artifact_paths = [item["path"] for item in manifest["artifacts"]]
    if len(artifact_paths) != len(set(artifact_paths)) or set(artifact_paths) != expected:
        raise RecordsError("Release inventory does not match the exact expected artifacts.")


def _merge(datasets):
    merged = {"schema_version": "1.0", "sources": [], "examples": [], "reviews": [], "adjudications": []}
    for field, key in (("sources", "source_id"), ("examples", "example_id"),
                       ("reviews", "review_id"), ("adjudications", "adjudication_id")):
        identities = {}
        for dataset in datasets:
            for item in dataset[field]:
                if item[key] in identities and identities[item[key]] != item:
                    raise RecordsError("Selected release split records have inconsistent repeated identities.")
                identities[item[key]] = item
        merged[field] = list(identities.values())
    return merged


def _history_monotonic(previous, current):
    _require_valid(current, "Current exposure history is invalid")
    for field in ("inventory",):
        old = {item["path"]: item["sha256"] for item in previous.get(field, [])}
        new = {item["path"]: item["sha256"] for item in current.get(field, [])}
        if any(new.get(path) != digest for path, digest in old.items()):
            raise RecordsError("Release exposure history was removed or changed after the release was built.")


def build_release(dataset_path, permissions_path, root, output_dir, *, release_id,
                  evidence_kind="human_review", contributor_policy="report"):
    """Audit and create a new private release; existing output is never overwritten.

    Synthetic construction is engineering-only and accepts only synthetic nonclinical
    source material. It cannot become human evidence through a manifest flag change.
    Build holds the same experiment lock used by inference/training dispatch.
    """
    from .experiment_lock import experiment_lock
    root = _safe_path(root, directory=True)
    with experiment_lock(root):
        return _build_release(dataset_path, permissions_path, root, output_dir,
            release_id=release_id, evidence_kind=evidence_kind, contributor_policy=contributor_policy)


def _build_release(dataset_path, permissions_path, root, output_dir, *, release_id,
                   evidence_kind, contributor_policy):
    if (not isinstance(release_id, str) or not _ID.fullmatch(release_id)
            or evidence_kind not in {"human_review", "synthetic_test"}):
        raise RecordsError("Release requires a valid ID and explicit human_review or synthetic_test evidence kind.")
    output = _safe_path(output_dir)
    if output.parent != root / "releases" or output.name != release_id:
        raise RecordsError("Release output must be root/releases/<release_id>.")
    if output.exists():
        raise RecordsError("Release output already exists; immutable releases cannot be overwritten.")
    if output.is_relative_to((Path.home() / "Desktop").resolve()):
        raise RecordsError("Dataset releases belong in the private research root, outside Desktop.")
    dataset, dataset_file = _read(dataset_path)
    permissions, permission_file = _read(permissions_path) if permissions_path is not None else (None, None)
    if permissions is not None and not isinstance(permissions, dict):
        raise RecordsError("Permission sidecar must contain a permission ledger object.")
    _require_valid(validate_dataset(dataset), "Release dataset is invalid")
    if not dataset["examples"] or any(item["split"] not in SPLITS for item in dataset["examples"]):
        raise RecordsError("Assign every example to one fixed release split before building.")
    synthetic = evidence_kind == "synthetic_test"
    if synthetic and permissions is not None and permissions.get("evidence_kind") != "synthetic_test":
        raise RecordsError("Engineering releases cannot carry operator-recorded permission evidence.")
    audited, reconciled = {}, dataset
    now = datetime.now(timezone.utc)
    for purpose in SPLITS:
        selected = [item["example_id"] for item in dataset["examples"] if item["split"] == purpose]
        if not selected:
            continue
        reconciled, report = audit_data_use(dataset, permissions, root / "runs", purpose=purpose,
            example_ids=selected, contributor_policy=contributor_policy, as_of=now, synthetic_only=synthetic)
        _require_valid(report, f"Release {purpose} audit failed")
        if synthetic and permissions is not None:
            # Engineering does not need human consent, but a supplied sidecar must
            # still be the bounded contract, never an unchecked free-text channel.
            for use in (purpose, "private_research"):
                _require_valid(validate_permissions(selected_dataset(reconciled, selected), permissions,
                    purpose=use, as_of=now), "Synthetic permission fixture is invalid")
        audited[purpose] = report
    inventories = [report["exposure_inventory"] for report in audited.values()]
    if len({record_sha256(value) for value in inventories}) != 1:
        raise RecordsError("Exposure history changed during release construction.")
    manifest = {"schema_kind": "dataset_release", "schema_version": "1.0", "release_id": release_id,
        "created_at": now.isoformat(), "evidence_kind": evidence_kind, "engineering_only": synthetic,
        "contributor_policy": contributor_policy, "inputs": {
            "dataset_file_sha256": dataset_file["sha256"], "dataset_canonical_sha256": record_sha256(dataset),
            "reconciled_dataset_canonical_sha256": record_sha256(reconciled),
            "permissions_file_sha256": permission_file["sha256"] if permission_file else None,
            "permissions_canonical_sha256": record_sha256(permissions) if permissions is not None else None},
        "splits": [], "artifacts": [], "permissions_path": "permissions.json", "history_path": "history.json",
        "limitations": ["Operator-recorded consent and author declarations are not authenticated by this contract.",
            "Only recorded local history is observable; omitted external or deleted history predating this release is unknown.",
            "Duplicate screening does not prove semantic independence or clinical safety.",
            "A release does not select a study, grant training approval or demonstrate model quality."]}
    payloads = {"permissions.json": permissions, "history.json": inventories[0]}
    for purpose, audit in audited.items():
        ids = [item["example_id"] for item in reconciled["examples"] if item["split"] == purpose]
        data = selected_dataset(reconciled, ids)
        dataset_digest = record_sha256(data)
        dataset_name = f"datasets/{purpose}.json"
        reference_name = None
        if purpose == "final_test":
            dataset_name, reference_name = "locked/final_test.dataset.json", "locked/final_test.references.json"
            entries = []
            for item in data["examples"]:
                entries.append({"example_id": item["example_id"], "example_version": item["version"],
                    "example_sha256": example_sha256(item), "allowed_claims": item["allowed_claims"],
                    "approved_answer": item["approved_answer"]})
                item["approved_answer"], item["allowed_claims"] = None, []
            payloads[reference_name] = {"schema_kind": "locked_final_references", "schema_version": "1.0", "entries": entries}
        payloads[dataset_name] = data
        payloads[f"audits/{purpose}.json"] = audit
        manifest["splits"].append({"purpose": purpose, "example_ids": sorted(ids), "source_ids": sorted(item["source_id"] for item in data["sources"]),
            "example_count": len(ids), "dataset_path": dataset_name, "dataset_canonical_sha256": dataset_digest,
            "audit_path": f"audits/{purpose}.json", "references_path": reference_name})
    # Re-read mutable input files immediately before publishing their immutable copy.
    if _read(dataset_path)[1] != dataset_file or (permissions_path is not None and _read(permissions_path)[1] != permission_file):
        raise RecordsError("Release input or permission ledger changed during construction.")
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    output.mkdir(mode=0o700)
    for name, value in sorted(payloads.items()):
        target = output / name
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        write_json_new(target, value)
        _, identity = _read(target)
        manifest["artifacts"].append({"path": name, **identity})
    _manifest_check(manifest)
    write_json_new(output / "manifest.json", manifest)
    write_json_new(output / "release.sha256.json", {"schema_kind": "dataset_release_digest",
        "schema_version": "1.0", "release_sha256": record_sha256(manifest)})
    return manifest


def verify_release(release_dir, *, root=None, permissions_path=None, purposes=None, recheck_current=True):
    """Verify and load only explicitly selected purposes; raises on failed checks.

    This function does not acquire an experiment lock. Dispatch callers must hold
    the root lock across rechecking, exposure reservation and their protected work.
    ``recheck_current=False`` is an offline integrity inspection, never clearance to
    train/evaluate. It does not read mutable permission files or claim current consent.
    """
    directory = _safe_path(release_dir, directory=True)
    root = _safe_path(root if root is not None else directory.parent.parent, directory=True)
    if directory.parent != root / "releases":
        raise RecordsError("Release must be under the selected private root/releases.")
    if (not isinstance(purposes, (list, tuple)) or not purposes
            or any(not isinstance(purpose, str) or purpose not in SPLITS for purpose in purposes)
            or len(set(purposes)) != len(purposes)):
        raise RecordsError("Select distinct explicit release purposes; no all-splits default is permitted.")
    manifest, _ = _read(directory / "manifest.json")
    _manifest_check(manifest)
    digest, _ = _read(directory / "release.sha256.json")
    release_hash = record_sha256(manifest)
    if (directory.name != manifest["release_id"] or digest != {"schema_kind": "dataset_release_digest",
            "schema_version": "1.0", "release_sha256": release_hash}):
        raise RecordsError("Release manifest digest or directory identity differs.")
    available = {item["purpose"]: item for item in manifest["splits"]}
    if not set(purposes) <= available.keys():
        raise RecordsError("A requested purpose does not exist in this release.")
    artifacts = {item["path"]: item for item in manifest["artifacts"]}
    expected_files = set(artifacts) | {"manifest.json", "release.sha256.json"}
    actual_files = set()
    for path in directory.rglob("*"):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise RecordsError("Release contains a symlink or nonregular filesystem entry.")
        if path.is_file():
            actual_files.add(str(path.relative_to(directory)))
    if expected_files != actual_files:
        raise RecordsError("Release files differ from the immutable artifact inventory.")
    for name, entry in artifacts.items():
        if (directory / name).stat().st_size != entry["bytes"]:
            raise RecordsError("Release artifact size differs from its inventory.")
    loaded_names = []
    def load_artifact(name):
        value, identity = _read(directory / name)
        if {"path": name, **identity} != artifacts[name]:
            raise RecordsError("Release artifact hash differs from its inventory.")
        loaded_names.append(name)
        return value
    permission_snapshot = load_artifact("permissions.json")
    history_snapshot = load_artifact("history.json")
    _require_valid(history_snapshot, "Release history snapshot is invalid")
    if (record_sha256(permission_snapshot) if permission_snapshot is not None else None) != manifest["inputs"]["permissions_canonical_sha256"]:
        raise RecordsError("Release permission snapshot identity differs from its manifest.")
    if manifest["engineering_only"]:
        if permission_snapshot is not None and (not isinstance(permission_snapshot, dict)
                or permission_snapshot.get("evidence_kind") != "synthetic_test"):
            raise RecordsError("Engineering release permission snapshot must be explicitly synthetic.")
    elif not isinstance(permission_snapshot, dict) or permission_snapshot.get("evidence_kind") != "operator_recorded":
        raise RecordsError("Human release requires an operator-recorded permission snapshot.")
    datasets, snapshots = {}, {}
    for purpose in purposes:
        item = available[purpose]
        data = load_artifact(item["dataset_path"])
        if purpose == "final_test":
            refs = load_artifact(item["references_path"])
            if (not isinstance(refs, dict) or set(refs) != {"schema_kind", "schema_version", "entries"}
                    or refs["schema_kind"] != "locked_final_references" or refs["schema_version"] != "1.0"
                    or not isinstance(refs["entries"], list)):
                raise RecordsError("Locked final references are malformed.")
            entries = {entry.get("example_id"): entry for entry in refs["entries"] if isinstance(entry, dict)}
            if len(entries) != len(refs["entries"]) or set(entries) != set(item["example_ids"]):
                raise RecordsError("Locked final reference membership differs.")
            for example in data["examples"]:
                entry = entries[example["example_id"]]
                if (set(entry) != {"example_id", "example_version", "example_sha256", "allowed_claims", "approved_answer"}
                        or entry["example_version"] != example["version"]
                        or example["approved_answer"] is not None or example["allowed_claims"] != []):
                    raise RecordsError("Locked final reference binding differs.")
                example.update(approved_answer=entry["approved_answer"], allowed_claims=entry["allowed_claims"])
                if example_sha256(example) != entry["example_sha256"]:
                    raise RecordsError("Locked final content hash differs.")
        _require_valid(validate_dataset(data), "Released dataset is invalid")
        if (record_sha256(data) != item["dataset_canonical_sha256"]
                or sorted(example["example_id"] for example in data["examples"]) != item["example_ids"]
                or sorted(source["source_id"] for source in data["sources"]) != item["source_ids"]
                or {source["source_id"] for source in data["sources"]} != {example["source_id"] for example in data["examples"]}
                or any(example["split"] != purpose for example in data["examples"])):
            raise RecordsError("Released content or fixed split assignment differs.")
        synthetic = manifest["engineering_only"]
        if any((source["source_kind"] == "synthetic_fixture") != synthetic
               or (synthetic and source["scope"] != "nonclinical") for source in data["sources"]):
            raise RecordsError("Release evidence marker disagrees with its source material.")
        audit = load_artifact(item["audit_path"])
        if (audit.get("valid") is not True or audit.get("purpose") != purpose
                or audit.get("synthetic_only") is not synthetic
                or sorted(audit.get("selected_example_ids", [])) != item["example_ids"]
                or audit.get("dataset_sha256") != manifest["inputs"]["dataset_canonical_sha256"]
                or audit.get("reconciled_dataset_sha256") != manifest["inputs"]["reconciled_dataset_canonical_sha256"]
                or audit.get("exposure_inventory") != history_snapshot):
            raise RecordsError("Release audit identity differs from released content/history.")
        if permission_snapshot is not None:
            for use in (purpose, "private_research"):
                _require_valid(validate_permissions(data, permission_snapshot, purpose=use,
                    as_of=manifest["created_at"]), "Release-time contributor permission is invalid")
        datasets[purpose], snapshots[purpose] = data, audit
    merged = _merge(datasets.values())
    _require_valid(validate_dataset(merged), "Merged release data is invalid")
    audits = snapshots
    if recheck_current:
        synthetic = manifest["engineering_only"]
        if not synthetic and permissions_path is None:
            raise RecordsError("Current permission ledger is required; a release snapshot cannot prove unrevoked consent.")
        current_permissions = _read(permissions_path)[0] if permissions_path is not None else None
        audits = {}
        for purpose in purposes:
            _, report = audit_data_use(merged, current_permissions, root / "runs", purpose=purpose,
                example_ids=available[purpose]["example_ids"], contributor_policy=manifest["contributor_policy"],
                synthetic_only=synthetic)
            _require_valid(report, f"Current {purpose} release audit failed")
            _history_monotonic(history_snapshot, report["exposure_inventory"])
            audits[purpose] = report
    return {"valid": True, "dataset": merged, "datasets": datasets, "manifest": manifest,
        "release_sha256": release_hash, "audits": audits, "engineering_only": manifest["engineering_only"],
        "evidence_kind": manifest["evidence_kind"], "current_eligibility_checked": bool(recheck_current),
        "verification_scope": "selected_content_and_shared_metadata", "verified_artifacts": sorted(loaded_names),
        "unopened_splits": sorted(set(available) - set(purposes))}
