"""Contract and interruption tests using synthetic English fixtures, never MLX."""
from copy import deepcopy
from dataclasses import asdict
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from ht_tibetan.baseline import (check_eligibility, conversation_for, run_baseline,
                                 validate_config)
from ht_tibetan.inference import InferenceResult
from ht_tibetan.records import (RecordsError, atomic_write_json, example_sha256,
                                load_dataset, require_valid_dataset)

FIXTURE = Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "synthetic-dataset.json"
CID = "qwen3-4b-mlx-4bit"


def permission_contract_stub(dataset):
    """Exercise the recorded-permission branch; this is not real human consent."""
    from test_contribution_permissions import synthetic_permissions
    permissions = synthetic_permissions(dataset)
    permissions["evidence_kind"] = "operator_recorded"
    permissions["source_contributors"] = []
    for index, source in enumerate(dataset["sources"]):
        contributor_id = f"contract-source-author-{index}"
        binding = {"source_id": source["source_id"], "source_version": source["version"],
                   "source_sha256": source["content_sha256"]}
        permissions["source_contributors"].append({**binding, "contributor_ids": [contributor_id]})
        permissions["grants"].append({**binding, "grant_id": f"contract-source-grant-{index}",
            "revision": 1, "supersedes_grant_id": None, "contributor_id": contributor_id,
            "contribution_kind": "source_text", "contribution_fields": ["original_text"],
            "permitted_uses": ["development_screen", "private_research", "review"],
            "status": "active", "evidence_ref": "synthetic-contract-evidence-only",
            "recorded_at": "2026-09-04T12:00:00Z", "granted_at": "2026-09-04T10:00:00Z",
            "expires_at": None})
    return permissions


class BaselineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name).resolve() / "runs"
        self.directory.mkdir()
        self.dataset = load_dataset(FIXTURE)
        self.permissions = None
        self.config = {"schema_version": "1.0", "run_id": "contract-test", "purpose": "infrastructure_smoke",
            "candidate_ids": [CID], "example_ids": ["fixture-example-1", "fixture-example-2"],
            "max_output_tokens": 16, "context_limit_tokens": 64, "timeout_seconds": 20,
            "seed": 0, "temperature": 0.0, "reasoning_mode": "disabled", "contributor_policy": "report",
            "community_id": None, "task_id": None, "review_criteria": None}
        self.lock = {"schema_version": "1.0", "candidates": [
            {"candidate_id": CID, "revision": "a" * 40, "repository": "fixture/locked-model"}]}
        self.verifier = Mock(return_value={"valid": True, "errors": [], "identity": {"candidate_id": CID}})
        self.loader = Mock(return_value=object())
        self.renderer = Mock(side_effect=lambda messages, tokenizer, **kw: {
            "rendered_text": messages[0]["content"], "input_ids": [10, 20, 30],
            "chat_template_utf8_sha256": "b" * 64, "reasoning": {"verified": True}})
        self.calls = []

    def success(self, request, **kwargs):
        self.calls.append((request, kwargs))
        return {"result": asdict(InferenceResult(request.run_id, "success", "Synthetic test output.",
            "eos", kwargs["model_identity"], input_tokens=len(kwargs["prompt_token_ids"]), output_tokens=4)),
            "raw_output": "Synthetic test output.", "measurements": {"load_seconds": 0.1}}

    def run_case(self, backend=None, output_dir=None, **overrides):
        for name, value in (("dataset", self.dataset), ("config", self.config), ("lock", self.lock)):
            path = self.directory / (name + ".json")
            if not path.exists():
                atomic_write_json(path, value)
        if self.permissions is not None:
            permissions_path = self.directory / "permissions.json"
            if not permissions_path.exists():
                atomic_write_json(permissions_path, self.permissions)
            overrides.setdefault("permissions_path", permissions_path)
        return run_baseline(self.directory / "dataset.json", self.directory / "config.json",
            self.directory / "lock.json", self.directory.parent, output_dir or self.directory / "run",
            backend=backend or self.success, tokenizer_loader=self.loader, renderer=self.renderer,
            snapshot_verifier=self.verifier, **overrides)

    def approved_contract_stub(self):
        # These deliberate labels exercise provenance validation only. The underlying
        # English fixture is not an actual Tibetan source or completed human review.
        self.config.update(purpose="language_baseline", community_id="contract-community",
                           task_id="contract-task", review_criteria="Synthetic contract criteria; not a real study.")
        for source in self.dataset["sources"]:
            source.update(source_kind="community", language="bo", language_review="approved")
        for index, example in enumerate(self.dataset["examples"]):
            example.update(review_state="approved", approved_answer="Fixture reference must never reach the model.")
            checksum = example_sha256(example)
            ids = []
            for reviewer in (1, 2):
                rid = f"contract-review-{index}-{reviewer}"
                ids.append(rid)
                self.dataset["reviews"].append({"review_id": rid, "example_id": example["example_id"],
                    "example_version": 1, "example_sha256": checksum, "source_sha256": example["source_sha256"],
                    "reviewer_id": f"contract-reviewer-{reviewer}", "reviewer_role": "language_reviewer",
                    "review_type": "language", "ratings": {"naturalness": 4, "fidelity": 4, "comprehension": 4},
                    "issues": [], "minutes_spent": 2, "status": "complete", "recommendation": "approve",
                    "revision": 1, "supersedes_review_id": None})
            self.dataset["adjudications"].append({"adjudication_id": f"contract-adjudication-{index}",
                "example_id": example["example_id"], "example_version": 1, "example_sha256": checksum,
                "review_ids": ids, "adjudicator_id": "contract-adjudicator", "decision": "approve",
                "language_review": "approved", "medical_review": "not_applicable",
                "rationale": "Synthetic contract fixture only.", "minutes_spent": 1})

    def test_smoke_records_generation_without_quality_claim_and_preserves_input(self):
        original = deepcopy(self.dataset)
        manifest = self.run_case()
        self.assertEqual(manifest["outcome"], "completed")
        self.assertEqual(manifest["evidence_type"], "infrastructure_smoke")
        self.assertIn("Tibetan comprehension", manifest["not_measured"])
        self.assertEqual(manifest["attempted_case_count"], 2)
        self.assertEqual(self.dataset, original)
        self.assertEqual(load_dataset(self.directory / "dataset.json"), original)
        first = load_dataset(self.directory / "run" / "exposed-dataset.001.json")
        self.assertEqual(first["examples"][0]["exposures"], ["development_screen"])
        self.assertEqual(first["examples"][1]["exposures"], [])
        self.assertTrue(any(item["name"] == "ht_tibetan/baseline.py" for item in manifest["code"]["files"]))
        self.assertEqual(self.calls[0][1]["prompt_token_ids"], [10, 20, 30])
        self.assertIn("@" + "a" * 40, self.calls[0][1]["model_identity"])
        with self.assertRaises(FileExistsError):
            self.run_case()
        self.assertEqual(len(self.calls), 2)

    def test_reference_answer_and_allowed_claims_are_excluded_from_every_prompt(self):
        self.approved_contract_stub()
        self.permissions = permission_contract_stub(self.dataset)
        require_valid_dataset(self.dataset)
        for example in self.dataset["examples"]:
            message = conversation_for(self.dataset["sources"][0], example)[0]["content"]
            self.assertNotIn(example["approved_answer"], message)
            for claim in example["allowed_claims"]:
                self.assertNotIn(claim, message)
        manifest = self.run_case()
        self.assertEqual(manifest["evidence_type"], "unscored_language_generation")
        self.assertEqual(manifest["outcome"], "completed")

    def test_initial_bounds_and_unknown_configuration_fail_before_models(self):
        for key, bad in (("example_ids", []), ("candidate_ids", [CID, CID]), ("seed", True),
                         ("max_output_tokens", 513), ("context_limit_tokens", 8193),
                         ("timeout_seconds", float("nan")), ("temperature", 0.1),
                         ("reasoning_mode", "enabled"), ("run_id", "../../oops")):
            config = deepcopy(self.config)
            config[key] = bad
            with self.subTest(key=key), self.assertRaises((RecordsError, TypeError)):
                validate_config(config)
        config = deepcopy(self.config)
        config["ignored_extra_instruction"] = "anything"
        with self.assertRaises(RecordsError):
            validate_config(config)
        self.loader.assert_not_called()

    def test_real_data_cannot_use_fixture_path_and_unreviewed_language_cannot_run(self):
        self.dataset["sources"][0]["source_kind"] = "community"
        with self.assertRaisesRegex(RecordsError, "synthetic"):
            check_eligibility(self.dataset, self.config)
        self.config.update(purpose="language_baseline", community_id="x", task_id="y", review_criteria="z")
        self.dataset["sources"][0].update(language="bo", language_review="approved")
        with self.assertRaisesRegex(RecordsError, "adjudicated"):
            check_eligibility(self.dataset, self.config)

    def test_health_requires_medical_review_separate_from_language(self):
        self.approved_contract_stub()
        self.dataset["sources"][0].update(scope="health", medical_review="pending")
        require_valid_dataset(self.dataset)
        with self.assertRaisesRegex(RecordsError, "medical approval"):
            check_eligibility(self.dataset, self.config)

    def test_connected_training_exposure_blocks_even_an_unselected_sibling(self):
        self.config["example_ids"] = ["fixture-example-1"]
        first, second = self.dataset["examples"]
        second["scenario_group"] = first["scenario_group"]
        self.dataset["sources"][1]["permitted_uses"].append("train")
        second["exposures"] = ["train"]
        with self.assertRaisesRegex(RecordsError, "prior training"):
            self.run_case()
        self.verifier.assert_not_called()
        self.assertFalse((self.directory / "run").exists())

    def test_unpermitted_data_never_reaches_snapshot_or_tokenizer(self):
        self.dataset["sources"][0]["permitted_uses"].remove("private_research")
        with self.assertRaisesRegex(RecordsError, "permission"):
            self.run_case()
        self.verifier.assert_not_called()
        self.loader.assert_not_called()

    def test_context_rejection_records_failure_without_inference_or_exposure(self):
        self.config["context_limit_tokens"] = 18  # 3 input + 16 reserved output.
        manifest = self.run_case()
        self.assertEqual(manifest["outcome"], "failed")
        self.assertEqual({c["outcome"] for c in manifest["cases"]}, {"context_overflow"})
        self.assertEqual(manifest["attempted_case_count"], 0)
        self.assertIsNone(manifest["latest_exposure_snapshot"])
        self.assertEqual(self.calls, [])

    def test_interrupt_preserves_only_attempted_exposure_and_finalizes_manifest(self):
        def interrupt(request, **kwargs):
            raise KeyboardInterrupt()
        manifest = self.run_case(interrupt)
        self.assertEqual(manifest["outcome"], "interrupted")
        self.assertEqual(manifest["attempted_case_count"], 1)
        self.assertFalse(manifest["all_cases_recorded"])
        exposure = load_dataset(self.directory / "run" / manifest["latest_exposure_snapshot"])
        self.assertEqual(exposure["examples"][1]["exposures"], [])
        result = load_dataset(self.directory / "run" / "case.001.result.json")
        self.assertIsNone(result["response"]["result"]["answer"])
        self.assertEqual(result["response"]["result"]["outcome"], "cancelled")
        self.assertTrue((self.directory / "run" / "manifest.json").is_file())

    def test_worker_returned_cancellation_stops_the_remaining_cases(self):
        def cancel(request, **kwargs):
            self.calls.append(request)
            return {"result": asdict(InferenceResult(request.run_id, "cancelled", None,
                "operator_interrupt", kwargs["model_identity"])), "raw_output": "Partial synthetic text",
                "measurements": {}}
        manifest = self.run_case(cancel)
        self.assertEqual(manifest["outcome"], "interrupted")
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(len(manifest["cases"]), 1)
        self.assertFalse(manifest["all_cases_recorded"])
        exposure = load_dataset(self.directory / "run" / manifest["latest_exposure_snapshot"])
        self.assertEqual(exposure["examples"][1]["exposures"], [])
        result = load_dataset(self.directory / "run" / "case.001.result.json")
        self.assertEqual(result["response"]["raw_output"], "Partial synthetic text")

    def test_failed_generation_keeps_partial_raw_output_but_never_an_answer(self):
        def timeout(request, **kwargs):
            return {"result": asdict(InferenceResult(request.run_id, "timeout", None,
                "worker_timeout", kwargs["model_identity"])), "raw_output": "Partial synthetic text",
                "measurements": {"load_seconds": 0.1}}
        manifest = self.run_case(timeout)
        self.assertEqual(manifest["outcome"], "failed")
        self.assertTrue(manifest["all_cases_recorded"])
        result = load_dataset(self.directory / "run" / "case.001.result.json")["response"]
        self.assertEqual(result["raw_output"], "Partial synthetic text")
        self.assertIsNone(result["result"]["answer"])

    def test_invalid_backend_success_cannot_silently_become_a_model_answer(self):
        def wrong_identity(request, **kwargs):
            response = self.success(request, **kwargs)
            response["result"]["model_identity"] = "different-model"
            return response
        manifest = self.run_case(wrong_identity)
        self.assertEqual(manifest["outcome"], "failed")
        result = load_dataset(self.directory / "run" / "case.001.result.json")
        self.assertIsNone(result["response"]["result"]["answer"])
        self.assertEqual(result["error_type"], "RecordsError")

    def test_desktop_and_redirected_output_paths_fail_before_artifact_creation(self):
        desktop = self.directory / "Desktop"
        alias = self.directory / "alias-to-desktop"
        alias.symlink_to(desktop, target_is_directory=True)
        with patch.object(Path, "home", return_value=self.directory):
            for target, reason in ((desktop / "private-run", "outside Desktop"),
                                   (alias / "private-run", "cannot contain symlinks")):
                with self.subTest(target=target), self.assertRaisesRegex(RecordsError, reason):
                    self.run_case(output_dir=target)
        self.assertFalse(desktop.exists())
        self.assertEqual(self.calls, [])
        self.verifier.assert_not_called()
        self.loader.assert_not_called()

    def test_bad_snapshot_stops_before_any_model_or_tokenizer_and_records_failure(self):
        self.verifier.return_value = {"valid": False, "errors": [{"path": "weights", "message": "hash mismatch"}]}
        manifest = self.run_case()
        self.assertEqual(manifest["outcome"], "failed")
        self.assertEqual(manifest["attempted_case_count"], 0)
        self.loader.assert_not_called()
        self.assertFalse(manifest["snapshots"][0]["verification"]["valid"])

    def test_render_failure_does_not_expose_data_and_keeps_error_code(self):
        class TemplateFailure(ValueError):
            code = "qwen_reasoning_control_unsupported"
        self.renderer.side_effect = TemplateFailure("Template cannot disable reasoning.")
        manifest = self.run_case()
        self.assertEqual(manifest["attempted_case_count"], 0)
        self.assertEqual(self.calls, [])
        result = load_dataset(self.directory / "run" / "case.001.result.json")
        self.assertEqual(result["error_code"], "qwen_reasoning_control_unsupported")


if __name__ == "__main__":
    unittest.main()
