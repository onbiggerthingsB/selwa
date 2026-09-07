import copy
from pathlib import Path
import unittest

from ht_tibetan.records import RecordsError, load_dataset
from ht_tibetan.splits import audit_splits

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "fixtures"


class SplitTests(unittest.TestCase):
    def setUp(self):
        self.dataset = load_dataset(FIXTURES / "synthetic-dataset.json")

    def codes(self, policy="report"):
        return {e["code"] for e in audit_splits(self.dataset, policy)["errors"]}

    def test_disjoint_synthetic_sources_pass(self):
        self.dataset["examples"][1]["split"] = "final_test"
        report = audit_splits(self.dataset)
        self.assertTrue(report["valid"])
        self.assertEqual(len(report["components"]), 2)
        self.assertTrue(report["components"][1]["unseen_final_test"])

    def test_connected_transitive_groups_cannot_cross_splits(self):
        first, second = self.dataset["examples"]
        second["scenario_group"] = first["scenario_group"]
        third = copy.deepcopy(second)
        third.update(example_id="fixture-example-3", scenario_group="third-scenario", split="final_test")
        self.dataset["examples"].append(third)
        report = audit_splits(self.dataset)
        self.assertEqual(len(report["components"]), 1)
        self.assertIn("connected_split", self.codes())

    def test_smoke_exposure_cannot_become_unseen_test(self):
        self.dataset["sources"][0]["permitted_uses"].append("smoke_training")
        self.dataset["examples"][0].update(split="final_test", exposures=["smoke_training"])
        self.assertIn("test_leakage", self.codes())

    def test_identical_source_content_cannot_hide_under_a_different_id(self):
        first_source, second_source = self.dataset["sources"]
        first, second = self.dataset["examples"]
        second_source.update(original_text=first_source["original_text"], content_sha256=first_source["content_sha256"])
        second.update(source_sha256=first_source["content_sha256"], split="final_test")
        first["exposures"] = ["development_screen"]
        self.assertIn("connected_split", self.codes())
        self.assertIn("test_leakage", self.codes())

    def test_group_exposure_propagates_to_all_members(self):
        first = self.dataset["examples"][0]
        second = copy.deepcopy(first)
        second["example_id"] = "fixture-example-3"
        first.update(split="final_test", exposures=["development_screen"])
        second["split"] = "final_test"
        self.dataset["examples"].append(second)
        self.assertIn("test_leakage", self.codes())

    def test_evaluated_test_is_explicitly_exposed(self):
        self.dataset["examples"][0].update(split="final_test", exposures=["final_test"])
        report = audit_splits(self.dataset)
        self.assertTrue(report["valid"])
        self.assertFalse(report["components"][0]["unseen_final_test"])
        self.assertIn("test_exposed", {w["code"] for w in report["warnings"]})

    def test_contributor_overlap_policy_is_explicit(self):
        first, second = self.dataset["examples"]
        second.update(contributor_id=first["contributor_id"], split="final_test")
        report = audit_splits(self.dataset)
        self.assertTrue(report["valid"])
        self.assertEqual(len(report["contributor_overlap"]), 1)
        self.assertIn("contributor_overlap", self.codes("disjoint"))
        with self.assertRaises(RecordsError):
            audit_splits(self.dataset, "silently-ignore")

    def test_validation_exposure_and_test_reassignment_fail(self):
        self.dataset["examples"][0].update(split="validation", exposures=["development_screen"])
        self.dataset["examples"][1].update(exposures=["final_test"])
        self.assertIn("validation_leakage", self.codes())
        self.assertIn("test_reassignment", self.codes())


if __name__ == "__main__":
    unittest.main()
