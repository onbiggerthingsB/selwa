"""Release-to-evaluation integration with synthetic fixtures and mocked models."""
from copy import deepcopy
from dataclasses import asdict
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from ht_tibetan.conditions import ENGINEERING_CONDITION
from ht_tibetan.evaluation import run_evaluation, validate_evaluation_config
from ht_tibetan.exposure_inventory import build_exposure_inventory
from ht_tibetan.inference import InferenceResult
from ht_tibetan.records import RecordsError, load_dataset
import test_releases as release_fixtures

CID = "qwen3-4b-mlx-4bit"
GID = "gemma3-4b-it-mlx-4bit"


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.release = release_fixtures.ReleaseTests()
        self.release.setUp()
        self.addCleanup(self.release.doCleanups)
        self.release.build()
        self.root = self.release.root
        self.output = self.root / "runs" / "test-evaluation"
        self.config_path = self.root / "evaluation.json"
        self.lock_path = self.root / "models.json"
        self.config = {"schema_version": "1.0", "run_id": "test-evaluation", "purpose": "final_test",
            "conditions": [deepcopy(ENGINEERING_CONDITION)], "arms": [
                {"candidate_id": CID, "arm_id": "base", "checkpoint_dir": None},
                {"candidate_id": CID, "arm_id": "adapter", "checkpoint_dir": str(self.root / "checkpoint")}],
            "example_ids": ["fixture-example-3"], "seed": 0, "timeout_seconds": 30}
        self.lock = {"schema_version": "1.0", "candidates": [
            {"candidate_id": cid, "repository": "synthetic/" + cid, "revision": "a" * 40} for cid in (CID, GID)]}
        self.verifier = Mock(return_value={"valid": True})
        self.loader = Mock(return_value=object())
        self.renderer = Mock(side_effect=lambda messages, tokenizer, **kwargs: {
            "rendered_text": messages[0]["content"], "input_ids": [1, 2, 3]})
        self.checkpoint = Mock(return_value={"adapter_identity": "sha256:" + "b" * 64,
            "checkpoint_hashes": {"adapters.safetensors": "b" * 64}, "config": {}})
        self.backend = Mock(side_effect=self.success)

    def success(self, request, **kwargs):
        self.assertTrue((self.output / "exposure.001.json").is_file())
        self.assertTrue((self.output / "started.json").is_file())
        adapter = "sha256:" + "b" * 64 if kwargs["checkpoint_dir"] else None
        answer = "The cup is green."
        return {"result": asdict(InferenceResult(request.run_id, "success", answer, "stop",
            kwargs["model_identity"], adapter_identity=adapter, input_tokens=3, output_tokens=5,
            elapsed_seconds=.2)), "raw_output": answer, "measurements": {}}

    def run_case(self, *, study=None):
        self.config_path.write_text(json.dumps(self.config))
        self.lock_path.write_text(json.dumps(self.lock))
        study_path = None
        if study is not None:
            study_path = self.root / 'study.json'
            study_path.write_text(json.dumps(study))
        return run_evaluation(self.release.output, self.release.permissions_path, self.config_path,
            self.lock_path, self.root, self.output, backend=self.backend, tokenizer_loader=self.loader,
            renderer=self.renderer, snapshot_verifier=self.verifier, checkpoint_verifier=self.checkpoint,
            study_path=study_path)

    def test_complete_paired_run_reserves_test_and_preserves_identity(self):
        from ht_tibetan.evaluation_plan import build_evaluation_plan
        plan = build_evaluation_plan(self.config)
        result = self.run_case()
        self.assertEqual(result["outcome"], "completed", result)
        report = load_dataset(self.output / "report.json")
        self.assertEqual(len(report["planned_cases"]), 2)
        self.assertEqual([case["case_id"] for case in report["cases"]],
                         [case["case_id"] for case in plan["planned_cases"]])
        self.assertEqual({case["arm_id"] for case in report["cases"]}, {"base", "adapter"})
        self.assertTrue(report["scoring"]["complete"])
        self.assertTrue(report["engineering_only"])
        self.assertEqual(report["native_review_status"], "pending")
        self.assertFalse(report["production_promotion"])
        self.assertEqual(self.backend.call_count, 2)
        self.assertEqual(self.backend.call_args_list[0].args[0].prompt, self.backend.call_args_list[1].args[0].prompt)
        inventory = build_exposure_inventory(self.root / "runs")
        self.assertTrue(inventory["valid"], inventory)
        self.assertTrue(any("final_test" in item["exposures"] for item in inventory["entries"]))

    def test_final_test_cannot_be_run_again_as_unseen(self):
        self.run_case()
        self.output = self.root / "runs" / "second-evaluation"
        self.loader.reset_mock()
        with self.assertRaisesRegex(RecordsError, "test_already_exposed"):
            self.run_case()
        self.loader.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_wrong_adapter_identity_is_failed_and_kept_in_denominator(self):
        def substitute(request, **kwargs):
            result = self.success(request, **kwargs)
            if kwargs["checkpoint_dir"]:
                result["result"]["adapter_identity"] = None
            return result
        self.backend.side_effect = substitute
        result = self.run_case()
        self.assertEqual(result["outcome"], "failed")
        report = load_dataset(self.output / "report.json")
        self.assertEqual(len(report["scoring"]["cases"]), 2)
        self.assertEqual(report["cases"][1]["result"]["outcome"], "runtime_failure")

    def test_output_limit_cannot_be_reported_as_complete_success(self):
        def truncate(request, **kwargs):
            result = self.success(request, **kwargs)
            result["result"]["termination_reason"] = "output_limit"
            return result
        self.backend.side_effect = truncate
        self.assertEqual(self.run_case()["outcome"], "failed")
        self.assertTrue(all(case["result"]["outcome"] == "runtime_failure"
                            for case in load_dataset(self.output / "report.json")["cases"]))

    def test_snapshot_failure_finalizes_history_and_scores_missing_cases(self):
        self.verifier.return_value = {"valid": False}
        result = self.run_case()
        self.assertEqual(result["outcome"], "failed")
        self.loader.assert_not_called()
        self.backend.assert_not_called()
        report = load_dataset(self.output / "report.json")
        self.assertEqual(len(report["scoring"]["cases"]), 2)
        self.assertTrue(build_exposure_inventory(self.root / "runs")["valid"])

    def test_declared_model_specific_budgets_reach_each_candidate(self):
        self.config["arms"] = [{"candidate_id": cid, "arm_id": "base", "checkpoint_dir": None} for cid in (CID, GID)]
        self.config["conditions"][0]["max_output_tokens_by_candidate"] = {CID: 12, GID: 24}
        self.run_case()
        self.assertEqual([call.args[0].max_output_tokens for call in self.backend.call_args_list], [12, 24])

    def test_overlong_prompt_is_refused_without_truncation(self):
        self.config["conditions"][0]["context_limit_tokens"] = 40
        self.renderer.side_effect = lambda messages, tokenizer, **kwargs: {"rendered_text": messages[0]["content"], "input_ids": list(range(20))}
        result = self.run_case()
        self.assertEqual(result["outcome"], "failed")
        self.backend.assert_not_called()
        self.assertTrue(all(case["result"]["outcome"] == "context_overflow"
                            for case in load_dataset(self.output / "report.json")["cases"]))

    def test_bad_reference_contract_is_refused_before_reservation(self):
        self.config["conditions"][0]["task_answer_kind"] = "source_span"
        with self.assertRaisesRegex(RecordsError, "not an exact span"):
            self.run_case()
        self.assertFalse(self.output.exists())
        self.loader.assert_not_called()

    def test_real_study_and_target_errors_stop_before_exposure_or_model_loading(self):
        from ht_tibetan.releases import verify_release
        from test_study import study_fixture
        # This mock exercises the real-study branch on fabricated structural data;
        # it does not create a real-material release or authorize these examples.
        verified = verify_release(self.release.output, root=self.root,
            permissions_path=self.release.permissions_path, purposes=['final_test'])
        verified['manifest']['engineering_only'] = False
        self.config['arms'] = self.config['arms'][:1]
        for problem in ('instruction', 'reference', 'pilot'):
            study = study_fixture()
            self.config['conditions'] = [deepcopy(study['condition'])]
            self.config['purpose'] = 'final_test'
            expected = 'outside the reviewed task labels'
            if problem == 'instruction':
                study['condition'].update(instruction_review='unreviewed')
                study['condition'].pop('instruction_review_sha256')
                self.config['conditions'] = [deepcopy(study['condition'])]
                expected = 'preregistered'
            elif problem == 'pilot':
                self.config['purpose'] = 'development_screen'
                expected = 'pilot_cases_not_planned'
            with self.subTest(problem=problem), patch('ht_tibetan.releases.verify_release', return_value=verified), \
                 self.assertRaisesRegex(RecordsError, expected):
                self.run_case(study=study)
            self.verifier.assert_not_called()
            self.loader.assert_not_called()
            self.backend.assert_not_called()
            self.assertFalse(self.output.exists())

    def test_unbalanced_arms_mixed_output_language_and_invalid_deadline_refused(self):
        original = deepcopy(self.config)
        variants = []
        variant = deepcopy(original)
        variant["arms"].append({"candidate_id": GID, "arm_id": "base", "checkpoint_dir": None})
        variants.append(variant)
        variant = deepcopy(original)
        variant["conditions"].append({**deepcopy(ENGINEERING_CONDITION), "condition_id": "another", "output_language": "bo"})
        variants.append(variant)
        variants.extend({**deepcopy(original), "timeout_seconds": timeout} for timeout in (301, float("nan"), True))
        for variant in variants:
            with self.subTest(variant=variant), self.assertRaises(RecordsError):
                validate_evaluation_config(variant)

    def test_review_metadata_keeps_actual_instruction_and_source(self):
        self.run_case()
        case = load_dataset(self.output / "report.json")["cases"][0]
        self.assertEqual(case["instruction_language"], "en")
        self.assertEqual(case["source_text"], "A green cup is on the shelf.")
        self.assertEqual(case["question"], "What color is the cup?")
        self.assertTrue(case["messages"][0]["content"].startswith(ENGINEERING_CONDITION["instruction_text"]))
