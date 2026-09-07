"""Sealed offline export checks; no reviewers, models or network calls."""
import base64
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import unittest
from unittest.mock import patch

import test_blind_review as model_fixture
from ht_tibetan.records import RecordsError, atomic_write_json, content_sha256, load_dataset
from ht_tibetan.review import export_review_packet, import_review_packet
from ht_tibetan.review_form import export_review_form, _html


class ReviewFormTests(unittest.TestCase):
    def setUp(self):
        self.fixture = model_fixture.BlindReviewTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root
        self.output = self.root/'forms'/'review.html'

    def build_model(self, **kwargs):
        self.fixture.build(**kwargs)
        self.fixture.export()
        return self.fixture.packet, self.fixture.key

    def decode_html(self):
        html = self.output.read_text()
        value = re.search(r'<script\b[^>]*id=[\"\']review-payload[\"\'][^>]*>(.*?)</script>', html, re.S).group(1)
        return json.loads(base64.b64decode(value)), html

    def build_source(self, dataset=None):
        dataset = deepcopy(dataset or self.fixture.dataset)
        packet = self.root/'source-operator'/'source.json'
        packet.parent.mkdir(mode=0o700)
        dataset_path = self.root/'source-data.json'
        atomic_write_json(dataset_path, dataset)
        export_review_packet(dataset, packet, 'synthetic-source-reviewer')
        return packet, Path(str(packet)+'.receipt.json'), dataset_path

    def test_model_form_embeds_only_public_exact_packet_and_bounded_policy(self):
        packet, key = self.build_model()
        summary = export_review_form(packet, self.output, key_path=key)
        envelope, html = self.decode_html()
        self.assertEqual(envelope['packet'], load_dataset(packet))
        self.assertEqual(envelope['packet_file_sha256'], hashlib.sha256(packet.read_bytes()).hexdigest())
        self.assertEqual(envelope['form_version'], '1.0')
        self.assertNotIn('run_manifest_sha256', html)
        self.assertNotIn(load_dataset(key)['run_manifest_sha256'], html)
        self.assertNotIn(str(key), html)
        self.assertFalse(summary['approval_granted'])
        self.assertFalse(summary['review_imported'])
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o600)
        self.assertIn("connect-src 'none'", html)
        self.assertIn("form-action 'none'", html)
        for attrs, body in re.findall(r'<script\b([^>]*)>(.*?)</script>', html, re.S):
            if 'application/json' not in attrs:
                checksum=base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
                self.assertIn("'sha256-"+checksum+"'", html)

    def test_xss_like_answers_and_unicode_remain_inert_exact_payload(self):
        answer='  e\u0301 ཀ་\n</script><img src=x onerror=alert(1)>\u2028'
        packet, key = self.build_model(answer=answer)
        export_review_form(packet, self.output, key_path=key)
        envelope, html = self.decode_html()
        self.assertEqual(envelope['packet']['items'][0]['answer'], answer)
        self.assertNotIn('<img src=x', html)
        self.assertNotIn('onerror=alert(1)', html)

    def test_source_form_validates_receipt_and_retains_scale_and_response_state(self):
        packet, receipt, data = self.build_source()
        summary = export_review_form(packet, self.output, receipt_path=receipt, dataset_path=data)
        envelope, _ = self.decode_html()
        self.assertEqual(summary['review_kind'], 'source_example')
        self.assertEqual(envelope['packet'], load_dataset(packet))
        self.assertIsNone(envelope['packet']['items'][0]['review']['ratings']['fidelity'])
        self.assertEqual(envelope['packet']['items'][0]['review']['status'], 'incomplete')

    def test_tampered_model_packet_cannot_be_exported(self):
        packet, key = self.build_model()
        value=load_dataset(packet); value['items'][0]['answer']='Edited after export.'
        packet.write_text(json.dumps(value))
        with self.assertRaisesRegex(RecordsError,'trusted|hash'):
            export_review_form(packet, self.output, key_path=key)
        self.assertFalse(self.output.exists())

    def test_stale_source_and_changed_receipt_packet_pair_fail(self):
        packet, receipt, data = self.build_source()
        value=load_dataset(data); value['sources'][0]['title']='Changed title'
        data.write_text(json.dumps(value))
        with self.assertRaisesRegex(RecordsError,'stale'):
            export_review_form(packet, self.output, receipt_path=receipt, dataset_path=data)
        data.write_text(json.dumps(self.fixture.dataset))
        value=load_dataset(packet); value['items'][0]['review']['issues']=['Changed original']
        packet.write_text(json.dumps(value))
        with self.assertRaisesRegex(RecordsError,'unchanged'):
            export_review_form(packet, self.output, receipt_path=receipt, dataset_path=data)

    def test_missing_or_mixed_proof_arguments_fail(self):
        packet, key = self.build_model()
        for kwargs in ({}, {'key_path':key,'receipt_path':key}, {'key_path':key,'dataset_path':self.fixture.dataset_path}):
            with self.assertRaises(RecordsError):
                export_review_form(packet, self.output, **kwargs)

    def test_existing_output_private_directory_and_run_boundaries(self):
        packet, key = self.build_model()
        with self.assertRaisesRegex(RecordsError,'source run'):
            export_review_form(packet,self.fixture.run/'review.html',key_path=key)
        export_review_form(packet,self.output,key_path=key)
        original=self.output.read_bytes()
        with self.assertRaises(FileExistsError):
            export_review_form(packet,self.output,key_path=key)
        self.assertEqual(self.output.read_bytes(),original)
        self.output.parent.chmod(0o755)
        with self.assertRaisesRegex(RecordsError,'private'):
            export_review_form(packet,self.output.parent/'other.html',key_path=key)

    def test_size_bound_and_shell_errors_publish_nothing(self):
        packet,key=self.build_model()
        with patch('ht_tibetan.review_form._MAX_HTML_BYTES',256):
            with self.assertRaisesRegex(RecordsError,'48 MiB'):
                export_review_form(packet,self.output,key_path=key)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.output.parent.exists())
        with patch('ht_tibetan.review_form._asset',return_value='invalid shell'):
            with self.assertRaisesRegex(RecordsError,'placeholder'):
                export_review_form(packet,self.output,key_path=key)

    def test_private_keys_and_symlink_outputs_are_rejected(self):
        packet,key=self.build_model()
        key.chmod(0o644)
        with self.assertRaisesRegex(RecordsError,'private'):
            export_review_form(packet,self.output,key_path=key)
        key.chmod(0o600)
        (self.root/'forms-real').mkdir(mode=0o700)
        self.output.parent.symlink_to(self.root/'forms-real',target_is_directory=True)
        with self.assertRaisesRegex(RecordsError,'Symlink'):
            export_review_form(packet,self.output,key_path=key)

    def test_browser_numeric_and_payload_limits_fail_before_publication(self):
        packet, key = self.build_model()
        with patch('ht_tibetan.review_form._MAX_BROWSER_BYTES', 256):
            with self.assertRaisesRegex(RecordsError, '32 MiB'):
                export_review_form(packet, self.output, key_path=key)
        self.assertFalse(self.output.exists())
        with self.assertRaisesRegex(RecordsError, 'round-trip exactly'):
            _html({'items': [{'version': 2**53 + 1}]}, 'a'*64)

    def test_superseded_partial_source_assignment_cannot_create_unimportable_form(self):
        packet, receipt, data = self.build_source()
        first = load_dataset(packet)
        returned = self.root/'returned-source.json'
        for item in first['items']:
            item['review']['issues'] = ['Synthetic partial response']
        atomic_write_json(returned, first)
        partial = import_review_packet(load_dataset(data), returned, receipt_path=receipt)
        second = deepcopy(first)
        for item in second['items']:
            item['review']['issues'] = ['Synthetic partial revision']
        returned.write_text(json.dumps(second))
        newer = import_review_packet(partial, returned, receipt_path=receipt)
        data.write_text(json.dumps(newer))
        with self.assertRaisesRegex(RecordsError, 'outdated'):
            export_review_form(packet, self.output, receipt_path=receipt, dataset_path=data)
        self.assertFalse(self.output.exists())

    def test_competing_assignment_cannot_fork_started_review_chain(self):
        packet, receipt, data = self.build_source()
        competing = packet.parent/'competing.json'
        export_review_packet(load_dataset(data), competing, 'synthetic-source-reviewer')
        current = import_review_packet(load_dataset(data), packet, receipt_path=receipt)
        data.write_text(json.dumps(current))
        with self.assertRaisesRegex(RecordsError, 'outdated'):
            export_review_form(competing, self.output,
                               receipt_path=Path(str(competing)+'.receipt.json'), dataset_path=data)
        fresh = packet.parent/'fresh.json'
        export_review_packet(current, fresh, 'synthetic-source-reviewer')
        export_review_form(fresh, self.output,
                           receipt_path=Path(str(fresh)+'.receipt.json'), dataset_path=data)

    def test_integer_notation_is_required_for_immutable_source_bindings(self):
        dataset = deepcopy(self.fixture.dataset)
        for source in dataset['sources']:
            source['version'] = float(source['version'])
        for example in dataset['examples']:
            example['version'] = float(example['version'])
            example['source_version'] = float(example['source_version'])
        packet, receipt, data = self.build_source(dataset)
        with self.assertRaisesRegex(RecordsError, 'integer JSON notation'):
            export_review_form(packet, self.output, receipt_path=receipt, dataset_path=data)


if __name__=='__main__':
    unittest.main()
