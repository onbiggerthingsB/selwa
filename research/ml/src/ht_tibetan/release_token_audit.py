"""Read-only token-cost inspection of permission-checked, non-final releases.

This loads local tokenizers, never model weights or inference backends. Exact text
is preserved in memory and represented by hashes and measurements in the report.
Observed ratios cannot establish language quality or safe future output budgets.
"""
from __future__ import annotations

from copy import deepcopy
import math
from pathlib import Path
import re

from .acquisition import verify_snapshot
from .artifacts import hash_file, utc_now
from .conditions import condition_identity, task_messages, validate_condition
from .experiment_lock import experiment_lock
from .records import RecordsError, content_sha256, example_sha256, load_dataset, record_sha256
from .releases import verify_release
from .token_audit import PromptConfigurationError, load_local_tokenizer, render_conversation
from .training_inputs import prepare_training_example

_CANDIDATES = {"qwen3-4b-mlx-4bit", "gemma3-4b-it-mlx-4bit"}
_PURPOSES = {"development_screen", "train", "validation"}
_SEGMENT_DEFINITION = (
    "Nonempty substrings containing U+0F40..U+0FBC after splitting at U+0F0B/U+0F0C; "
    "spaces and other punctuation are not separators. This is an orthographic cost "
    "proxy, not verified syllables, words or linguistic segmentation."
)


def _ids(tokenizer, text):
    tokens = tokenizer.encode(text, add_special_tokens=False)
    if not isinstance(tokens, list) or any(type(item) is not int or item < 0 for item in tokens):
        raise RecordsError("Tokenizer returned malformed raw text IDs.")
    return tokens


def _material(tokenizer, text):
    if not isinstance(text, str):
        raise RecordsError("Audit material must be exact text.")
    encoded = text.encode("utf-8")
    tokens = _ids(tokenizer, text)
    segments = sum(bool(re.search(r"[\u0f40-\u0fbc]", segment))
                   for segment in re.split(r"[\u0f0b\u0f0c]", text))
    return {"utf8_sha256": content_sha256(text), "utf8_bytes": len(encoded),
            "unicode_codepoints": len(text),
            "tibetan_block_codepoints": sum("\u0f00" <= char <= "\u0fff" for char in text),
            "tsheg_segment_proxy_count": segments, "standalone_raw_tokens": len(tokens),
            "unicode_codepoints_per_standalone_token": len(text) / len(tokens) if tokens else None,
            "standalone_tokens_per_tsheg_segment": len(tokens) / segments if segments else None}


def _propose(rows, *, requested_segments, context_limit):
    result = {"status": "not_requested", "review_state": "unreviewed", "reviewed_task_budget": False,
              "max_output_segments": requested_segments, "max_output_tokens": None,
              "formula": "ceil(max observed assistant-target tokens / answer tsheg proxy segments * requested segment budget)",
              "limitation": "Observed non-final reference targets include template stop tokens. This conservative ratio is not a guarantee for unseen text or generated answer length."}
    if requested_segments is None:
        return result
    measured = [row for row in rows if row["outcome"] == "measured"]
    ratios = [row["assistant_target_tokens"] / row["materials"]["answer"]["tsheg_segment_proxy_count"]
              for row in measured if row["materials"]["answer"]["tsheg_segment_proxy_count"] > 0]
    if len(measured) != len(rows):
        return result | {"status": "blocked", "reason": "incomplete_exact_target_measurements"}
    if not ratios:
        return result | {"status": "unavailable", "reason": "no_tibetan_answer_segments"}
    ratio = max(ratios)
    proposed = math.ceil(ratio * requested_segments)
    result.update(max_observed_target_tokens_per_segment=ratio,
                  observed_answer_count=len(ratios), calculated_output_tokens=proposed,
                  maximum_observed_prompt_tokens=max(row["generation_prompt_tokens"] for row in measured))
    if proposed > 512 or any(row["generation_prompt_tokens"] + proposed > context_limit for row in measured):
        return result | {"status": "blocked", "reason": "proposed_budget_exceeds_output_or_context_limit"}
    if any(row["assistant_target_tokens"] > proposed for row in measured):
        return result | {"status": "blocked", "reason": "proposed_budget_cannot_fit_observed_reference_targets"}
    return result | {"status": "proposed_unreviewed", "max_output_tokens": proposed}


def audit_release_tokens(release_dir, permissions_path, lock_path, root, *, purposes,
                         candidate_ids, condition, max_output_segments=None):
    """Measure exact prompts and assistant targets without opening final-test data.

    This is the outer locked orchestration; callers must not hold the same lock.
    Tokenizer paths are the acquired tokenizer-only snapshots, whose receipts and
    files are verified with include_weights=False before any tokenizer is loaded.
    No model dispatch, training, exposure reservation or release promotion occurs.
    """
    if (not isinstance(purposes, (list, tuple)) or not purposes
            or any(not isinstance(item, str) or item not in _PURPOSES for item in purposes)
            or len(set(purposes)) != len(purposes)):
        raise RecordsError("Token inspection accepts distinct development_screen/train/validation purposes; final_test is forbidden.")
    if (not isinstance(candidate_ids, (list, tuple)) or not 1 <= len(candidate_ids) <= 2
            or any(not isinstance(item, str) or item not in _CANDIDATES for item in candidate_ids)
            or len(set(candidate_ids)) != len(candidate_ids)):
        raise RecordsError("Select one or two distinct supported candidate IDs.")
    validate_condition(condition)
    if any(cid not in condition["max_output_tokens_by_candidate"] for cid in candidate_ids):
        raise RecordsError("The condition must declare an output budget for every selected candidate.")
    if max_output_segments is not None and (type(max_output_segments) is not int or not 1 <= max_output_segments <= 8192):
        raise RecordsError("max_output_segments must be an integer from 1 through 8192 or null.")
    condition = deepcopy(condition)
    lock_path = Path(lock_path)
    with experiment_lock(Path(root)) as root:
        release = verify_release(Path(release_dir), root=root, permissions_path=permissions_path,
                                 purposes=list(purposes), recheck_current=True)
        if release.get("valid") is not True or release.get("current_eligibility_checked") is not True:
            raise RecordsError("Token inspection requires a current verified release and permission/history audit.")
        if (release.get("engineering_only") is not True and permissions_path is None):
            raise RecordsError("Real contributions require their current permission ledger.")
        permission_file_sha = hash_file(Path(permissions_path)) if permissions_path is not None else None
        permission_sha = record_sha256(load_dataset(permissions_path)) if permissions_path is not None else None
        lock_bytes_hash = hash_file(lock_path)
        lock = load_dataset(lock_path)
        entries = lock.get("candidates", []) if isinstance(lock, dict) else []
        candidates = {}
        for cid in candidate_ids:
            matches = [entry for entry in entries if isinstance(entry, dict) and entry.get("candidate_id") == cid]
            if (len(matches) != 1 or not isinstance(matches[0].get("revision"), str)
                    or not re.fullmatch(r"[a-f0-9]{40}", matches[0]["revision"])
                    or not isinstance(matches[0].get("repository"), str) or not matches[0]["repository"].strip()):
                raise RecordsError("Each tokenizer candidate must have one exact pinned repository/revision.")
            candidates[cid] = matches[0]
        dataset = release["dataset"]
        if not 1 <= len(dataset["examples"]) <= 256:
            raise RecordsError("The initial token audit is bounded to 1–256 selected release examples.")
        if any(example["split"] not in purposes for example in dataset["examples"]):
            raise RecordsError("A loaded example does not belong to an explicitly selected purpose.")
        sources = {source["source_id"]: source for source in dataset["sources"]}
        if any(not isinstance(example.get("approved_answer"), str) or not example["approved_answer"].strip()
               for example in dataset["examples"]):
            raise RecordsError("Exact target accounting requires a nonblank approved answer for every example.")
        verification = {}
        paths = {}
        # Verify all selected snapshots before loading any tokenizer.
        for cid in candidate_ids:
            paths[cid] = root / "models" / cid / candidates[cid]["revision"] / "tokenizer"
            check = verify_snapshot(lock_path, cid, paths[cid], include_weights=False)
            if check.get("valid") is not True:
                raise RecordsError("Pinned tokenizer-only snapshot verification failed for " + cid + ".")
            verification[cid] = check
        reports = []
        for cid in candidate_ids:
            tokenizer = load_local_tokenizer(paths[cid])
            instruction = _material(tokenizer, condition["instruction_text"])
            instruction["accounting_scope"] = "Standalone instruction text only; not additive to contextual prompt tokens."
            rows = []
            for example in dataset["examples"]:
                source = sources[example["source_id"]]
                row = {"example_id": example["example_id"], "source_id": source["source_id"],
                    "purpose": example["split"], "source_sha256": source["content_sha256"],
                    "example_sha256": example_sha256(example), "source_language": source["language"],
                    "outcome": "unmeasured", "fit": False, "text_normalized": False, "truncated": False}
                try:
                    materials = {"source": _material(tokenizer, source["original_text"]),
                        "question": _material(tokenizer, example["question"]),
                        "answer": _material(tokenizer, example["approved_answer"])}
                    messages = task_messages(source, example, condition)
                    user_material = _material(tokenizer, messages[0]["content"])
                    generation = render_conversation(messages, tokenizer, candidate_id=cid,
                                                      mode="generation", reasoning_mode="disabled")
                    training_messages = messages + [{"role": "assistant", "content": example["approved_answer"]}]
                    full = render_conversation(training_messages, tokenizer, candidate_id=cid,
                                               mode="training", reasoning_mode="disabled")
                    prompt_count, full_count = len(generation["input_ids"]), len(full["input_ids"])
                    output_limit, context_limit = condition["max_output_tokens_by_candidate"][cid], condition["context_limit_tokens"]
                    row.update(materials=materials, complete_user_message=user_material,
                        generation_prompt_tokens=prompt_count, complete_training_tokens=full_count,
                        generation_prompt_sha256=generation["rendered_utf8_sha256"],
                        generation_token_ids_sha256=generation["input_ids_sha256"],
                        complete_training_sha256=full["rendered_utf8_sha256"],
                        training_token_ids_sha256=full["input_ids_sha256"],
                        chat_template_sha256=generation["chat_template_utf8_sha256"],
                        messages_sha256=generation["messages_sha256"], reasoning=generation["reasoning"],
                        declared_output_tokens=output_limit, context_limit_tokens=context_limit,
                        generation_minus_standalone_user_tokens=prompt_count - user_material["standalone_raw_tokens"],
                        standalone_components_sum=instruction["standalone_raw_tokens"] + sum(materials[key]["standalone_raw_tokens"] for key in ("source", "question")),
                        overhead_scope="Token differences describe complete rendering versus separately encoded strings; contextual tokenization prevents additive attribution.",
                        fits_generation_budget=prompt_count + output_limit <= context_limit,
                        fits_complete_training=full_count <= context_limit)
                    # The shared preparation refuses ambiguous prefixes, bad
                    # decoded targets and >8192 sequences; no offset is guessed.
                    prepared = prepare_training_example(tokenizer, example_id=example["example_id"],
                        messages=training_messages, max_seq_length=8192,
                        template_kwargs={"candidate_id": cid, "reasoning_mode": "disabled"})
                    target_count = len(prepared["tokens"]) - prepared["offset"]
                    row.update(outcome="measured", assistant_offset=prepared["offset"],
                        assistant_target_tokens=target_count, assistant_target_ids_sha256=prepared["target_ids_sha256"],
                        assistant_target_includes_template_suffix=True,
                        target_minus_standalone_answer_tokens=target_count - materials["answer"]["standalone_raw_tokens"],
                        target_tokens_per_answer_tsheg_segment=target_count / materials["answer"]["tsheg_segment_proxy_count"]
                            if materials["answer"]["tsheg_segment_proxy_count"] else None,
                        fits_reference_target_budget=target_count <= output_limit,
                        fit=row["fits_generation_budget"] and row["fits_complete_training"] and target_count <= output_limit)
                except (RecordsError, ValueError, TypeError, KeyError) as exc:
                    # Exception text can contain material. Save only its fixed
                    # category and known renderer configuration code.
                    row.update(outcome="measurement_rejected", error_type=type(exc).__name__,
                               error_code=exc.code if isinstance(exc, PromptConfigurationError) else "exact_token_accounting_rejected")
                rows.append(row)
            proposal = _propose(rows, requested_segments=max_output_segments,
                                context_limit=condition["context_limit_tokens"])
            reports.append({"candidate_id": cid, "model_identity": candidates[cid]["repository"] + "@" + candidates[cid]["revision"],
                "tokenizer_identity": verification[cid].get("identity"),
                "tokenizer_files": verification[cid].get("files", []),
                "tokenizer_verification_sha256": record_sha256(verification[cid]),
                "instruction_standalone": instruction, "cases": rows,
                "all_measured": all(row["outcome"] == "measured" for row in rows),
                "all_fit": all(row["fit"] for row in rows), "proposed_output_budget": proposal})
        refreshed = verify_release(Path(release_dir), root=root, permissions_path=permissions_path,
                                   purposes=list(purposes), recheck_current=True)
        if (refreshed["release_sha256"] != release["release_sha256"]
                or record_sha256(refreshed["dataset"]) != record_sha256(dataset)
                or hash_file(lock_path) != lock_bytes_hash
                or (permissions_path is not None and hash_file(Path(permissions_path)) != permission_file_sha)):
            raise RecordsError("Release, current permissions or tokenizer lock changed during token inspection.")
        for cid in candidate_ids:
            final_check = verify_snapshot(lock_path, cid, paths[cid], include_weights=False)
            if (final_check.get("valid") is not True or final_check.get("identity") != verification[cid].get("identity")
                    or final_check.get("files") != verification[cid].get("files")):
                raise RecordsError("Verified tokenizer payload changed during token inspection.")
        return {"schema_version": "1.0", "kind": "release_token_cost_audit", "created_at": utc_now(),
            "valid": all(report["all_measured"] for report in reports),
            "all_fit": all(report["all_fit"] for report in reports),
            "release_sha256": release["release_sha256"], "dataset_sha256": record_sha256(dataset),
            "model_lock_file_sha256": lock_bytes_hash, "purposes": list(purposes),
            "permissions_file_sha256": permission_file_sha, "permissions_canonical_sha256": permission_sha,
            "engineering_only": release["engineering_only"], "evidence_kind": release["evidence_kind"],
            "condition": condition, "condition_identity": condition_identity(condition),
            "current_release_verification_sha256": record_sha256(refreshed),
            "current_eligibility_checked": True, "final_test_opened": False,
            "unopened_splits": release.get("unopened_splits", []),
            "tsheg_segment_proxy_definition": _SEGMENT_DEFINITION,
            "tibetan_codepoint_definition": "Unicode Tibetan block U+0F00..U+0FFF inclusive; script presence is not fluency or comprehension.",
            "candidates": reports, "text_normalized": False, "truncated": False,
            "claims": {"language_quality_measured": False, "tibetan_comprehension_measured": False,
                "clinical_correctness_measured": False, "model_weights_loaded": False, "model_inference_run": False,
                "training_authorized": False, "reviewed_task_budget_granted": False, "release_promoted": False},
            "limitations": ["Synthetic engineering material measures software paths, not native language quality.",
                "Standalone instruction and material token counts are not additive components of a contextual prompt.",
                "Proposed budgets are unreviewed observations from non-final references; output quality, truncation risk and equivalence still need native review."]}
