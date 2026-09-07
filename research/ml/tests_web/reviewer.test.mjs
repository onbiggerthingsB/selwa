import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM, VirtualConsole} from 'jsdom';

const assetRoot = new URL('../src/ht_tibetan/reviewer_assets/', import.meta.url);
const script = readFileSync(new URL('reviewer.js', assetRoot), 'utf8');
const shell = readFileSync(new URL('shell.html', assetRoot), 'utf8');
const css = readFileSync(new URL('reviewer.css', assetRoot), 'utf8');
const dataset = JSON.parse(readFileSync(new URL('../../contracts/fixtures/synthetic-dataset.json', import.meta.url), 'utf8'));
const copy = value => JSON.parse(JSON.stringify(value));
const passage = '  བོད་ཡིག་\n中文 e\u0301 😀\r\n<script>unsafe()</script>  ';
const sourcePacket = (medical = false) => ({
  schema_version: '1.0', packet_id: 'source-packet', dataset_sha256: 'a'.repeat(64), reviewer_id: 'reviewer-1',
  reviewer_role: medical ? 'clinician' : 'language_reviewer', review_type: medical ? 'medical' : 'language',
  items: dataset.examples.map((example, i) => ({
    example: {...copy(example), question: `${i}: ག་རེ་?`, approved_answer: i === 0 ? '  回答\nབོད་  ' : null},
    source: {...copy(dataset.sources[i]), original_text: passage}, binding_sha256: 'b'.repeat(64),
    review: {review_id: `review-${i}`, example_id: example.example_id, example_version: example.version,
      example_sha256: 'c'.repeat(64), source_sha256: example.source_sha256, reviewer_id: 'reviewer-1',
      reviewer_role: medical ? 'clinician' : 'language_reviewer', review_type: medical ? 'medical' : 'language',
      ratings: {naturalness: null, fidelity: null, comprehension: null}, issues: [], minutes_spent: null,
      status: 'incomplete', recommendation: 'pending', revision: 1, supersedes_review_id: null},
  })),
});
const modelPacket = (paired = false) => ({
  schema_version: paired ? '1.1' : '1.0', kind: 'blind_model_output_review', packet_id: 'blind-packet', reviewer_id: 'reviewer-1',
  status: 'unfilled', input_evidence_type: 'infrastructure_smoke', instructions: ['Original instruction <img src=x onerror=unsafe()>'],
  rating_scale: {'1': 'Major failure', '2': 'Substantial problems', '3': 'Minor problems', '4': 'No identified problems'},
  items: [0, 1].map(i => ({blind_id: `blind-${i}`, source_text: passage, question: `${i}: ག་རེ་?`, answer: '  回答\nབོད་  ',
    ratings: {naturalness: null, fidelity: null, comprehension: null}, issues: [], blind_compromised: null,
    ...(paired ? {input_language: i === 0 ? 'bo' : 'zh', requested_output_language: i === 0 ? 'zh' : 'bo'} : {}),
  })),
});

function openForm(t, packet = modelPacket(), options = {}) {
  const envelope = {form_version: '1.0', packet, packet_file_sha256: 'a'.repeat(64)};
  const payload = options.rawEnvelope ?? JSON.stringify(envelope);
  const html = shell.replace('__REVIEW_CSS__', css).replace('__REVIEW_JS__', '').replace('__REVIEW_PAYLOAD__', Buffer.from(payload).toString('base64'));
  const errors = [], downloads = [], blobs = new Map();
  const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, {url: 'file:///tmp/local-review.html', runScripts: 'outside-only', virtualConsole});
  const {window} = dom;
  window.TextDecoder = TextDecoder; window.TextEncoder = TextEncoder; window.Blob = Blob;
  window.URL.createObjectURL = blob => { const url = `blob:local-${blobs.size}`; blobs.set(url, blob); return url; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { downloads.push({url: this.href, filename: this.download}); };
  window.confirm = () => true;
  window.fetch = () => { throw new Error('Network access forbidden'); };
  t.after(() => { dom.window.close(); assert.equal(errors.length, 0, errors.map(error => error.message).join('\n')); });
  vm.runInContext(script, dom.getInternalVMContext());
  const document = window.document;
  const byId = id => document.getElementById(id);
  const change = (id, value, event = 'change') => { const node = byId(id); assert.ok(node, `missing ${id}`); node.value = value; node.dispatchEvent(new window.Event(event, {bubbles: true})); };
  const click = id => { const node = byId(id); assert.ok(node, `missing ${id}`); node.click(); };
  async function downloaded() {
    assert.ok(downloads.length, 'expected a JSON download');
    return JSON.parse(await blobs.get(downloads.at(-1).url).text());
  }
  async function resume(value, {raw, size, bytes} = {}) {
    const data = bytes ?? new TextEncoder().encode(raw ?? JSON.stringify(value));
    const input = byId('resume-file');
    Object.defineProperty(input, 'files', {configurable: true, value: [{size: size ?? data.byteLength, arrayBuffer: async () => data}]});
    input.dispatchEvent(new window.Event('change', {bubbles: true}));
    await new Promise(resolve => setImmediate(resolve));
  }
  return {window, document, byId, change, click, downloaded, downloads, resume};
}

test('single-file assets have exact substitution tokens and no network or HTML injection surfaces', () => {
  for (const token of ['__REVIEW_CSS__', '__REVIEW_JS__', '__REVIEW_PAYLOAD__']) assert.equal(shell.split(token).length - 1, 1);
  assert.doesNotMatch(script, /\b(?:innerHTML|outerHTML|eval|localStorage|sessionStorage|fetch|XMLHttpRequest|serviceWorker)\b/);
  assert.doesNotMatch(shell + css + script, /https?:\/\/|@import|url\(/);
  assert.doesNotMatch(shell, /\son[a-z]+=/i);
});

test('model v1 renders exact Unicode as text, labels scale 1–4, and starts without judgments', async t => {
  const packet = modelPacket(), form = openForm(t, packet);
  assert.equal(form.document.querySelector('.reading-block .exact-text').textContent, passage);
  assert.equal(form.document.querySelectorAll('img').length, 0);
  assert.equal(form.document.querySelectorAll('script').length, 2);
  assert.match(form.document.querySelector('.scale-note').textContent, /1–4/);
  assert.equal(form.byId('rating-fidelity').value, '');
  assert.equal(form.byId('rating-fidelity').options.length, 5);
  assert.equal(form.byId('blind-compromised').value, '');
  assert.equal(form.byId('completion-count').textContent, '0 / 2 complete');
  form.click('download-review'); assert.deepEqual(await form.downloaded(), packet);
});

test('source v1 uses 1–5, explicit completion, and exact material/identity round trip', async t => {
  const packet = sourcePacket(), form = openForm(t, packet);
  assert.match(form.document.querySelector('.scale-note').textContent, /1–5/);
  assert.equal(form.byId('rating-fidelity').options.length, 6);
  assert.ok(form.byId('source-complete').disabled);
  for (const axis of ['fidelity', 'comprehension', 'naturalness']) form.change(`rating-${axis}`, '5');
  form.change('minutes-spent', '2.5', 'input');
  assert.ok(form.byId('source-complete').disabled, 'no default recommendation');
  form.change('recommendation', 'revise');
  assert.equal(form.byId('source-complete').disabled, false);
  assert.equal(form.byId('source-complete').checked, false, 'completion requires a deliberate click');
  form.click('source-complete'); form.click('download-review');
  const returned = await form.downloaded();
  assert.equal(returned.items[0].review.status, 'complete');
  assert.equal(returned.items[0].review.minutes_spent, 2.5);
  assert.deepEqual(returned.items[0].source, packet.items[0].source);
  assert.deepEqual(returned.items[0].example, packet.items[0].example);
  assert.equal(returned.items[0].binding_sha256, packet.items[0].binding_sha256);
  assert.deepEqual(returned.items[1], packet.items[1]);
  form.change('rating-fidelity', '');
  assert.ok(form.byId('source-complete').disabled);
  form.click('download-review'); assert.equal((await form.downloaded()).items[0].review.status, 'incomplete');
});

test('medical source completion permits optional naturalness but still requires explicit recommendation and time', t => {
  const form = openForm(t, sourcePacket(true));
  form.change('rating-fidelity', '4'); form.change('rating-comprehension', '4');
  form.change('recommendation', 'approve'); assert.ok(form.byId('source-complete').disabled);
  form.change('minutes-spent', '0', 'input'); assert.equal(form.byId('source-complete').disabled, false);
  assert.equal(form.byId('rating-naturalness').value, '');
});

test('editable unsafe integral minutes cannot produce a draft that resume would reject', t => {
  const form = openForm(t, sourcePacket());
  form.change('minutes-spent', '9007199254740992', 'input');
  form.click('download-review');
  assert.equal(form.downloads.length, 0);
  assert.match(form.byId('review-status').textContent, /response is invalid/);
});

test('paired v1.1 shows each input/requested language and preserves paired fields after edits', async t => {
  const packet = modelPacket(true), form = openForm(t, packet);
  assert.match(form.document.querySelector('.language-pair').textContent, /Input: Tibetan.*Requested answer: Chinese/);
  form.change('rating-fidelity', '3'); form.click('next-item');
  assert.match(form.document.querySelector('.language-pair').textContent, /Input: Chinese.*Requested answer: Tibetan/);
  assert.equal(form.document.activeElement.id, 'item-heading');
  form.click('previous-item'); assert.equal(form.byId('rating-fidelity').value, '3');
  form.click('download-review');
  const returned = await form.downloaded();
  assert.equal(returned.schema_version, '1.1'); assert.equal(returned.status, 'unfilled');
  returned.items.forEach((item, i) => {
    assert.equal(item.input_language, packet.items[i].input_language);
    assert.equal(item.requested_output_language, packet.items[i].requested_output_language);
  });
});

test('completion is derived from all model ratings and an explicit blinding answer', async t => {
  const form = openForm(t);
  form.change('rating-fidelity', '4'); form.change('rating-comprehension', '4'); form.change('blind-compromised', 'false');
  assert.equal(form.byId('completion-count').textContent, '0 / 2 complete');
  form.change('rating-naturalness', '4'); assert.equal(form.byId('completion-count').textContent, '1 / 2 complete');
  form.click('add-issue'); assert.equal(form.byId('completion-count').textContent, '0 / 2 complete');
  form.click('download-review'); assert.equal(form.downloads.length, 0);
  assert.match(form.byId('review-status').textContent, /issue is empty/);
  form.change('issue-0', '  Unsupported claim\nབོད་  ', 'input');
  assert.equal(form.byId('completion-count').textContent, '1 / 2 complete');
  form.click('download-review'); const returned = await form.downloaded();
  assert.deepEqual(returned.items[0].issues, ['  Unsupported claim\nབོད་  ']);
  assert.equal(returned.status, 'unfilled'); assert.equal(returned.items[0].blind_compromised, false);
});

test('issues are separate strings and untouched CRLF/whitespace survives restoration and export', async t => {
  const packet = modelPacket(), returned = copy(packet);
  returned.items[0].issues = ['  one\r\ntwo  ', 'བོད་\n\n中文'];
  const form = openForm(t, packet); await form.resume(returned);
  assert.equal(form.document.querySelectorAll('#issue-list textarea').length, 2);
  form.change('rating-fidelity', '2'); form.click('download-review');
  assert.deepEqual((await form.downloaded()).items[0].issues, returned.items[0].issues);
  form.click('remove-issue-0'); form.click('download-review');
  assert.deepEqual((await form.downloaded()).items[0].issues, [returned.items[0].issues[1]]);
});

test('draft resume preserves missing ratings, supports repeated resumes, and never changes immutable fields', async t => {
  const packet = sourcePacket(), returned = copy(packet);
  returned.items[0].review.ratings.naturalness = 2;
  returned.items[0].review.issues = ['  Needs work\n原文  '];
  const form = openForm(t, packet); await form.resume(returned);
  assert.equal(form.byId('rating-naturalness').value, '2'); assert.equal(form.byId('rating-fidelity').value, '');
  assert.equal(form.byId('source-complete').checked, false); assert.equal(form.byId('resume-file').disabled, false);
  form.click('download-review'); assert.deepEqual(await form.downloaded(), returned);
  returned.items[1].review.ratings.fidelity = 3; await form.resume(returned);
  form.click('next-item'); assert.equal(form.byId('rating-fidelity').value, '3');
});

test('Chinese interface toggling preserves material and current responses', async t => {
  const packet = modelPacket(), form = openForm(t, packet);
  form.change('rating-fidelity', '2'); form.change('ui-language', 'zh');
  assert.equal(form.document.documentElement.lang, 'zh'); assert.equal(form.document.querySelector('h1').textContent, '独立评审');
  assert.equal(form.document.querySelector('.reading-block .exact-text').textContent, passage);
  assert.equal(form.byId('rating-fidelity').value, '2');
  form.click('download-review'); assert.equal((await form.downloaded()).items[0].ratings.fidelity, 2);
});

test('download keeps an honest memory-only warning and beforeunload protection', async t => {
  const form = openForm(t);
  let event = new form.window.Event('beforeunload', {cancelable: true});
  form.window.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
  form.change('rating-fidelity', '2'); form.click('download-review');
  assert.match(form.byId('review-status').textContent, /Check your browser.*confirm the file was saved/);
  event = new form.window.Event('beforeunload', {cancelable: true});
  form.window.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
  assert.equal(form.downloads[0].filename, 'review-blind-packet-responses.json');
});

test('failed or cancelled resume leaves edits untouched', async t => {
  const packet = modelPacket(), form = openForm(t, packet);
  form.change('rating-fidelity', '2');
  const tampered = copy(packet); tampered.items[0].answer += 'x'; await form.resume(tampered);
  assert.match(form.byId('review-status').textContent, /current responses were kept/);
  assert.equal(form.byId('rating-fidelity').value, '2');
  form.window.confirm = () => false; await form.resume(packet);
  assert.match(form.byId('review-status').textContent, /cancelled/); assert.equal(form.byId('rating-fidelity').value, '2');
});

for (const [name, mutate] of [
  ['immutable source text', p => {p.items[0].source_text += '\n';}],
  ['changed item order', p => {p.items.reverse();}],
  ['unknown packet field', p => {p.extra = true;}],
  ['unknown row field', p => {p.items[0].extra = true;}],
  ['unknown rating axis', p => {p.items[0].ratings.extra = null;}],
  ['rating boolean', p => {p.items[0].ratings.fidelity = true;}],
  ['rating out of range', p => {p.items[0].ratings.fidelity = 5;}],
  ['rating fraction', p => {p.items[0].ratings.fidelity = 2.5;}],
  ['missing rating axis', p => {delete p.items[0].ratings.naturalness;}],
  ['blinding string', p => {p.items[0].blind_compromised = 'false';}],
  ['empty issue', p => {p.items[0].issues = [''];}],
  ['whitespace-only model issue', p => {p.items[0].issues = [' \n '];}],
  ['oversized issue', p => {p.items[0].issues = ['a'.repeat(8193)];}],
  ['too many issues', p => {p.items[0].issues = Array(129).fill('x');}],
  ['outer status rewrite', p => {p.status = 'complete';}],
  ['packet identity rewrite', p => {p.packet_id += 'x';}],
  ['paired input language rewrite', p => {p.items[0].input_language = 'zh';}],
  ['paired output language rewrite', p => {p.items[0].requested_output_language = 'bo';}],
]) {
  test(`resume rejects ${name}`, async t => {
    const packet = modelPacket(true), form = openForm(t, packet), returned = copy(packet); mutate(returned);
    await form.resume(returned); assert.match(form.byId('review-status').textContent, /Could not load/);
    form.click('download-review'); assert.deepEqual(await form.downloaded(), packet);
  });
}

for (const [name, mutate] of [
  ['source identity', p => {p.items[0].source.original_text += ' ';}],
  ['review identity', p => {p.items[0].review.reviewer_id = 'other';}],
  ['unknown review field', p => {p.items[0].review.extra = true;}],
  ['negative time', p => {p.items[0].review.minutes_spent = -1;}],
  ['time string', p => {p.items[0].review.minutes_spent = '2';}],
  ['completed without required fields', p => {p.items[0].review.status = 'complete';}],
  ['unknown recommendation', p => {p.items[0].review.recommendation = 'publish';}],
  ['rating above five', p => {p.items[0].review.ratings.naturalness = 6;}],
]) {
  test(`source resume rejects ${name}`, async t => {
    const packet = sourcePacket(), form = openForm(t, packet), returned = copy(packet); mutate(returned);
    await form.resume(returned); assert.match(form.byId('review-status').textContent, /Could not load/);
    form.click('download-review'); assert.deepEqual(await form.downloaded(), packet);
  });
}

for (const [name, raw] of [
  ['duplicate ordinary keys', '{"x":1,"x":2}'],
  ['duplicate escaped keys', '{"x":1,"\\u0078":2}'],
  ['prototype duplicate keys', '{"__proto__":{},"__proto__":{}}'],
  ['nonfinite number', '{"x":1e999}'],
  ['unsafe integer', '{"x":9007199254740993}'],
  ['unpaired Unicode surrogate', '{"x":"\\ud800"}'],
  ['trailing comma', '{"x":1,}'],
  ['excessive nesting', '['.repeat(105) + 'null' + ']'.repeat(105)],
]) {
  test(`strict resume rejects ${name}`, async t => {
    const form = openForm(t); await form.resume(null, {raw});
    assert.match(form.byId('review-status').textContent, /Could not load/);
  });
}

test('duplicate known keys cannot silently change ratings', async t => {
  const packet = modelPacket(), form = openForm(t, packet);
  const raw = JSON.stringify(packet).replace('"fidelity":null', '"fidelity":1,"fidelity":4');
  await form.resume(null, {raw}); assert.match(form.byId('review-status').textContent, /Could not load/);
  assert.equal(form.byId('rating-fidelity').value, '');
});

test('resume rejects oversized and invalid UTF-8 files before state changes', async t => {
  const form = openForm(t); form.change('rating-fidelity', '3');
  await form.resume(null, {size: 32 * 1024 * 1024 + 1});
  assert.match(form.byId('review-status').textContent, /Could not load/);
  await form.resume(null, {bytes: Uint8Array.from([0xff, 0xfe, 0xfa])});
  assert.match(form.byId('review-status').textContent, /Could not load/);
  assert.equal(form.byId('rating-fidelity').value, '3');
});

test('initial packet rejects unsupported versions and more than 1000 items', t => {
  const packet = modelPacket(); packet.schema_version = '9.0';
  const first = openForm(t, packet); assert.ok(first.document.querySelector('.fatal')); assert.equal(first.byId('download-review'), null);
  const many = modelPacket(); many.items = Array.from({length: 1001}, (_, i) => ({...copy(many.items[0]), blind_id: `id-${i}`}));
  const second = openForm(t, many); assert.ok(second.document.querySelector('.fatal'));
});

test('all visible response controls have accessible labels and navigation uses focusable headings', t => {
  const form = openForm(t, sourcePacket()); form.click('add-issue');
  for (const control of form.document.querySelectorAll('select, textarea, input')) {
    assert.ok(control.id); assert.ok(form.document.querySelector(`label[for="${control.id}"]`), `missing label for ${control.id}`);
  }
  assert.ok(form.byId('previous-item').disabled); form.click('next-item');
  assert.ok(form.byId('next-item').disabled); assert.equal(form.document.activeElement.id, 'item-heading');
});
