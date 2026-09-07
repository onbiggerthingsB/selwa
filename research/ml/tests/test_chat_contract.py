"""Cross-language and Python-boundary checks for synthetic research chat."""

from __future__ import annotations

import copy
import json
import math
import unittest
from importlib.resources import files

from jsonschema import Draft202012Validator

from ht_tibetan.chat_contract import (
    validate_chat_catalog,
    validate_chat_request,
    validate_chat_response,
)
from ht_tibetan.records import RecordsError, content_sha256


class ChatContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        package = files("ht_tibetan_contracts")
        cls.fixture = json.loads(package.joinpath("fixtures/chat-conformance.json").read_text(encoding="utf-8"))
        cls.request = next(case["value"] for case in cls.fixture["cases"] if case["name"] == "request valid selected source")
        cls.response = next(case["value"] for case in cls.fixture["cases"] if case["name"] == "response valid success")
        cls.catalog = next(case["value"] for case in cls.fixture["cases"] if case["name"] == "catalog valid two synthetic sources")

    def test_shared_schema_is_valid_and_packaged(self):
        schema = json.loads(files("ht_tibetan_contracts").joinpath("chat.schema.json").read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
        self.assertEqual(schema["$id"], "https://health-translator.local/research/contracts/chat.schema.json")
        self.assertEqual(set(schema["$defs"]) & {"request", "response", "catalog"}, {"request", "response", "catalog"})

    def test_shared_conformance_cases(self):
        self.assertEqual(self.fixture["schema_version"], "1.0")
        self.assertGreaterEqual(len(self.fixture["cases"]), 72)
        names = [case["name"] for case in self.fixture["cases"]]
        self.assertEqual(len(names), len(set(names)))
        for case in self.fixture["cases"]:
            with self.subTest(case=case["name"]):
                original = copy.deepcopy(case)

                def validate():
                    if case["kind"] == "request":
                        return validate_chat_request(case["value"], case.get("catalog"))
                    if case["kind"] == "response":
                        return validate_chat_response(case["value"], case["request"])
                    self.assertEqual(case["kind"], "catalog")
                    return validate_chat_catalog(case["value"])

                if case["valid"]:
                    self.assertEqual(validate(), case["value"])
                else:
                    with self.assertRaises(RecordsError):
                        validate()
                self.assertEqual(case, original, "Validation must never rewrite supplied data.")

    def test_rejects_nonfinite_numbers_and_nonjson_python_values(self):
        for value in (math.nan, math.inf, -math.inf, b"binary", ("tuple",), {"set"}):
            with self.subTest(value=repr(value)):
                request = copy.deepcopy(self.request)
                request["source"]["version"] = value
                with self.assertRaises(RecordsError):
                    validate_chat_request(request)
        request = copy.deepcopy(self.request)
        request[1] = "Non-string object key"
        with self.assertRaises(RecordsError):
            validate_chat_request(request)

    def test_circular_python_input_is_rejected_as_a_record_error(self):
        request = copy.deepcopy(self.request)
        request["messages"].append(request)
        with self.assertRaises(RecordsError):
            validate_chat_request(request)

    def test_integral_json_number_versions_match_javascript_semantics(self):
        request = copy.deepcopy(self.request)
        request["source"]["version"] = 1.0
        self.assertEqual(validate_chat_request(request, self.catalog), request)
        response = copy.deepcopy(self.response)
        response["citations"][0]["version"] = 1.0
        self.assertEqual(validate_chat_response(response, self.request), response)
        for invalid in (True, False, 1.5, 0.0, -1.0, float(2**53)):
            request["source"]["version"] = invalid
            with self.subTest(invalid=invalid), self.assertRaises(RecordsError):
                validate_chat_request(request)

    def test_unicode_scalar_validation_includes_object_keys_and_metadata(self):
        mutations = (
            lambda request: request.update({"\ud800": "bad key"}),
            lambda request: request.update(request_id="\udfff"),
            lambda request: request["source"].update(source_id="\ud800"),
            lambda request: request["messages"][0].update(content="\ud800\udfff"),
        )
        for mutate in mutations:
            request = copy.deepcopy(self.request)
            mutate(request)
            with self.assertRaises(RecordsError):
                validate_chat_request(request)
        catalog = copy.deepcopy(self.catalog)
        catalog["sources"][0]["title"] = "\ud800"
        with self.assertRaises(RecordsError):
            validate_chat_catalog(catalog)

    def test_source_hash_and_output_preserve_exact_unicode(self):
        catalog = copy.deepcopy(self.catalog)
        source = catalog["sources"][0]
        source["original_text"] = "e\u0301 ཀ་ 中文 😀\r\n"
        source["content_sha256"] = content_sha256(source["original_text"])
        original = copy.deepcopy(catalog)
        self.assertEqual(validate_chat_catalog(catalog), original)
        for changed in ("é ཀ་ 中文 😀\r\n", source["original_text"].replace("\r\n", "\n"), "\ufeff" + source["original_text"]):
            changed_catalog = copy.deepcopy(catalog)
            changed_catalog["sources"][0]["original_text"] = changed
            with self.subTest(changed=changed), self.assertRaises(RecordsError):
                validate_chat_catalog(changed_catalog)

    def test_unknown_source_requires_catalog_binding_before_dispatch(self):
        request = copy.deepcopy(self.request)
        request["source"]["source_id"] = "not-in-catalog"
        self.assertEqual(validate_chat_request(request), request)
        with self.assertRaises(RecordsError):
            validate_chat_request(request, self.catalog)

    def test_response_also_validates_its_request(self):
        request = copy.deepcopy(self.request)
        request["messages"][0]["role"] = "assistant"
        with self.assertRaises(RecordsError):
            validate_chat_response(self.response, request)
        with self.assertRaises(RecordsError):
            validate_chat_response(self.response, None)

    def test_other_catalog_source_is_not_a_valid_response_citation(self):
        response = copy.deepcopy(self.response)
        response["citations"] = [{key: self.catalog["sources"][1][key] for key in ("source_id", "version", "content_sha256")}]
        with self.assertRaises(RecordsError):
            validate_chat_response(response, self.request)

    def test_nonblank_is_consistent_with_ecmascript_trim(self):
        for blank in ("\ufeff", "\u3000", "\u00a0", "\u2000\t\n"):
            request = copy.deepcopy(self.request)
            request["messages"][0]["content"] = blank
            with self.subTest(blank=repr(blank)), self.assertRaises(RecordsError):
                validate_chat_request(request)
        for nonblank in ("\u0085", "\u001c", "\u200b", " \ufeffཀ་ "):
            request = copy.deepcopy(self.request)
            request["messages"][0]["content"] = nonblank
            self.assertEqual(validate_chat_request(request), request)


if __name__ == "__main__":
    unittest.main()
