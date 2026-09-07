"""Conservative, denominator-preserving scores for constrained research tasks.

String matching measures a declared task rule, never general Tibetan comprehension
or clinical correctness. A supplied plan is required to establish planned coverage.
No metric or model card grants approval, a dataset release, or deployment readiness.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import asdict
import json
import math
from typing import Any
import unicodedata

from .inference import InferenceResult
from .records import RecordsError, record_sha256

CASE_FIELDS = ("candidate_id", "arm_id", "condition_id", "instruction_language", "example_id")
STRATUM_FIELDS = ("candidate_id", "arm_id", "condition_id", "instruction_language", "task_answer_kind")
TASK_KINDS = {"exact_label", "exact_text", "source_span", "open_ended"}
LIMIT_REASONS = {"output_limit", "max_tokens", "max_output_tokens", "length", "token_limit"}


def _text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise RecordsError(f"{name} must be nonblank text.")
    return value


def _identity(case: dict) -> tuple[str, ...]:
    if not isinstance(case, dict):
        raise RecordsError("Each case or planned case must be an object.")
    key = tuple(_text(case.get(field), field) for field in CASE_FIELDS)
    if case["arm_id"] not in {"base", "adapter"}:
        raise RecordsError("arm_id must be base or adapter.")
    return key


def _normal(text: str) -> str:
    return " ".join(unicodedata.normalize("NFC", text).split())


def _count(value: Any, name: str) -> int | None:
    if value is not None and (type(value) is not int or value < 0):
        raise RecordsError(f"{name} must be a nonnegative integer or null.")
    return value


def _resources(case: dict, result: dict) -> dict:
    resources = {}
    for output, names, result_field in (
        ("input_tokens", ("prompt_tokens", "prompt_token_count", "input_tokens"), "input_tokens"),
        ("output_tokens", ("output_tokens", "output_token_count"), "output_tokens"),
    ):
        values = [_count(case[name], name) for name in names if name in case and case[name] is not None]
        if result.get(result_field) is not None:
            values.append(_count(result[result_field], result_field))
        if len(set(values)) > 1:
            raise RecordsError(f"Conflicting {output} counts in case and result.")
        resources[output] = values[0] if values else None
    elapsed = case.get("elapsed_seconds", result.get("elapsed_seconds"))
    if elapsed is not None and (type(elapsed) not in (int, float) or not math.isfinite(elapsed) or elapsed < 0):
        raise RecordsError("elapsed_seconds must be a finite nonnegative number or null.")
    resources["elapsed_seconds"] = elapsed
    return resources


def _reference_index(references: list[dict]) -> dict[tuple[str, str | None], dict]:
    indexed = {}
    for reference in references:
        if not isinstance(reference, dict):
            raise RecordsError("References must be objects.")
        eid = _text(reference.get("example_id"), "reference example_id")
        condition = reference.get("condition_id")
        if condition is not None:
            _text(condition, "reference condition_id")
        key = (eid, condition)
        if key in indexed:
            raise RecordsError("Duplicate reference identity.")
        kind = reference.get("task_answer_kind")
        if kind not in TASK_KINDS:
            raise RecordsError("Unknown task_answer_kind.")
        answer = reference.get("approved_answer")
        if kind != "open_ended" or answer is not None:
            _text(answer, "approved_answer")
        if reference.get("abstention_label") is not None:
            _text(reference["abstention_label"], "abstention_label")
            if kind not in {"exact_label", "source_span"}:
                raise RecordsError("Abstention scoring requires an explicit exact_label or source_span task.")
        if kind == "source_span":
            source = _text(reference.get("source_text"), "source_span source_text")
            if answer not in source and answer != reference.get("abstention_label"):
                raise RecordsError("The approved source_span answer is not an exact span of source_text or its explicit abstention label.")
        indexed[key] = reference
    return indexed


def _summarize(rows: list[dict]) -> dict:
    n = len(rows)
    failures = Counter(row["failure_reason"] for row in rows if row["failure_reason"] is not None)
    strict = sum(row["strict_reference_match"] for row in rows)
    normalized = sum(row["normalized_reference_match"] for row in rows)
    task_pass = sum(row["automatic_task_rule_pass"] for row in rows)
    resources = {}
    for metric in ("input_tokens", "output_tokens", "elapsed_seconds"):
        values = [row["resources"][metric] for row in rows if row["resources"][metric] is not None]
        resources[metric] = {"known_total": sum(values), "measured_case_count": len(values),
                             "unknown_case_count": n - len(values)}
    seconds = resources["elapsed_seconds"]["known_total"]
    resources["output_tokens_per_elapsed_second"] = (
        resources["output_tokens"]["known_total"] / seconds
        if seconds > 0 and resources["output_tokens"]["unknown_case_count"] == 0
        and resources["elapsed_seconds"]["unknown_case_count"] == 0 else None)
    return {"planned_case_count": n, "recorded_case_count": sum(row["recorded"] for row in rows),
        "successful_generation_count": sum(row["generation_success"] for row in rows),
        "failed_case_count": sum(failures.values()), "failure_counts": dict(sorted(failures.items())),
        "strict_reference_match_count": strict, "strict_reference_match_rate": strict / n if n else None,
        "normalized_reference_match_count": normalized,
        "normalized_reference_match_rate": normalized / n if n else None,
        "automatic_task_rule_pass_count": task_pass, "automatic_task_rule_pass_rate": task_pass / n if n else None,
        "automatically_unscorable_count": sum(row["task_answer_kind"] == "open_ended" for row in rows),
        "exact_abstention_count": sum(row["exact_abstention"] for row in rows),
        "correct_exact_abstention_count": sum(row["correct_exact_abstention"] for row in rows),
        "unexpected_exact_abstention_count": sum(row["exact_abstention"] and not row["correct_exact_abstention"] for row in rows),
        "native_review_pending_count": sum(row["native_review"] == "pending" for row in rows),
        "synthetic_case_count": sum(row["synthetic"] for row in rows), "resources": resources}


def _clusters(rows: list[dict]) -> dict:
    examples = {}
    for row in rows:
        examples[row["example_id"]] = (row["source_id"], row["scenario_group"])
    parent = {eid: eid for eid in examples}
    def find(eid):
        while parent[eid] != eid:
            parent[eid] = parent[parent[eid]]
            eid = parent[eid]
        return eid
    seen = {}
    for eid, values in examples.items():
        for field, value in zip(("source_id", "scenario_group"), values):
            if value is None:
                continue
            key = field, value
            if key in seen:
                parent[find(eid)] = find(seen[key])
            else:
                seen[key] = eid
    groups = defaultdict(list)
    for eid in examples:
        groups[find(eid)].append(eid)
    result = []
    for ids in sorted(sorted(group) for group in groups.values()):
        members = [row for row in rows if row["example_id"] in ids]
        result.append({"example_ids": ids,
            "source_ids": sorted({row["source_id"] for row in members if row["source_id"] is not None}),
            "scenario_groups": sorted({row["scenario_group"] for row in members if row["scenario_group"] is not None}),
            "case_count": len(members)})
    return {"connected_cluster_count": len(result), "unique_example_count": len(examples), "groups": result,
            "unknown_metadata_example_count": sum(None in values for values in examples.values()),
            "independence_established": False, "confidence_intervals_computed": False,
            "limitation": "Repeated arms, conditions and connected sources/scenarios are not independent observations; no semantic independence claim or row-level confidence interval is made."}


def score_cases(cases: list[dict], references: list[dict], *, study: dict | None = None) -> dict:
    """Score every planned identity, including absent and failed generations.

    Cases contain CASE_FIELDS, source_id, scenario_group and an InferenceResult
    dictionary under result. Optional outer prompt_tokens/output_tokens are checked
    against result counts; outer elapsed_seconds represents measured wall time.
    References are keyed by example_id, optionally also condition_id, and include
    task_answer_kind and approved_answer. Source spans also require source_text.

    study.planned_cases is the authoritative list of identity objects. Without it,
    coverage is explicitly limited to observed cases plus expected-arm counterparts.
    expected_arms defaults to [base, adapter]; baseline-only callers must set [base].
    """
    if not isinstance(cases, list) or not isinstance(references, list):
        raise RecordsError("Cases and references must be lists.")
    study = {} if study is None else study
    if not isinstance(study, dict):
        raise RecordsError("study must be an object or null.")
    expected_arms = study.get("expected_arms", ["base", "adapter"])
    if (not isinstance(expected_arms, list) or not expected_arms
            or any(arm not in {"base", "adapter"} for arm in expected_arms)
            or len(expected_arms) != len(set(expected_arms))):
        raise RecordsError("expected_arms must contain distinct base/adapter arm names.")
    refs = _reference_index(references)
    observed = {}
    metadata = {}
    model_identities = {}
    adapter_identities = {}
    for case in cases:
        key = _identity(case)
        if key in observed:
            raise RecordsError("Duplicate case identity would change the evaluation denominator.")
        _text(case.get("source_id"), "case source_id")
        _text(case.get("scenario_group"), "case scenario_group")
        observed[key] = case
    explicit_plan = "planned_cases" in study
    plans = study.get("planned_cases", [])
    if explicit_plan and (not isinstance(plans, list) or not plans):
        raise RecordsError("planned_cases must be a nonempty list.")
    planned = {}
    if explicit_plan:
        for plan in plans:
            key = _identity(plan)
            if key in planned:
                raise RecordsError("Duplicate planned case identity.")
            planned[key] = plan
    else:
        for case in cases:
            for arm in expected_arms:
                counterpart = {**case, "arm_id": arm}
                planned[_identity(counterpart)] = counterpart
    if not planned:
        raise RecordsError("No evaluation cases were planned or observed.")
    # Metadata must describe the same example consistently across all conditions.
    for item in list(observed.values()) + list(planned.values()) + references:
        eid = item["example_id"]
        existing = metadata.setdefault(eid, {})
        for field in ("source_id", "scenario_group"):
            value = item.get(field)
            if value is not None:
                _text(value, field)
                if field in existing and existing[field] != value:
                    raise RecordsError(f"Conflicting {field} for example {eid}.")
                existing[field] = value
    rows = []
    for key, plan in sorted(planned.items()):
        eid, condition = plan["example_id"], plan["condition_id"]
        reference = refs.get((eid, condition), refs.get((eid, None)))
        if reference is None:
            raise RecordsError(f"Missing reference for planned example {eid}, condition {condition}.")
        case = observed.get(key)
        result = {}
        resources = {"input_tokens": None, "output_tokens": None, "elapsed_seconds": None}
        if case is not None:
            result = case.get("result")
            if not isinstance(result, dict):
                raise RecordsError("Recorded cases require an InferenceResult dictionary.")
            try:
                asdict(InferenceResult(**result))
            except (TypeError, ValueError) as exc:
                raise RecordsError(f"Invalid inference result: {exc}") from exc
            candidate = plan["candidate_id"]
            identity = result["model_identity"]
            if candidate in model_identities and model_identities[candidate] != identity:
                raise RecordsError("A candidate's model identity changed across evaluation cases or arms.")
            model_identities[candidate] = identity
            adapter = result.get("adapter_identity")
            if plan["arm_id"] == "base" and adapter is not None:
                raise RecordsError("A base arm cannot report an adapter identity.")
            if plan["arm_id"] == "adapter":
                if result["outcome"] == "success" and adapter is None:
                    raise RecordsError("Successful adapter cases require an explicit adapter identity.")
                if adapter is not None:
                    if candidate in adapter_identities and adapter_identities[candidate] != adapter:
                        raise RecordsError("An adapter identity changed within one candidate arm.")
                    adapter_identities[candidate] = adapter
            if case.get("raw_output") is not None and not isinstance(case["raw_output"], str):
                raise RecordsError("raw_output must be text or null.")
            resources = _resources(case, result)
        failure = ("missing_case" if case is None else "output_limit"
                   if result["termination_reason"] in LIMIT_REASONS else
                   result["outcome"] if result["outcome"] != "success" else None)
        success = failure is None
        answer = result.get("answer") if success else None
        expected = reference.get("approved_answer")
        strict = success and expected is not None and answer == expected
        normalized = success and expected is not None and _normal(answer) == _normal(expected)
        span = (success and answer in reference["source_text"]
                if reference["task_answer_kind"] == "source_span" else None)
        label = reference.get("abstention_label")
        abstention = success and label is not None and answer == label
        kind = reference["task_answer_kind"]
        rows.append({**dict(zip(CASE_FIELDS, key)),
            "source_id": metadata[eid].get("source_id"), "scenario_group": metadata[eid].get("scenario_group"),
            "model_identity": result.get("model_identity"), "adapter_identity": result.get("adapter_identity"),
            "reference_sha256": record_sha256(reference),
            "result_sha256": record_sha256(result) if case is not None else None,
            "input_case_sha256": record_sha256(case) if case is not None else None,
            "task_answer_kind": kind, "recorded": case is not None, "generation_success": success,
            "outcome": result.get("outcome", "missing_case"), "failure_reason": failure,
            "strict_reference_match": strict, "normalized_reference_match": normalized,
            "automatic_task_rule_pass": strict and kind != "open_ended" and (kind != "source_span" or span or abstention),
            "answer_is_exact_source_span": span, "exact_abstention": abstention,
            "correct_exact_abstention": abstention and expected == label,
            "native_review": "pending" if kind in {"source_span", "open_ended"} else "not_assessed_by_scorer",
            "synthetic": result.get("synthetic", False), "resources": resources})
    strata = defaultdict(list)
    for row in rows:
        strata[tuple(row[field] for field in STRATUM_FIELDS)].append(row)
    pairs = defaultdict(dict)
    for row in rows:
        pair = (row["candidate_id"], row["condition_id"], row["instruction_language"], row["example_id"])
        pairs[pair][row["arm_id"]] = row
    comparisons = defaultdict(list)
    pairing_errors = []
    for pair, arms in sorted(pairs.items()):
        absent = [arm for arm in expected_arms if arm not in arms or not arms[arm]["recorded"]]
        if absent:
            pairing_errors.append({"code": "incomplete_arm_pair", "pair": dict(zip(
                ("candidate_id", "condition_id", "instruction_language", "example_id"), pair)), "missing_arms": absent})
        if set(expected_arms) == {"base", "adapter"}:
            comparisons[pair[:3]].append({"example_id": pair[3], "complete": not absent,
                "base_reference_match": bool(arms.get("base", {}).get("strict_reference_match", False)),
                "adapter_reference_match": bool(arms.get("adapter", {}).get("strict_reference_match", False))})
    paired = []
    for key, members in sorted(comparisons.items()):
        complete = all(item["complete"] for item in members)
        paired.append({**dict(zip(("candidate_id", "condition_id", "instruction_language"), key)),
            "planned_pair_count": len(members), "complete_pair_count": sum(item["complete"] for item in members),
            "adapter_minus_base_reference_match_rate": (sum(item["adapter_reference_match"] - item["base_reference_match"]
                for item in members) / len(members)) if complete else None,
            "pairs": members, "statistical_significance_established": False})
    errors = [{"code": "unplanned_case", "case": dict(zip(CASE_FIELDS, key))}
              for key in sorted(set(observed) - set(planned))]
    errors.extend({"code": "unexpected_arm", "case": dict(zip(CASE_FIELDS, key))}
                  for key in planned if key[1] not in expected_arms)
    errors.extend(pairing_errors)
    return {"schema_version": "1.0", "kind": "constrained_evaluation_scores", "valid": not errors,
        "complete": not errors, "errors": errors, "explicit_plan_supplied": explicit_plan,
        "denominator_scope": "explicit_planned_cases" if explicit_plan else "observed_cases_plus_expected_arm_counterparts",
        "cases_sha256": record_sha256(cases), "references_sha256": record_sha256(references),
        "study_sha256": record_sha256(study),
        "model_identities": dict(sorted(model_identities.items())), "adapter_identities": dict(sorted(adapter_identities.items())),
        "expected_arms": expected_arms.copy(), "plan_sha256": record_sha256(list(planned.values())) if explicit_plan else None,
        "aggregate": _summarize(rows), "per_stratum": [{**dict(zip(STRATUM_FIELDS, key)), **_summarize(members)}
            for key, members in sorted(strata.items())], "paired_comparisons": paired,
        "clusters": _clusters(rows), "cases": rows,
        "claims": {"general_tibetan_comprehension": False, "clinical_correctness": False,
                   "semantic_independence": False, "release_promoted": False, "deployment_ready": False},
        "metric_limits": ["All planned cases remain in rate denominators; failed and absent generations never count as matches.",
            "Strict matching uses exact reference text. NFC/whitespace normalization is a separate diagnostic, never a replacement score.",
            "A source span proves textual presence only; its relevance and meaning require native review.",
            "Exact-label and exact-text rule passes do not independently establish semantic or medical correctness.",
            "Model selection and stopping rules must be declared outside this scorer; paired differences do not establish statistical significance."]}


def build_model_card(training_manifest: dict, evaluation_report: dict) -> str:
    """Render reported facts with explicit limits; never infer approval from scores."""
    if not isinstance(training_manifest, dict) or not isinstance(evaluation_report, dict):
        raise RecordsError("Model card inputs must be manifest/report objects.")
    config = training_manifest.get("config", {})
    training = training_manifest.get("train") or {}
    response = training.get("response") or {}
    evidence = response.get("evidence") or {}
    reload = training_manifest.get("reload") or {}
    reload_evidence = (reload.get("response") or {}).get("evidence") or {}
    scores = evaluation_report.get("scoring", evaluation_report)
    aggregate = scores.get("aggregate", {})
    facts = {"Training run": training_manifest.get("run_id"), "Training outcome": training_manifest.get("outcome"),
        "Training manifest kind": training_manifest.get("kind"),
        "Training evidence type": training_manifest.get("evidence_type"),
        "Training engineering-only flag": training_manifest.get("engineering_only"),
        "Training dataset release identity": training_manifest.get("release_sha256"),
        "Base model identity": config.get("model_identity", training_manifest.get("model_identity")),
        "Adapter identity": response.get("adapter_identity", training_manifest.get("adapter_identity")),
        "Completed updates": response.get("completed_steps", training_manifest.get("completed_steps")),
        "Base tensors unchanged": evidence.get("base_unchanged"),
        "Changed adapter tensor count": evidence.get("changed_tensor_count"),
        "Reload verified": reload_evidence.get("reload_verified", training_manifest.get("reload_verified")),
        "Validation reload verified": reload_evidence.get("validation_reload_verified"),
        "Validation assistant-token loss before training": (evidence.get("validation_before") or {}).get("token_weighted_loss"),
        "Validation assistant-token loss after training": (evidence.get("validation_after") or {}).get("token_weighted_loss"),
        "Evaluation run": evaluation_report.get("run_id"),
        "Evaluation outcome": evaluation_report.get("outcome"),
        "Evaluation engineering-only flag": evaluation_report.get("engineering_only"),
        "Evaluation dataset release identity": evaluation_report.get("release_sha256"),
        "Evaluation denominator scope": scores.get("denominator_scope"),
        "Evaluation cases input hash": scores.get("cases_sha256"),
        "Evaluation reference input hash": scores.get("references_sha256"),
        "Planned evaluation cases": aggregate.get("planned_case_count"),
        "Failed or missing cases": aggregate.get("failed_case_count"),
        "Strict reference matches": aggregate.get("strict_reference_match_count"),
        "Native reviews still pending": aggregate.get("native_review_pending_count")}
    def value(item):
        # JSON escaping prevents supplied newlines or markup from becoming claims.
        return "not recorded" if item is None else json.dumps(item, ensure_ascii=False).replace("`", "\\u0060")
    lines = ["# Research adapter record", "", "This card reports supplied local artifacts; it does not authenticate them or approve a model for release.", ""]
    lines.extend(f"- {label}: `{value(item)}`" for label, item in facts.items())
    lines.extend(["", "String scores measure declared task rules. They do not establish general Tibetan comprehension, health correctness, semantic test independence or deployment readiness.",
        "Source-span and open-ended answers require native review. Missing throughput, memory, provenance, permission, dataset and clinical evidence remain unverified.",
        "No release promotion or model selection is granted by this card.", ""])
    return "\n".join(lines)
