"""Export a sealed assignment as a self-contained offline reviewer form.

Only the public packet enters the HTML. Keys, receipts and datasets stay with the
operator. Browser downloads remain submissions requiring the existing importers.
"""
from __future__ import annotations

import base64
import hashlib
from importlib.resources import files
import json
import os
from pathlib import Path
import re
import tempfile

from .blind_review import _path, _private_directory
from .output_review_import import (_outside_run_and_desktop, _parse, _private,
                                   _read_text, _validate_pair)
from .records import RecordsError, example_sha256, record_sha256, require_valid_dataset, validate_record
from .review import _binding

_MAX_ITEMS = 1000
_MAX_HTML_BYTES = 48 * 1024 * 1024
_MAX_BROWSER_BYTES = 32 * 1024 * 1024


def _validate_source(packet, receipt, dataset):
    require_valid_dataset(dataset)
    for value in (packet, receipt):
        if validate_record(value, 'review_packet'):
            raise RecordsError('Source review form requires a valid source/example review packet.')
    if record_sha256(packet) != record_sha256(receipt):
        raise RecordsError('Build the form from the unchanged original packet and its retained receipt.')
    if packet['review_type'] == 'medical' and packet['reviewer_role'] not in ('clinician', 'dietitian'):
        raise RecordsError('A medical assignment requires its declared qualified reviewer role.')
    sources = {item['source_id']: item for item in dataset['sources']}
    examples = {item['example_id']: item for item in dataset['examples']}
    superseded = {review['supersedes_review_id'] for review in dataset['reviews']
                  if review['supersedes_review_id']}
    existing = {review['review_id'] for review in dataset['reviews']}
    seen, review_ids = set(), set()
    for item in packet['items']:
        source, example, review = item['source'], item['example'], item['review']
        if example['example_id'] in seen or review['review_id'] in review_ids:
            raise RecordsError('Duplicate source review assignments are not allowed.')
        seen.add(example['example_id']); review_ids.add(review['review_id'])
        if example != examples.get(example['example_id']) or source != sources.get(source['source_id']):
            raise RecordsError('Source review packet is stale relative to the current dataset.')
        if (example['source_id'] != source['source_id'] or review['example_id'] != example['example_id']
                or review['example_version'] != example['version'] or review['example_sha256'] != example_sha256(example)
                or review['source_sha256'] != source['content_sha256']):
            raise RecordsError('Source review response does not bind its exact current example and passage.')
        if 'review' not in source['permitted_uses']:
            raise RecordsError('The source does not permit reviewer export.')
        if (item['binding_sha256'] != _binding(example, source, packet['reviewer_id'], packet['reviewer_role'],
                packet['review_type'], review['review_id'], packet['packet_id'])
                or any(review[field] != packet[field] for field in ('reviewer_id', 'reviewer_role', 'review_type'))):
            raise RecordsError('Source review assignment identity or binding is inconsistent.')
        if review['status'] == 'complete':
            raise RecordsError('Completed source responses need to remain immutable; issue an incomplete assignment.')
        if (review['review_id'] in superseded or (review['review_id'] not in existing
                and review['supersedes_review_id'] in superseded)):
            raise RecordsError('This source review assignment is outdated; export its latest state.')
        latest = [r for r in dataset['reviews'] if r['example_id'] == example['example_id']
                  and r['reviewer_id'] == packet['reviewer_id'] and r['review_type'] == packet['review_type']
                  and r['review_id'] not in superseded]
        if any(r['status'] == 'complete' for r in latest):
            raise RecordsError('This source/example reviewer has already completed the assignment.')
        prior = latest[0] if latest else None
        if prior is not None and review['review_id'] != prior['review_id']:
            if review['supersedes_review_id'] != prior['review_id'] or review['revision'] != prior['revision'] + 1:
                raise RecordsError('This source review assignment is outdated; export its latest state.')
        elif prior is None and (review['revision'] != 1 or review['supersedes_review_id'] is not None):
            raise RecordsError('This source review assignment has no matching current revision history.')

        def immutable_numbers(value):
            if isinstance(value, float):
                raise RecordsError('Immutable source review numbers must use integer JSON notation for exact browser bindings.')
            if isinstance(value, dict):
                for nested in value.values():
                    immutable_numbers(nested)
            elif isinstance(value, list):
                for nested in value:
                    immutable_numbers(nested)
        # Integer-valued JSON floats (1.0) satisfy JSON Schema's integer type,
        # but browser JSON.stringify writes 1 and changes our canonical hashes.
        immutable_numbers(source)
        immutable_numbers(example)
        immutable_numbers({key: value for key, value in review.items()
                           if key not in ('ratings', 'issues', 'minutes_spent', 'status', 'recommendation')})


def _asset(name):
    return files('ht_tibetan').joinpath('reviewer_assets', name).read_text(encoding='utf-8')


def _html(packet, packet_sha):
    def browser_numbers(value):
        if (isinstance(value, (int, float)) and not isinstance(value, bool)
                and (not isinstance(value, float) or value.is_integer()) and abs(value) > 2**53 - 1):
            raise RecordsError('Reviewer form integers must round-trip exactly in the browser.')
        if isinstance(value, dict):
            for item in value.values():
                browser_numbers(item)
        elif isinstance(value, list):
            for item in value:
                browser_numbers(item)
    browser_numbers(packet)
    shell, css, js = (_asset(name) for name in ('shell.html', 'reviewer.css', 'reviewer.js'))
    for token in ('__REVIEW_CSS__', '__REVIEW_JS__', '__REVIEW_PAYLOAD__'):
        if shell.count(token) != 1:
            raise RecordsError('Reviewer shell must contain each asset placeholder exactly once.')
    envelope = {'form_version': '1.0', 'packet': packet, 'packet_file_sha256': packet_sha}
    serialized = json.dumps(envelope, ensure_ascii=False, allow_nan=False,
                            separators=(',', ':')).encode('utf-8')
    if len(serialized) > _MAX_BROWSER_BYTES:
        raise RecordsError('Reviewer form payload exceeds the bounded 32 MiB browser size.')
    payload = base64.b64encode(serialized).decode('ascii')
    # Packet bytes never enter markup or executable JavaScript directly.
    html = shell.replace('__REVIEW_PAYLOAD__', payload).replace('__REVIEW_CSS__', css).replace('__REVIEW_JS__', js)
    script_hashes = []
    for attrs, body in re.findall(r'<script\b([^>]*)>(.*?)</script\s*>', html, re.DOTALL | re.IGNORECASE):
        if not re.search(r'\btype\s*=\s*[\"\']application/json[\"\']', attrs, re.IGNORECASE):
            script_hashes.append("'sha256-" + base64.b64encode(hashlib.sha256(body.encode('utf-8')).digest()).decode('ascii') + "'")
    style_hashes = ["'sha256-" + base64.b64encode(hashlib.sha256(body.encode('utf-8')).digest()).decode('ascii') + "'"
                    for body in re.findall(r'<style\b[^>]*>(.*?)</style\s*>', html, re.DOTALL | re.IGNORECASE)]
    if len(script_hashes) != 1 or len(style_hashes) != 1 or re.search(r'http-equiv\s*=\s*[\"\']Content-Security-Policy', html, re.IGNORECASE):
        raise RecordsError('Reviewer shell must contain one executable script, one style and no preexisting policy.')
    policy = ("default-src 'none'; script-src " + ' '.join(script_hashes) + '; style-src ' + ' '.join(style_hashes)
        + "; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'")
    head = re.search(r'<head\s*>', html, re.IGNORECASE)
    if head is None:
        raise RecordsError('Reviewer shell needs a document head.')
    html = html[:head.end()] + '\n<meta http-equiv="Content-Security-Policy" content="' + policy + '">' + html[head.end():]
    encoded = html.encode('utf-8')
    if len(encoded) > _MAX_HTML_BYTES:
        raise RecordsError('Reviewer form exceeds the bounded 48 MiB HTML size.')
    return encoded


def export_review_form(packet_path, output_path, *, key_path=None, receipt_path=None, dataset_path=None):
    """Write a new private HTML file, without importing or approving any review."""
    packet_file, output = _path(packet_path), _path(output_path)
    if output.suffix.lower() != '.html':
        raise RecordsError('Offline reviewer form output must have an .html extension.')
    _outside_run_and_desktop(output)
    if output.exists():
        raise FileExistsError(output)
    raw, packet_sha = _read_text(packet_file)
    packet = _parse(raw)
    if not isinstance(packet.get('items'), list) or not 1 <= len(packet['items']) <= _MAX_ITEMS:
        raise RecordsError('A reviewer form requires 1-1000 items; issue smaller assignments for larger packets.')
    is_model = packet.get('kind') == 'blind_model_output_review'
    if is_model:
        if key_path is None or receipt_path is not None or dataset_path is not None:
            raise RecordsError('Model-output forms require only the retained private --key alongside the packet.')
        key_file = _path(key_path)
        _outside_run_and_desktop(key_file)
        key_text, _ = _read_text(key_file, private=True)
        _validate_pair(packet, packet, _parse(key_text), packet_sha)
    else:
        if key_path is not None or receipt_path is None or dataset_path is None:
            raise RecordsError('Source/example forms require --receipt and --dataset, with no model key.')
        receipt_file = _path(receipt_path)
        receipt_text, _ = _read_text(receipt_file, private=True)
        dataset_text, _ = _read_text(_path(dataset_path))
        _validate_source(packet, _parse(receipt_text), _parse(dataset_text))
    encoded = _html(packet, packet_sha)
    _private_directory(output.parent)
    _private(output.parent, directory=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.review-form-', dir=output.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(encoded); stream.flush(); os.fsync(stream.fileno())
        _path(output)
        _outside_run_and_desktop(output)
        os.link(temporary, output, follow_symlinks=False)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return {'schema_version': '1.0', 'status': 'offline_form_exported',
        'review_kind': 'model_output' if is_model else 'source_example', 'packet_version': packet['schema_version'],
        'item_count': len(packet['items']), 'packet_file_sha256': packet_sha,
        'html_file_sha256': hashlib.sha256(encoded).hexdigest(), 'output_path': str(output),
        'approval_granted': False, 'review_imported': False}
