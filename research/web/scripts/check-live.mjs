// Explicit opt-in smoke check against the already-running synthetic demo only.
// Session credentials stay in process memory; only non-sensitive results print.
import assert from 'node:assert/strict';
import http from 'node:http';

const port = Number(process.argv[2] ?? '38471');
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
const base = `http://127.0.0.1:${port}`;
const checks = [];
const home = await fetch(base);
assert.equal(home.status, 200);
const setCookie = home.headers.get('set-cookie');
assert.match(setCookie, /HttpOnly; SameSite=Strict/);
const cookie = setCookie.split(';')[0];
const markup = await home.text();
assert.ok(!markup.includes(cookie.split('=')[1]));
assert.equal(home.headers.get('cache-control'), 'no-store');
checks.push('homepage/session bootstrap; credential absent from HTML; no-store');
const headers = { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' };
async function status(path, expected, options = {}) {
  const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(12000) });
  assert.equal(response.status, expected, `${path} expected ${expected}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response;
}
await status('/api/catalog', 401);
const catalog = await (await status('/api/catalog', 200, { headers })).json();
assert.equal(catalog.mode, 'synthetic_demo'); assert.equal(catalog.sources.length, 2);
for (const source of catalog.sources) assert.equal(source.source_kind, 'synthetic_fixture');
for (const extra of [{ Origin: 'http://127.0.0.1:1' }, { 'X-Forwarded-Host': 'attacker.example' }]) {
  await status('/api/catalog', 403, { headers: { ...headers, ...extra } });
}
// Node fetch normalizes Host; use the HTTP transport to actually send the probe.
const substitutedHostStatus = await new Promise((resolve, reject) => {
  const request = http.get(base + '/api/catalog', { headers: { ...headers, Host: 'attacker.example' } }, response => {
    response.resume(); resolve(response.statusCode);
  });
  request.setTimeout(3000, () => request.destroy(new Error('Host check timed out')));
  request.on('error', reject);
});
assert.equal(substitutedHostStatus, 403);
checks.push('catalog authentication; exact host/origin; forwarded-header denial');
const first = catalog.sources[0];
const source = { source_id: first.source_id, version: first.version, content_sha256: first.content_sha256 };
const request = { schema_version: '1.0', request_id: 'live-synthetic-check', source, messages: [{ role: 'user', content: 'Synthetic interface check: when does the library open?' }] };
const post = body => ({ method: 'POST', headers, body: JSON.stringify(body) });
await status('/api/chat', 403, { ...post(request), headers: { Cookie: cookie, 'Content-Type': 'application/json' } });
const result = await (await status('/api/chat', 200, post(request))).json();
assert.equal(result.synthetic, true); assert.equal(result.model_identity, 'fake://research-chat-v1');
assert.equal(result.outcome, 'success'); assert.equal(result.input_tokens, null); assert.equal(result.output_tokens, null);
assert.deepEqual(result.citations, [source]); assert.ok(result.answer.includes(first.original_text));
await status('/api/chat', 409, post({ ...request, source: { ...source, version: 2 } }));
await status('/api/chat', 400, post({ ...request, model_path: '/untrusted' }));
await status('/api/chat', 400, { method: 'POST', headers, body: '{"schema_version":"1.0","schema_version":"1.0"}' });
await status('/api/chat', 413, { method: 'POST', headers, body: 'x'.repeat(65_537) });
checks.push('synthetic answer/source binding; stale source, extra fields, duplicate keys and byte cap');
const tibetanProbe = { ...request, request_id: 'live-unreviewed-unicode-check', messages: [
  { role: 'user', content: 'ཀ'.repeat(2000) }, { role: 'assistant', content: result.answer },
  { role: 'user', content: 'ཀ'.repeat(2000) }, { role: 'assistant', content: result.answer },
  { role: 'user', content: 'ཀ'.repeat(2000) },
] };
assert.ok(Buffer.byteLength(JSON.stringify(tibetanProbe)) > 16_384);
assert.equal((await (await status('/api/chat', 200, post(tibetanProbe))).json()).synthetic, true);
checks.push('valid Unicode conversation above 16 KiB accepted within 64 KiB cap; no language judgment');
const asset = /src="([^"\s]*\/_next\/static\/[^"\s]+\.js)"/.exec(markup)?.[1];
assert.ok(asset); await status(asset.replaceAll('&amp;', '&'), 200);
checks.push('framework script asset also no-store');
const upgradeStatus = await new Promise((resolve, reject) => {
  const request = http.request(base + '/_next/webpack-hmr', { headers: { ...headers, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13' } });
  request.setTimeout(3000, () => request.destroy(new Error('Upgrade check timed out')));
  request.on('response', response => { response.resume(); resolve(response.statusCode); });
  request.on('upgrade', (_, socket) => { socket.destroy(); reject(new Error('Production upgrade unexpectedly accepted')); });
  request.on('error', reject); request.end();
});
assert.equal(upgradeStatus, 403); checks.push('production WebSocket upgrade rejected before Next handler');
console.log(JSON.stringify({ status: 'passed', origin: base, checks, model_calls: 0, human_judgments: 0 }, null, 2));
