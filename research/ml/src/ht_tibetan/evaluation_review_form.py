"""Export an operator-verified blinded evaluation packet as an offline form.

Only the exact public packet bytes enter the HTML. The decoded private review,
sealed key, study and evaluation report remain outside the reviewer artifact.
"""
from __future__ import annotations

import base64
import hashlib
from importlib.resources import files
import os
from pathlib import Path
import tempfile

from .blind_review import _path, _private_directory
from .output_review_import import _outside_run_and_desktop, _private
from .records import RecordsError, load_dataset
from .study import load_evaluation_review

_MAX_BYTES = 32 * 1024 * 1024


def _html(raw: bytes) -> bytes:
    assets = files("ht_tibetan").joinpath("reviewer_assets")
    shell = assets.joinpath("evaluation-form.html").read_text(encoding="utf-8")
    css = assets.joinpath("evaluation-form.css").read_text(encoding="utf-8")
    script = assets.joinpath("evaluation-form.js").read_text(encoding="utf-8")
    for placeholder in ("__EVALUATION_CSS__", "__EVALUATION_JS__", "__EVALUATION_PACKET__", "__EVALUATION_CSP__"):
        if shell.count(placeholder) != 1:
            raise RecordsError("Evaluation form assets have invalid placeholders.")
    def digest(text):
        return base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode("ascii")
    policy = ("default-src 'none'; script-src 'sha256-" + digest(script)
        + "'; style-src 'sha256-" + digest(css)
        + "'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'")
    return (shell.replace("__EVALUATION_CSP__", policy).replace("__EVALUATION_CSS__", css)
        .replace("__EVALUATION_JS__", script).replace("__EVALUATION_PACKET__", base64.b64encode(raw).decode("ascii"))).encode("utf-8")


def export_evaluation_review_form(packet_path, output_path, *, study_path, report_path, key_path=None):
    """Create a private self-contained HTML file without submitting any judgments."""
    packet_file, output = _path(packet_path), _path(output_path)
    if output.suffix.lower() != ".html":
        raise RecordsError("Evaluation review form output requires an .html extension.")
    _outside_run_and_desktop(output)
    if output.exists():
        raise FileExistsError(output)
    if key_path is None:
        raise RecordsError("A blinded evaluation form requires its separately retained operator key.")
    key_file = _path(key_path)
    if output.parent == key_file.parent:
        raise RecordsError("Reviewer HTML and the sealed operator key require separate directories.")
    if packet_file.stat().st_size > _MAX_BYTES:
        raise RecordsError("Evaluation reviewer packet exceeds the bounded 32 MiB form payload.")
    # This return value contains decoded model identities. Never pass it to _html.
    _, verified_hash = load_evaluation_review(packet_file, study=study_path,
        evaluation_report_path=report_path, key_path=key_file)
    raw = packet_file.read_bytes()
    packet_hash = hashlib.sha256(raw).hexdigest()
    if packet_hash != verified_hash or len(raw) > _MAX_BYTES:
        raise RecordsError("The public packet changed during form verification.")
    packet = load_dataset(packet_file)
    if (packet.get("kind") != "blinded_evaluation_native_review"
            or not isinstance(packet.get("items"), list) or not 1 <= len(packet["items"]) <= 1000):
        raise RecordsError("Evaluation forms require a verified blinded packet with 1–1000 items.")
    if hashlib.sha256(packet_file.read_bytes()).hexdigest() != packet_hash:
        raise RecordsError("The public packet changed during form export.")
    encoded = _html(raw)
    _private_directory(output.parent)
    _private(output.parent, directory=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".evaluation-form-", dir=output.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        _path(output)
        _outside_run_and_desktop(output)
        os.link(temporary, output, follow_symlinks=False)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return {"schema_version": "1.0", "status": "offline_evaluation_form_exported",
        "output_path": str(output), "item_count": len(packet["items"]),
        "packet_file_sha256": packet_hash, "html_file_sha256": hashlib.sha256(encoded).hexdigest(),
        "blinded": True, "review_imported": False, "approval_granted": False}
