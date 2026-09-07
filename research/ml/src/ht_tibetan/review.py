"""Round-trip review packets with content bindings and append-only independent ratings."""

from __future__ import annotations

import copy
import uuid
from pathlib import Path
from typing import Any, Sequence

from .records import (RecordsError, atomic_write_json, example_sha256, load_dataset,
                      record_sha256, require_valid_dataset, validate_record)


def _binding(example: dict[str, Any], source: dict[str, Any], reviewer_id: str,
             reviewer_role: str, review_type: str, review_id: str, packet_id: str) -> str:
    return record_sha256({"example": example, "source": source, "reviewer_id": reviewer_id,
                          "reviewer_role": reviewer_role, "review_type": review_type,
                          "review_id": review_id, "packet_id": packet_id})


def export_review_packet(dataset: dict[str, Any], output_path: str | Path, reviewer_id: str,
                         reviewer_role: str = "language_reviewer", review_type: str = "language",
                         example_ids: Sequence[str] | None = None) -> dict[str, Any]:
    """Create a packet and immutable sibling receipt (<output>.receipt.json).

    Only review ratings/issues/time/status/recommendation may be edited. Keep the
    receipt locally; it is a tamper-detection baseline, not a digital signature.
    An export refuses to replace either output. No review is inferred or completed.
    """
    require_valid_dataset(dataset)
    path = Path(output_path)
    receipt_path = path.with_name(path.name + ".receipt.json")
    if path.exists() or receipt_path.exists():
        raise FileExistsError(f"Review packet or receipt already exists: {path}")
    selected = list(example_ids) if example_ids is not None else [item["example_id"] for item in dataset["examples"]]
    if len(set(selected)) != len(selected):
        raise RecordsError("Duplicate requested example IDs.")
    examples = {item["example_id"]: item for item in dataset["examples"]}
    missing = set(selected) - examples.keys()
    if missing:
        raise RecordsError("Unknown examples: " + ", ".join(sorted(missing)))
    if not selected:
        raise RecordsError("Cannot export an empty review packet.")
    if review_type == "medical" and reviewer_role not in {"clinician", "dietitian"}:
        raise RecordsError("Medical packets require a qualified reviewer role.")
    superseded = {r["supersedes_review_id"] for r in dataset["reviews"] if r["supersedes_review_id"]}
    previous = {r["example_id"]: r for r in dataset["reviews"] if r["example_id"] in selected
                and r["reviewer_id"] == reviewer_id and r["review_type"] == review_type and r["review_id"] not in superseded}
    if any(r["status"] == "complete" for r in previous.values()):
        raise RecordsError("This reviewer already completed a selected example; preserve the completed independent rating.")
    sources = {item["source_id"]: item for item in dataset["sources"]}
    packet_id = "packet-" + uuid.uuid4().hex
    packet: dict[str, Any] = {"schema_version": "1.0", "packet_id": packet_id,
                              "dataset_sha256": record_sha256(dataset), "reviewer_id": reviewer_id,
                              "reviewer_role": reviewer_role, "review_type": review_type, "items": []}
    for identifier in selected:
        example = copy.deepcopy(examples[identifier])
        source = copy.deepcopy(sources[example["source_id"]])
        if "review" not in source["permitted_uses"]:
            raise RecordsError(f"Source {source['source_id']} does not permit reviewer export.")
        review_id = "review-" + uuid.uuid4().hex
        review = {"review_id": review_id, "example_id": identifier, "example_version": example["version"],
                  "example_sha256": example_sha256(example), "source_sha256": example["source_sha256"],
                  "reviewer_id": reviewer_id, "reviewer_role": reviewer_role, "review_type": review_type,
                  "ratings": {"naturalness": None, "fidelity": None, "comprehension": None},
                  "issues": [], "minutes_spent": None, "status": "incomplete", "recommendation": "pending"}
        prior = previous.get(identifier)
        review.update(revision=prior["revision"] + 1 if prior else 1,
                      supersedes_review_id=prior["review_id"] if prior else None)
        if prior:
            for key in ("ratings", "issues", "minutes_spent", "status", "recommendation"):
                review[key] = copy.deepcopy(prior[key])
        packet["items"].append({"example": example, "source": source, "review": review,
                                "binding_sha256": _binding(example, source, reviewer_id, reviewer_role, review_type, review_id, packet_id)})
    errors = validate_record(packet, "review_packet")
    if errors:
        raise RecordsError("Invalid review packet: " + "; ".join(item["message"] for item in errors))
    # Write receipt first. A partial export leaves a protected receipt and cannot be
    # mistaken for a complete packet; the operator can choose a new output filename.
    atomic_write_json(receipt_path, packet)
    atomic_write_json(path, packet)
    return packet


def import_review_packet(dataset: dict[str, Any], packet_path: str | Path,
                         output_path: str | Path | None = None,
                         receipt_path: str | Path | None = None) -> dict[str, Any]:
    """Append new independent reviews, never mutate an example's approval status.

    The default trusted receipt is the sibling created at export. It must remain
    under the operator's control. The submitted packet can move elsewhere when an
    explicit original receipt_path is supplied. A replay or conflicting rating is
    rejected rather than overwritten. Completing an imported partial review appends
    a new revision and retains the original; adjudication is a separate record.
    """
    require_valid_dataset(dataset)
    path = Path(packet_path)
    packet = load_dataset(path)
    receipt = load_dataset(receipt_path or path.with_name(path.name + ".receipt.json"))
    for label, value in (("packet", packet), ("receipt", receipt)):
        errors = validate_record(value, "review_packet")
        if errors:
            raise RecordsError(f"Invalid {label}: " + "; ".join(item["message"] for item in errors))
    immutable = ("schema_version", "packet_id", "dataset_sha256", "reviewer_id", "reviewer_role", "review_type")
    if any(packet[key] != receipt[key] for key in immutable):
        raise RecordsError("Packet identity/version differs from the original export receipt.")
    # Other reviewers may have been imported since export. Bind every selected
    # source/example exactly, rather than falsely requiring the whole dataset hash.
    originals = {item["review"]["review_id"]: item for item in receipt["items"]}
    returned = [item["review"]["review_id"] for item in packet["items"]]
    if len(set(returned)) != len(returned) or set(returned) != set(originals):
        raise RecordsError("Packet has duplicate, missing or substituted review IDs.")
    if len({item["example"]["example_id"] for item in packet["items"]}) != len(packet["items"]):
        raise RecordsError("Packet contains duplicate example IDs.")
    examples = {item["example_id"]: item for item in dataset["examples"]}
    sources = {item["source_id"]: item for item in dataset["sources"]}
    mutable = {"ratings", "issues", "minutes_spent", "status", "recommendation"}
    updated = copy.deepcopy(dataset)
    existing = {item["review_id"]: item for item in dataset["reviews"]}
    superseded = {item["supersedes_review_id"] for item in dataset["reviews"] if item["supersedes_review_id"]}
    for item in packet["items"]:
        review = item["review"]
        original = originals[review["review_id"]]
        if any(item[key] != original[key] for key in ("example", "source", "binding_sha256")):
            raise RecordsError("Packet source/example/binding was edited; request a fresh export.")
        if {k: v for k, v in review.items() if k not in mutable} != {k: v for k, v in original["review"].items() if k not in mutable}:
            raise RecordsError("Review identity or content version was edited.")
        if item["example"] != examples.get(item["example"]["example_id"]) or item["source"] != sources.get(item["source"]["source_id"]):
            raise RecordsError("Stale packet: the current example or source differs from the exported version.")
        if item["binding_sha256"] != _binding(item["example"], item["source"], packet["reviewer_id"], packet["reviewer_role"], packet["review_type"], review["review_id"], packet["packet_id"]):
            raise RecordsError("Packet binding hash is invalid.")
        imported = copy.deepcopy(review)
        prior = existing.get(review["review_id"])
        if prior:
            if prior == review or prior["status"] == "complete" or prior["review_id"] in superseded:
                raise RecordsError("Duplicate, completed or outdated review import; independent ratings are never overwritten.")
            imported.update(review_id="review-" + uuid.uuid4().hex, revision=prior["revision"] + 1,
                            supersedes_review_id=prior["review_id"])
        elif review["supersedes_review_id"] in superseded:
            raise RecordsError("This partial review already has a newer revision; export its latest state.")
        updated["reviews"].append(imported)
    require_valid_dataset(updated)
    if output_path is not None:
        atomic_write_json(output_path, updated)
    return updated
