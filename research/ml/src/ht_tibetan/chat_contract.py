"""Portable contracts for a synthetic, nonclinical research chat demo.

Validation preserves supplied text exactly. It never invokes a model, grants
review approval, or makes a source eligible for training.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from importlib.resources import files
from typing import Any, cast

from jsonschema import Draft202012Validator

from .records import RecordsError, content_sha256


_CITATION_FIELDS = ("source_id", "version", "content_sha256")


def _json_values(value: Any) -> None:
    """Reject non-JSON Python values and strings that are not Unicode scalars."""
    if value is None or isinstance(value, bool) or type(value) is int:
        return
    if isinstance(value, str):
        value.encode("utf-8", errors="strict")
        return
    if type(value) is float:
        if not math.isfinite(value):
            raise RecordsError("Chat data must contain finite JSON values.")
        return
    if isinstance(value, list):
        for item in value:
            _json_values(item)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise RecordsError("Chat object keys must be strings.")
            _json_values(key)
            _json_values(item)
        return
    raise RecordsError("Chat data must contain only JSON values.")


@lru_cache(maxsize=3)
def _validator(definition: str) -> Any:
    schema = json.loads(
        files("ht_tibetan_contracts").joinpath("chat.schema.json").read_text(encoding="utf-8")
    )
    # A selected definition must not also satisfy the top-level union.
    schema.pop("oneOf")
    schema["$ref"] = f"#/$defs/{definition}"
    return Draft202012Validator(schema)


def _validate(value: Any, definition: str) -> dict[str, Any]:
    try:
        _json_values(value)
    except (UnicodeError, RecursionError) as exc:
        raise RecordsError("Chat data must be finite JSON with Unicode scalar strings.") from exc
    errors = sorted(_validator(definition).iter_errors(value), key=lambda error: str(list(error.absolute_path)))
    if errors:
        path = "/" + "/".join(map(str, errors[0].absolute_path))
        raise RecordsError(f"Invalid chat {definition} at {path}: {errors[0].message}")
    return cast(dict[str, Any], value)


def _citation(value: dict[str, Any]) -> dict[str, Any]:
    return {field: value[field] for field in _CITATION_FIELDS}


def validate_chat_catalog(value: Any) -> dict[str, Any]:
    """Validate bounded synthetic source cards and exact UTF-8 text hashes."""
    catalog = _validate(value, "catalog")
    source_ids: set[str] = set()
    for source in catalog["sources"]:
        if source["source_id"] in source_ids:
            raise RecordsError("Chat catalog source IDs must be unique.")
        source_ids.add(source["source_id"])
        if content_sha256(source["original_text"]) != source["content_sha256"]:
            raise RecordsError("Chat source hash does not match its exact original UTF-8 text.")
    return catalog


def validate_chat_request(value: Any, catalog: Any = None) -> dict[str, Any]:
    """Validate odd alternating history; optionally bind to a verified catalog.

    Without a catalog this validates the wire shape only. A server must also
    supply its catalog before dispatch to reject unknown or stale sources.
    """
    request = _validate(value, "request")
    messages = request["messages"]
    if len(messages) % 2 != 1 or any(
        message["role"] != ("user" if index % 2 == 0 else "assistant")
        for index, message in enumerate(messages)
    ):
        raise RecordsError("Chat history must alternate, starting and ending with a user message.")
    if sum(len(message["content"]) for message in messages) > 8000:
        raise RecordsError("Chat history exceeds the 8000-code-point context limit.")
    if catalog is not None:
        valid_catalog = validate_chat_catalog(catalog)
        if not any(request["source"] == _citation(source) for source in valid_catalog["sources"]):
            raise RecordsError("Chat request source is not an exact citation from the catalog.")
    return request


def validate_chat_response(value: Any, request: Any) -> dict[str, Any]:
    """Bind a fake response to its request without interpreting answer quality."""
    valid_request = validate_chat_request(request)
    response = _validate(value, "response")
    if response["request_id"] != valid_request["request_id"]:
        raise RecordsError("Chat response request ID does not match the actual request.")
    if response["outcome"] == "success" and response["citations"] != [valid_request["source"]]:
        raise RecordsError("Successful chat response must cite exactly the request's selected source.")
    return response
