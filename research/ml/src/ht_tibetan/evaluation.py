"""Serial, permission-checked release evaluation with paired base/adapter arms.

Outputs stay private. Final-test inspection reserves exposure before execution;
the resulting score is a task measurement, never clinical approval or promotion.
"""
from __future__ import annotations

from dataclasses import asdict
import math
from pathlib import Path
import re

from .artifacts import hash_file, make_manifest, utc_now, write_json_new
from .conditions import condition_identity, task_messages, validate_condition
from .data_use import permission_checks, selected_dataset
from .inference import InferenceRequest, InferenceResult
from .records import RecordsError, example_sha256, load_dataset, record_sha256


def validate_evaluation_config(config: dict) -> None:
    required = {"schema_version", "run_id", "purpose", "conditions", "arms", "example_ids", "seed", "timeout_seconds"}
    if not isinstance(config, dict) or set(config) != required or config["schema_version"] != "1.0":
        raise RecordsError("Evaluation requires a complete version 1.0 configuration.")
    if not isinstance(config["run_id"], str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}", config["run_id"]):
        raise RecordsError("Invalid evaluation run ID.")
    if config["purpose"] not in {"development_screen", "validation", "final_test"}:
        raise RecordsError("Choose a declared evaluation split.")
    if not isinstance(config["conditions"], list) or not 1 <= len(config["conditions"]) <= 4:
        raise RecordsError("Declare one to four explicit conditions.")
    for condition in config["conditions"]:
        validate_condition(condition)
    if len({condition["condition_id"] for condition in config["conditions"]}) != len(config["conditions"]):
        raise RecordsError("Condition IDs must be distinct.")
    if len({condition["output_language"] for condition in config["conditions"]}) != 1:
        raise RecordsError("A released reference has one output language; use separately reviewed reference material for another language.")
    arms = config["arms"]
    if not isinstance(arms, list) or not 1 <= len(arms) <= 4:
        raise RecordsError("Declare one to four candidate/arm pairs.")
    identities = set()
    for arm in arms:
        if not isinstance(arm, dict) or set(arm) != {"arm_id", "candidate_id", "checkpoint_dir"}:
            raise RecordsError("An arm declares candidate, base/adapter role and explicit checkpoint path/null.")
        identity = (arm["candidate_id"], arm["arm_id"])
        if arm["candidate_id"] not in {"qwen3-4b-mlx-4bit", "gemma3-4b-it-mlx-4bit"} or arm["arm_id"] not in {"base", "adapter"} or identity in identities:
            raise RecordsError("Unsupported or duplicate evaluation arm.")
        identities.add(identity)
        if (arm["arm_id"] == "base" and arm["checkpoint_dir"] is not None) or (arm["arm_id"] == "adapter" and
                (not isinstance(arm["checkpoint_dir"], str) or not arm["checkpoint_dir"].strip())):
            raise RecordsError("Only adapter arms require a checkpoint.")
        if any(arm["candidate_id"] not in condition["max_output_tokens_by_candidate"] for condition in config["conditions"]):
            raise RecordsError("Every condition needs a token ceiling for every selected candidate.")
    if any((cid, "base") not in identities for cid, kind in identities if kind == "adapter"):
        raise RecordsError("Every adapter must have its unchanged base as a paired control.")
    if len({tuple(sorted(kind for candidate, kind in identities if candidate == cid)) for cid, _ in identities}) != 1:
        raise RecordsError("All compared candidates must use the same set of base/adapter arms.")
    ids = config["example_ids"]
    if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or any(not isinstance(item, str) for item in ids) or len(set(ids)) != len(ids):
        raise RecordsError("Select one to 100 distinct example IDs.")
    if len(ids) * len(arms) * len(config["conditions"]) > 400:
        raise RecordsError("An evaluation is bounded to 400 planned cases.")
    if type(config["seed"]) is not int or not 0 <= config["seed"] <= 2**32 - 1:
        raise RecordsError("Use an explicit uint32 seed.")
    if type(config["timeout_seconds"]) not in (int, float) or not math.isfinite(config["timeout_seconds"]) or not 0 < config["timeout_seconds"] <= 300:
        raise RecordsError("Inference deadline must be finite, positive and at most 300 seconds.")


def _failed(case_id: str, model_identity: str, adapter_identity: str | None, reason: str,
            *, outcome: str = "runtime_failure", input_tokens: int | None = None) -> dict:
    return {"result": asdict(InferenceResult(case_id, outcome, None, reason, model_identity,
        adapter_identity=adapter_identity, input_tokens=input_tokens)), "raw_output": None, "measurements": {}}


def _check_response(response: dict, request: InferenceRequest, model_identity: str, adapter_identity: str | None,
                    token_count: int, engineering_only: bool) -> None:
    if not isinstance(response, dict) or not isinstance(response.get("result"), dict):
        raise RecordsError("Backend returned no structured result.")
    result = InferenceResult(**response["result"])
    if result.run_id != request.run_id or result.model_identity != model_identity or result.adapter_identity != adapter_identity:
        raise RecordsError("Backend returned another model, adapter or case identity.")
    if result.synthetic and not engineering_only:
        raise RecordsError("Synthetic responses cannot count as real language evidence.")
    if result.input_tokens is not None and result.input_tokens != token_count:
        raise RecordsError("Backend input token count differs from the recorded prompt.")
    if result.output_tokens is not None and result.output_tokens > request.max_output_tokens:
        raise RecordsError("Backend output exceeded the model-specific budget.")
    if result.outcome == "success" and (response.get("raw_output") != result.answer or result.termination_reason != "stop"):
        raise RecordsError("Successful output must preserve the exact complete answer.")
    record_sha256(response)


def run_evaluation(release_dir, permissions_path, config_path, lock_path, root, output, *,
                   backend=None, tokenizer_loader=None, renderer=None, snapshot_verifier=None,
                   release_verifier=None, checkpoint_verifier=None, study_path=None) -> dict:
    from .acquisition import verify_snapshot
    from .adapter_backend import run_adapter_inference, verify_adapter_checkpoint
    from .evaluation_scoring import score_cases
    from .evaluation_plan import enumerate_cases, case_id_for, validate_evaluation_study
    from .task_contract import validate_task_target
    from .experiment_lock import experiment_lock
    from .exposure_inventory import reserve_exposure
    from .releases import verify_release
    from .token_audit import load_local_tokenizer, render_conversation
    from .training_mechanics import validate_output_path

    config_path, lock_path, permissions_path = map(Path, (config_path, lock_path, permissions_path))
    config, lock = load_dataset(config_path), load_dataset(lock_path)
    validate_evaluation_config(config)
    root, output = validate_output_path(Path(root), Path(output))
    backend = backend or run_adapter_inference
    tokenizer_loader = tokenizer_loader or load_local_tokenizer
    renderer = renderer or render_conversation
    snapshot_verifier = snapshot_verifier or verify_snapshot
    release_verifier = release_verifier or verify_release
    checkpoint_verifier = checkpoint_verifier or verify_adapter_checkpoint
    with experiment_lock(root):
        release = release_verifier(Path(release_dir), root=root, permissions_path=permissions_path,
                                   purposes=[config["purpose"]], recheck_current=True)
        if release.get("valid") is not True or release.get("current_eligibility_checked") is not True:
            raise RecordsError("Evaluation requires current verified release eligibility.")
        dataset = release["dataset"]
        examples = {item["example_id"]: item for item in dataset["examples"]}
        sources = {item["source_id"]: item for item in dataset["sources"]}
        if not set(config["example_ids"]) <= examples.keys():
            raise RecordsError("Requested examples must all belong to the selected released evaluation split.")
        engineering = release["manifest"]["engineering_only"]
        study = load_dataset(study_path) if study_path is not None else None
        if not engineering:
            validate_evaluation_study(config, study)
        study_sha = record_sha256(study) if study is not None else None
        ledger = load_dataset(permissions_path)
        permission_sha = record_sha256(ledger)
        selected = selected_dataset(dataset, config["example_ids"])
        if any(source["language"] != config["conditions"][0]["output_language"] for source in selected["sources"]):
            raise RecordsError("This release runner evaluates same-language references; cross-language tasks need reviewed parallel references.")
        conditions = {item["condition_id"]: item for item in config["conditions"]}
        clearances = [entry for audit in release.get("audits", {}).values()
                      for check in audit.get("permission_checks", []) for entry in check.get("clearances", [])]
        if lock.get("schema_version") != "1.0" or not isinstance(lock.get("candidates"), list):
            raise RecordsError("An exact candidate metadata lock is required.")
        locked = {item["candidate_id"]: item for item in lock["candidates"]}
        if len(locked) != len(lock["candidates"]):
            raise RecordsError("Candidate identities in the metadata lock must be distinct.")
        identities, checkpoints, paths, verifications = {}, {}, {}, []
        for arm in config["arms"]:
            cid = arm["candidate_id"]
            if cid not in locked or not re.fullmatch(r"[a-f0-9]{40}", locked[cid].get("revision", "")):
                raise RecordsError("Every candidate needs an exact local model revision.")
            candidate = locked[cid]
            paths[cid] = root / "models" / cid / candidate["revision"] / "model"
            model_identity = candidate["repository"] + "@" + candidate["revision"]
            identities[(cid, arm["arm_id"])] = model_identity
            if arm["arm_id"] == "adapter":
                proof = checkpoint_verifier(Path(arm["checkpoint_dir"]), model_identity)
                checkpoints[cid] = proof
                if not engineering and proof.get("config", {}).get("release_sha256") != release["release_sha256"]:
                    raise RecordsError("A real adapter comparison requires the checkpoint's exact dataset release identity.")
        planned = enumerate_cases(config)
        for condition in config["conditions"]:
            for eid in config["example_ids"]:
                example = examples[eid]
                validate_task_target(sources[example["source_id"]], example, condition, study)
        references = [{"example_id": eid, "condition_id": condition["condition_id"],
                       "approved_answer": examples[eid]["approved_answer"],
                       "source_text": sources[examples[eid]["source_id"]]["original_text"],
                       "task_answer_kind": condition["task_answer_kind"],
                       **({"abstention_label": study["first_task"]["no_answer_label"]}
                          if study is not None and study.get("first_task") is not None
                          and condition["task_answer_kind"] in {"source_span", "exact_label"} else {})}
                      for condition in config["conditions"] for eid in config["example_ids"]]
        score_plan = {"planned_cases": planned, "expected_arms": sorted({arm["arm_id"] for arm in config["arms"]})}
        score_cases([], references, study=score_plan)  # Validate every reference before any exposure or worker.
        output.mkdir(mode=0o700, parents=True, exist_ok=False)
        journal = reserve_exposure(output, dataset, config["purpose"], config["example_ids"], 1)
        inputs = [config_path, lock_path, permissions_path, Path(release_dir) / "manifest.json"]
        if study_path is not None:
            inputs.append(Path(study_path))
        manifest = make_manifest(config["run_id"], "release_evaluation", inputs, config, "started")
        manifest.update(release_sha256=release["release_sha256"], engineering_only=engineering,
            study_sha256=study_sha,
            exposure_reservations=[{"path": journal.name, "sha256": hash_file(journal)}],
            planned_cases=planned, cases=[], snapshots=verifications)
        write_json_new(output / "started.json", manifest)
        cases, error = [], None
        try:
            for cid, path in paths.items():
                verification = snapshot_verifier(lock_path, cid, path, include_weights=True)
                verifications.append({"candidate_id": cid, "verification": verification})
                if verification.get("valid") is not True:
                    raise RecordsError("Pinned model payload verification failed.")
            tokenizers = {cid: tokenizer_loader(path) for cid, path in paths.items()}
            for sequence, job in enumerate(planned, 1):
                cid, arm_id, eid = job["candidate_id"], job["arm_id"], job["example_id"]
                condition, example = conditions[job["condition_id"]], examples[eid]
                source = sources[example["source_id"]]
                source_authors = {entry["contributor_id"] for entry in clearances
                    if entry.get("contribution_kind") == "source_text" and entry.get("source_id") == source["source_id"]}
                example_authors = {example["contributor_id"]} | {entry["contributor_id"] for entry in clearances
                    if entry.get("contribution_kind") == "example_bundle" and entry.get("example_id") == eid}
                for declaration in ledger.get("source_contributors", []):
                    if declaration["source_id"] == source["source_id"]:
                        source_authors.update(declaration["contributor_ids"])
                for declaration in ledger.get("example_contributors", []):
                    if declaration["example_id"] == eid:
                        example_authors.update(declaration["contributor_ids"])
                model_identity = identities[(cid, arm_id)]
                checkpoint = checkpoints.get(cid) if arm_id == "adapter" else None
                adapter_identity = checkpoint["adapter_identity"] if checkpoint else None
                case_id = case_id_for(config, sequence)
                case = {**job, **condition_identity(condition), "case_id": case_id,
                    "model_identity": model_identity, "adapter_identity": adapter_identity,
                    "source_id": source["source_id"], "source_sha256": source["content_sha256"],
                    "source_text": source["original_text"], "question": example["question"],
                    "scenario_group": example["scenario_group"], "contributor_id": example["contributor_id"],
                    "source_contributor_ids": sorted(source_authors), "example_contributor_ids": sorted(example_authors),
                    "example_sha256": example_sha256(example), "task_answer_kind": condition["task_answer_kind"],
                    "messages": task_messages(source, example, condition), "attempted": False}
                try:
                    prompt = renderer(case["messages"], tokenizers[cid], candidate_id=cid,
                                      mode="generation", reasoning_mode="disabled")
                    tokens = prompt["input_ids"]
                    if not isinstance(tokens, list) or not tokens or any(type(value) is not int or value < 0 for value in tokens):
                        raise RecordsError("Renderer produced invalid token IDs.")
                    case["prompt"] = prompt
                    request = InferenceRequest(case_id, prompt["rendered_text"],
                        condition["max_output_tokens_by_candidate"][cid], config["timeout_seconds"])
                    if len(tokens) + request.max_output_tokens > condition["context_limit_tokens"]:
                        response = _failed(case_id, model_identity, adapter_identity, "prompt_plus_output_exceeds_context",
                                           outcome="context_overflow", input_tokens=len(tokens))
                    else:
                        current = load_dataset(permissions_path)
                        if record_sha256(current) != permission_sha or (not engineering and any(not item["valid"] for item in
                                permission_checks(selected, current, purpose=config["purpose"], as_of=utc_now()))):
                            raise RecordsError("Contribution permission changed or expired before dispatch.")
                        case["attempted"] = True
                        write_json_new(output / f"case.{sequence:04d}.attempt.json", case)
                        response = backend(request, model_path=paths[cid], model_identity=model_identity,
                            prompt_token_ids=tokens, checkpoint_dir=next(arm["checkpoint_dir"] for arm in config["arms"]
                                if arm["candidate_id"] == cid and arm["arm_id"] == arm_id),
                            checkpoint_hashes=checkpoint["checkpoint_hashes"] if checkpoint else None,
                            seed=config["seed"], temperature=0.0)
                        _check_response(response, request, model_identity, adapter_identity, len(tokens), engineering)
                except KeyboardInterrupt:
                    response = _failed(case_id, model_identity, adapter_identity, "operator_interrupt", outcome="cancelled")
                except Exception as exc:
                    response = _failed(case_id, model_identity, adapter_identity, "case_exception:" + type(exc).__name__)
                    case["error"] = str(exc)[:1000]
                case.update(response)
                case["case_sha256"] = record_sha256(case)
                write_json_new(output / f"case.{sequence:04d}.result.json", case)
                cases.append(case)
                if case["result"]["outcome"] == "cancelled":
                    break
        except (Exception, KeyboardInterrupt) as exc:
            error = {"type": type(exc).__name__, "message": str(exc)[:1000]}
        scoring = score_cases(cases, references, study=score_plan)
        outcome = "completed" if scoring["valid"] and scoring["complete"] and len(cases) == len(planned) and all(case["result"]["outcome"] == "success" for case in cases) and error is None else "failed"
        report = {"schema_version": "1.0", "kind": "release_evaluation_report", "outcome": outcome,
            "run_id": config["run_id"], "engineering_only": engineering, "release_sha256": release["release_sha256"],
            "study_sha256": study_sha,
            "purpose": config["purpose"], "conditions": config["conditions"],
            "condition_identities": [condition_identity(item) for item in config["conditions"]],
            "planned_cases": planned, "cases": cases, "scoring": scoring, "error": error,
            "native_review_status": "pending", "clinical_approval": False, "production_promotion": False,
            "comparison_budgets_reviewed": all(item["budget_basis"] == "reviewed_task_budget" for item in config["conditions"]),
            "candidates": [{"candidate_id": cid, "arm_id": arm, "model_identity": identity,
                "adapter_identity": checkpoints[cid]["adapter_identity"] if arm == "adapter" else None}
                for (cid, arm), identity in identities.items()]}
        write_json_new(output / "report.json", report)
        manifest.update(outcome=outcome, finished_at=utc_now(), cases=[{"case_id": item["case_id"],
            "case_sha256": item["case_sha256"], "outcome": item["result"]["outcome"]} for item in cases],
            error=error, report_sha256=hash_file(output / "report.json"))
        manifest["artifact_inventory"] = [{"path": str(path.relative_to(output)), "sha256": hash_file(path),
            "bytes": path.stat().st_size} for path in sorted(output.rglob("*")) if path.is_file()]
        write_json_new(output / "manifest.json", manifest)
        return manifest
