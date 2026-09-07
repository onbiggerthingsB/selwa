"""Paired dispatch/provenance tests with synthetic fixtures and a fake backend.

No fixture here is evidence of translation quality or completed human review.
"""
from copy import deepcopy
from dataclasses import asdict
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from ht_tibetan.artifacts import hash_file
from ht_tibetan.baseline import (check_eligibility, conversation_for, conversation_for_job,
                                 jobs_for, run_baseline, validate_config)
from ht_tibetan.inference import InferenceResult
from ht_tibetan.records import (RecordsError, atomic_write_json, load_dataset,
                                record_sha256, require_valid_dataset)

CID = "qwen3-4b-mlx-4bit"
OTHER_CID = "gemma3-4b-it-mlx-4bit"
CONDITIONS = ["bo_to_bo", "bo_to_zh", "zh_to_bo", "zh_to_zh"]
PAIR_FIELDS = ("pair_id", "condition_id", "input_language", "output_language", "parallel_pair_sha256")


class PairedBaselineTests(unittest.TestCase):
    def setUp(self):
        from test_parallel import synthetic_pair
        self.dataset, self.parallel = synthetic_pair()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name).resolve() / "runs"
        self.directory.mkdir()
        self.permissions = None
        self.config = {"schema_version": "1.1", "run_id": "paired-contract", "purpose": "infrastructure_smoke",
            "candidate_ids": [CID], "example_ids": [example["example_id"] for example in self.dataset["examples"]],
            "pair_ids": [self.parallel["pairs"][0]["pair_id"]], "conditions": CONDITIONS[:],
            "max_output_tokens": 16, "context_limit_tokens": 64, "timeout_seconds": 20,
            "seed": 0, "temperature": 0.0, "reasoning_mode": "disabled", "contributor_policy": "report",
            "community_id": None, "task_id": None, "review_criteria": None}
        self.lock = {"schema_version": "1.0", "candidates": [
            {"candidate_id": candidate_id, "revision": revision * 40, "repository": "fixture/" + candidate_id}
            for candidate_id, revision in ((CID, "a"), (OTHER_CID, "b"))]}
        self.verifier = Mock(return_value={"valid": True, "errors": []})
        self.loader = Mock(return_value=object())
        self.renderer = Mock(side_effect=lambda messages, tokenizer, **kw: {
            "rendered_text": messages[0]["content"], "input_ids": [10, 20, 30],
            "chat_template_utf8_sha256": "c" * 64, "reasoning": {"verified": True}})
        self.calls = []

    def success(self, request, **kwargs):
        self.calls.append((request, kwargs))
        return {"result": asdict(InferenceResult(request.run_id, "success", "Synthetic answer.",
            "eos", kwargs["model_identity"], input_tokens=len(kwargs["prompt_token_ids"]), output_tokens=4, synthetic=True)),
            "raw_output": "Synthetic answer.", "measurements": {"load_seconds": 0.1}}

    def run_case(self, backend=None, *, use_parallel=True):
        for name, value in (("dataset", self.dataset), ("config", self.config),
                            ("lock", self.lock), ("parallel", self.parallel)):
            atomic_write_json(self.directory / (name + ".json"), value)
        permissions_path = None
        if self.permissions is not None:
            permissions_path = self.directory / "permissions.json"
            atomic_write_json(permissions_path, self.permissions)
        return run_baseline(self.directory / "dataset.json", self.directory / "config.json",
            self.directory / "lock.json", self.directory.parent, self.directory / "run",
            backend=backend or self.success, tokenizer_loader=self.loader, renderer=self.renderer,
            snapshot_verifier=self.verifier, permissions_path=permissions_path,
            parallel_path=self.directory / "parallel.json" if use_parallel else None)

    def add_connected_sibling(self):
        sibling = deepcopy(self.dataset["examples"][0])
        sibling["example_id"] = "unselected-connected-sibling"
        self.dataset["examples"].append(sibling)
        require_valid_dataset(self.dataset)
        return sibling

    def test_four_conditions_for_each_candidate_preserve_job_and_prompt_identity(self):
        self.config["candidate_ids"].append(OTHER_CID)
        expected_jobs = jobs_for(self.dataset, self.config, self.parallel)
        self.assertEqual([job["condition_id"] for job in expected_jobs], CONDITIONS)
        self.assertEqual([job["input_language"] for job in expected_jobs], ["bo", "bo", "zh", "zh"])
        self.assertEqual([job["output_language"] for job in expected_jobs], ["bo", "zh", "bo", "zh"])
        manifest = self.run_case()
        self.assertEqual(manifest["outcome"], "completed")
        self.assertEqual(manifest["planned_cases"], 8)
        self.assertEqual(manifest["attempted_case_count"], 8)
        self.assertEqual([item["candidate_id"] for item in manifest["cases"]], [CID] * 4 + [OTHER_CID] * 4)
        for sequence, job in enumerate(expected_jobs * 2, start=1):
            index = manifest["cases"][sequence - 1]
            result = load_dataset(self.directory / "run" / index["result_file"])
            attempt = load_dataset(self.directory / "run" / f"case.{sequence:03d}.attempt.json")
            for record in (index, result, attempt):
                self.assertEqual(record["schema_version"], "1.1")
                self.assertEqual(record["example_id"], job["example_id"])
                for key in PAIR_FIELDS:
                    self.assertEqual(record[key], job[key])
            example = next(ex for ex in self.dataset["examples"] if ex["example_id"] == job["example_id"])
            source = next(src for src in self.dataset["sources"] if src["source_id"] == example["source_id"])
            self.assertEqual(result["messages"], conversation_for_job(source, example, job))
            self.assertIn(source["original_text"], self.calls[sequence - 1][0].prompt)
            self.assertIn(example["question"], self.calls[sequence - 1][0].prompt)

    def test_parallel_input_is_bound_into_both_manifests_without_mutating_originals(self):
        original_dataset, original_parallel = deepcopy(self.dataset), deepcopy(self.parallel)
        manifest = self.run_case()
        started = load_dataset(self.directory / "run" / "manifest.started.json")
        for record in (manifest, started):
            self.assertEqual(record["schema_version"], "1.1")
            self.assertEqual(record["parallel_material"], original_parallel)
            self.assertEqual(record["loaded_records_sha256"]["parallel_material"], record_sha256(original_parallel))
            self.assertIn({"name": "parallel.json", "sha256": hash_file(self.directory / "parallel.json")}, record["inputs"])
        self.assertEqual(self.dataset, original_dataset)
        self.assertEqual(self.parallel, original_parallel)
        self.assertEqual(load_dataset(self.directory / "dataset.json"), original_dataset)
        self.assertEqual(load_dataset(self.directory / "parallel.json"), original_parallel)

    def test_all_condition_prompts_exclude_reference_answers_and_review_metadata(self):
        for job in jobs_for(self.dataset, self.config, self.parallel):
            example = deepcopy(next(ex for ex in self.dataset["examples"] if ex["example_id"] == job["example_id"]))
            source = next(src for src in self.dataset["sources"] if src["source_id"] == example["source_id"])
            example["approved_answer"] = "PRIVATE-REFERENCE-ANSWER-MUST-NOT-ENTER-PROMPT"
            example["allowed_claims"] = ["PRIVATE-REFERENCE-CLAIM-MUST-NOT-ENTER-PROMPT"]
            example["contributor_id"] = "PRIVATE-CONTRIBUTOR-MUST-NOT-ENTER-PROMPT"
            messages = conversation_for_job(source, example, job)
            self.assertEqual(len(messages), 1)
            self.assertEqual(messages[0]["role"], "user")
            self.assertIn(source["original_text"], messages[0]["content"])
            self.assertIn(example["question"], messages[0]["content"])
            self.assertNotIn("PRIVATE-", messages[0]["content"])

    def test_paired_config_bounds_and_condition_names_are_strict(self):
        for key, value in (("pair_ids", []), ("pair_ids", ["same", "same"]),
                           ("pair_ids", [f"pair-{i}" for i in range(11)]),
                           ("conditions", []), ("conditions", ["bo_to_bo", "bo_to_bo"]),
                           ("conditions", ["en_to_bo"]), ("conditions", [True]),
                           ("example_ids", [f"example-{i}" for i in range(21)])):
            invalid = deepcopy(self.config)
            invalid[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(RecordsError):
                validate_config(invalid)
        for key in ("pair_ids", "conditions"):
            missing = deepcopy(self.config)
            del missing[key]
            with self.subTest(missing=key), self.assertRaises(RecordsError):
                validate_config(missing)

    def test_even_one_condition_requires_exactly_both_selected_pair_members(self):
        self.config["conditions"] = ["bo_to_bo"]
        self.config["example_ids"] = self.config["example_ids"][:1]
        with self.assertRaisesRegex(RecordsError, "exactly both"):
            self.run_case()
        self.verifier.assert_not_called()
        self.assertFalse((self.directory / "run").exists())

    def test_unselected_example_cannot_silently_join_declared_pair_selection(self):
        sibling = self.add_connected_sibling()
        self.config["example_ids"].append(sibling["example_id"])
        with self.assertRaisesRegex(RecordsError, "exactly both"):
            self.run_case()
        self.verifier.assert_not_called()

    def test_paired_configuration_requires_sidecar_before_any_artifact_or_model(self):
        with self.assertRaisesRegex(RecordsError, "require parallel"):
            self.run_case(use_parallel=False)
        self.verifier.assert_not_called()
        self.loader.assert_not_called()
        self.assertFalse((self.directory / "run").exists())

    def test_legacy_configuration_rejects_sidecar_and_preserves_prompt_bytes(self):
        legacy = deepcopy(self.config)
        legacy["schema_version"] = "1.0"
        del legacy["pair_ids"], legacy["conditions"]
        validate_config(legacy)
        legacy_jobs = jobs_for(self.dataset, legacy)
        self.assertEqual(legacy_jobs, [{"example_id": eid} for eid in legacy["example_ids"]])
        first_example, first_source = self.dataset["examples"][0], self.dataset["sources"][0]
        self.assertEqual(conversation_for_job(first_source, first_example, legacy_jobs[0]),
                         conversation_for(first_source, first_example))
        self.config = legacy
        with self.assertRaisesRegex(RecordsError, "Legacy"):
            self.run_case()
        self.verifier.assert_not_called()
        self.assertFalse((self.directory / "run").exists())

    def test_legacy_real_baseline_still_rejects_a_reviewed_chinese_source(self):
        from test_baseline import BaselineTests
        self.config["schema_version"] = "1.0"
        del self.config["pair_ids"], self.config["conditions"]
        # Reuse an explicit contract stub only; these are not real human reviews.
        BaselineTests.approved_contract_stub(self)
        self.dataset["sources"][0]["language"] = "zh"
        require_valid_dataset(self.dataset)
        with self.assertRaisesRegex(RecordsError, "Tibetan source material"):
            check_eligibility(self.dataset, self.config)

    def test_cancelled_first_attempt_exposes_both_languages_and_all_connected_siblings(self):
        self.add_connected_sibling()

        def cancel(request, **kwargs):
            # The conservative exposure record must exist before the backend sees data.
            exposed = load_dataset(self.directory / "run" / "exposed-dataset.001.json")
            self.assertTrue(all(ex["exposures"] == ["development_screen"] for ex in exposed["examples"]))
            self.calls.append(request)
            return {"result": asdict(InferenceResult(request.run_id, "cancelled", None,
                "operator_interrupt", kwargs["model_identity"], synthetic=True)), "raw_output": "partial", "measurements": {}}

        manifest = self.run_case(cancel)
        self.assertEqual(manifest["outcome"], "interrupted")
        self.assertEqual(manifest["attempted_case_count"], 1)
        self.assertEqual(len(self.calls), 1)
        self.assertFalse(manifest["all_cases_recorded"])
        self.assertEqual(manifest["cases"][0]["condition_id"], "bo_to_bo")
        result = load_dataset(self.directory / "run" / manifest["cases"][0]["result_file"])
        self.assertIsNone(result["response"]["result"]["answer"])
        self.assertEqual(result["response"]["raw_output"], "partial")

    def test_keyboard_interrupt_preserves_paired_index_metadata_and_exposure(self):
        def interrupt(request, **kwargs):
            raise KeyboardInterrupt
        manifest = self.run_case(interrupt)
        self.assertEqual(manifest["outcome"], "interrupted")
        index = manifest["cases"][0]
        self.assertEqual(index["schema_version"], "1.1")
        self.assertEqual(index["condition_id"], "bo_to_bo")
        self.assertEqual(index["outcome"], "cancelled")
        self.assertEqual(len(manifest["cases"]), 1)
        exposed = load_dataset(self.directory / "run" / manifest["latest_exposure_snapshot"])
        self.assertTrue(all("development_screen" in ex["exposures"] for ex in exposed["examples"]))

    def test_context_overflow_never_dispatches_or_adds_exposure(self):
        self.config["context_limit_tokens"] = 18
        manifest = self.run_case()
        self.assertEqual(manifest["outcome"], "failed")
        self.assertEqual(manifest["planned_cases"], 4)
        self.assertEqual(manifest["attempted_case_count"], 0)
        self.assertEqual({case["outcome"] for case in manifest["cases"]}, {"context_overflow"})
        self.assertIsNone(manifest["latest_exposure_snapshot"])
        self.assertEqual(list((self.directory / "run").glob("exposed-dataset.*")), [])
        self.assertEqual(self.calls, [])

    def test_connected_unselected_training_exposure_blocks_before_dispatch(self):
        sibling = self.add_connected_sibling()
        sibling["exposures"] = ["train"]
        source = next(src for src in self.dataset["sources"] if src["source_id"] == sibling["source_id"])
        source["permitted_uses"].append("train")
        with self.assertRaises(RecordsError):
            self.run_case()
        self.verifier.assert_not_called()
        self.assertFalse((self.directory / "run").exists())

    def test_stale_pair_binding_fails_before_snapshot_verification(self):
        self.parallel["pairs"][0]["members"]["bo"]["source_sha256"] = "0" * 64
        with self.assertRaises(RecordsError):
            self.run_case()
        self.verifier.assert_not_called()
        self.assertFalse((self.directory / "run").exists())

    def test_synthetic_pairs_cannot_become_language_baseline_evidence(self):
        self.config.update(purpose="language_baseline", community_id="contract-community",
                           task_id="contract-task", review_criteria="Synthetic contract criteria only.")
        with self.assertRaises(RecordsError):
            check_eligibility(self.dataset, self.config, self.parallel)
        self.verifier.assert_not_called()

    def test_paired_language_eligibility_accepts_both_reviewed_language_contracts(self):
        from test_parallel import reviewed_contract_stub
        # Fabricated branch fixture only, never a human review or quality claim.
        self.dataset, self.parallel = reviewed_contract_stub()
        self.config.update(purpose="language_baseline", community_id="contract-community",
                           task_id="contract-task", review_criteria="Synthetic contract criteria only.")
        self.assertTrue(check_eligibility(self.dataset, self.config, self.parallel)["valid"])
        self.assertEqual({job["input_language"] for job in jobs_for(self.dataset, self.config, self.parallel)}, {"bo", "zh"})

    def test_synthetic_backend_results_remain_rejected_in_paired_language_runs(self):
        from test_baseline import permission_contract_stub
        from test_parallel import reviewed_contract_stub
        self.dataset, self.parallel = reviewed_contract_stub()
        self.permissions = permission_contract_stub(self.dataset)
        self.config.update(purpose="language_baseline", community_id="contract-community",
                           task_id="contract-task", review_criteria="Synthetic contract criteria only.")
        manifest = self.run_case()
        self.assertEqual(manifest["outcome"], "failed")
        self.assertTrue(manifest["all_cases_recorded"])
        for index in manifest["cases"]:
            result = load_dataset(self.directory / "run" / index["result_file"])
            self.assertEqual(index["outcome"], "runtime_failure")
            self.assertEqual(result["error_type"], "RecordsError")
            self.assertIn("Synthetic backend results", result["error_message"])
            self.assertIsNone(result["response"]["result"]["answer"])


if __name__ == "__main__":
    unittest.main()
