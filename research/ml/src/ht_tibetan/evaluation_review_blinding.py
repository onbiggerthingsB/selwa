"""In-memory, exact-text blinding for constrained-evaluation review packets.

The caller keeps the key private and binds its original packet to the freshly
verified evaluation report. Hashes detect inconsistent edits, not an operator
rewriting an entire key. Review text can itself disclose a candidate's identity.
"""
from __future__ import annotations

from copy import deepcopy
import math
import re
import secrets

from .records import RecordsError, record_sha256

_AXES = {"fidelity", "comprehension", "naturalness"}
_MUTABLE = {"status", "ratings", "critical_errors", "minutes_spent", "blind_compromised", "notes"}
_IDENTITY = {"candidate_id", "arm_id", "condition_sha256"}
_TEXT_FIELDS = {"source_text", "question", "messages", "answer"}
_ORIGINAL_FIELDS = {"schema_version", "kind", "evidence_kind", "evaluation_report_path",
    "evaluation_report_sha256", "study_sha256", "reviewer_id", "status", "independent",
    "items", "candidate_decisions", "limitations"}
_ORIGINAL_ROW_FIELDS = _IDENTITY | _TEXT_FIELDS | _MUTABLE | {"case_id", "case_sha256", "outcome"}
_PUBLIC_FIELDS = {"schema_version", "kind", "evidence_kind", "reviewer_id", "status", "independent",
                  "items", "candidate_decisions", "limitations"}
_PUBLIC_ROW_FIELDS = _TEXT_FIELDS | _MUTABLE | {"item_id", "candidate_alias"}
_KEY_FIELDS = {"schema_version", "kind", "original_packet", "original_packet_sha256",
               "public_template", "public_template_sha256", "item_map", "candidate_map"}
_LIMITATIONS = [
    "Candidate identities and case order are blinded; mark blind_compromised if text or prior knowledge reveals a candidate.",
    "Exact source, question, instructions and answer text are preserved and can contain identity clues.",
    "Suitability is for the registered bounded adaptation experiment, not deployment or health advice.",
    "Reviewer identity and independence are declarations; this packet does not authenticate them.",
]
_MAX_ROWS = 10000
_MAX_BYTES = 32 * 1024 * 1024


def _object(value, fields, label):
    if not isinstance(value, dict) or set(value) != fields:
        raise RecordsError(f"{label} has missing or unknown fields.")


def _digest(value):
    try:
        return record_sha256(value)
    except (TypeError, ValueError, RecursionError, UnicodeError) as exc:
        raise RecordsError("Review packets must contain finite UTF-8 JSON.") from exc


def _bounded(value):
    import json
    _digest(value)
    if len(json.dumps(value, ensure_ascii=False).encode("utf-8")) > _MAX_BYTES:
        raise RecordsError("Review packet exceeds its bounded JSON size.")


def _text(value, label, maximum=1024):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise RecordsError(f"{label} must be bounded nonblank text.")


def _sha(value):
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise RecordsError("Review provenance requires an exact SHA-256 hash.")


def _identity(row):
    return tuple(row[field] for field in ("candidate_id", "arm_id", "condition_sha256"))


def _response(row, categories, *, blank=False):
    if not isinstance(row["status"], str) or row["status"] not in {"incomplete", "complete"}:
        raise RecordsError("Review item status must be incomplete or complete.")
    _object(row["ratings"], _AXES, "Ratings")
    if any(value is not None and (type(value) is not int or not 1 <= value <= 4)
           for value in row["ratings"].values()):
        raise RecordsError("Ratings must be null or integers from 1 to 4.")
    _object(row["critical_errors"], categories, "Critical judgments")
    if any(not isinstance(value, str) or value not in {"present", "absent", "not_assessed"}
           for value in row["critical_errors"].values()):
        raise RecordsError("Critical judgments must preserve the declared categories and states.")
    minutes = row["minutes_spent"]
    try:
        if minutes is not None and (type(minutes) not in {int, float} or not 0 <= minutes <= 1_000_000 or not math.isfinite(minutes)):
            raise RecordsError("Review minutes must be null or finite numbers from 0 to 1000000.")
    except OverflowError as exc:
        raise RecordsError("Review minutes exceed the supported numeric range.") from exc
    if type(row["blind_compromised"]) is not bool:
        raise RecordsError("Compromised blinding must be an explicit boolean.")
    if not isinstance(row["notes"], str) or len(row["notes"]) > 8000:
        raise RecordsError("Review notes must be bounded text.")
    if blank and (row["status"] != "incomplete" or any(v is not None for v in row["ratings"].values())
            or any(v != "not_assessed" for v in row["critical_errors"].values())
            or minutes is not None or row["notes"] != ""):
        raise RecordsError("Blinding requires an original blank review packet.")
    if row["status"] == "complete" and (any(v is None for v in row["ratings"].values())
            or any(v == "not_assessed" for v in row["critical_errors"].values()) or minutes is None):
        raise RecordsError("Completed items require every rating, critical judgment and review time.")


def _decision(row, *, blank=False):
    if not isinstance(row["recommendation"], str) or row["recommendation"] not in {"pending", "approve", "reject", "revise"}:
        raise RecordsError("Candidate recommendation is invalid.")
    if not isinstance(row["rationale"], str) or len(row["rationale"]) > 8000:
        raise RecordsError("Candidate rationale must be bounded text.")
    if blank and (row["recommendation"] != "pending" or row["rationale"] != ""):
        raise RecordsError("Blinding requires blank candidate recommendations.")


def _original(packet):
    _bounded(packet)
    _object(packet, _ORIGINAL_FIELDS, "Original evaluation review")
    if packet["schema_version"] != "1.0" or packet["kind"] != "evaluation_native_review":
        raise RecordsError("Unsupported original evaluation review.")
    if not isinstance(packet["evidence_kind"], str) or packet["evidence_kind"] not in {"human_review", "synthetic_test"}:
        raise RecordsError("Review evidence kind must be explicit.")
    _text(packet["reviewer_id"], "Reviewer ID", 128)
    _text(packet["evaluation_report_path"], "Report path", 32768)
    for field in ("evaluation_report_sha256", "study_sha256"):
        _sha(packet[field])
    if packet["status"] != "incomplete" or packet["independent"] is not False:
        raise RecordsError("Blinding requires an original blank review packet.")
    if not isinstance(packet["limitations"], list) or not 1 <= len(packet["limitations"]) <= 32:
        raise RecordsError("Original limitations must be a bounded nonempty list.")
    for value in packet["limitations"]:
        _text(value, "Limitation", 8000)
    if not isinstance(packet["candidate_decisions"], list) or not 1 <= len(packet["candidate_decisions"]) <= _MAX_ROWS:
        raise RecordsError("Candidate decisions must be a bounded nonempty list.")
    identities = set()
    for row in packet["candidate_decisions"]:
        _object(row, _IDENTITY | {"recommendation", "rationale"}, "Original candidate decision")
        _text(row["candidate_id"], "Candidate ID"); _text(row["arm_id"], "Arm ID")
        _sha(row["condition_sha256"])
        if _identity(row) in identities:
            raise RecordsError("Duplicate candidate, arm and condition identities are not allowed.")
        identities.add(_identity(row))
        _decision(row, blank=True)
    if not isinstance(packet["items"], list) or not 1 <= len(packet["items"]) <= _MAX_ROWS:
        raise RecordsError("Review items must be a bounded nonempty list.")
    cases, categories = set(), None
    for row in packet["items"]:
        _object(row, _ORIGINAL_ROW_FIELDS, "Original evaluation row")
        _text(row["case_id"], "Case ID")
        _sha(row["case_sha256"])
        _text(row["candidate_id"], "Candidate ID"); _text(row["arm_id"], "Arm ID")
        _sha(row["condition_sha256"])
        if row["case_id"] in cases or _identity(row) not in identities or row["outcome"] != "success":
            raise RecordsError("Review case roster contains duplicates or unknown/unsuccessful identities.")
        cases.add(row["case_id"])
        for field in ("source_text", "question"):
            if row[field] is not None and (not isinstance(row[field], str) or len(row[field]) > 1024 * 1024):
                raise RecordsError("Source and question must be bounded exact text or null.")
        _text(row["answer"], "Answer", 1024 * 1024)
        if not isinstance(row["messages"], list) or not 1 <= len(row["messages"]) <= 128:
            raise RecordsError("Messages must be a bounded nonempty list.")
        for message in row["messages"]:
            _object(message, {"role", "content"}, "Message")
            _text(message["role"], "Message role", 128)
            _text(message["content"], "Message content", 1024 * 1024)
        if not isinstance(row["critical_errors"], dict) or not 1 <= len(row["critical_errors"]) <= 128:
            raise RecordsError("Critical categories must be a bounded nonempty object.")
        for category in row["critical_errors"]:
            _text(category, "Critical category", 128)
        if categories is None:
            categories = set(row["critical_errors"])
        _response(row, categories, blank=True)
    return packet


def _row(row, item_id, alias):
    public = {field: deepcopy(row[field]) for field in _TEXT_FIELDS | _MUTABLE}
    return dict(public, item_id=item_id, candidate_alias=alias, blind_compromised=False)


def blind_packet(packet: dict) -> tuple[dict, dict]:
    """Make a fresh independently shuffled public packet and private mapping key."""
    original = deepcopy(_original(packet))
    candidate_map, identity_alias = {}, {}
    for row in original["candidate_decisions"]:
        alias = "candidate-" + secrets.token_hex(16)
        while alias in candidate_map:
            alias = "candidate-" + secrets.token_hex(16)
        candidate_map[alias] = {field: row[field] for field in _IDENTITY}
        identity_alias[_identity(row)] = alias
    items, item_map = [], {}
    for row in original["items"]:
        item_id = "item-" + secrets.token_hex(16)
        while item_id in item_map:
            item_id = "item-" + secrets.token_hex(16)
        item_map[item_id] = row["case_id"]
        items.append(_row(row, item_id, identity_alias[_identity(row)]))
    decisions = [{"candidate_alias": alias, "recommendation": "pending", "rationale": ""} for alias in candidate_map]
    random = secrets.SystemRandom()
    random.shuffle(items)
    random.shuffle(decisions)
    public = {"schema_version": "1.0", "kind": "blinded_evaluation_native_review",
        "evidence_kind": original["evidence_kind"], "reviewer_id": original["reviewer_id"],
        "status": "incomplete", "independent": False, "items": items,
        "candidate_decisions": decisions, "limitations": deepcopy(_LIMITATIONS)}
    key = {"schema_version": "1.0", "kind": "private_evaluation_review_key",
        "original_packet": original, "original_packet_sha256": _digest(original),
        "public_template": deepcopy(public), "public_template_sha256": _digest(public),
        "item_map": item_map, "candidate_map": candidate_map}
    # The embedded pair can exceed the bound even when each packet fits alone.
    # Never export a key that our own decoder would refuse to load.
    _bounded(public)
    _bounded(key)
    return public, key


def _key(key):
    _bounded(key)
    _object(key, _KEY_FIELDS, "Private review key")
    if key["schema_version"] != "1.0" or key["kind"] != "private_evaluation_review_key":
        raise RecordsError("Unsupported private review key.")
    original = _original(key["original_packet"])
    for field in ("original_packet_sha256", "public_template_sha256"):
        _sha(key[field])
    if key["original_packet_sha256"] != _digest(original) or key["public_template_sha256"] != _digest(key["public_template"]):
        raise RecordsError("Private key packet/template hash mismatch.")
    expected_identities = {_identity(row) for row in original["candidate_decisions"]}
    mapping = key["candidate_map"]
    if not isinstance(mapping, dict) or len(mapping) != len(expected_identities):
        raise RecordsError("Private candidate map differs from the original roster.")
    aliases = {}
    for alias, identity in mapping.items():
        if not isinstance(alias, str) or re.fullmatch(r"candidate-[0-9a-f]{32}", alias) is None:
            raise RecordsError("Candidate aliases must be opaque identifiers.")
        _object(identity, _IDENTITY, "Private candidate mapping")
        for field in ("candidate_id", "arm_id"):
            _text(identity[field], "Candidate mapping identity")
        _sha(identity["condition_sha256"])
        if _identity(identity) not in expected_identities or _identity(identity) in aliases:
            raise RecordsError("Private candidate mappings must cover each identity exactly once.")
        aliases[_identity(identity)] = alias
    rows = {row["case_id"]: row for row in original["items"]}
    item_map = key["item_map"]
    if not isinstance(item_map, dict) or len(item_map) != len(rows):
        raise RecordsError("Private item map differs from the original roster.")
    mapped = set()
    for item_id, case_id in item_map.items():
        if not isinstance(item_id, str) or re.fullmatch(r"item-[0-9a-f]{32}", item_id) is None:
            raise RecordsError("Item aliases must be opaque identifiers.")
        if not isinstance(case_id, str) or case_id not in rows or case_id in mapped:
            raise RecordsError("Private item mappings must cover each case exactly once.")
        mapped.add(case_id)
    template = key["public_template"]
    _object(template, _PUBLIC_FIELDS, "Public review template")
    expected = {"schema_version": "1.0", "kind": "blinded_evaluation_native_review",
        "evidence_kind": original["evidence_kind"], "reviewer_id": original["reviewer_id"],
        "status": "incomplete", "independent": False, "limitations": deepcopy(_LIMITATIONS)}
    if not isinstance(template["items"], list) or len(template["items"]) != len(rows):
        raise RecordsError("Public template item roster differs from its key.")
    seen, expected_items = set(), []
    for row in template["items"]:
        _object(row, _PUBLIC_ROW_FIELDS, "Public template item")
        item_id = row["item_id"]
        if not isinstance(item_id, str) or item_id not in item_map or item_id in seen:
            raise RecordsError("Public template item roster differs from its key.")
        seen.add(item_id)
        original_row = rows[item_map[item_id]]
        expected_items.append(_row(original_row, item_id, aliases[_identity(original_row)]))
    decisions = template["candidate_decisions"]
    if not isinstance(decisions, list) or len(decisions) != len(mapping):
        raise RecordsError("Public candidate roster differs from its key.")
    seen, expected_decisions = set(), []
    for row in decisions:
        _object(row, {"candidate_alias", "recommendation", "rationale"}, "Public template decision")
        alias = row["candidate_alias"]
        if not isinstance(alias, str) or alias not in mapping or alias in seen:
            raise RecordsError("Public candidate roster differs from its key.")
        seen.add(alias)
        expected_decisions.append({"candidate_alias": alias, "recommendation": "pending", "rationale": ""})
    expected.update(items=expected_items, candidate_decisions=expected_decisions)
    if _digest(expected) != _digest(template):
        raise RecordsError("Private key template differs from its exact original packet and mappings.")
    return original, template


def decode_blinded_review(public: dict, key: dict) -> dict:
    """Validate a returned public packet and restore original order and identities."""
    _bounded(public)
    original, template = _key(key)
    _object(public, _PUBLIC_FIELDS, "Returned blinded review")
    for field in _PUBLIC_FIELDS - {"status", "independent", "items", "candidate_decisions"}:
        if _digest(public[field]) != _digest(template[field]):
            raise RecordsError("Returned review changed immutable packet fields or uses another key.")
    if (not isinstance(public["status"], str) or public["status"] not in {"incomplete", "complete"}
            or type(public["independent"]) is not bool):
        raise RecordsError("Review status and independence must be explicit.")
    if not isinstance(public["items"], list) or len(public["items"]) != len(template["items"]):
        raise RecordsError("Returned review must retain its complete item roster and order.")
    decoded = deepcopy(original)
    rows = {row["case_id"]: row for row in decoded["items"]}
    for returned, expected in zip(public["items"], template["items"]):
        _object(returned, _PUBLIC_ROW_FIELDS, "Returned blinded item")
        if any(_digest(returned[field]) != _digest(expected[field]) for field in _PUBLIC_ROW_FIELDS - _MUTABLE):
            raise RecordsError("Returned review changed an alias, order, instruction, source, question or answer.")
        _response(returned, set(expected["critical_errors"]))
        if public["status"] == "complete" and returned["status"] != "complete":
            raise RecordsError("Complete packets require every item to be complete.")
        original_row = rows[key["item_map"][returned["item_id"]]]
        original_row.update({field: deepcopy(returned[field]) for field in _MUTABLE})
    decisions = public["candidate_decisions"]
    if not isinstance(decisions, list) or len(decisions) != len(template["candidate_decisions"]):
        raise RecordsError("Returned review must retain its complete candidate roster and order.")
    original_decisions = {_identity(row): row for row in decoded["candidate_decisions"]}
    for returned, expected in zip(decisions, template["candidate_decisions"]):
        _object(returned, {"candidate_alias", "recommendation", "rationale"}, "Returned candidate decision")
        if returned["candidate_alias"] != expected["candidate_alias"]:
            raise RecordsError("Returned review changed a candidate alias or decision order.")
        _decision(returned)
        if public["status"] == "complete" and (returned["recommendation"] == "pending" or not returned["rationale"].strip()):
            raise RecordsError("Complete packets require explicit candidate recommendations and rationale.")
        original_decisions[_identity(key["candidate_map"][returned["candidate_alias"]])].update(
            recommendation=returned["recommendation"], rationale=returned["rationale"])
    if public["status"] == "complete" and not public["independent"]:
        raise RecordsError("Completed review requires explicit independence.")
    decoded.update(status=public["status"], independent=public["independent"])
    return decoded
