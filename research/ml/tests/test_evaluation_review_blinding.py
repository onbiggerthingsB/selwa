"""Pure synthetic packet checks; no model execution or real human judgments."""
from copy import deepcopy
import json
import unittest
from unittest.mock import patch

from ht_tibetan.evaluation_review_blinding import blind_packet, decode_blinded_review
from ht_tibetan.records import RecordsError, record_sha256


def fixture():
    identities = [
        {"candidate_id": "secret-model-a", "arm_id": "secret-base", "condition_sha256": "a" * 64},
        {"candidate_id": "secret-model-a", "arm_id": "secret-adapted", "condition_sha256": "a" * 64},
        {"candidate_id": "secret-model-b", "arm_id": "secret-base", "condition_sha256": "b" * 64},
    ]
    text = "བོད་ཡིག་ ཀཱ་ ཀ\u0f71་ e\u0301  \n保留原文 🥣"
    return {"schema_version": "1.0", "kind": "evaluation_native_review", "evidence_kind": "synthetic_test",
        "evaluation_report_path": "/private/secret-run/report.json", "evaluation_report_sha256": "e" * 64,
        "study_sha256": "f" * 64, "reviewer_id": "reader-one", "status": "incomplete", "independent": False,
        "items": [{"case_id": "secret-case-" + str(i), "case_sha256": str(i + 1) * 64, **identity,
            "source_text": text, "question": "ག་རེ།?", "messages": [{"role": "user", "content": "Read exactly.\n" + text}],
            "answer": "བོད་ཡིག་ " + str(i), "outcome": "success", "status": "incomplete",
            "ratings": {axis: None for axis in ("fidelity", "comprehension", "naturalness")},
            "critical_errors": {"number_changed": "not_assessed", "negation_changed": "not_assessed"},
            "minutes_spent": None, "blind_compromised": True, "notes": ""}
            for i, identity in enumerate(identities[:2])],
        "candidate_decisions": [{**identity, "recommendation": "pending", "rationale": ""} for identity in identities],
        "limitations": ["Original report-bound limitations remain private and exact."]}


def complete(public):
    result = deepcopy(public)
    result.update(status="complete", independent=True)
    for i, row in enumerate(result["items"]):
        row.update(status="complete", ratings={axis: 3 + i % 2 for axis in row["ratings"]},
            critical_errors={key: "absent" for key in row["critical_errors"]}, minutes_spent=1.5 + i,
            notes="Synthetic review only. " + row["item_id"])
    for row in result["candidate_decisions"]:
        row.update(recommendation="revise", rationale="Synthetic suitability judgment.")
    return result


class EvaluationReviewBlindingTests(unittest.TestCase):
    def setUp(self):
        self.original = fixture()
        self.public, self.key = blind_packet(self.original)

    def test_public_allowlist_hides_metadata_and_keeps_exact_unicode(self):
        serialized = json.dumps(self.public, ensure_ascii=False)
        for marker in ("secret-model", "secret-base", "secret-adapted", "secret-case", "secret-run", "a" * 64,
                       "b" * 64, "e" * 64, "f" * 64, "case_sha256", "study_sha256", "condition_sha256"):
            self.assertNotIn(marker, serialized)
        self.assertEqual(set(self.public), {"schema_version", "kind", "evidence_kind", "reviewer_id", "status",
            "independent", "items", "candidate_decisions", "limitations"})
        for row in self.public["items"]:
            source = next(item for item in self.original["items"] if item["answer"] == row["answer"])
            for field in ("source_text", "question", "messages", "answer"):
                self.assertEqual(row[field], source[field])
            self.assertIs(row["blind_compromised"], False)

    def test_roundtrip_restores_original_order_and_judgments(self):
        returned = complete(self.public)
        returned["items"][0]["blind_compromised"] = True
        decoded = decode_blinded_review(returned, self.key)
        self.assertEqual([r["case_id"] for r in decoded["items"]], [r["case_id"] for r in self.original["items"]])
        self.assertEqual(decoded["limitations"], self.original["limitations"])
        self.assertEqual(decoded["candidate_decisions"][2]["candidate_id"], "secret-model-b")
        for row in returned["items"]:
            original_id = self.key["item_map"][row["item_id"]]
            decoded_row = next(item for item in decoded["items"] if item["case_id"] == original_id)
            self.assertEqual(decoded_row["notes"], row["notes"])
            self.assertEqual(decoded_row["blind_compromised"], row["blind_compromised"])

    def test_blank_and_partial_packets_roundtrip_without_manufactured_completion(self):
        self.public["items"][0]["ratings"]["fidelity"] = 2
        decoded = decode_blinded_review(self.public, self.key)
        self.assertEqual(decoded["status"], "incomplete")
        self.assertFalse(decoded["independent"])
        self.assertEqual(sum(row["ratings"]["fidelity"] == 2 for row in decoded["items"]), 1)

    def test_fresh_aliases_differ_and_keep_candidate_arm_condition_groups_separate(self):
        again, key = blind_packet(self.original)
        self.assertFalse(set(key["candidate_map"]) & set(self.key["candidate_map"]))
        self.assertFalse(set(key["item_map"]) & set(self.key["item_map"]))
        self.assertEqual(len(self.key["candidate_map"]), 3)
        self.assertEqual(len(self.public["candidate_decisions"]), 3)  # Including an arm with no successful output.
        with self.assertRaises(RecordsError):
            decode_blinded_review(self.public, key)
        with self.assertRaises(RecordsError):
            decode_blinded_review(again, self.key)

    def test_item_and_candidate_orders_are_independently_shuffled(self):
        def reverse(rows):
            rows.reverse()
        with patch("ht_tibetan.evaluation_review_blinding.secrets.SystemRandom") as rng:
            rng.return_value.shuffle.side_effect = reverse
            public, key = blind_packet(self.original)
        self.assertEqual(rng.return_value.shuffle.call_count, 2)
        self.assertEqual([key["item_map"][r["item_id"]] for r in public["items"]],
                         [r["case_id"] for r in reversed(self.original["items"])])
        self.assertEqual(key["candidate_map"][public["candidate_decisions"][0]["candidate_alias"]]["candidate_id"], "secret-model-b")

    def test_no_input_or_key_mutation_and_no_shared_return_aliases(self):
        original = deepcopy(self.original)
        public, key = blind_packet(original)
        self.assertEqual(original, self.original)
        returned = complete(public)
        before_returned, before_key = deepcopy(returned), deepcopy(key)
        decoded = decode_blinded_review(returned, key)
        self.assertEqual(returned, before_returned)
        self.assertEqual(key, before_key)
        decoded["items"][0]["messages"][0]["content"] = "changed"
        self.assertEqual(key, before_key)
        public["items"][0]["messages"][0]["content"] = "changed"
        self.assertEqual(key, before_key)

    def test_immutable_fields_alias_order_and_text_edits_fail(self):
        mutations = [lambda p: p.update(reviewer_id="reader-two"), lambda p: p.update(evidence_kind="human_review"),
            lambda p: p["items"].reverse(), lambda p: p["candidate_decisions"].reverse(),
            lambda p: p["items"][0].update(candidate_alias=p["items"][1]["candidate_alias"]),
            lambda p: p["items"][0].update(answer="Edited answer"),
            lambda p: p["items"][0]["messages"][0].update(content="Edited instruction"),
            lambda p: p["items"][0].update(source_text=p["items"][0]["source_text"].replace("e\u0301", "é")),
            lambda p: p["limitations"].append("Edited limitation")]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                packet = deepcopy(self.public)
                mutate(packet)
                with self.assertRaises(RecordsError):
                    decode_blinded_review(packet, self.key)

    def test_duplicate_missing_extra_and_unknown_rows_fail(self):
        mutations = [lambda p: p["items"].pop(), lambda p: p["items"].append(deepcopy(p["items"][0])),
            lambda p: p["items"].__setitem__(1, deepcopy(p["items"][0])),
            lambda p: p["candidate_decisions"].pop(),
            lambda p: p["candidate_decisions"].__setitem__(1, deepcopy(p["candidate_decisions"][0])),
            lambda p: p.update(unknown=True), lambda p: p["items"][0].update(case_id="hidden"),
            lambda p: p["candidate_decisions"][0].update(candidate_id="hidden")]
        for mutate in mutations:
            packet = deepcopy(self.public)
            mutate(packet)
            with self.assertRaises(RecordsError):
                decode_blinded_review(packet, self.key)

    def test_key_hash_mapping_and_rehashed_template_tampering_fail(self):
        mutations = [lambda k: k["original_packet"].update(reviewer_id="other"),
            lambda k: k.update(original_packet_sha256="0" * 64),
            lambda k: k["candidate_map"][next(iter(k["candidate_map"]))].update(arm_id="unknown"),
            lambda k: k["item_map"].update({next(iter(k["item_map"])): "unknown"}),
            lambda k: k["public_template"]["items"][0].update(answer="changed"),
            lambda k: k.update(unknown=True)]
        for mutate in mutations:
            key = deepcopy(self.key)
            mutate(key)
            with self.assertRaises(RecordsError):
                decode_blinded_review(self.public, key)
        key = deepcopy(self.key)
        key["public_template"]["items"][0]["answer"] = "changed"
        key["public_template_sha256"] = record_sha256(key["public_template"])
        with self.assertRaisesRegex(RecordsError, "exact original"):
            decode_blinded_review(self.public, key)

    def test_invalid_response_types_categories_and_nonfinite_numbers_fail(self):
        mutations = [lambda r: r.update(minutes_spent=True), lambda r: r.update(minutes_spent=-1),
            lambda r: r.update(minutes_spent=float("nan")), lambda r: r.update(minutes_spent=float("inf")),
            lambda r: r.update(minutes_spent=10 ** 400), lambda r: r.update(minutes_spent=1_000_001),
            lambda r: r.update(blind_compromised=None),
            lambda r: r.update(blind_compromised=1), lambda r: r["ratings"].update(fidelity=True),
            lambda r: r["ratings"].update(fidelity=5), lambda r: r["critical_errors"].update(number_changed=False),
            lambda r: r["critical_errors"].update(unknown="absent"), lambda r: r.update(notes="x" * 8001)]
        for mutate in mutations:
            packet = deepcopy(self.public)
            mutate(packet["items"][0])
            with self.assertRaises(RecordsError):
                decode_blinded_review(packet, self.key)

    def test_complete_status_requires_independence_full_judgments_and_recommendations(self):
        mutations = [lambda p: p.update(independent=False), lambda p: p["items"][0].update(status="incomplete"),
            lambda p: p["items"][0].update(minutes_spent=None),
            lambda p: p["items"][0]["ratings"].update(fidelity=None),
            lambda p: p["items"][0]["critical_errors"].update(number_changed="not_assessed"),
            lambda p: p["candidate_decisions"][0].update(recommendation="pending"),
            lambda p: p["candidate_decisions"][0].update(rationale=" ")]
        for mutate in mutations:
            packet = complete(self.public)
            mutate(packet)
            with self.assertRaises(RecordsError):
                decode_blinded_review(packet, self.key)

    def test_original_requires_blank_unique_successful_review_roster(self):
        mutations = [lambda p: p.update(status="complete"), lambda p: p.update(items=[]),
            lambda p: p["items"][0]["ratings"].update(fidelity=4),
            lambda p: p["items"][0].update(outcome="timeout"),
            lambda p: p["items"].append(deepcopy(p["items"][0])),
            lambda p: p["candidate_decisions"].append(deepcopy(p["candidate_decisions"][0])),
            lambda p: p["candidate_decisions"][0].update(recommendation="approve")]
        for mutate in mutations:
            packet = deepcopy(self.original)
            mutate(packet)
            with self.assertRaises(RecordsError):
                blind_packet(packet)

    def test_export_rejects_pair_whose_embedded_key_exceeds_limit(self):
        single_size = len(json.dumps(self.original, ensure_ascii=False).encode("utf-8"))
        public_size = len(json.dumps(self.public, ensure_ascii=False).encode("utf-8"))
        with patch("ht_tibetan.evaluation_review_blinding._MAX_BYTES", max(single_size, public_size) + 100):
            with self.assertRaisesRegex(RecordsError, "bounded JSON"):
                blind_packet(self.original)

    def test_actual_study_template_is_supported(self):
        from ht_tibetan.study import _review_template
        from test_study import study_fixture
        report = {"engineering_only": True, "cases": [{
            **{key: value for key, value in row.items() if key not in {"ratings", "critical_errors", "notes", "status",
                "minutes_spent", "blind_compromised", "outcome", "answer"}},
            "result": {"outcome": "success", "answer": row["answer"]}} for row in self.original["items"]],
            "condition_identities": [{"condition_sha256": "a" * 64}],
            "candidates": [{"candidate_id": "secret-model-a", "arm_id": "secret-base"},
                           {"candidate_id": "secret-model-a", "arm_id": "secret-adapted"}]}
        original = _review_template(report, "/private/example.json", "e" * 64, "reader-one", study_fixture())
        public, key = blind_packet(original)
        decoded = decode_blinded_review(public, key)
        self.assertEqual(decoded["evaluation_report_sha256"], original["evaluation_report_sha256"])
        self.assertEqual(decoded["items"][0]["messages"], original["items"][0]["messages"])


if __name__ == "__main__":
    unittest.main()
