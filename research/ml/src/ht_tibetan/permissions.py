"""Validate recorded consent for exact contributed material, separately from sources.

Every example's named contributor must cover its question, claims and answer as one
content-bound contribution. Operators must declare known additional example authors
in example_contributors; each needs separate permission. Source author declarations
require additional source-text grants and are mandatory for community sources. This
cannot discover omitted authors, verify identity or inspect the underlying consent
evidence, and it does not approve examples for training.

The caller supplies the complete current ledger and an explicit current timestamp.
Deleting a revocation from an old copy cannot be detected by a stateless validator;
consumers must bind their receipt to the current ledger hash and recheck before use.
Synthetic ledgers exercise contracts and must never serve as human consent evidence.
"""
from __future__ import annotations

from datetime import datetime, timezone
from importlib.resources import files
import json
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from .records import example_sha256, record_sha256, validate_dataset

PERMITTED_USES = frozenset({"development_screen", "smoke_training", "train",
                          "validation", "final_test", "private_research", "review"})
EXAMPLE_CONTRIBUTION_FIELDS = ["question", "allowed_claims", "approved_answer"]


def _timestamp(value: Any) -> datetime:
    if isinstance(value, datetime):
        result = value
    elif isinstance(value, str):
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        raise ValueError("Expected an explicit timezone-aware timestamp.")
    if result.tzinfo is None or result.utcoffset() is None:
        raise ValueError("Expected an explicit timezone-aware timestamp.")
    return result.astimezone(timezone.utc)


def _identity(grant: dict) -> tuple[str, str, str]:
    record_id = grant["example_id"] if grant["contribution_kind"] == "example_bundle" else grant["source_id"]
    # Content revisions do not create a second consent chain. A newer withdrawal or
    # changed binding must supersede the old entry, never fall back to its old grant.
    return grant["contribution_kind"], record_id, grant["contributor_id"]


def validate_permissions(dataset: Any, permissions: Any, *, purpose: str,
                         as_of: str | datetime) -> dict[str, Any]:
    """Return contributor and source-use clearance for all supplied dataset examples.

    Use a dataset containing exactly the selected examples (with their referenced
    source/review records). The ledger may also contain unrelated contributions and
    superseded content versions. All ledger revisions must remain structurally valid.
    Only the current head of each contribution/author chain may grant permission.

    ``valid`` is a contract result, not authenticated consent, language approval,
    training eligibility or proof that the optional source author list is exhaustive.
    The explicit ``evidence_kind`` lets real-material gates reject synthetic tests.
    """
    errors: list[dict[str, str]] = []
    report: dict[str, Any] = {"valid": False, "errors": errors, "clearances": [],
        "purpose": purpose, "as_of": None, "evidence_kind": None,
        "permissions_sha256": None, "scope": {
            "example_contribution_fields": EXAMPLE_CONTRIBUTION_FIELDS.copy(),
            "example_authorship_exhaustive": False,
            "source_authorship_exhaustive": False, "sources_without_author_registry": [],
            "underlying_evidence_verified": False}}

    def error(path: str, code: str, message: str) -> None:
        errors.append({"path": path, "code": code, "message": message})

    if not isinstance(purpose, str) or purpose not in PERMITTED_USES:
        error("/purpose", "permission_purpose", "Select one explicit permitted use; uses never imply one another.")
    try:
        now = _timestamp(as_of)
        report["as_of"] = now.isoformat().replace("+00:00", "Z")
    except (ValueError, TypeError, OverflowError):
        error("/as_of", "permission_time", "Supply an explicit timezone-aware as_of timestamp.")
        return report
    dataset_report = validate_dataset(dataset)
    if not dataset_report["valid"]:
        errors.extend({**item, "path": "/dataset" + item["path"]} for item in dataset_report["errors"])
    try:
        ledger_hash = record_sha256(permissions)
    except (ValueError, TypeError):
        error("/permissions", "schema", "Permissions must contain only finite JSON values.")
        return report
    schema = json.loads(files("ht_tibetan_contracts").joinpath(
        "contribution-permissions.schema.json").read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    for item in sorted(validator.iter_errors(permissions), key=lambda item: str(list(item.absolute_path))):
        error("/permissions/" + "/".join(map(str, item.absolute_path)), "schema", item.message)
    if errors:
        return report
    report.update(evidence_kind=permissions["evidence_kind"], permissions_sha256=ledger_hash)

    grants: dict[str, dict] = {}
    for index, grant in enumerate(permissions["grants"]):
        if grant["grant_id"] in grants:
            error(f"/permissions/grants/{index}/grant_id", "duplicate_grant", "Grant IDs must be unique across revisions.")
        grants[grant["grant_id"]] = grant
    roots: dict[tuple, str] = {}
    successors: dict[str, str] = {}
    needs_fresh_permission: set[str] = set()
    times: dict[str, tuple[datetime, datetime | None, datetime | None]] = {}
    for index, grant in enumerate(permissions["grants"]):
        try:
            times[grant["grant_id"]] = (_timestamp(grant["recorded_at"]),
                _timestamp(grant["granted_at"]) if grant["granted_at"] is not None else None,
                _timestamp(grant["expires_at"]) if grant["expires_at"] is not None else None)
        except (ValueError, TypeError, OverflowError):
            error(f"/permissions/grants/{index}", "permission_time", "Permission timestamps must be valid timezone-aware instants.")
    if errors:
        return report
    for index, grant in enumerate(permissions["grants"]):
        path = f"/permissions/grants/{index}"
        identity = _identity(grant)
        prior_id = grant["supersedes_grant_id"]
        recorded, granted, expiry = times[grant["grant_id"]]
        if recorded > now:
            error(path + "/recorded_at", "permission_time", "A ledger containing future records cannot establish current permission.")
        if granted is not None and granted > recorded:
            error(path + "/granted_at", "permission_time", "A recorded grant cannot predate its claimed permission.")
        if grant["status"] == "active" and granted is None:
            error(path + "/granted_at", "permission_time", "An active grant requires its actual permission timestamp.")
        if expiry is not None and granted is not None and expiry <= granted:
            error(path + "/expires_at", "permission_time", "Expiry must follow the original permission timestamp.")
        if prior_id is None:
            if grant["revision"] != 1 or identity in roots:
                error(path, "permission_revision", "Each contribution/author has exactly one initial revision followed by a single chain.")
            roots[identity] = grant["grant_id"]
        else:
            prior = grants.get(prior_id)
            if (prior is None or _identity(prior) != identity
                    or grant["revision"] != prior["revision"] + 1
                    or prior_id in successors):
                error(path, "permission_revision", "A revision must supersede the same contribution and author exactly once, without gaps or forks.")
            elif recorded < times[prior_id][0]:
                error(path + "/recorded_at", "permission_revision", "Permission history timestamps cannot move backwards.")
            elif (grant["status"] == "active" and granted is not None
                  and (prior["status"] != "active" or not set(grant["permitted_uses"]) <= set(prior["permitted_uses"])
                       or (times[prior_id][2] is not None
                           and (expiry is None or expiry > times[prior_id][2]))
                       or any(grant.get(key) != prior.get(key) for key in
                              ("example_version", "example_sha256", "source_version", "source_sha256")))):
                needs_fresh_permission.add(grant["grant_id"])
                if granted < times[prior_id][0]:
                    error(path + "/granted_at", "permission_revision", "Restoring, expanding or rebinding permission cannot predate the prior record.")
            successors[prior_id] = grant["grant_id"]
    # Revision increments plus one root, one predecessor and one successor rule out
    # cycles, disconnected roots, skipped withdrawals and ambiguous current heads.
    heads = {_identity(grant): grant for grant in grants.values() if grant["grant_id"] not in successors}
    if errors:
        return report
    # Preserve the most recent permission time across the entire chain, including
    # withdrawn/pending entries whose granted_at is null. A timestamp-lowering
    # intermediate revision must not make old consent appear newly granted later.
    latest_permission_time: dict[tuple, datetime] = {}
    for grant in sorted(grants.values(), key=lambda item: item["revision"]):
        identity = _identity(grant)
        granted = times[grant["grant_id"]][1]
        latest = latest_permission_time.get(identity)
        if granted is not None:
            if latest is not None and (granted < latest
                    or (grant["grant_id"] in needs_fresh_permission and granted <= latest)):
                error("/permissions/grants", "permission_revision", "Permission timestamps cannot move backwards; restoring, expanding or rebinding requires a timestamp newer than all prior grants.")
            latest_permission_time[identity] = max(granted, latest) if latest is not None else granted
    if errors:
        return report

    sources = {source["source_id"]: source for source in dataset["sources"]}
    examples = {example["example_id"]: example for example in dataset["examples"]}
    selected_sources = {example["source_id"] for example in dataset["examples"]}
    declarations: dict[str, dict] = {}
    for index, declaration in enumerate(permissions.get("source_contributors", [])):
        path = f"/permissions/source_contributors/{index}"
        source_id = declaration["source_id"]
        if source_id in declarations:
            error(path, "duplicate_source_authors", "Only one current author declaration is allowed for each source.")
        declarations[source_id] = declaration
        source = sources.get(source_id)
        if source_id in selected_sources and source is not None and (
                declaration["source_version"] != source["version"]
                or declaration["source_sha256"] != source["content_sha256"]):
            error(path, "stale_source_authors", "Source authors must be declared against the exact current source version and text hash.")
    example_declarations: dict[str, dict] = {}
    for index, declaration in enumerate(permissions.get("example_contributors", [])):
        path = f"/permissions/example_contributors/{index}"
        example_id = declaration["example_id"]
        if example_id in example_declarations:
            error(path, "duplicate_example_authors", "Only one current author declaration is allowed for each example.")
        example_declarations[example_id] = declaration
        example = examples.get(example_id)
        if example is not None:
            if (declaration["example_version"] != example["version"]
                    or declaration["example_sha256"] != example_sha256(example)):
                error(path, "stale_example_authors", "Additional authors must be declared against the exact current example version and hash.")
            if example["contributor_id"] not in declaration["contributor_ids"]:
                error(path, "missing_primary_author", "An example author declaration must include its named primary contributor.")

    def clear(identity: tuple[str, str, str], binding: dict, path: str) -> None:
        grant = heads.get(identity)
        if grant is None:
            error(path, "missing_contributor_permission", "No current permission record covers this contribution and contributor.")
            return
        if any(grant.get(key) != value for key, value in binding.items()):
            error(path, "stale_contributor_permission", "The current permission is not bound to the exact current contribution version and content.")
        elif grant["status"] != "active":
            error(path, "inactive_contributor_permission", f"Current contributor permission is {grant['status']}; older grants cannot supply clearance.")
        elif purpose not in grant["permitted_uses"]:
            error(path, "contributor_use_not_permitted", "The contributor has not explicitly permitted this use.")
        elif grant["expires_at"] is not None and _timestamp(grant["expires_at"]) <= now:
            error(path, "expired_contributor_permission", "Current contributor permission has expired; older grants cannot supply clearance.")
        else:
            report["clearances"].append({"contribution_kind": identity[0], "contributor_id": identity[2],
                **binding, "grant_id": grant["grant_id"], "grant_revision": grant["revision"],
                "purpose": purpose, "evidence_ref": grant["evidence_ref"], "expires_at": grant["expires_at"]})

    def known_authors(kind: str, binding: dict) -> set[str]:
        # Deleting an author declaration cannot erase an author/revocation already
        # recorded for this selected material in the supplied ledger history. Source
        # text has its own exact hash: a metadata-only version bump cannot erase its
        # authors. Clearance below still requires the current source version.
        return {grant["contributor_id"] for grant in grants.values()
                if grant["contribution_kind"] == kind
                and all(grant.get(key) == value for key, value in binding.items()
                        if not (kind == "source_text" and key == "source_version"))}

    for index, example in enumerate(dataset["examples"]):
        binding = {"example_id": example["example_id"], "example_version": example["version"],
                   "example_sha256": example_sha256(example)}
        contributor_ids = {example["contributor_id"]}
        contributor_ids.update(example_declarations.get(example["example_id"], {}).get("contributor_ids", []))
        contributor_ids.update(known_authors("example_bundle", binding))
        for contributor_id in sorted(contributor_ids):
            clear(("example_bundle", example["example_id"], contributor_id), binding, f"/dataset/examples/{index}")
    for source_id in sorted(selected_sources):
        source = sources[source_id]
        path = "/dataset/sources/" + str(dataset["sources"].index(source))
        if purpose not in source["permitted_uses"]:
            error(path + "/permitted_uses", "source_use_not_permitted", "Contributor permission cannot replace the source's explicit permission for this use.")
        declaration = declarations.get(source_id)
        binding = {"source_id": source_id, "source_version": source["version"],
                   "source_sha256": source["content_sha256"]}
        contributor_ids = known_authors("source_text", binding)
        if declaration is None:
            report["scope"]["sources_without_author_registry"].append(source_id)
            if source["source_kind"] == "community":
                error(path, "missing_source_authors", "Community source material requires a version-bound source author declaration and grants for every declared author.")
        else:
            contributor_ids.update(declaration["contributor_ids"])
        for contributor_id in sorted(contributor_ids):
            clear(("source_text", source_id, contributor_id), binding, path)
    report["valid"] = not errors
    # Avoid presenting partial clearance as a consumable authorization if any
    # selected contribution, source or revision is invalid.
    if errors:
        report["clearances"] = []
    return report
