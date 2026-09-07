"""Synthetic contract tests only; no fixture is Tibetan quality or human evidence."""
from copy import deepcopy
from pathlib import Path
import unittest

from ht_tibetan.parallel import (CONDITIONS, PRESERVATION_CHECKS, condition_jobs,
    conversation_for_condition, pair_sha256, validate_parallel_material)
from ht_tibetan.records import RecordsError, example_sha256, load_dataset, record_sha256

FIXTURE = Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "synthetic-dataset.json"


def synthetic_pair():
    """Latin-script placeholders declared bo/zh exercise plumbing, never translation.

    These explicitly synthetic nonclinical sources retain pending language review.
    The language fields are routing labels, not claims about the English text.
    """
    dataset = load_dataset(FIXTURE)
    pair = {"pair_id": "synthetic-pair-1", "version": 1,
        "scenario_group": "synthetic-shared-scenario", "paraphrase_group": "synthetic-shared-paraphrase",
        "translation_contributor_ids": ["synthetic-translation-author"], "members": {}, "permission_record_ids": []}
    permissions = []
    for language, source, example in zip(("bo", "zh"), dataset["sources"], dataset["examples"]):
        source.update(language=language, title="Synthetic Latin placeholder; no translation or language quality claim")
        example.update(scenario_group=pair["scenario_group"], paraphrase_group=pair["paraphrase_group"])
        pair["members"][language] = {"source_id": source["source_id"], "source_version": source["version"],
            "source_sha256": source["content_sha256"], "example_id": example["example_id"],
            "example_version": example["version"], "example_sha256": example_sha256(example)}
        permission_id = "synthetic-permission-" + language
        pair["permission_record_ids"].append(permission_id)
        permissions.append({"permission_id": permission_id, "source_id": source["source_id"],
            "source_version": source["version"], "source_sha256": source["content_sha256"], "status": "granted",
            "permitted_derivatives": ["translation", "parallel_evaluation"], "granted_by": "synthetic-fixture-author",
            "permission_evidence": "Synthetic test declaration only; no actual permissioned Tibetan or Chinese material.",
            "evidence_kind": "synthetic_test"})
    parallel = {"schema_version": "1.0", "evidence_kind": "synthetic_test", "pairs": [pair],
        "permissions": permissions, "equivalence_reviews": [], "equivalence_adjudications": []}
    return dataset, parallel


def reviewed_contract_stub():
    """Fabricated in-memory provenance for branch tests; never export as evidence."""
    dataset, parallel = synthetic_pair()
    parallel["evidence_kind"] = "human_review"
    for permission in parallel["permissions"]:
        permission["evidence_kind"] = "human_review"
    pair = parallel["pairs"][0]
    for source, example in zip(dataset["sources"], dataset["examples"]):
        source.update(source_kind="community", language_review="approved")
        example.update(approved_answer="Synthetic held-out reference; never a model prompt.", review_state="approved")
        checksum = example_sha256(example)
        pair["members"][source["language"]]["example_sha256"] = checksum
        ids = []
        for reviewer in (1, 2):
            rid = f"contract-{example['example_id']}-review-{reviewer}"
            ids.append(rid)
            dataset["reviews"].append({"review_id": rid, "example_id": example["example_id"],
                "example_version": 1, "example_sha256": checksum, "source_sha256": example["source_sha256"],
                "reviewer_id": f"contract-language-reviewer-{reviewer}", "reviewer_role": "language_reviewer",
                "review_type": "language", "ratings": {"naturalness": 4, "fidelity": 4, "comprehension": 4},
                "issues": [], "minutes_spent": 1, "status": "complete", "recommendation": "approve",
                "revision": 1, "supersedes_review_id": None})
        dataset["adjudications"].append({"adjudication_id": "contract-decision-" + example["example_id"],
            "example_id": example["example_id"], "example_version": 1, "example_sha256": checksum,
            "review_ids": ids, "adjudicator_id": "contract-language-reviewer-1", "decision": "approve",
            "language_review": "approved", "medical_review": "not_applicable",
            "rationale": "Fabricated unit-test provenance; not a human review.", "minutes_spent": 1})
    for reviewer in (1, 2):
        parallel["equivalence_reviews"].append({"review_id": f"contract-equivalence-{reviewer}",
            "pair_id": pair["pair_id"], "pair_version": 1, "parallel_pair_sha256": pair_sha256(pair),
            "reviewer_id": f"contract-bilingual-{reviewer}", "reviewer_languages": ["bo", "zh"],
            "independent_judgment": True, "evidence_kind": "human_review",
            "checks": {key: True for key in PRESERVATION_CHECKS}, "status": "complete", "recommendation": "approve",
            "issues": [], "minutes_spent": 1})
    parallel["equivalence_adjudications"].append({"adjudication_id": "contract-pair-adjudication",
        "pair_id": pair["pair_id"], "pair_version": 1, "parallel_pair_sha256": pair_sha256(pair),
        "adjudicator_id": "contract-bilingual-1", "evidence_kind": "human_review",
        "review_bindings": [{"review_id": r["review_id"], "review_sha256": record_sha256(r)}
                            for r in parallel["equivalence_reviews"]],
        "decision": "approve", "rationale": "Fabricated unit-test provenance; not a human adjudication.", "minutes_spent": 1})
    return dataset, parallel


class ParallelTests(unittest.TestCase):
    def check(self, dataset, parallel, purpose="infrastructure_smoke"):
        return validate_parallel_material(dataset, parallel, purpose=purpose,
            pair_ids=[parallel["pairs"][0]["pair_id"]])

    def test_smoke_validates_without_claiming_native_review_or_mutating_records(self):
        dataset, parallel = synthetic_pair()
        original = deepcopy((dataset, parallel))
        audit = self.check(dataset, parallel)
        self.assertTrue(audit["valid"])
        self.assertEqual(audit["example_ids"], [e["example_id"] for e in dataset["examples"]])
        self.assertEqual(audit["parallel_material_sha256"], record_sha256(parallel))
        self.assertEqual((dataset, parallel), original)
        self.assertFalse(parallel["equivalence_reviews"])

    def test_ordered_conditions_select_input_member_and_distinct_output_language(self):
        dataset, parallel = synthetic_pair()
        jobs = condition_jobs(dataset, parallel, ["synthetic-pair-1"], list(CONDITIONS))
        self.assertEqual([j["condition_id"] for j in jobs], list(CONDITIONS))
        self.assertEqual([j["example_id"] for j in jobs], ["fixture-example-1"] * 2 + ["fixture-example-2"] * 2)
        self.assertEqual([j["output_language"] for j in jobs], ["bo", "zh", "bo", "zh"])
        self.assertEqual(len({j["parallel_pair_sha256"] for j in jobs}), 1)
        reordered = condition_jobs(dataset, parallel, ["synthetic-pair-1"], ["zh_to_bo", "bo_to_bo"])
        self.assertEqual([j["condition_id"] for j in reordered], ["zh_to_bo", "bo_to_bo"])

    def test_prompt_preserves_text_and_never_includes_reference_or_allowed_claims(self):
        source = {"original_text": "  e\u0301\n༌  "}
        example = {"question": "  exact question?\n", "approved_answer": "SECRET REFERENCE", "allowed_claims": ["SECRET CLAIM"]}
        bo = conversation_for_condition(source, example, "bo")[0]["content"]
        zh = conversation_for_condition(source, example, "zh")[0]["content"]
        self.assertIn(source["original_text"], bo)
        self.assertTrue(bo.endswith(example["question"]))
        self.assertNotIn("SECRET", bo)
        self.assertEqual(bo.replace("Answer in Tibetan.", "Answer in Chinese."), zh)
        with self.assertRaises(RecordsError):
            conversation_for_condition(source, example, "en")

    def test_duplicate_missing_unknown_or_empty_selection_is_rejected(self):
        dataset, parallel = synthetic_pair()
        for ids in ([], ["missing"], ["synthetic-pair-1"] * 2):
            with self.subTest(ids=ids), self.assertRaises(RecordsError):
                validate_parallel_material(dataset, parallel, purpose="infrastructure_smoke", pair_ids=ids)
        for conditions in ([], ["bo_to_bo"] * 2, ["en_to_bo"]):
            with self.subTest(conditions=conditions), self.assertRaises(RecordsError):
                condition_jobs(dataset, parallel, ["synthetic-pair-1"], conditions)

    def test_exact_hash_version_language_and_shared_groups_are_enforced(self):
        for field, replacement in (("example_sha256", "0" * 64), ("source_sha256", "0" * 64),
                                    ("example_version", 2), ("source_version", 2)):
            dataset, parallel = synthetic_pair()
            parallel["pairs"][0]["members"]["bo"][field] = replacement
            with self.subTest(field=field), self.assertRaisesRegex(RecordsError, "Stale"):
                self.check(dataset, parallel)
        dataset, parallel = synthetic_pair()
        dataset["sources"][0]["language"] = "zh"
        with self.assertRaisesRegex(RecordsError, "language"):
            self.check(dataset, parallel)
        for field in ("scenario_group", "paraphrase_group"):
            dataset, parallel = synthetic_pair()
            parallel["pairs"][0][field] = "different"
            with self.subTest(field=field), self.assertRaisesRegex(RecordsError, "share"):
                self.check(dataset, parallel)

    def test_source_and_derivative_permissions_are_separate(self):
        for language_index in (0, 1):
            for ordinary in ("private_research", "development_screen", "review"):
                dataset, parallel = synthetic_pair()
                dataset["sources"][language_index]["permitted_uses"].remove(ordinary)
                with self.subTest(language=language_index, ordinary=ordinary), self.assertRaises(RecordsError):
                    self.check(dataset, parallel)
            for field, value in (("status", "pending"), ("permitted_derivatives", ["translation"]),
                                 ("permission_evidence", " "), ("granted_by", None)):
                dataset, parallel = synthetic_pair()
                parallel["permissions"][language_index][field] = value
                with self.subTest(language=language_index, field=field), self.assertRaises(RecordsError):
                    self.check(dataset, parallel)

    def test_permission_identity_bindings_and_duplicate_records_fail(self):
        dataset, parallel = synthetic_pair()
        parallel["permissions"][0]["source_sha256"] = "a" * 64
        with self.assertRaisesRegex(RecordsError, "stale"):
            self.check(dataset, parallel)
        for collection in ("pairs", "permissions"):
            dataset, parallel = synthetic_pair()
            parallel[collection].append(deepcopy(parallel[collection][0]))
            with self.subTest(collection=collection), self.assertRaisesRegex(RecordsError, "Duplicate"):
                self.check(dataset, parallel)

    def test_cross_split_or_connected_prior_exposure_blocks(self):
        dataset, parallel = synthetic_pair()
        dataset["examples"][1]["split"] = "validation"
        with self.assertRaisesRegex(RecordsError, "split/exposure"):
            self.check(dataset, parallel)
        dataset, parallel = synthetic_pair()
        dataset["sources"][1]["permitted_uses"].append("train")
        dataset["examples"][1]["exposures"] = ["train"]
        with self.assertRaisesRegex(RecordsError, "prior training"):
            self.check(dataset, parallel)

    def test_synthetic_and_pending_equivalence_cannot_grant_language_eligibility(self):
        dataset, parallel = synthetic_pair()
        with self.assertRaisesRegex(RecordsError, "human_review"):
            self.check(dataset, parallel, "language_baseline")
        dataset, parallel = reviewed_contract_stub()
        parallel["equivalence_adjudications"] = []
        with self.assertRaisesRegex(RecordsError, "equivalence adjudication"):
            self.check(dataset, parallel, "language_baseline")

    def test_recorded_reviews_and_separate_adjudication_allow_language_contract(self):
        dataset, parallel = reviewed_contract_stub()
        self.assertTrue(self.check(dataset, parallel, "language_baseline")["valid"])
        # The adjudicator can be one reviewer; approval remains a separate record.
        self.assertEqual(parallel["equivalence_adjudications"][0]["adjudicator_id"],
                         parallel["equivalence_reviews"][0]["reviewer_id"])

    def test_unapproved_version_or_missing_medical_review_remains_blocked(self):
        for index in (0, 1):
            dataset, parallel = reviewed_contract_stub()
            dataset["sources"][index]["language_review"] = "pending"
            with self.subTest(index=index), self.assertRaisesRegex(RecordsError, "Both language versions"):
                self.check(dataset, parallel, "language_baseline")
            dataset, parallel = reviewed_contract_stub()
            for source in dataset["sources"]:
                source.update(scope="health", medical_review="approved")
            dataset["sources"][index]["medical_review"] = "pending"
            with self.subTest(index=index), self.assertRaisesRegex(RecordsError, "medical approval"):
                self.check(dataset, parallel, "language_baseline")

    def test_translated_health_material_cannot_be_reclassified_nonclinical(self):
        dataset, parallel = reviewed_contract_stub()
        dataset["sources"][0].update(scope="health", medical_review="pending")
        with self.assertRaisesRegex(RecordsError, "clinical scope"):
            self.check(dataset, parallel, "language_baseline")

    def test_review_independence_bilingual_competence_and_all_checks_required(self):
        for field, value in (("independent_judgment", False), ("reviewer_languages", ["bo"]),
                             ("minutes_spent", None), ("recommendation", "pending")):
            dataset, parallel = reviewed_contract_stub()
            parallel["equivalence_reviews"][0][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(RecordsError, "Complete equivalence"):
                self.check(dataset, parallel, "language_baseline")
        for check in PRESERVATION_CHECKS:
            dataset, parallel = reviewed_contract_stub()
            parallel["equivalence_reviews"][0]["checks"][check] = False
            with self.subTest(check=check), self.assertRaisesRegex(RecordsError, "every preservation"):
                self.check(dataset, parallel, "language_baseline")

    def test_source_question_or_translation_contributor_cannot_review_own_pair(self):
        for identity in ("synthetic-contributor-1", "synthetic-contributor-2", "synthetic-translation-author"):
            dataset, parallel = reviewed_contract_stub()
            parallel["equivalence_reviews"][0]["reviewer_id"] = identity
            with self.subTest(identity=identity), self.assertRaisesRegex(RecordsError, "independent"):
                self.check(dataset, parallel, "language_baseline")

    def test_adjudication_needs_distinct_complete_current_review_hashes(self):
        for mutation in ("duplicate_reviewer", "one_review", "changed_review", "stale_pair"):
            dataset, parallel = reviewed_contract_stub()
            if mutation == "duplicate_reviewer":
                parallel["equivalence_reviews"][1]["reviewer_id"] = parallel["equivalence_reviews"][0]["reviewer_id"]
            elif mutation == "one_review":
                parallel["equivalence_adjudications"][0]["review_bindings"].pop()
            elif mutation == "changed_review":
                parallel["equivalence_reviews"][0]["minutes_spent"] = 2
            else:
                parallel["pairs"][0]["version"] = 2
            with self.subTest(mutation=mutation), self.assertRaises(RecordsError):
                self.check(dataset, parallel, "language_baseline")

    def test_no_mixed_synthetic_human_evidence_or_schema_extensions(self):
        for collection in ("permissions", "equivalence_reviews", "equivalence_adjudications"):
            dataset, parallel = reviewed_contract_stub()
            parallel[collection][0]["evidence_kind"] = "synthetic_test"
            with self.subTest(collection=collection), self.assertRaisesRegex(RecordsError, "evidence kind"):
                self.check(dataset, parallel, "language_baseline")
        dataset, parallel = synthetic_pair()
        parallel["auto_approve"] = True
        with self.assertRaisesRegex(RecordsError, "schema"):
            self.check(dataset, parallel)


if __name__ == "__main__":
    unittest.main()
