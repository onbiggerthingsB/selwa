"""Released-token inspection with fake tokenizers, never language measurements."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ht_tibetan.conditions import ENGINEERING_CONDITION
from ht_tibetan.records import RecordsError, content_sha256, example_sha256, record_sha256
from ht_tibetan.release_token_audit import audit_release_tokens
from ht_tibetan.releases import build_release
from test_contribution_permissions import synthetic_permissions
from test_releases import release_fixture
from test_training_inputs import ExactTokenizer


CID = "gemma3-4b-it-mlx-4bit"
QWEN = "qwen3-4b-mlx-4bit"


class ReleaseTokenAuditTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        (self.root / "runs").mkdir()
        self.release = self.root / "releases" / "synthetic-cost-fixture"
        self.data, self.permissions = release_fixture()
        self.permission_path = self.root / "permissions.json"
        self.input_path = self.root / "dataset.json"
        self.lock_path = self.root / "models.json"
        self.lock_path.write_text(json.dumps({"candidates": [
            {"candidate_id": candidate, "repository": "fixture/" + candidate, "revision": letter * 40}
            for candidate, letter in ((CID, "a"), (QWEN, "b"))]}))
        self.condition = deepcopy(ENGINEERING_CONDITION)
        self.condition["max_output_tokens_by_candidate"] = {CID: 128, QWEN: 128}
        self.tokenizer = ExactTokenizer()
        self.events = []

    def build(self):
        self.input_path.write_text(json.dumps(self.data, ensure_ascii=False))
        self.permission_path.write_text(json.dumps(self.permissions))
        build_release(self.input_path, self.permission_path, self.root, self.release,
                      release_id=self.release.name, evidence_kind="synthetic_test")

    def verified(self, lock_path, candidate, path, **kwargs):
        self.events.append(("verify", candidate))
        self.assertEqual(kwargs, {"include_weights": False})
        self.assertEqual(path.name, "tokenizer")
        return {"valid": True, "identity": {"candidate_id": candidate, "mode": "tokenizer",
            "inventory_sha256": "c" * 64}, "files": [{"path": "tokenizer.json", "sha256": "d" * 64}]}

    def load(self, path):
        self.events.append(("load", path.parts[-3]))
        self.assertTrue(any(event[0] == "verify" for event in self.events))
        return self.tokenizer

    def audit(self, **kwargs):
        with patch("ht_tibetan.release_token_audit.verify_snapshot", side_effect=self.verified), \
             patch("ht_tibetan.release_token_audit.load_local_tokenizer", side_effect=self.load):
            return audit_release_tokens(self.release, self.permission_path, self.lock_path, self.root,
                **({"purposes": ["train", "validation"], "candidate_ids": [CID], "condition": self.condition} | kwargs))

    def rewrite_first_as_unicode_fixture(self):
        source, example = self.data["sources"][0], self.data["examples"][0]
        source.update(original_text="Synthetic Unicode plumbing: e\u0301 ཀ་ ཁ་\n", language="bo")
        source["content_sha256"] = content_sha256(source["original_text"])
        example.update(source_sha256=source["content_sha256"], question="Copy the marked symbols?",
                       approved_answer="ཀ་ ཁ་", allowed_claims=["Synthetic symbol copy only."])
        checksum = example_sha256(example)
        for review in self.data["reviews"]:
            if review["example_id"] == example["example_id"]:
                review.update(example_sha256=checksum, source_sha256=example["source_sha256"])
        for decision in self.data["adjudications"]:
            if decision["example_id"] == example["example_id"]:
                decision["example_sha256"] = checksum
        self.permissions = synthetic_permissions(self.data)
        for grant in self.permissions["grants"]:
            grant["permitted_uses"] += ["train", "validation", "final_test"]

    def test_full_prompt_target_suffix_and_instruction_cost_are_separate(self):
        self.build()
        report = self.audit()
        self.assertTrue(report["valid"])
        self.assertTrue(report["all_fit"])
        candidate = report["candidates"][0]
        row = candidate["cases"][0]
        answer = self.data["examples"][0]["approved_answer"]
        self.assertEqual(row["assistant_target_tokens"], len(answer + "<eos>"))
        self.assertEqual(row["assistant_offset"], row["generation_prompt_tokens"])
        self.assertEqual(row["complete_training_tokens"], row["assistant_offset"] + row["assistant_target_tokens"])
        self.assertEqual(row["target_minus_standalone_answer_tokens"], len("<eos>"))
        self.assertEqual(candidate["instruction_standalone"]["standalone_raw_tokens"], len(self.condition["instruction_text"]))
        self.assertIn("not additive", candidate["instruction_standalone"]["accounting_scope"])
        self.assertFalse(any(report["claims"].values()))
        self.assertEqual(candidate["proposed_output_budget"]["status"], "not_requested")

    def test_report_excludes_raw_sources_questions_answers_and_token_ids(self):
        self.build()
        report = self.audit()
        serialized = json.dumps(report, ensure_ascii=False)
        for source, example in zip(self.data["sources"], self.data["examples"]):
            for text in (source["original_text"], example["question"], example["approved_answer"]):
                self.assertNotIn(text, serialized)
        self.assertEqual(report["condition"]["instruction_text"], self.condition["instruction_text"])
        self.assertNotIn('"input_ids":', serialized)
        self.assertEqual(report["permissions_canonical_sha256"], record_sha256(self.permissions))
        self.assertEqual(report["candidates"][0]["cases"][0]["source_sha256"], self.data["sources"][0]["content_sha256"])

    def test_final_test_rejected_before_release_or_tokenizer_reads(self):
        self.build()
        with patch("ht_tibetan.release_token_audit.verify_release") as verifier:
            with self.assertRaisesRegex(RecordsError, "final_test is forbidden"):
                self.audit(purposes=["train", "final_test"])
            verifier.assert_not_called()
        self.assertEqual(self.events, [])

    def test_only_requested_release_contents_open_and_no_run_is_created(self):
        self.build()
        from ht_tibetan import releases
        original, paths = releases._read, []
        def track(path):
            paths.append(str(path))
            if "/locked/" in str(path) or str(path).endswith("datasets/train.json"):
                self.fail("Token audit opened an unselected payload.")
            return original(path)
        with patch.object(releases, "_read", side_effect=track):
            report = self.audit(purposes=["validation"])
        self.assertEqual(len(report["candidates"][0]["cases"]), 1)
        self.assertEqual(report["unopened_splits"], ["final_test", "train"])
        self.assertFalse(report["final_test_opened"])
        self.assertEqual(list((self.root / "runs").iterdir()), [])

    def test_corrupted_tokenizer_blocks_all_loading_even_if_other_candidate_passes(self):
        self.build()
        def verify(lock_path, candidate, path, **kwargs):
            result = self.verified(lock_path, candidate, path, **kwargs)
            return result | {"valid": candidate != QWEN}
        with patch("ht_tibetan.release_token_audit.verify_snapshot", side_effect=verify), \
             patch("ht_tibetan.release_token_audit.load_local_tokenizer") as loader:
            with self.assertRaisesRegex(RecordsError, "verification failed"):
                audit_release_tokens(self.release, self.permission_path, self.lock_path, self.root,
                    purposes=["train"], candidate_ids=[CID, QWEN], condition=self.condition)
            loader.assert_not_called()

    def test_revoked_human_ledger_rejected_before_tokenizer(self):
        self.build()
        with patch("ht_tibetan.release_token_audit.verify_release", side_effect=RecordsError("revoked permission")):
            with self.assertRaisesRegex(RecordsError, "revoked permission"):
                self.audit()
        self.assertEqual(self.events, [])

    def test_unicode_cost_proxy_preserves_decomposed_text_without_quality_claim(self):
        self.rewrite_first_as_unicode_fixture()
        original = deepcopy(self.data)
        self.build()
        report = self.audit(purposes=["train"], max_output_segments=3)
        row = report["candidates"][0]["cases"][0]
        answer = row["materials"]["answer"]
        self.assertEqual(answer["tsheg_segment_proxy_count"], 2)
        self.assertEqual(answer["tibetan_block_codepoints"], 4)
        self.assertEqual(answer["unicode_codepoints"], 5)
        self.assertEqual(row["materials"]["source"]["utf8_sha256"], content_sha256(original["sources"][0]["original_text"]))
        self.assertEqual(self.data, original)
        proposal = report["candidates"][0]["proposed_output_budget"]
        self.assertEqual(proposal["status"], "proposed_unreviewed")
        self.assertEqual(proposal["max_output_tokens"], 15)
        self.assertFalse(proposal["reviewed_task_budget"])
        self.assertEqual(report["condition"]["max_output_tokens_by_candidate"][CID], 128)
        self.assertTrue(report["engineering_only"])
        self.assertFalse(report["claims"]["language_quality_measured"])

    def test_english_targets_do_not_fabricate_tibetan_segment_budget(self):
        self.build()
        report = self.audit(max_output_segments=10)
        proposal = report["candidates"][0]["proposed_output_budget"]
        self.assertEqual(proposal["status"], "unavailable")
        self.assertIsNone(proposal["max_output_tokens"])
        self.assertEqual(proposal["reason"], "no_tibetan_answer_segments")

    def test_proposed_budget_overflow_is_blocked_without_clamping(self):
        self.rewrite_first_as_unicode_fixture()
        self.build()
        report = self.audit(purposes=["train"], max_output_segments=200)
        proposal = report["candidates"][0]["proposed_output_budget"]
        self.assertEqual(proposal["calculated_output_tokens"], 1000)
        self.assertEqual(proposal["status"], "blocked")
        self.assertIsNone(proposal["max_output_tokens"])

    def test_proposed_context_overflow_or_shorter_than_observed_target_is_blocked(self):
        self.rewrite_first_as_unicode_fixture()
        self.build()
        measured = self.audit(purposes=["train"])
        prompt_tokens = measured["candidates"][0]["cases"][0]["generation_prompt_tokens"]
        self.condition["context_limit_tokens"] = prompt_tokens + 14
        report = self.audit(purposes=["train"], max_output_segments=3)
        proposal = report["candidates"][0]["proposed_output_budget"]
        self.assertEqual(proposal["calculated_output_tokens"], 15)
        self.assertEqual(proposal["status"], "blocked")
        self.assertIsNone(proposal["max_output_tokens"])
        self.condition["context_limit_tokens"] = 2048
        report = self.audit(purposes=["train"], max_output_segments=1)
        self.assertEqual(report["candidates"][0]["proposed_output_budget"]["reason"],
                         "proposed_budget_cannot_fit_observed_reference_targets")

    def test_each_candidate_uses_its_own_observed_token_cost(self):
        class DoubledQwenFixture(ExactTokenizer):
            chat_template = "synthetic enable_thinking control template"
            def encode(self, text, *, add_special_tokens):
                return [ord(char) for char in text for _ in range(2)]
            def decode(self, tokens, *, skip_special_tokens):
                value = "".join(chr(token) for token in tokens[::2])
                return value.replace("<eos>", "") if skip_special_tokens else value
            def apply_chat_template(self, messages, **kwargs):
                prefix = "<assistant>" + ("<think>\n\n</think>\n\n" if kwargs.get("enable_thinking") is False else "<think>")
                rendered = "".join((prefix if message["role"] == "assistant" else "<user>") + message["content"] + "<eos>"
                                   for message in messages)
                if kwargs["add_generation_prompt"]:
                    rendered += prefix
                return self.encode(rendered, add_special_tokens=False) if kwargs["tokenize"] else rendered
        self.rewrite_first_as_unicode_fixture()
        self.build()
        def tokenizer(path):
            return DoubledQwenFixture() if QWEN in path.parts else ExactTokenizer()
        with patch("ht_tibetan.release_token_audit.verify_snapshot", side_effect=self.verified), \
             patch("ht_tibetan.release_token_audit.load_local_tokenizer", side_effect=tokenizer):
            report = audit_release_tokens(self.release, self.permission_path, self.lock_path, self.root,
                purposes=["train"], candidate_ids=[CID, QWEN], condition=self.condition, max_output_segments=3)
        self.assertTrue(report["valid"])
        budgets = {item["candidate_id"]: item["proposed_output_budget"]["max_output_tokens"] for item in report["candidates"]}
        self.assertEqual(budgets, {CID: 15, QWEN: 30})
        self.assertFalse(report["claims"]["reviewed_task_budget_granted"])

    def test_declared_context_or_target_budget_never_truncates_inputs(self):
        self.build()
        self.condition["max_output_tokens_by_candidate"][CID] = 1
        self.condition["context_limit_tokens"] = 132
        report = self.audit()
        self.assertTrue(report["valid"])
        self.assertFalse(report["all_fit"])
        self.assertTrue(all(row["assistant_target_tokens"] > 1 for row in report["candidates"][0]["cases"]))
        self.assertTrue(all(not row["truncated"] for row in report["candidates"][0]["cases"]))

    def test_ambiguous_training_prefix_is_rejected_without_guessing_offset(self):
        class BrokenPrefix(ExactTokenizer):
            def apply_chat_template(self, messages, **kwargs):
                value = super().apply_chat_template(messages, **kwargs)
                return value + ([33] if kwargs["tokenize"] else "!") if kwargs["add_generation_prompt"] else value
        self.tokenizer = BrokenPrefix()
        self.build()
        report = self.audit(max_output_segments=3)
        self.assertFalse(report["valid"])
        self.assertEqual(report["candidates"][0]["proposed_output_budget"]["status"], "blocked")
        self.assertTrue(all("assistant_offset" not in row for row in report["candidates"][0]["cases"]))

    def test_lock_and_permission_mutation_during_inspection_is_detected(self):
        self.build()
        original_loader = self.load
        def modify(path):
            self.permission_path.write_text(self.permission_path.read_text() + "\n")
            return original_loader(path)
        with patch("ht_tibetan.release_token_audit.verify_snapshot", side_effect=self.verified), \
             patch("ht_tibetan.release_token_audit.load_local_tokenizer", side_effect=modify):
            with self.assertRaisesRegex(RecordsError, "changed during token inspection"):
                audit_release_tokens(self.release, self.permission_path, self.lock_path, self.root,
                    purposes=["train"], candidate_ids=[CID], condition=self.condition)

    def test_invalid_bounds_and_duplicate_purposes_never_touch_tokenizers(self):
        self.build()
        for changed in ({"purposes": []}, {"purposes": ["train", "train"]},
                        {"candidate_ids": [CID, CID]}, {"max_output_segments": True},
                        {"max_output_segments": 0}, {"max_output_segments": 8193}):
            with self.subTest(changed=changed), self.assertRaises(RecordsError):
                self.audit(**changed)
        self.assertEqual(self.events, [])


if __name__ == "__main__":
    unittest.main()
