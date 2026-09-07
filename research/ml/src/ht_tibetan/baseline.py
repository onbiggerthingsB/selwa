"""Bounded, local source-and-question baselines with explicit research eligibility.

A completed run records generation, not Tibetan comprehension or clinical safety.
No model is downloaded here. Reviewed reference answers never enter prompts.
"""
from __future__ import annotations

from dataclasses import asdict
import math
from pathlib import Path
import re
from typing import Any, Callable

from .artifacts import hash_file, make_manifest, utc_now, write_json_new
from .inference import InferenceRequest, InferenceResult
from .records import (RecordsError, example_sha256, load_dataset,
                      record_sha256, require_valid_dataset)
from .splits import audit_splits

CANDIDATE_IDS = {"qwen3-4b-mlx-4bit", "gemma3-4b-it-mlx-4bit"}
_FIELDS = {"schema_version", "run_id", "purpose", "candidate_ids", "example_ids",
           "max_output_tokens", "context_limit_tokens", "timeout_seconds", "seed",
           "temperature", "reasoning_mode", "contributor_policy", "community_id",
           "task_id", "review_criteria"}
_PAIRED_FIELDS = _FIELDS | {"pair_ids", "conditions"}
_CONDITIONS = {"bo_to_bo", "bo_to_zh", "zh_to_bo", "zh_to_zh"}
_JOB_FIELDS = ("pair_id", "condition_id", "input_language", "output_language",
               "parallel_pair_sha256")
_INSTRUCTION = ("Read the following passage and answer the question using only that passage. "
                "If the passage does not answer it, say that it does not provide the answer. "
                "Answer in the same language as the question.")


def validate_config(config: Any) -> None:
    if not isinstance(config, dict):
        raise RecordsError("Baseline configuration must contain exactly the documented fields.")
    version = config.get("schema_version")
    if version not in ("1.0", "1.1"):
        raise RecordsError("Unsupported baseline configuration version.")
    fields = _PAIRED_FIELDS if version == "1.1" else _FIELDS
    if set(config) != fields:
        raise RecordsError("Baseline configuration must contain exactly the documented fields.")
    if not isinstance(config["run_id"], str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", config["run_id"]):
        raise RecordsError("run_id must be a safe 1-64 character identifier.")
    if not isinstance(config["purpose"], str) or config["purpose"] not in {"infrastructure_smoke", "language_baseline"}:
        raise RecordsError("Unknown baseline purpose.")
    for key, maximum in (("candidate_ids", 2), ("example_ids", 20)):
        values = config[key]
        if (not isinstance(values, list) or not 1 <= len(values) <= maximum
                or any(not isinstance(value, str) or not value for value in values)
                or len(set(values)) != len(values)):
            raise RecordsError(f"{key} must contain 1-{maximum} unique identifiers.")
    if not set(config["candidate_ids"]) <= CANDIDATE_IDS:
        raise RecordsError("Only the two locked initial candidates are supported.")
    if version == "1.1":
        for key, maximum in (("pair_ids", 10), ("conditions", 4)):
            values = config[key]
            if (not isinstance(values, list) or not 1 <= len(values) <= maximum
                    or any(not isinstance(value, str) or not value for value in values)
                    or len(set(values)) != len(values)):
                raise RecordsError(f"{key} must contain 1-{maximum} unique identifiers.")
        if not set(config["conditions"]) <= _CONDITIONS:
            raise RecordsError("Paired baselines support only bo/zh input and output conditions.")
    for key, lower, upper in (("max_output_tokens", 1, 512), ("context_limit_tokens", 1, 8192), ("seed", 0, 2**32 - 1)):
        value = config[key]
        if type(value) is not int or not lower <= value <= upper:
            raise RecordsError(f"{key} must be an integer between {lower} and {upper}.")
    timeout = config["timeout_seconds"]
    if type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= 300:
        raise RecordsError("timeout_seconds must be finite, positive and at most 300.")
    if type(config["temperature"]) not in (int, float) or config["temperature"] != 0:
        raise RecordsError("The first baseline fixes temperature at zero.")
    if config["reasoning_mode"] != "disabled":
        raise RecordsError("The first baseline requires explicitly disabled reasoning.")
    if not isinstance(config["contributor_policy"], str) or config["contributor_policy"] not in {"report", "disjoint"}:
        raise RecordsError("Declare the contributor overlap policy.")
    for key in ("community_id", "task_id", "review_criteria"):
        value = config[key]
        if value is not None and (not isinstance(value, str) or not value.strip() or len(value) > 8000):
            raise RecordsError(f"{key} must be null or nonempty text up to 8000 characters.")
        if config["purpose"] == "language_baseline" and value is None:
            raise RecordsError(f"Language baselines require {key} before any model runs.")


def _parallel_selection(dataset: dict, config: dict, parallel: dict | None) -> dict | None:
    """Validate the sidecar binding without allowing hidden or omitted pair members."""
    if config["schema_version"] == "1.0":
        if parallel is not None:
            raise RecordsError("Legacy baseline configurations do not accept parallel material.")
        return None
    if parallel is None:
        raise RecordsError("Paired baseline configurations require parallel material.")
    from .parallel import validate_parallel_material
    report = validate_parallel_material(dataset, parallel, purpose=config["purpose"],
                                        pair_ids=config["pair_ids"])
    if set(config["example_ids"]) != set(report["example_ids"]):
        raise RecordsError("example_ids must contain exactly both language members of every selected pair.")
    return report


def check_eligibility(dataset: dict, config: dict, parallel: dict | None = None) -> dict:
    """Check record-level eligibility, also used to read historical review packets.

    New dispatch additionally checks current contributor grants and recorded run
    history in run_baseline; this legacy helper alone never authorizes a new run.
    """
    require_valid_dataset(dataset)
    audit = audit_splits(dataset, config["contributor_policy"])
    if not audit["valid"]:
        raise RecordsError("Dataset split/exposure audit failed: " + ", ".join(sorted({e["code"] for e in audit["errors"]})))
    _parallel_selection(dataset, config, parallel)
    examples = {item["example_id"]: item for item in dataset["examples"]}
    sources = {item["source_id"]: item for item in dataset["sources"]}
    decisions = {item["example_id"]: item for item in dataset["adjudications"]}
    selected_ids = set(config["example_ids"])
    if not selected_ids <= examples.keys():
        raise RecordsError("A requested example does not exist in this dataset.")
    for component in audit["components"]:
        if selected_ids.intersection(component["example_ids"]):
            if component["splits"] != ["development_screen"] or any(
                    examples[eid]["split"] != "development_screen" for eid in component["example_ids"]):
                raise RecordsError("Every connected selected example must have a fixed development_screen split.")
            if any(role != "development_screen" for role in component["exposures"]):
                raise RecordsError("Selected development groups have prior training, validation or test exposure.")
    for eid in config["example_ids"]:
        example = examples[eid]
        source = sources[example["source_id"]]
        if not {"development_screen", "private_research"} <= set(source["permitted_uses"]):
            raise RecordsError("Selected sources require development_screen and private_research permission.")
        if source["unresolved_issues"]:
            raise RecordsError("Resolve selected source issues before a baseline.")
        if config["purpose"] == "infrastructure_smoke":
            if source["source_kind"] != "synthetic_fixture" or source["scope"] != "nonclinical":
                raise RecordsError("Infrastructure smoke accepts declared synthetic nonclinical fixtures only.")
        else:
            permitted_languages = {"bo", "zh"} if config["schema_version"] == "1.1" else {"bo"}
            if source["source_kind"] == "synthetic_fixture" or source["language"] not in permitted_languages:
                raise RecordsError("Tibetan language baselines require actual reviewed Tibetan source material.")
            if source["language_review"] != "approved" or example["review_state"] != "approved":
                raise RecordsError("Language baselines require approved source language and adjudicated examples.")
            decision = decisions.get(eid, {})
            if decision.get("decision") != "approve" or decision.get("language_review") != "approved":
                raise RecordsError("An explicit current language adjudication is required.")
            if source["scope"] == "health" and (source["medical_review"] != "approved" or decision.get("medical_review") != "approved"):
                raise RecordsError("Health material requires separate qualified source and example medical approval.")
    return audit


def conversation_for(source: dict, example: dict) -> list[dict[str, str]]:
    return [{"role": "user", "content": _INSTRUCTION + "\n\nPassage:\n" + source["original_text"]
             + "\n\nQuestion:\n" + example["question"]}]


def jobs_for(dataset: dict, config: dict, parallel: dict | None = None) -> list[dict]:
    """Return the deterministic case order used by generation and later verification."""
    validate_config(config)
    _parallel_selection(dataset, config, parallel)
    if config["schema_version"] == "1.0":
        return [{"example_id": eid} for eid in config["example_ids"]]
    from .parallel import condition_jobs
    return condition_jobs(dataset, parallel, config["pair_ids"], config["conditions"])


def conversation_for_job(source: dict, example: dict, job: dict) -> list[dict[str, str]]:
    if "condition_id" not in job:
        return conversation_for(source, example)
    from .parallel import conversation_for_condition
    return conversation_for_condition(source, example, job["output_language"])


def _case_index(current: dict) -> dict:
    index = {"case_id": current["case_id"], "candidate_id": current["candidate_id"],
        "example_id": current["example_id"], "attempted": current["attempted"],
        "outcome": current["response"]["result"]["outcome"],
        "result_file": f"case.{current['sequence']:03d}.result.json"}
    if current["schema_version"] == "1.1":
        index.update(schema_version="1.1", **{key: current[key] for key in _JOB_FIELDS})
    return index


def _candidate_paths(lock: dict, config: dict, root: Path) -> list[tuple[dict, Path]]:
    if not isinstance(lock, dict) or lock.get("schema_version") != "1.0" or not isinstance(lock.get("candidates"), list):
        raise RecordsError("Invalid candidate metadata lock.")
    indexed = {}
    for candidate in lock["candidates"]:
        if not isinstance(candidate, dict) or not isinstance(candidate.get("candidate_id"), str) or candidate["candidate_id"] in indexed:
            raise RecordsError("Invalid or duplicate locked candidate identity.")
        indexed[candidate["candidate_id"]] = candidate
    resolved = []
    for cid in config["candidate_ids"]:
        candidate = indexed.get(cid, {})
        revision, repository = candidate.get("revision"), candidate.get("repository")
        if not isinstance(revision, str) or not re.fullmatch(r"[a-f0-9]{40}", revision) or not isinstance(repository, str) or not repository.strip():
            raise RecordsError("A requested candidate lacks an exact pinned repository revision.")
        model = root / "models" / cid / revision / "model"
        if model.resolve() != model:
            raise RecordsError("Model snapshot paths may not redirect through symlinks.")
        resolved.append((candidate, model))
    return resolved


def _default_backend(*args, **kwargs):
    from .mlx_backend import run_local_inference
    return run_local_inference(*args, **kwargs)


def _default_loader(path):
    from .token_audit import load_local_tokenizer
    return load_local_tokenizer(path)


def _default_renderer(*args, **kwargs):
    from .token_audit import render_conversation
    return render_conversation(*args, **kwargs)


def _default_verifier(*args, **kwargs):
    from .acquisition import verify_snapshot
    return verify_snapshot(*args, **kwargs)


def _failure(run_id: str, identity: str, reason: str, *, outcome="runtime_failure", input_tokens=None) -> dict:
    return {"result": asdict(InferenceResult(run_id=run_id, outcome=outcome, answer=None,
        termination_reason=reason, model_identity=identity, input_tokens=input_tokens)),
        "raw_output": None, "measurements": {}}


def _checked_response(response: Any, request: InferenceRequest, identity: str, input_count: int, purpose: str) -> dict:
    if not isinstance(response, dict) or not isinstance(response.get("result"), dict):
        raise RecordsError("Backend did not return an inference result record.")
    result = InferenceResult(**response["result"])
    if result.run_id != request.run_id or result.model_identity != identity or result.adapter_identity is not None:
        raise RecordsError("Backend result identity does not match the unadapted requested model.")
    if result.input_tokens is not None and result.input_tokens != input_count:
        raise RecordsError("Backend input token count does not match the rendered prompt.")
    if result.output_tokens is not None and result.output_tokens > request.max_output_tokens:
        raise RecordsError("Backend exceeded the configured output budget.")
    if result.synthetic and purpose != "infrastructure_smoke":
        raise RecordsError("Synthetic backend results cannot become language baseline evidence.")
    if response.get("raw_output") is not None and not isinstance(response["raw_output"], str):
        raise RecordsError("Backend raw output must be text or null.")
    if not isinstance(response.get("measurements"), dict):
        raise RecordsError("Backend measurements must be an explicit object.")
    record_sha256(response)  # Reject non-JSON or non-finite measurements before publication.
    return response


def run_baseline(dataset_path, config_path, lock_path, root, output_dir, *, backend: Callable | None = None,
                 tokenizer_loader: Callable | None = None, renderer: Callable | None = None,
                 snapshot_verifier: Callable | None = None, parallel_path=None, permissions_path=None) -> dict:
    """Serialize preflight, exposure reservation and inference with other experiments."""
    from .experiment_lock import experiment_lock
    with experiment_lock(Path(root)):
        return _run_baseline(dataset_path, config_path, lock_path, root, output_dir,
            backend=backend, tokenizer_loader=tokenizer_loader, renderer=renderer,
            snapshot_verifier=snapshot_verifier, parallel_path=parallel_path, permissions_path=permissions_path)


def _run_baseline(dataset_path, config_path, lock_path, root, output_dir, *, backend: Callable | None = None,
                  tokenizer_loader: Callable | None = None, renderer: Callable | None = None,
                  snapshot_verifier: Callable | None = None, parallel_path=None, permissions_path=None) -> dict:
    """Run serial cases; preserve attempts, partial outputs, and conservative exposure.

    Invalid data/configurations raise before starting a run. A valid run blocked by
    local snapshots or runtime failures gets a failed manifest. Output directories
    must be new, under the private root/runs, and outside Desktop. Keyboard
    interruption is finalized as interrupted and returned.
    """
    dataset_path, config_path, lock_path = map(Path, (dataset_path, config_path, lock_path))
    dataset, config, lock = (load_dataset(path) for path in (dataset_path, config_path, lock_path))
    validate_config(config)
    if config["schema_version"] == "1.0" and parallel_path is not None:
        raise RecordsError("Legacy baseline configurations do not accept parallel material.")
    parallel_path = Path(parallel_path) if parallel_path is not None else None
    parallel = load_dataset(parallel_path) if parallel_path is not None else None
    check_eligibility(dataset, config, parallel)
    jobs = jobs_for(dataset, config, parallel)
    root = Path(root).expanduser().absolute()
    output = Path(output_dir).expanduser().absolute()
    if any(part.is_symlink() for value in (root, output) for part in (value, *value.parents)) or any(
            value.resolve() != value for value in (root, output)):
        raise RecordsError("Run paths must be canonical and cannot contain symlinks.")
    candidates = _candidate_paths(lock, config, root)
    if output.is_relative_to((Path.home() / "Desktop").resolve()):
        raise RecordsError("Raw research run outputs must be outside Desktop.")
    if output == root / "runs" or not output.is_relative_to(root / "runs"):
        raise RecordsError("Run outputs must be below the private research root/runs so later audits can find exposure.")
    (root / "runs").mkdir(parents=True, exist_ok=True)
    from .data_use import audit_data_use, permission_checks, selected_dataset
    permissions_path = Path(permissions_path) if permissions_path is not None else None
    permissions = load_dataset(permissions_path) if permissions_path is not None else None
    exposed, data_use = audit_data_use(dataset, permissions, root / "runs", purpose="development_screen",
        example_ids=config["example_ids"], contributor_policy=config["contributor_policy"],
        synthetic_only=config["purpose"] == "infrastructure_smoke")
    if not data_use["valid"]:
        raise RecordsError("Current data-use audit failed: " + ", ".join(sorted({item["code"] for item in data_use["errors"]})))
    audit = check_eligibility(exposed, config, parallel)
    output.mkdir(parents=True, exist_ok=False)
    write_json_new(output / "data-use-audit.json", data_use)
    backend = backend or _default_backend
    tokenizer_loader = tokenizer_loader or _default_loader
    renderer = renderer or _default_renderer
    snapshot_verifier = snapshot_verifier or _default_verifier
    inputs = [dataset_path, config_path, lock_path]
    if parallel_path is not None:
        inputs.append(parallel_path)
    if permissions_path is not None:
        inputs.append(permissions_path)
    manifest = make_manifest(config["run_id"], "local_source_question_baseline", inputs, config, "running")
    manifest.update(purpose=config["purpose"],
        evidence_type="infrastructure_smoke" if config["purpose"] == "infrastructure_smoke" else "unscored_language_generation",
        not_measured=["Tibetan comprehension", "clinical safety", "training quality", "generalization"],
        planned_cases=len(candidates) * len(jobs), selected_example_ids=config["example_ids"],
        split_audit=audit, snapshots=[], cases=[], attempted_case_count=0,
        loaded_records_sha256={"dataset": record_sha256(dataset), "config": record_sha256(config), "lock": record_sha256(lock)})
    manifest["data_use_audit"] = {"artifact": "data-use-audit.json", "sha256": hash_file(output / "data-use-audit.json"),
        "policy_version": "1.0", "synthetic_only": config["purpose"] == "infrastructure_smoke"}
    if permissions is not None:
        manifest["loaded_records_sha256"]["contribution_permissions"] = record_sha256(permissions)
    if parallel is not None:
        manifest["schema_version"] = "1.1"
        manifest["parallel_material"] = parallel
        manifest["loaded_records_sha256"]["parallel_material"] = record_sha256(parallel)
    write_json_new(output / "manifest.started.json", manifest)
    examples = {item["example_id"]: item for item in dataset["examples"]}
    sources = {item["source_id"]: item for item in dataset["sources"]}
    exposed_index = {item["example_id"]: item for item in exposed["examples"]}
    connected_examples = {eid: component["example_ids"] for component in audit["components"]
                          for eid in component["example_ids"]}
    current = None
    current_result_written = False
    try:
        # Verify every selected snapshot before loading any tokenizer or starting a worker.
        for candidate, model_path in candidates:
            report = snapshot_verifier(lock_path, candidate["candidate_id"], model_path, include_weights=True)
            manifest["snapshots"].append({"candidate_id": candidate["candidate_id"], "verification": report})
            if not isinstance(report, dict) or report.get("valid") is not True:
                raise RecordsError("A selected local model snapshot failed payload verification.")
        for candidate, model_path in candidates:
            identity = candidate["repository"] + "@" + candidate["revision"]
            tokenizer = tokenizer_loader(model_path)
            for job in jobs:
                eid = job["example_id"]
                sequence = len(manifest["cases"]) + 1
                example, source = examples[eid], sources[examples[eid]["source_id"]]
                case_id = f"{config['run_id']}-{sequence:03d}"
                current_result_written = False
                current = {"schema_version": config["schema_version"], "case_id": case_id, "sequence": sequence,
                    "candidate_id": candidate["candidate_id"], "model_identity": identity,
                    "example_id": eid, "example_version": example["version"],
                    "example_sha256": example_sha256(example), "source_id": source["source_id"],
                    "source_sha256": source["content_sha256"], "purpose": config["purpose"],
                    "settings": {key: config[key] for key in ("max_output_tokens", "context_limit_tokens", "timeout_seconds", "seed", "temperature", "reasoning_mode")},
                    "messages": conversation_for_job(source, example, job), "attempted": False,
                    "created_at": utc_now(),
                    **({key: job[key] for key in _JOB_FIELDS} if config["schema_version"] == "1.1" else {})}
                try:
                    rendering = renderer(current["messages"], tokenizer, candidate_id=candidate["candidate_id"],
                                         mode="generation", reasoning_mode=config["reasoning_mode"])
                    ids = rendering["input_ids"]
                    if not isinstance(ids, list) or not ids or any(type(token) is not int or token < 0 for token in ids):
                        raise RecordsError("Renderer returned invalid prompt token IDs.")
                    current["prompt"] = rendering
                    request = InferenceRequest(case_id, rendering["rendered_text"], config["max_output_tokens"], config["timeout_seconds"])
                    if len(ids) + request.max_output_tokens > config["context_limit_tokens"]:
                        response = _failure(case_id, identity, "prompt_plus_output_exceeds_context_budget", outcome="context_overflow", input_tokens=len(ids))
                    else:
                        if config["purpose"] != "infrastructure_smoke":
                            # Recheck after rendering and before reserving dispatch;
                            # a changed ledger requires a new inspectable run receipt.
                            current_permissions = load_dataset(permissions_path)
                            if record_sha256(current_permissions) != record_sha256(permissions) or any(
                                    not check["valid"] for check in permission_checks(
                                        selected_dataset(dataset, config["example_ids"]), current_permissions,
                                        purpose="development_screen", as_of=utc_now())):
                                raise RecordsError("Contributor permission changed or expired after preflight.")
                        current["attempted"] = True
                        manifest["attempted_case_count"] += 1
                        # Publish before dispatch: if interrupted during dispatch, conservatively
                        # retain exposure rather than describing this case as unseen.
                        exposed_ids = connected_examples[eid] if config["schema_version"] == "1.1" else [eid]
                        for exposed_id in exposed_ids:
                            if "development_screen" not in exposed_index[exposed_id]["exposures"]:
                                exposed_index[exposed_id]["exposures"].append("development_screen")
                        current["exposure_snapshot"] = f"exposed-dataset.{manifest['attempted_case_count']:03d}.json"
                        write_json_new(output / current["exposure_snapshot"], exposed)
                        write_json_new(output / f"case.{sequence:03d}.attempt.json", current)
                        response = _checked_response(backend(request, model_path=model_path, model_identity=identity,
                            prompt_token_ids=ids, seed=config["seed"], temperature=config["temperature"]),
                            request, identity, len(ids), config["purpose"])
                except Exception as exc:
                    response = _failure(case_id, identity, "case_exception:" + type(exc).__name__)
                    current["error_type"] = type(exc).__name__
                    current["error_message"] = str(exc)[:1000]
                    current["error_code"] = getattr(exc, "code", None)
                current["response"] = response
                current["finished_at"] = utc_now()
                write_json_new(output / f"case.{sequence:03d}.result.json", current)
                current_result_written = True
                manifest["cases"].append(_case_index(current))
                current = None
                if response["result"]["outcome"] == "cancelled":
                    raise KeyboardInterrupt  # Worker already stopped; do not dispatch another case.
        manifest["outcome"] = "completed" if all(case["outcome"] == "success" for case in manifest["cases"]) else "failed"
    except KeyboardInterrupt:
        manifest["outcome"] = "interrupted"
        if current is not None and not current_result_written:
            current["response"] = _failure(current["case_id"], current["model_identity"], "operator_interrupt", outcome="cancelled")
            current["finished_at"] = utc_now()
            write_json_new(output / f"case.{current['sequence']:03d}.result.json", current)
            manifest["cases"].append(_case_index(current))
    except Exception as exc:
        manifest["outcome"] = "failed"
        manifest["error_type"] = type(exc).__name__
        manifest["error_message"] = str(exc)[:1000]
    manifest["finished_at"] = utc_now()
    manifest["all_cases_recorded"] = len(manifest["cases"]) == manifest["planned_cases"]
    manifest["exposure_policy"] = "Attempted worker dispatch is conservatively development-exposed, including failed or interrupted attempts; cases rejected before dispatch are not marked exposed."
    if config["schema_version"] == "1.1":
        manifest["exposure_policy"] = ("Before attempted worker dispatch, every connected source/scenario/paraphrase group member, "
            "including both language variants, is conservatively development-exposed, including failed or interrupted attempts; "
            "cases rejected before dispatch do not add exposure.")
    manifest["latest_exposure_snapshot"] = f"exposed-dataset.{manifest['attempted_case_count']:03d}.json" if manifest["attempted_case_count"] else None
    manifest["artifacts"] = [{"name": path.name, "sha256": hash_file(path)}
                             for path in sorted(output.glob("*.json"))]
    write_json_new(output / "manifest.json", manifest)
    return manifest
