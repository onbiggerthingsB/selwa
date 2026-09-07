import copy
from pathlib import Path
import tempfile
import unittest

from ht_tibetan.records import (RecordsError, atomic_write_json, content_sha256,
                                example_sha256, load_dataset, validate_dataset)

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "fixtures"


class RecordsTests(unittest.TestCase):
    def setUp(self):
        self.dataset = load_dataset(FIXTURES / "synthetic-dataset.json")

    def codes(self, dataset=None):
        return {e["code"] for e in validate_dataset(dataset or self.dataset)["errors"]}

    def test_shared_conformance_fixtures(self):
        manifest = load_dataset(FIXTURES / "conformance.json")
        for name in manifest["valid"]:
            with self.subTest(name=name):
                self.assertTrue(validate_dataset(load_dataset(FIXTURES / name))["valid"])
        for case in manifest["invalid"]:
            with self.subTest(name=case["file"]):
                self.assertIn(case["expected_error_code"], self.codes(load_dataset(FIXTURES / case["file"])))

    def test_exact_unicode_is_preserved(self):
        # This Unicode probe is not a Tibetan translation or a gold language example.
        text = "e\u0301\u0f0b\n\u00e9\u0f0d  "
        self.assertNotEqual(content_sha256(text), content_sha256(text.strip()))
        self.assertNotEqual(content_sha256("e\u0301"), content_sha256("\u00e9"))
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "unicode.json"
            atomic_write_json(path, {"text": text})
            self.assertEqual(load_dataset(path)["text"], text)
            with self.assertRaises(FileExistsError):
                atomic_write_json(path, {"text": "replacement"})
            self.assertEqual(load_dataset(path)["text"], text)

    def test_duplicate_ids_and_stale_source(self):
        self.dataset["examples"].append(copy.deepcopy(self.dataset["examples"][0]))
        self.dataset["sources"][0]["version"] = 2
        self.assertIn("duplicate_id", self.codes())
        self.assertIn("stale_source", self.codes())

    def test_incomplete_review_never_approves_an_example(self):
        example = self.dataset["examples"][0]
        example["review_state"] = "approved"
        example["approved_answer"] = "Synthetic draft answer."
        self.assertIn("missing_adjudication", self.codes())

    def test_health_pending_is_not_language_approval(self):
        source = self.dataset["sources"][0]
        source.update(source_kind="community", scope="health", medical_review="pending", language_review="approved")
        source["permitted_uses"].append("train")
        self.dataset["examples"][0]["split"] = "train"
        self.assertIn("training_medical", self.codes())
        self.assertIn("training_review", self.codes())

    def test_workflow_changes_do_not_change_reviewed_content_hash(self):
        example = self.dataset["examples"][0]
        original = example_sha256(example)
        example.update(review_state="approved", split="final_test", exposures=["final_test"])
        self.assertEqual(example_sha256(example), original)
        example["question"] += " "
        self.assertNotEqual(example_sha256(example), original)

    def test_strict_json_rejects_duplicate_keys_and_nonfinite_values(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "bad.json"
            for content in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}'):
                path.write_text(content)
                with self.assertRaises(RecordsError):
                    load_dataset(path)

    def test_unknown_fields_and_bad_dates_fail(self):
        self.dataset["sources"][0]["source_date"] = "2026-02-31"
        self.dataset["examples"][0]["undeclared"] = True
        self.assertIn("schema", self.codes())

    def test_in_memory_records_reject_nonfinite_values(self):
        self.dataset["sources"][0]["version"] = float("nan")
        report = validate_dataset(self.dataset)
        self.assertFalse(report["valid"])
        self.assertIn("finite JSON", report["errors"][0]["message"])


if __name__ == "__main__":
    unittest.main()
