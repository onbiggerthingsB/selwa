"""Private verification and public-only HTML using synthetic report fixtures."""
import base64
import hashlib
import json
from pathlib import Path
import re
import unittest
from unittest.mock import patch

from ht_tibetan.evaluation_review_form import export_evaluation_review_form
from ht_tibetan.records import RecordsError, load_dataset
from ht_tibetan.study import export_evaluation_review, load_evaluation_review


class EvaluationReviewFormTests(unittest.TestCase):
    def setUp(self):
        from test_study import SelectionTests
        self.fixture = SelectionTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.make_evaluation(engineering=True)
        self.root = self.fixture.root
        self.packet = self.root / "reviewer" / "packet.json"
        self.key = self.root / "operator" / "key.json"
        self.output = self.root / "forms" / "review.html"
        export_evaluation_review(self.fixture.report_path, "fixture-reviewer", self.packet,
            study=self.fixture.study_path, key_path=self.key)

    def export(self, **changes):
        return export_evaluation_review_form(self.packet, changes.pop("output_path", self.output),
            **({"study_path": self.fixture.study_path, "report_path": self.fixture.report_path,
                "key_path": self.key} | changes))

    def embedded(self):
        text = self.output.read_text()
        encoded = re.search(r'<script id="evaluation-packet" type="application/octet-stream">([^<]+)</script>', text).group(1)
        return base64.b64decode(encoded)

    def test_only_exact_public_packet_bytes_are_embedded_and_originals_unchanged(self):
        packet_before, key_before = self.packet.read_bytes(), self.key.read_bytes()
        receipt = self.export()
        self.assertEqual(self.embedded(), packet_before)
        self.assertEqual(self.packet.read_bytes(), packet_before)
        self.assertEqual(self.key.read_bytes(), key_before)
        self.assertEqual(receipt["packet_file_sha256"], hashlib.sha256(packet_before).hexdigest())
        self.assertEqual(receipt["html_file_sha256"], hashlib.sha256(self.output.read_bytes()).hexdigest())
        self.assertFalse(receipt["approval_granted"])
        self.assertFalse(receipt["review_imported"])
        public_text = self.output.read_text() + self.embedded().decode()
        for private in (str(self.fixture.report_path), "qwen3-4b", "gemma3-4b", "test-evaluation-0001",
                        "private_evaluation_review_key", "original_packet_sha256", "evaluation_report_sha256"):
            self.assertNotIn(private, public_text)

    def test_blank_embedded_packet_loads_back_with_same_key_and_remains_incomplete(self):
        self.export()
        returned = self.root / "returned.json"
        returned.write_bytes(self.embedded())
        returned.chmod(0o600)
        packet, _ = load_evaluation_review(returned, study=self.fixture.study_path,
            evaluation_report_path=self.fixture.report_path, key_path=self.key)
        self.assertEqual(packet["status"], "incomplete")
        self.assertFalse(packet["independent"])
        for item in packet["items"]:
            self.assertTrue(all(value is None for value in item["ratings"].values()))
            self.assertIsNone(item["minutes_spent"])
            self.assertEqual(item["status"], "incomplete")

    def test_exact_script_and_style_hashes_match_no_network_policy(self):
        self.export()
        html = self.output.read_text()
        policy = re.search(r'http-equiv="Content-Security-Policy" content="([^"]+)"', html).group(1)
        script = re.search(r'<script>(.*?)</script>', html, re.S).group(1)
        style = re.search(r'<style>(.*?)</style>', html, re.S).group(1)
        for value in (script, style):
            digest = base64.b64encode(hashlib.sha256(value.encode()).digest()).decode()
            self.assertIn("'sha256-" + digest + "'", policy)
        for directive in ("connect-src 'none'", "default-src 'none'", "form-action 'none'", "base-uri 'none'"):
            self.assertIn(directive, policy)
        self.assertNotIn("unsafe-inline", policy)
        self.assertNotRegex(script, r"\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|innerHTML|outerHTML)\b")

    def test_tampered_public_packet_or_wrong_key_fails_before_html_creation(self):
        original = self.packet.read_bytes()
        packet = load_dataset(self.packet)
        packet["items"][0]["answer"] += " altered"
        self.packet.write_text(json.dumps(packet))
        with self.assertRaises(RecordsError):
            self.export()
        self.assertFalse(self.output.exists())
        self.packet.write_bytes(original)
        wrong = self.root / "wrong-key.json"
        wrong.write_text("{}")
        wrong.chmod(0o600)
        with self.assertRaises(RecordsError):
            self.export(key_path=wrong)
        self.assertFalse(self.output.exists())

    def test_missing_key_and_key_directory_target_are_rejected(self):
        with self.assertRaisesRegex(RecordsError, "retained operator key"):
            self.export(key_path=None)
        with self.assertRaisesRegex(RecordsError, "separate directories"):
            self.export(output_path=self.key.parent / "public.html")
        self.assertFalse(self.output.exists())

    def test_export_is_private_create_only_and_rejects_run_target(self):
        self.export()
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.output.parent.stat().st_mode & 0o777, 0o700)
        original = self.output.read_bytes()
        with self.assertRaises(FileExistsError):
            self.export()
        self.assertEqual(self.output.read_bytes(), original)
        with self.assertRaises(RecordsError):
            self.export(output_path=self.fixture.run / "form.html")
        with self.assertRaises(RecordsError):
            self.export(output_path=self.root / "form.json")

    def test_verified_decoded_result_is_never_used_for_embedding(self):
        public_hash = hashlib.sha256(self.packet.read_bytes()).hexdigest()
        with patch("ht_tibetan.evaluation_review_form.load_evaluation_review", return_value=(
                {"SECRET_OPERATOR_MODEL": "DO_NOT_EMBED_PRIVATE_KEY"}, public_hash)) as verifier:
            self.export()
        verifier.assert_called_once_with(self.packet, study=self.fixture.study_path,
            evaluation_report_path=self.fixture.report_path, key_path=self.key)
        self.assertNotIn("DO_NOT_EMBED_PRIVATE_KEY", self.output.read_text() + self.embedded().decode())

    def test_packet_mutation_after_verification_cannot_replace_payload(self):
        original_hash = hashlib.sha256(self.packet.read_bytes()).hexdigest()
        def changed(*args, **kwargs):
            self.packet.write_bytes(self.packet.read_bytes() + b"\n")
            return {}, original_hash
        with patch("ht_tibetan.evaluation_review_form.load_evaluation_review", side_effect=changed):
            with self.assertRaisesRegex(RecordsError, "changed during form verification"):
                self.export()
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
