"""Portable synthetic artifacts only; no community, human review or MLX claims."""
from copy import deepcopy
from dataclasses import asdict
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ht_tibetan.artifacts import hash_file
from ht_tibetan.conditions import ENGINEERING_CONDITION, condition_identity, task_messages
from ht_tibetan.evaluation_scoring import score_cases
from ht_tibetan.inference import InferenceResult
from ht_tibetan.records import RecordsError, atomic_write_json, content_sha256, load_dataset, record_sha256
from ht_tibetan.study import (analyze_agreement, analyze_evaluation_reviews, blank_study,
    export_evaluation_review, load_evaluation_review, record_model_decision, validate_study, verify_model_selection)

CID = "qwen3-4b-mlx-4bit"
OTHER = "gemma3-4b-it-mlx-4bit"


def study_fixture():
    condition = {**deepcopy(ENGINEERING_CONDITION), "task_answer_kind": "exact_label",
        "budget_basis": "reviewed_task_budget", "instruction_review": "reviewed",
        "budget_evidence_sha256": "a" * 64, "instruction_review_sha256": "b" * 64}
    study = {"schema_version": "1.0", "kind": "tibetan_comprehension_study", "study_id": "test-study",
        "status": "preregistered", "evidence_kind": "human_review", "population": "Synthetic test declaration only",
        "writing_style": "Synthetic test declaration only", "condition": condition,
        "community": {"community_id": "fabricated-test-group", "description": "Synthetic test only", "language_variety": "Synthetic test only"},
        "first_task": {"task_id": "fabricated-test-task", "description": "Synthetic test only", "answer_kind": "exact_label",
            "labels": ["YES", "UNKNOWN"], "no_answer_label": "UNKNOWN", "review_criteria": "Synthetic criterion only"},
        "critical_failure_categories": [{"category_id": "number_changed", "definition": "Synthetic test category only"}],
        "pilot": {"planned_item_count": 10, "item_unit": "model_output_case", "minimum_reviewers": 2,
            "expected_item_ids": [f"test-evaluation-{index:04d}" for index in range(1, 11)]},
        "candidate_ids": [CID, OTHER], "clinical_review_available": False,
        "registered_by": "synthetic-operator", "registered_at": "2026-01-01T00:00:00Z"}
    config = {"schema_version": "1.0", "run_id": "test-evaluation", "purpose": "development_screen",
        "conditions": [condition], "arms": [{"candidate_id": cid, "arm_id": "base", "checkpoint_dir": None} for cid in (CID, OTHER)],
        "example_ids": [f"example-{index}" for index in range(5)], "seed": 0, "timeout_seconds": 20}
    study["development_config_sha256"] = record_sha256(config)
    return study


def pilot_fixture(count=10, reviewers=2):
    study = study_fixture()
    ids = study["pilot"]["expected_item_ids"][:count]
    return {"schema_version": "1.0", "kind": "reviewer_agreement_pilot", "pilot_id": "synthetic-pilot",
        "evidence_kind": "synthetic_test", "study_sha256": record_sha256(study), "planned_item_ids": ids,
        "reviewer_ids": [f"test-reviewer-{index}" for index in range(reviewers)], "critical_categories": ["number_changed"],
        "items": [{"item_id": item_id, "reviews": [{"reviewer_id": f"test-reviewer-{index}", "status": "complete",
            "independent": True, "blind_compromised": False, "ratings": {axis: 4 for axis in ("fidelity", "comprehension", "naturalness")},
            "critical_errors": {"number_changed": "absent"}, "minutes_spent": 2.0} for index in range(reviewers)]} for item_id in ids]}


class StudyValidationTests(unittest.TestCase):
    def test_blank_helper_does_not_fabricate_group_task_or_human_evidence(self):
        study = blank_study()
        self.assertTrue(validate_study(study)["valid"])
        self.assertFalse(validate_study(study)["ready_for_evaluation"])
        self.assertIsNone(study["community"])
        self.assertIsNone(study["first_task"])
        self.assertIsNone(study["development_config_sha256"])
        self.assertEqual(study["pilot"]["expected_item_ids"], [])
        self.assertFalse(study["clinical_review_available"])

    def test_draft_preserves_unknown_community_and_task_without_authorization(self):
        study = study_fixture()
        study.update(status="draft", community=None, first_task=None, condition=None, registered_at=None, registered_by=None)
        study["pilot"]["expected_item_ids"] = []
        before = deepcopy(study)
        result = validate_study(study)
        self.assertTrue(result["valid"])
        self.assertFalse(result["ready_for_evaluation"])
        self.assertIn("community", result["missing_preregistration_fields"])
        self.assertFalse(result["training_authorized"])
        self.assertEqual(study, before)

    def test_preregistered_study_requires_task_categories_and_ten_output_ids(self):
        study = study_fixture()
        self.assertTrue(validate_study(study)["ready_for_evaluation"])
        for modify in (lambda s: s.update(community=None), lambda s: s["pilot"]["expected_item_ids"].pop(),
                       lambda s: s.update(critical_failure_categories=[])):
            broken = deepcopy(study)
            modify(broken)
            self.assertFalse(validate_study(broken)["valid"])

    def test_constrained_answers_and_condition_must_match(self):
        study = study_fixture()
        study["first_task"]["labels"] = ["YES"]
        self.assertFalse(validate_study(study)["valid"])
        study = study_fixture()
        study["condition"]["task_answer_kind"] = "source_span"
        self.assertFalse(validate_study(study)["valid"])

    def test_real_preregistration_requires_reviewed_instruction_and_budget(self):
        for field, value, evidence in (("instruction_review", "unreviewed", "instruction_review_sha256"),
                                       ("instruction_review", "synthetic", "instruction_review_sha256"),
                                       ("budget_basis", "engineering_limit", "budget_evidence_sha256")):
            study = study_fixture()
            study["condition"][field] = value
            study["condition"].pop(evidence)
            with self.subTest(field=field, value=value):
                result = validate_study(study)
                self.assertFalse(result["valid"])
                self.assertFalse(result["ready_for_evaluation"])
                self.assertIn("condition." + field, result["missing_preregistration_fields"])
                study["status"] = "draft"
                draft = validate_study(study)
                self.assertTrue(draft["valid"])
                self.assertFalse(draft["ready_for_evaluation"])

    def test_synthetic_preregistration_can_keep_engineering_conditions(self):
        study = study_fixture()
        study["evidence_kind"] = "synthetic_test"
        study["condition"].update(instruction_review="synthetic", budget_basis="engineering_limit")
        study["condition"].pop("instruction_review_sha256")
        study["condition"].pop("budget_evidence_sha256")
        study.pop("development_config_sha256")
        self.assertTrue(validate_study(study)["ready_for_evaluation"])

    def test_real_preregistration_requires_exact_development_configuration_hash(self):
        for absent in (False, True):
            study = study_fixture()
            if absent:
                study.pop("development_config_sha256")
            else:
                study["development_config_sha256"] = None
            with self.subTest(absent=absent):
                result = validate_study(study)
                self.assertFalse(result["valid"])
                self.assertFalse(result["ready_for_evaluation"])
                self.assertIn("development_config_sha256", result["missing_preregistration_fields"])
                study["status"] = "draft"
                self.assertTrue(validate_study(study)["valid"])

    def test_configuration_hash_rejects_malformed_values(self):
        for value in ("a" * 63, "A" * 64, "g" * 64, 123, {}, "a" * 64 + "\n"):
            study = study_fixture()
            study["development_config_sha256"] = value
            with self.subTest(value=value):
                self.assertFalse(validate_study(study)["valid"])

    def test_unknown_fields_duplicate_categories_blank_text_and_nonfinite_fail(self):
        for modify in (lambda s: s.update(unknown=True), lambda s: s.update(population=" "),
                       lambda s: s["critical_failure_categories"].append(deepcopy(s["critical_failure_categories"][0])),
                       lambda s: s.update(population=float("nan"))):
            study = study_fixture()
            modify(study)
            self.assertFalse(validate_study(study)["valid"])


class AgreementTests(unittest.TestCase):
    def test_legacy_freeze_uses_verified_loader_and_keeps_absent_timing_unknown(self):
        study = study_fixture()
        freeze = {"evidence_kind": "human_review", "reviewer_ids": ["reader-1", "reader-2"],
            "excluded_cases": [], "candidate_counts": [], "connected_cluster_count": 5,
            "cases": [{"case_id": case_id, "reviews": [{"reviewer_id": reviewer,
                "ratings": {axis: 4 for axis in ("fidelity", "comprehension", "naturalness")}, "blind_compromised": False}
                for reviewer in ("reader-1", "reader-2")]} for case_id in study["pilot"]["expected_item_ids"]]}
        with patch("ht_tibetan.output_review.load_frozen_reviews", return_value=(freeze, "f" * 64)) as verified:
            report = analyze_agreement("/synthetic/freeze.json", study=study)
        verified.assert_called_once_with("/synthetic/freeze.json")
        self.assertIsNone(report["timing"]["recorded_minutes_total"])
        self.assertEqual(report["rating_agreement"]["fidelity"]["eligible_items"], 10)
        self.assertEqual(report["critical_error_agreement"]["number_changed"]["eligible_items"], 0)

    def test_legacy_timing_supplement_must_bind_exact_freeze_study_and_case(self):
        study = study_fixture()
        freeze = {"evidence_kind": "human_review", "reviewer_ids": ["reader-1", "reader-2"], "excluded_cases": [],
            "candidate_counts": [], "connected_cluster_count": 1, "cases": [{"case_id": study["pilot"]["expected_item_ids"][0],
            "reviews": [{"reviewer_id": reader, "ratings": {axis: 4 for axis in ("fidelity", "comprehension", "naturalness")},
                "blind_compromised": False} for reader in ("reader-1", "reader-2")]}]}
        sidecar = {"schema_version": "1.0", "kind": "reviewer_pilot_supplement", "study_sha256": record_sha256(study),
            "freeze_file_sha256": "f" * 64, "evidence_kind": "human_review", "entries": [{
                "case_id": study["pilot"]["expected_item_ids"][0], "reviewer_id": "reader-1", "minutes_spent": 1.5,
                "critical_errors": {"number_changed": "absent"}}]}
        with patch("ht_tibetan.output_review.load_frozen_reviews", return_value=(freeze, "f" * 64)):
            report = analyze_agreement("/synthetic/freeze.json", study=study, supplement=sidecar)
            self.assertEqual(report["timing"]["recorded_review_count"], 1)
            self.assertEqual(report["timing"]["missing_review_count"], 19)
            self.assertEqual(report["provenance"]["unrecorded_pilot_items"], study["pilot"]["expected_item_ids"][1:])
            sidecar["freeze_file_sha256"] = "0" * 64
            with self.assertRaisesRegex(RecordsError, "exact study, freeze"):
                analyze_agreement("/synthetic/freeze.json", study=study, supplement=sidecar)

    def test_constant_ratings_have_raw_agreement_but_undefined_kappa(self):
        report = analyze_agreement(pilot_fixture())
        axis = report["rating_agreement"]["fidelity"]
        self.assertEqual(axis["raw_agreement"], 1.0)
        self.assertIsNone(axis["cohen_kappa"])
        self.assertEqual(axis["kappa_unavailable_reason"], "constant_marginals_expected_agreement_one")
        self.assertEqual(report["timing"]["recorded_minutes_total"], 40)
        self.assertTrue(report["timing"]["complete_coverage"])
        self.assertFalse(report["training_authorized"])

    def test_kappa_uses_paired_marginals_and_not_ordinal_distance(self):
        pilot = pilot_fixture(count=4)
        for row, left, right in zip(pilot["items"], [1, 1, 4, 4], [1, 4, 4, 4]):
            row["reviews"][0]["ratings"]["fidelity"] = left
            row["reviews"][1]["ratings"]["fidelity"] = right
        report = analyze_agreement(pilot)
        self.assertEqual(report["rating_agreement"]["fidelity"]["raw_agreement"], 0.75)
        self.assertEqual(report["rating_agreement"]["fidelity"]["cohen_kappa"], 0.5)
        self.assertFalse(report["matches_ten_item_plan"])

    def test_missing_and_incomplete_reviews_keep_planned_denominator(self):
        pilot = pilot_fixture()
        pilot["items"].pop()
        pilot["items"][0]["reviews"].pop()
        pilot["items"][1]["reviews"][0]["status"] = "incomplete"
        report = analyze_agreement(pilot)
        self.assertEqual(report["planned_review_count"], 20)
        self.assertEqual(report["review_status_counts"]["missing"], 3)
        self.assertEqual(report["rating_agreement"]["comprehension"]["eligible_items"], 7)

    def test_blinding_independence_and_axis_nulls_are_explicit_exclusions(self):
        pilot = pilot_fixture()
        pilot["items"][0]["reviews"][0]["blind_compromised"] = True
        pilot["items"][1]["reviews"][0]["independent"] = False
        pilot["items"][2]["reviews"][0]["ratings"]["fidelity"] = None
        report = analyze_agreement(pilot)
        self.assertEqual(report["rating_agreement"]["fidelity"]["eligible_items"], 7)
        self.assertEqual(report["rating_agreement"]["comprehension"]["eligible_items"], 8)

    def test_missing_timings_and_unassessed_categories_are_never_zero(self):
        pilot = pilot_fixture()
        for item in pilot["items"]:
            for review in item["reviews"]:
                review["minutes_spent"] = None
                review["critical_errors"]["number_changed"] = "not_assessed"
        report = analyze_agreement(pilot)
        self.assertIsNone(report["timing"]["recorded_minutes_total"])
        self.assertEqual(report["timing"]["missing_review_count"], 20)
        self.assertIsNone(report["critical_error_agreement"]["number_changed"]["raw_agreement"])
        self.assertEqual(report["critical_error_agreement"]["number_changed"]["judgment_counts"]["absent"], 0)

    def test_more_than_two_reviewers_reports_unanimity_without_kappa(self):
        report = analyze_agreement(pilot_fixture(reviewers=3))
        self.assertEqual(report["rating_agreement"]["fidelity"]["raw_agreement"], 1)
        self.assertEqual(report["rating_agreement"]["fidelity"]["kappa_unavailable_reason"], "requires_exactly_two_reviewers")

    def test_duplicate_unknown_boolean_ratings_and_negative_times_fail(self):
        for modify in (lambda p: p["items"].append(deepcopy(p["items"][0])),
                       lambda p: p["items"][0]["reviews"][0]["ratings"].update(fidelity=True),
                       lambda p: p["items"][0]["reviews"][0].update(minutes_spent=-1),
                       lambda p: p["items"][0]["reviews"][0]["critical_errors"].update(number_changed="unknown")):
            pilot = pilot_fixture()
            modify(pilot)
            with self.assertRaises(RecordsError):
                analyze_agreement(pilot)

    def test_report_is_stable_and_does_not_mutate_ratings(self):
        pilot = pilot_fixture()
        before = deepcopy(pilot)
        self.assertEqual(analyze_agreement(pilot), analyze_agreement(pilot))
        self.assertEqual(pilot, before)


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.run = self.root / "run"
        self.run.mkdir()
        self.study = study_fixture()
        self.study_path = self.root / "study.json"
        atomic_write_json(self.study_path, self.study)
        self.report_path = self.run / "report.json"
        self.keys = {}
        self.make_evaluation()

    def write(self, path, value):
        path.write_text(__import__("json").dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        path.chmod(0o600)

    def inventory(self):
        manifest = load_dataset(self.run / "manifest.json")
        manifest["report_sha256"] = hash_file(self.report_path)
        manifest["artifact_inventory"] = [{"path": path.name, "sha256": hash_file(path), "bytes": path.stat().st_size}
            for path in sorted(self.run.iterdir()) if path.is_file() and path.name != "manifest.json"]
        self.write(self.run / "manifest.json", manifest)

    def make_evaluation(self, *, engineering=False):
        condition = self.study["condition"]
        config = {"schema_version": "1.0", "run_id": "test-evaluation", "purpose": "development_screen",
            "conditions": [condition], "arms": [{"candidate_id": cid, "arm_id": "base", "checkpoint_dir": None} for cid in (CID, OTHER)],
            "example_ids": [f"example-{index}" for index in range(5)], "seed": 0, "timeout_seconds": 20}
        planned = [{"candidate_id": cid, "arm_id": "base", "condition_id": condition["condition_id"],
            "instruction_language": "en", "example_id": eid} for eid in config["example_ids"] for cid in (CID, OTHER)]
        candidates = [{"candidate_id": cid, "arm_id": "base", "model_identity": f"fixture/{cid}@" + "a" * 40, "adapter_identity": None} for cid in (CID, OTHER)]
        cases = []
        for sequence, job in enumerate(planned, 1):
            case_id = f"test-evaluation-{sequence:04d}"
            identity = next(item["model_identity"] for item in candidates if item["candidate_id"] == job["candidate_id"])
            case = {**job, **condition_identity(condition), "case_id": case_id, "model_identity": identity, "adapter_identity": None,
                "source_id": "source-" + job["example_id"], "source_sha256": content_sha256("A synthetic box is blue."),
                "source_text": "A synthetic box is blue.", "question": "Synthetic fixture question?",
                "scenario_group": "scenario-" + job["example_id"], "contributor_id": "synthetic-author",
                "source_contributor_ids": ["synthetic-source-author"], "example_contributor_ids": ["synthetic-author", "synthetic-coauthor"],
                "example_sha256": "e" * 64, "task_answer_kind": "exact_label", "attempted": True,
                "messages": task_messages({"original_text": "A synthetic box is blue."}, {"question": "Synthetic fixture question?"}, condition),
                "result": asdict(InferenceResult(case_id, "success", "YES", "eos", identity, input_tokens=3, output_tokens=1, synthetic=engineering)),
                "raw_output": "YES", "measurements": {}}
            case["case_sha256"] = record_sha256(case)
            cases.append(case)
            self.write(self.run / f"case.{sequence:04d}.result.json", case)
        references = [{"example_id": eid, "approved_answer": "YES", "task_answer_kind": "exact_label"} for eid in config["example_ids"]]
        self.report = {"schema_version": "1.0", "kind": "release_evaluation_report", "outcome": "completed",
            "run_id": "test-evaluation", "engineering_only": engineering, "release_sha256": "r" * 64,
            "study_sha256": record_sha256(self.study), "purpose": config["purpose"], "conditions": [condition],
            "condition_identities": [condition_identity(condition)], "planned_cases": planned, "cases": cases,
            "scoring": score_cases(cases, references, study={"planned_cases": planned, "expected_arms": ["base"]}), "error": None,
            "native_review_status": "pending", "clinical_approval": False, "production_promotion": False,
            "comparison_budgets_reviewed": True, "candidates": candidates}
        self.write(self.report_path, self.report)
        manifest = {"schema_version": "1.0", "kind": "release_evaluation", "run_id": "test-evaluation", "outcome": "running",
            "config": config, "created_at": "2026-01-02T00:00:00Z", "release_sha256": "r" * 64,
            "engineering_only": engineering, "study_sha256": record_sha256(self.study), "planned_cases": planned, "cases": []}
        self.write(self.run / "started.json", manifest)
        manifest.update(outcome="completed", finished_at="2026-01-03T00:00:00Z",
            cases=[{"case_id": case["case_id"], "case_sha256": case["case_sha256"], "outcome": "success"} for case in cases])
        self.write(self.run / "manifest.json", manifest)
        self.inventory()

    def packet(self, reviewer, *, complete=True, blinded=False):
        # Deliberately fabricated human-review labels exercise rejection branches;
        # these temporary unit-test ratings are never study evidence.
        from ht_tibetan.study import _review_template
        packet = _review_template(self.report, self.report_path, hash_file(self.report_path), reviewer, self.study)
        key = None
        if blinded:
            from ht_tibetan.evaluation_review_blinding import blind_packet
            packet, key = blind_packet(packet)
        if complete:
            packet.update(status="complete", independent=True)
            for row in packet["items"]:
                row.update(status="complete", ratings={axis: 4 for axis in ("fidelity", "comprehension", "naturalness")},
                    critical_errors={"number_changed": "absent"}, minutes_spent=1)
            for row in packet["candidate_decisions"]:
                row.update(recommendation="approve", rationale="Synthetic unit-test declaration only.")
        path = self.root / (reviewer + ".json")
        atomic_write_json(path, packet)
        if key is not None:
            key_path = self.root / (reviewer + ".key.json")
            atomic_write_json(key_path, key)
            self.keys[str(path)] = str(key_path)
        return path

    def decision(self, paths):
        return {"decision_id": "synthetic-decision", "selected_candidate_id": CID,
            "study_sha256": record_sha256(self.study), "evaluation_report_sha256": hash_file(self.report_path),
            "review_paths": [str(path) for path in paths], "review_keys": [self.keys.get(str(path)) for path in paths], "reviewed_by": "synthetic-operator",
            "reviewed_at": "2026-01-04T00:00:00Z", "user_reviewed": True,
            "rationale": "Synthetic unit-test decision only.", "criteria_reviewed": "Synthetic criterion only.", "pilot_reviewed": True}

    def test_review_load_preserves_missing_judgments_and_exact_outputs(self):
        path = self.packet("reader-1", complete=False)
        packet, _ = load_evaluation_review(path, study=self.study)
        self.assertEqual(packet["status"], "incomplete")
        self.assertIsNone(packet["items"][0]["minutes_spent"])
        self.assertEqual(packet["items"][0]["source_text"], self.report["cases"][0]["source_text"])
        self.assertTrue(packet["items"][0]["blind_compromised"])

    def test_actual_artifact_bound_reviews_support_explicit_selection_and_reverification(self):
        paths = [self.packet("reader-1", blinded=True), self.packet("reader-2", blinded=True)]
        receipt = record_model_decision(self.study_path, self.report_path, self.decision(paths))
        self.assertEqual(receipt["selected_candidate_id"], CID)
        self.assertFalse(receipt["training_authorized"])
        self.assertEqual(receipt["pilot_report"]["timing"]["recorded_minutes_total"], 20)
        self.assertTrue(receipt["pilot_report"]["provenance"]["blinded"])
        self.assertEqual(receipt["pilot_report"]["rating_agreement"]["fidelity"]["eligible_items"], 10)
        self.assertEqual(receipt["pilot_report"]["unblinded_independent_rating_agreement"]["fidelity"]["eligible_items"], 10)
        receipt_path = self.root / "receipt.json"
        atomic_write_json(receipt_path, receipt)
        verified = verify_model_selection(self.study_path, receipt_path, CID, model_identity=receipt["selected_model_identity"])
        self.assertTrue(verified["valid"])
        self.assertEqual(verified["condition"], self.study["condition"])
        with self.assertRaisesRegex(RecordsError, "revision"):
            verify_model_selection(self.study_path, receipt_path, CID, model_identity="wrong@" + "a" * 40)

    def test_public_pilot_analysis_does_not_select_and_preserves_unblinded_status(self):
        paths = [self.packet("reader-1"), self.packet("reader-2")]
        result = analyze_evaluation_reviews(self.study, paths, self.report_path)
        self.assertIsNone(result["model_selected"])
        self.assertFalse(result["provenance"]["blinded"])
        self.assertEqual(result["comparison_case_counts"], {"planned": 10, "recorded": 10, "successful": 10})
        self.assertEqual(result["unblinded_independent_rating_agreement"]["comprehension"]["eligible_items"], 10)

    def test_blank_returned_packets_are_descriptive_with_no_invented_ratings_or_time(self):
        paths = [self.packet("reader-1", complete=False), self.packet("reader-2", complete=False)]
        result = analyze_evaluation_reviews(self.study, paths, self.report_path)
        self.assertEqual(result["planned_review_count"], 20)
        self.assertEqual(result["review_status_counts"]["incomplete"], 20)
        self.assertEqual(result["review_status_counts"]["not_independent"], 20)
        self.assertEqual(result["rating_agreement"]["fidelity"]["eligible_items"], 0)
        self.assertIsNone(result["timing"]["recorded_minutes_total"])
        self.assertEqual(result["timing"]["missing_review_count"], 20)
        self.assertIsNone(result["model_selected"])

    def test_partial_ratings_preserve_ineligible_item_and_unknown_time(self):
        paths = [self.packet("reader-1", blinded=True), self.packet("reader-2", blinded=True)]
        packet = load_dataset(paths[0])
        packet["status"] = "incomplete"
        packet["items"][0].update(status="incomplete", minutes_spent=None)
        packet["items"][0]["ratings"]["fidelity"] = None
        self.write(paths[0], packet)
        result = analyze_evaluation_reviews(self.study, paths, self.report_path,
            review_keys=[self.keys[str(path)] for path in paths])
        self.assertEqual(result["planned_review_count"], 20)
        self.assertEqual(result["review_status_counts"]["incomplete"], 1)
        self.assertEqual(result["rating_agreement"]["fidelity"]["eligible_items"], 9)
        self.assertEqual(result["timing"]["missing_review_count"], 1)
        with self.assertRaisesRegex(RecordsError, "reviews complete"):
            record_model_decision(self.study, self.report_path, self.decision(paths))

    def test_failed_generation_stays_in_pilot_denominator_without_a_fake_review_row(self):
        case = self.report["cases"][-1]
        case["result"] = asdict(InferenceResult(case["case_id"], "runtime_failure", None, "output_limit",
            case["model_identity"], input_tokens=3, output_tokens=32))
        case["raw_output"] = "A retained partial diagnostic."
        case["case_sha256"] = record_sha256({key: value for key, value in case.items() if key != "case_sha256"})
        self.write(self.run / "case.0010.result.json", case)
        self.report.update(outcome="failed", error="A fabricated output-limit test failure.")
        refs = [{"example_id": eid, "approved_answer": "YES", "task_answer_kind": "exact_label"}
                for eid in {item["example_id"] for item in self.report["planned_cases"]}]
        self.report["scoring"] = score_cases(self.report["cases"], refs,
            study={"planned_cases": self.report["planned_cases"], "expected_arms": ["base"]})
        self.write(self.report_path, self.report)
        manifest = load_dataset(self.run / "manifest.json")
        manifest["outcome"] = "failed"
        manifest["cases"][-1].update(case_sha256=case["case_sha256"], outcome="runtime_failure")
        self.write(self.run / "manifest.json", manifest)
        self.inventory()
        paths = [self.packet("reader-1", blinded=True), self.packet("reader-2", blinded=True)]
        result = analyze_evaluation_reviews(self.study, paths, self.report_path,
            review_keys=[self.keys[str(path)] for path in paths])
        self.assertEqual(result["planned_review_count"], 20)
        self.assertEqual(result["observed_item_count"], 9)
        self.assertEqual(result["review_status_counts"]["missing"], 2)
        self.assertEqual(result["rating_agreement"]["fidelity"]["eligible_items"], 9)
        self.assertEqual(result["comparison_case_counts"], {"planned": 10, "recorded": 10, "successful": 9})
        self.assertEqual(result["pilot_generation_failures"], [{"case_id": case["case_id"],
            "outcome": "runtime_failure", "termination_reason": "output_limit"}])
        with self.assertRaisesRegex(RecordsError, "completed real-material"):
            record_model_decision(self.study, self.report_path, self.decision(paths))

    def test_final_test_selection_is_rejected_before_reading_report_answers(self):
        manifest = load_dataset(self.run / "manifest.json")
        manifest["config"]["purpose"] = "final_test"
        self.write(self.run / "manifest.json", manifest)
        with patch("ht_tibetan.study._evaluation") as payload:
            with self.assertRaisesRegex(RecordsError, "development_screen"):
                record_model_decision(self.study, self.report_path, self.decision([]))
        payload.assert_not_called()

    def test_selection_rejects_remapped_case_ids_before_reading_report_answers(self):
        original = load_dataset(self.run / "manifest.json")
        for field in ("example_ids", "arms"):
            manifest = deepcopy(original)
            manifest["config"][field].reverse()
            self.write(self.run / "manifest.json", manifest)
            with self.subTest(field=field), patch("ht_tibetan.study._evaluation") as payload:
                with self.assertRaisesRegex(RecordsError, "preregistered development configuration"):
                    record_model_decision(self.study, self.report_path, self.decision([]))
                payload.assert_not_called()

    def test_posthoc_study_change_cannot_reuse_an_old_comparison(self):
        paths = [self.packet("reader-1"), self.packet("reader-2")]
        changed = deepcopy(self.study)
        changed["first_task"]["review_criteria"] += " Changed after the comparison."
        decision = self.decision(paths)
        decision["study_sha256"] = record_sha256(changed)
        with self.assertRaisesRegex(RecordsError, "originally bound"):
            record_model_decision(changed, self.report_path, decision)

    def test_numeric_summary_cannot_replace_immutable_reviewed_report(self):
        with self.assertRaisesRegex(RecordsError, "numeric summary"):
            record_model_decision(self.study, {"completed": True, "score": 1}, self.decision([]))

    def test_two_unanimous_candidate_rejections_cannot_select_unchanged_candidate(self):
        paths = [self.packet("reader-1", blinded=True), self.packet("reader-2", blinded=True)]
        for path in paths:
            packet = load_dataset(path)
            for row in packet["candidate_decisions"]:
                row["recommendation"] = "reject"
            self.write(path, packet)
        with self.assertRaisesRegex(RecordsError, "Unchanged unanimous"):
            record_model_decision(self.study, self.report_path, self.decision(paths))
        packet = load_dataset(paths[0])
        for row in packet["candidate_decisions"]:
            row["recommendation"] = "approve"
        self.write(paths[0], packet)
        self.assertEqual(record_model_decision(self.study, self.report_path, self.decision(paths))["status"], "recorded")

    def test_missing_incomplete_duplicate_or_author_reviews_cannot_select(self):
        one = self.packet("reader-1", blinded=True)
        two = self.packet("reader-2", complete=False, blinded=True)
        for paths in ([one], [one, one], [one, two]):
            with self.subTest(paths=paths), self.assertRaises(RecordsError):
                record_model_decision(self.study, self.report_path, self.decision(paths))
        with self.assertRaisesRegex(RecordsError, "author"):
            self.packet("synthetic-author")
        for author in ("synthetic-source-author", "synthetic-coauthor"):
            with self.assertRaisesRegex(RecordsError, "author"):
                self.packet(author)

    def test_review_cannot_change_case_content_evidence_kind_or_claim_blinding(self):
        path = self.packet("reader-1")
        original = load_dataset(path)
        for modify in (lambda p: p["items"][0].update(answer="Changed"), lambda p: p.update(evidence_kind="synthetic_test"),
                       lambda p: p["items"][0].update(blind_compromised=False),
                       lambda p: p["items"][0]["critical_errors"].update(number_changed="not_assessed")):
            changed = deepcopy(original)
            modify(changed)
            self.write(path, changed)
            with self.assertRaises(RecordsError):
                load_evaluation_review(path, study=self.study)

    def test_tampered_result_report_or_inventory_fails_before_review(self):
        path = self.packet("reader-1")
        result = self.run / "case.0001.result.json"
        case = load_dataset(result)
        case["raw_output"] = "Changed"
        self.write(result, case)
        with self.assertRaisesRegex(RecordsError, "hash or size"):
            load_evaluation_review(path, study=self.study)
        self.inventory()
        with self.assertRaisesRegex(RecordsError, "immutable result"):
            load_evaluation_review(path, study=self.study)

    def test_synthetic_comparison_and_relabelled_synthetic_reviews_do_not_select(self):
        self.make_evaluation(engineering=True)
        paths = [self.packet("reader-1"), self.packet("reader-2")]
        with self.assertRaisesRegex(RecordsError, "real-material"):
            record_model_decision(self.study, self.report_path, self.decision(paths))

    def test_explicit_acknowledgment_preregistration_and_condition_binding_required(self):
        paths = [self.packet("reader-1", blinded=True), self.packet("reader-2", blinded=True)]
        for modify in (lambda d: d.update(user_reviewed=False), lambda d: d.update(pilot_reviewed=False),
                       lambda d: d.update(study_sha256="0" * 64), lambda d: d.update(reviewed_at="2025-01-01T00:00:00Z")):
            decision = self.decision(paths)
            modify(decision)
            with self.assertRaises(RecordsError):
                record_model_decision(self.study, self.report_path, decision)

    def test_real_review_export_requires_current_review_permissions(self):
        with self.assertRaisesRegex(RecordsError, "current permissions"):
            export_evaluation_review(self.report_path, "reader-1", self.root / "packet.json", study=self.study)
        self.assertFalse((self.root / "packet.json").exists())

    def test_engineering_review_export_remains_blank_and_synthetic(self):
        self.make_evaluation(engineering=True)
        output = self.root / "packet.json"
        result = export_evaluation_review(self.report_path, "reader-1", output, study=self.study)
        self.assertEqual(result["evidence_kind"], "synthetic_test")
        packet = load_dataset(output)
        self.assertFalse(packet["independent"])
        self.assertEqual(packet["candidate_decisions"][0]["recommendation"], "pending")
        self.assertIsNone(packet["items"][0]["ratings"]["comprehension"])

    def test_unblinded_or_compromised_reviews_cannot_select(self):
        unblinded = [self.packet("debug-1"), self.packet("debug-2")]
        with self.assertRaisesRegex(RecordsError, "sealed blinded"):
            record_model_decision(self.study, self.report_path, self.decision(unblinded))
        paths = [self.packet("reader-1", blinded=True), self.packet("reader-2", blinded=True)]
        packet = load_dataset(paths[0])
        packet["items"][0]["blind_compromised"] = True
        self.write(paths[0], packet)
        with self.assertRaisesRegex(RecordsError, "Compromised"):
            record_model_decision(self.study, self.report_path, self.decision(paths))

    def test_blinded_export_keeps_sealed_key_outside_reviewer_directory(self):
        self.make_evaluation(engineering=True)
        output, key = self.root / "reviewer" / "packet.json", self.root / "operator" / "key.json"
        result = export_evaluation_review(self.report_path, "reader-1", output, key_path=key, study=self.study)
        self.assertTrue(result["blinded"])
        public = load_dataset(output)
        self.assertNotIn("evaluation_report_path", public)
        self.assertNotIn(CID, __import__("json").dumps(public))
        restored, _ = load_evaluation_review(output, key_path=key, study=self.study)
        self.assertEqual(restored["items"][0]["case_id"], self.report["cases"][0]["case_id"])
        self.assertFalse(restored["items"][0]["blind_compromised"])
        self.assertEqual(key.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(RecordsError):
            load_evaluation_review(output, study=self.study)


if __name__ == "__main__":
    unittest.main()
