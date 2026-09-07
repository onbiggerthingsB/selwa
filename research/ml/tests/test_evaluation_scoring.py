"""Adversarial scoring fixtures, never actual language or clinical judgments."""
from copy import deepcopy
from dataclasses import asdict
import unittest

from ht_tibetan.evaluation_scoring import CASE_FIELDS, build_model_card, score_cases
from ht_tibetan.inference import InferenceResult
from ht_tibetan.records import RecordsError, record_sha256


def reference(eid="item-1", answer="B", **changes):
    return {"example_id": eid, "approved_answer": answer, "task_answer_kind": "exact_label",
            "source_id": "source-" + eid, "scenario_group": "scenario-" + eid, **changes}


def case(eid="item-1", arm="base", answer="B", *, outcome="success", reason="stop", **changes):
    result = asdict(InferenceResult(run_id=f"run-{eid}-{arm}", outcome=outcome,
        answer=answer if outcome == "success" else None, termination_reason=reason,
        model_identity="fixture/model@" + "a" * 40,
        adapter_identity="fixture-adapter-sha256" if arm == "adapter" else None,
        elapsed_seconds=2.0, input_tokens=10, output_tokens=3, synthetic=True))
    return {"example_id": eid, "source_id": "source-" + eid, "scenario_group": "scenario-" + eid,
        "candidate_id": "fixture-candidate", "arm_id": arm, "condition_id": "bo_to_bo",
        "instruction_language": "en", "result": result, "raw_output": answer,
        "prompt_tokens": 10, "output_tokens": 3, "elapsed_seconds": 4.0, **changes}


def study(cases, arms=None):
    return {"planned_cases": [{field: item[field] for field in CASE_FIELDS} for item in cases],
            "expected_arms": ["base", "adapter"] if arms is None else arms}


class EvaluationScoringTests(unittest.TestCase):
    def test_whole_missing_example_and_missing_arm_remain_denominators(self):
        planned = [case(eid, arm) for eid in ("item-1", "item-2") for arm in ("base", "adapter")]
        report = score_cases(planned[:1], [reference(), reference("item-2")], study=study(planned))
        self.assertFalse(report["complete"])
        self.assertEqual(report["aggregate"]["planned_case_count"], 4)
        self.assertEqual(report["aggregate"]["recorded_case_count"], 1)
        self.assertEqual(report["aggregate"]["strict_reference_match_rate"], 0.25)
        self.assertEqual(report["aggregate"]["failure_counts"], {"missing_case": 3})
        self.assertIsNone(report["paired_comparisons"][0]["adapter_minus_base_reference_match_rate"])

    def test_failed_raw_reference_and_success_marked_output_limit_never_score(self):
        cases = [case("timeout", outcome="timeout", answer="B"),
                 case("limited", answer="B", reason="output_limit"),
                 case("failed", outcome="runtime_failure", answer="B"), case("good", answer="B")]
        report = score_cases(cases, [reference(item["example_id"]) for item in cases], study=study(cases, ["base"]))
        self.assertTrue(report["complete"])
        self.assertEqual(report["aggregate"]["strict_reference_match_rate"], 0.25)
        self.assertEqual(report["aggregate"]["automatic_task_rule_pass_count"], 1)
        self.assertEqual(report["aggregate"]["failure_counts"], {"timeout": 1, "output_limit": 1, "runtime_failure": 1})
        self.assertEqual(report["aggregate"]["resources"]["input_tokens"]["known_total"], 40)
        self.assertEqual(report["aggregate"]["resources"]["output_tokens"]["known_total"], 12)

    def test_whitespace_and_nfc_matching_is_diagnostic_not_a_pass(self):
        cases = [case(answer="  cafe\u0301\n ")]
        report = score_cases(cases, [reference(answer="caf\u00e9", task_answer_kind="exact_text")], study=study(cases, ["base"]))
        self.assertEqual(report["aggregate"]["strict_reference_match_count"], 0)
        self.assertEqual(report["aggregate"]["normalized_reference_match_count"], 1)
        self.assertEqual(report["aggregate"]["automatic_task_rule_pass_count"], 0)

    def test_abstention_only_uses_explicit_exact_label(self):
        cases = [case("correct", answer="UNKNOWN"), case("wrong", answer="UNKNOWN"),
                 case("paraphrase", answer="I do not know"), case("padded", answer=" UNKNOWN ")]
        refs = [reference("correct", "UNKNOWN", abstention_label="UNKNOWN"),
                reference("wrong", "B", abstention_label="UNKNOWN"),
                reference("paraphrase", "UNKNOWN", abstention_label="UNKNOWN"),
                reference("padded", "UNKNOWN", abstention_label="UNKNOWN")]
        report = score_cases(cases, refs, study=study(cases, ["base"]))
        self.assertEqual(report["aggregate"]["exact_abstention_count"], 2)
        self.assertEqual(report["aggregate"]["correct_exact_abstention_count"], 1)
        self.assertEqual(report["aggregate"]["unexpected_exact_abstention_count"], 1)
        self.assertEqual(report["aggregate"]["strict_reference_match_count"], 1)

    def test_source_presence_does_not_prove_the_answer_is_relevant(self):
        source = "The blue notebook is on the table. The red notebook is in the bag."
        cases = [case("wrong-span", answer="red notebook"), case("missing-span", answer="green notebook"),
                 case("right-span", answer="blue notebook")]
        refs = [reference(item["example_id"], "blue notebook", task_answer_kind="source_span", source_text=source)
                for item in cases]
        report = score_cases(cases, refs, study=study(cases, ["base"]))
        rows = {item["example_id"]: item for item in report["cases"]}
        self.assertTrue(rows["wrong-span"]["answer_is_exact_source_span"])
        self.assertFalse(rows["wrong-span"]["automatic_task_rule_pass"])
        self.assertFalse(rows["missing-span"]["answer_is_exact_source_span"])
        self.assertTrue(rows["right-span"]["automatic_task_rule_pass"])
        self.assertEqual(report["aggregate"]["native_review_pending_count"], 3)
        self.assertFalse(report["claims"]["general_tibetan_comprehension"])

    def test_reference_span_outside_source_is_rejected(self):
        cases = [case(answer="invented")]
        with self.assertRaisesRegex(RecordsError, "not an exact span"):
            score_cases(cases, [reference(answer="invented", task_answer_kind="source_span", source_text="Original passage.")],
                        study=study(cases, ["base"]))

    def test_source_span_accepts_only_the_explicit_exact_abstention_label(self):
        source = "The blue notebook is on the table."
        cases = [case("correct", answer="UNKNOWN"), case("unexpected", answer="UNKNOWN"),
                 case("padded", answer=" UNKNOWN "), case("paraphrase", answer="Not stated")]
        refs = [reference(item["example_id"], "blue notebook" if item["example_id"] == "unexpected" else "UNKNOWN",
                          task_answer_kind="source_span", source_text=source, abstention_label="UNKNOWN")
                for item in cases]
        report = score_cases(cases, refs, study=study(cases, ["base"]))
        rows = {row["example_id"]: row for row in report["cases"]}
        self.assertTrue(rows["correct"]["automatic_task_rule_pass"])
        self.assertTrue(rows["correct"]["correct_exact_abstention"])
        self.assertFalse(rows["correct"]["answer_is_exact_source_span"])
        self.assertFalse(rows["unexpected"]["automatic_task_rule_pass"])
        self.assertFalse(rows["padded"]["automatic_task_rule_pass"])
        self.assertFalse(rows["paraphrase"]["automatic_task_rule_pass"])
        self.assertEqual(report["aggregate"]["correct_exact_abstention_count"], 1)
        self.assertEqual(report["aggregate"]["unexpected_exact_abstention_count"], 1)
        self.assertEqual(report["aggregate"]["native_review_pending_count"], 4)
        self.assertFalse(report["claims"]["general_tibetan_comprehension"])

    def test_source_span_abstention_does_not_allow_other_invented_references(self):
        cases = [case(answer="invented")]
        for answer, label in (("invented", "UNKNOWN"), ("UNKNOWN", None), (" UNKNOWN ", "UNKNOWN")):
            with self.subTest(answer=answer, label=label), self.assertRaises(RecordsError):
                score_cases(cases, [reference(answer=answer, task_answer_kind="source_span",
                    source_text="Original passage.", abstention_label=label)], study=study(cases, ["base"]))

    def test_matching_open_ended_text_does_not_become_automatic_correctness(self):
        cases = [case(answer="A fluent-looking sentence.")]
        report = score_cases(cases, [reference(answer="A fluent-looking sentence.", task_answer_kind="open_ended")],
                             study=study(cases, ["base"]))
        self.assertEqual(report["aggregate"]["strict_reference_match_count"], 1)
        self.assertEqual(report["aggregate"]["automatic_task_rule_pass_count"], 0)
        self.assertEqual(report["aggregate"]["automatically_unscorable_count"], 1)
        self.assertEqual(report["cases"][0]["native_review"], "pending")

    def test_different_conditions_and_instruction_languages_never_pair(self):
        cases = [case(), case(arm="adapter", condition_id="bo_to_zh"),
                 case("item-2", instruction_language="bo"), case("item-2", arm="adapter", instruction_language="en")]
        report = score_cases(cases, [reference(), reference("item-2")], study=study(cases))
        self.assertFalse(report["complete"])
        self.assertEqual(len(report["per_stratum"]), 4)
        self.assertTrue(all(item["adapter_minus_base_reference_match_rate"] is None for item in report["paired_comparisons"]))

    def test_paired_difference_uses_identical_examples_and_keeps_failures(self):
        cases = [case("one", answer="A"), case("one", arm="adapter"),
                 case("two"), case("two", arm="adapter", outcome="timeout")]
        report = score_cases(cases, [reference("one"), reference("two")], study=study(cases))
        comparison = report["paired_comparisons"][0]
        self.assertTrue(report["complete"])
        self.assertEqual(comparison["complete_pair_count"], 2)
        self.assertEqual(comparison["adapter_minus_base_reference_match_rate"], 0.0)
        self.assertFalse(comparison["statistical_significance_established"])

    def test_duplicate_observed_or_planned_identities_are_rejected(self):
        single = case()
        with self.assertRaisesRegex(RecordsError, "Duplicate case"):
            score_cases([single, deepcopy(single)], [reference()])
        plan = study([single, deepcopy(single)], ["base"])
        with self.assertRaisesRegex(RecordsError, "Duplicate planned"):
            score_cases([single], [reference()], study=plan)

    def test_extra_cases_cannot_improve_planned_denominator(self):
        good, bad, extra = case(), case("bad", answer="A"), case("extra")
        report = score_cases([good, bad, extra], [reference(), reference("bad"), reference("extra")],
                             study=study([good, bad], ["base"]))
        self.assertFalse(report["valid"])
        self.assertEqual(report["aggregate"]["planned_case_count"], 2)
        self.assertEqual(report["aggregate"]["strict_reference_match_rate"], 0.5)
        self.assertIn("unplanned_case", {item["code"] for item in report["errors"]})

    def test_missing_plan_is_explicit_and_missing_counterpart_counted(self):
        report = score_cases([case()], [reference()])
        self.assertFalse(report["explicit_plan_supplied"])
        self.assertEqual(report["denominator_scope"], "observed_cases_plus_expected_arm_counterparts")
        self.assertEqual(report["aggregate"]["planned_case_count"], 2)
        self.assertEqual(report["aggregate"]["strict_reference_match_rate"], 0.5)
        self.assertFalse(report["complete"])

    def test_resource_unknowns_are_not_zero_and_wall_time_is_not_worker_time(self):
        complete = case()
        report = score_cases([complete], [reference()], study=study([complete], ["base"]))
        self.assertEqual(report["aggregate"]["resources"]["output_tokens_per_elapsed_second"], 0.75)
        unknown = case("unknown")
        unknown["output_tokens"] = unknown["result"]["output_tokens"] = None
        report = score_cases([complete, unknown], [reference(), reference("unknown")], study=study([complete, unknown], ["base"]))
        output = report["aggregate"]["resources"]["output_tokens"]
        self.assertEqual(output, {"known_total": 3, "measured_case_count": 1, "unknown_case_count": 1})
        self.assertIsNone(report["aggregate"]["resources"]["output_tokens_per_elapsed_second"])

    def test_resource_conflicts_nonfinite_counts_and_booleans_fail(self):
        for field, value in (("prompt_tokens", 11), ("output_tokens", True), ("elapsed_seconds", float("nan"))):
            item = case(**{field: value})
            with self.subTest(field=field), self.assertRaises(RecordsError):
                score_cases([item], [reference()], study=study([item], ["base"]))

    def test_model_or_adapter_substitution_cannot_be_scored_as_same_arm(self):
        base, adapter = case(), case(arm="adapter")
        adapter["result"]["model_identity"] = "another/model@revision"
        with self.assertRaisesRegex(RecordsError, "model identity changed"):
            score_cases([base, adapter], [reference()], study=study([base, adapter]))
        adapter = case(arm="adapter")
        adapter["result"]["adapter_identity"] = None
        with self.assertRaisesRegex(RecordsError, "explicit adapter identity"):
            score_cases([base, adapter], [reference()], study=study([base, adapter]))

    def test_cluster_counts_do_not_treat_repeated_conditions_as_independent(self):
        cases = [case("one"), case("one", arm="adapter"),
                 case("two", source_id="source-one", scenario_group="bridge"),
                 case("three", scenario_group="bridge")]
        refs = [reference("one"), reference("two", source_id="source-one", scenario_group="bridge"),
                reference("three", scenario_group="bridge")]
        report = score_cases(cases, refs, study=study(cases))
        self.assertEqual(report["clusters"]["connected_cluster_count"], 1)
        self.assertEqual(report["clusters"]["unique_example_count"], 3)
        self.assertEqual(report["clusters"]["groups"][0]["case_count"], 4)
        self.assertFalse(report["clusters"]["independence_established"])
        self.assertFalse(report["clusters"]["confidence_intervals_computed"])

    def test_condition_specific_references_preserve_different_target_languages(self):
        cases = [case(answer="B"), case(condition_id="bo_to_zh", answer="乙")]
        refs = [reference(condition_id="bo_to_bo"), reference(answer="乙", condition_id="bo_to_zh")]
        report = score_cases(cases, refs, study=study(cases, ["base"]))
        self.assertEqual(report["aggregate"]["strict_reference_match_count"], 2)
        with self.assertRaisesRegex(RecordsError, "Duplicate reference"):
            score_cases(cases, [refs[0], deepcopy(refs[0])], study=study(cases, ["base"]))

    def test_input_bindings_and_originals_are_preserved(self):
        cases = [case(), case(arm="adapter")]
        refs, plan = [reference()], study(cases)
        original = deepcopy((cases, refs, plan))
        report = score_cases(cases, refs, study=plan)
        self.assertEqual((cases, refs, plan), original)
        self.assertEqual(report["cases_sha256"], record_sha256(cases))
        self.assertEqual(report["study_sha256"], record_sha256(plan))
        for row in report["cases"]:
            item = next(item for item in cases if item["arm_id"] == row["arm_id"])
            self.assertEqual(row["result_sha256"], record_sha256(item["result"]))
            self.assertEqual(row["input_case_sha256"], record_sha256(item))
        self.assertEqual(report["aggregate"]["synthetic_case_count"], 2)
        self.assertFalse(any(report["claims"].values()))

    def test_model_card_does_not_infer_training_or_health_readiness(self):
        cases = [case()]
        report = score_cases(cases, [reference()], study=study(cases, ["base"]))
        card = build_model_card({"run_id": "fixture\n# forged headline", "outcome": "completed",
                                 "claims": {"health_correctness": True}}, report)
        self.assertIn("Completed updates: `not recorded`", card)
        self.assertIn("No release promotion", card)
        self.assertNotIn("\n# forged headline", card)
        self.assertIn("does not authenticate", card)

    def test_model_card_reads_release_training_and_wrapped_evaluation_facts(self):
        cases = [case()]
        scores = score_cases(cases, [reference()], study=study(cases, ["base"]))
        training = {"run_id": "released-training-fixture", "kind": "released_adapter_training",
            "outcome": "completed", "engineering_only": True, "release_sha256": "a" * 64,
            "config": {"model_identity": "fixture/model@revision"},
            "train": {"response": {"completed_steps": 20, "adapter_identity": "fixture-adapter",
                "evidence": {"base_unchanged": True, "changed_tensor_count": 4,
                    "validation_before": {"token_weighted_loss": 2.0},
                    "validation_after": {"token_weighted_loss": 1.5}}}},
            "reload": {"response": {"evidence": {"reload_verified": True, "validation_reload_verified": True}}}}
        card = build_model_card(training, {"kind": "release_evaluation_report", "run_id": "evaluation-fixture",
            "outcome": "completed", "engineering_only": True, "release_sha256": "a" * 64, "scoring": scores})
        self.assertIn("Completed updates: `20`", card)
        self.assertIn("Validation reload verified: `true`", card)
        self.assertIn("Validation assistant-token loss after training: `1.5`", card)
        self.assertIn("Planned evaluation cases: `1`", card)
        self.assertIn("Training engineering-only flag: `true`", card)
        self.assertIn("No release promotion", card)


if __name__ == "__main__":
    unittest.main()
