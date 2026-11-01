// Host-protocol harness for the Phext Scroll View adapter.
//
// Simulates the Ink OS host exactly as derived from
// siliconjungle/ink-os-platform @ a1d3b117:
//   * Module invocation mirrors server/local-adapter-worker.mjs: import the
//     backend entry, require `typeof module.fetch === 'function'`, build a
//     Request to 'https://adapter.invalid' + path with a JSON body, and call
//     module.fetch(request, { ink, namespace }) (ink is a stub here — the
//     module under test does not use it; namespace is the app id).
//   * The run body mirrors server/adapters.mjs startAdapter:
//       { requestId, source: <snapshot>, contentPath:
//         '/api/v1/files/' + source.id + '/content?revision=' + source.revision }
//   * Source content is served by a stub implementing server/files.mjs
//     fileContent semantics that matter here: revision query must match
//     (else 409) and raw bytes are returned.
//   * Result handling mirrors server/adapters.mjs applyResult: 'completed'
//     with output.text -> UTF-8 bytes, hard limit 24 MiB.
//
// Usage: node tests/harness.mjs <expected.json> <fixture.phext>
//   expected.json comes from Will's Python parser (parse_phext.py) via
//   verify.sh — an independent implementation, not this module's port.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const [expectedPath, fixturePath] = process.argv.slice(2);
if (!expectedPath || !fixturePath) {
  console.error('usage: node tests/harness.mjs <expected.json> <fixture.phext>');
  process.exit(2);
}
const EXPECTED_FIXTURE_SHA256 =
  'e755d3b591adfe928f7e05413a5a944996bef5069b07d813e04a17e3ae59ab16';
const TOKEN = 'harness-token';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

let failures = 0;
const check = (n, label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${n}. ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
const extra = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: manifest. ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

// The harness's own escaper, written independently of server.mjs so check 4
// is a cross-check, not the module agreeing with itself.
function escapeHtmlHarness(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return text.replace(/[&<>"']/g, (c) => map[c]);
}

const expected = JSON.parse(await readFile(expectedPath, 'utf8'));
const fixtureBytes = await readFile(fixturePath);
const fixtureShaBefore = sha256(fixtureBytes);

// --- stub content store (server/files.mjs semantics) -----------------------
const files = new Map(); // id -> { bytes, revision, title }
function addFile(id, bytes, title) {
  files.set(id, { bytes, revision: 1, title });
  return { id, revision: 1 };
}
const fixtureSource = addFile('aa'.repeat(16), fixtureBytes, 'learn-you-phext.phext');
const plainText = 'Hello phext.\nThis file has no phext delimiters at all.\n';
const plainSource = addFile('bb'.repeat(16), Buffer.from(plainText), 'plain.txt');
const emptySource = addFile('cc'.repeat(16), Buffer.alloc(0), 'empty.phext');

const stub = createServer((req, res) => {
  const url = new URL(req.url, 'http://stub.invalid');
  const match = /^\/api\/v1\/files\/([a-f0-9]{32})\/content$/.exec(url.pathname);
  const file = match && files.get(match[1]);
  if (!file) { res.writeHead(404); return res.end(); }
  if (req.headers.authorization !== 'Bearer ' + TOKEN) { res.writeHead(401); return res.end(); }
  if (url.searchParams.get('revision') !== String(file.revision)) { res.writeHead(409); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
  res.end(file.bytes);
});
await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
process.env.INK_OS_URL = `http://127.0.0.1:${stub.address().port}`;
process.env.INK_OS_APP_TOKEN = TOKEN;
process.env.INK_OS_APP_ID = 'phext-scroll-view';

// --- invoke the module the way server/local-adapter-worker.mjs does --------
const mod = await import(join(root, 'server.mjs'));
if (typeof mod.fetch !== 'function') {
  console.log('FAIL: module does not export fetch');
  process.exit(1);
}
async function invoke(path, body) {
  const init = { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const result = await mod.fetch(new Request('https://adapter.invalid' + path, init), {
    ink: {}, // stub: the worker passes a real SDK client; this module must not need it
    namespace: 'phext-scroll-view',
  });
  const response = result instanceof Response ? result : Response.json(result);
  return response.json();
}
const runBody = (source, requestId) => ({
  requestId,
  source: {
    id: source.id, namespace: 'os', kind: 'file',
    title: files.get(source.id).title, source: files.get(source.id).title,
    revision: source.revision,
    body: JSON.stringify({ originalName: files.get(source.id).title, mime: 'application/octet-stream', bytes: files.get(source.id).bytes.length }),
  },
  contentPath: '/api/v1/files/' + source.id + '/content?revision=' + source.revision,
});

// --- manifest contract (rules copied from shared/adapters.mjs) -------------
const manifest = JSON.parse(await readFile(join(root, 'ink-adapter.json'), 'utf8'));
const a = manifest.adapter || {};
extra('adapter.operation matches token rule /^[a-z][a-z0-9-]{0,63}$/', /^[a-z][a-z0-9-]{0,63}$/.test(a.operation || ''));
extra('input.fileTypes entries match the file-type rule', Array.isArray(a.input?.fileTypes) && a.input.fileTypes.every((t) => /^(\*|[a-z][a-z0-9-]{0,63}|\.[a-z0-9][a-z0-9.+_-]{0,20}|[a-z0-9.+-]+\/(?:[a-z0-9.+-]+|\*))$/.test(t)), JSON.stringify(a.input?.fileTypes));
extra('output mime/extension match the manifest rules', /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(a.output?.mime || '') && /^\.[a-z0-9]{1,12}$/.test(a.output?.extension || ''), `${a.output?.mime} ${a.output?.extension}`);
extra('backend entry declared, no desktop entry (validateBundle rule)', manifest.backend?.entry === 'server.mjs' && manifest.desktop === undefined);

// --- 1. health --------------------------------------------------------------
const health = await invoke('/adapter/health');
check(1, 'health returns configured', health && health.configured === true, JSON.stringify(health));

// --- 2..5, 7. fixture run ----------------------------------------------------
const run1 = await invoke('/adapter/run', runBody(fixtureSource, 'run-fixture-1'));
const html = run1?.output?.text;
check(2, 'run completes (not pending) with output of the declared mime/extension',
  run1?.status === 'completed' && typeof html === 'string' &&
  a.output.mime === 'text/html' && a.output.extension === '.html' &&
  html.startsWith('<!DOCTYPE html>') && Buffer.byteLength(html) <= 24 * 1024 * 1024,
  `status=${run1?.status}, output ${typeof html === 'string' ? Buffer.byteLength(html) + ' bytes' : 'missing'}, declared ${a.output.mime} / ${a.output.extension}`);

const sectionCoords = typeof html === 'string'
  ? [...html.matchAll(/<section id="scroll-([^"]+)">/g)].map((m) => m[1]) : [];
const expectedCoords = expected.map((s) => s.coordinate);
check(3, 'output contains all scroll coordinates, in fixture TOC order (independent Python parser)',
  expected.length === 16 && JSON.stringify(sectionCoords) === JSON.stringify(expectedCoords),
  `${sectionCoords.length} sections vs ${expectedCoords.length} expected coordinates`);

const preCount = typeof html === 'string' ? (html.match(/<pre>/g) || []).length : 0;
const missing = typeof html === 'string'
  ? expected.filter((s) => !html.includes(escapeHtmlHarness(s.text))).map((s) => s.coordinate) : ['<no output>'];
check(4, 'every scroll text appears in the output (escaped form) — none dropped or truncated',
  missing.length === 0 && preCount === expected.length,
  missing.length ? 'missing: ' + missing.join(', ') : `${preCount} <pre> blocks, all ${expected.length} scroll texts present`);

const run2 = await invoke('/adapter/run', runBody(fixtureSource, 'run-fixture-2'));
const fixtureShaAfter = sha256(await readFile(fixturePath));
check(5, 'input file SHA-256 identical before and after the run (original preserved)',
  fixtureShaBefore === fixtureShaAfter && fixtureShaAfter === EXPECTED_FIXTURE_SHA256,
  fixtureShaAfter);

// --- 6. edge cases ------------------------------------------------------------
const plainRun = await invoke('/adapter/run', runBody(plainSource, 'run-plain-1'));
const plainCoords = typeof plainRun?.output?.text === 'string'
  ? [...plainRun.output.text.matchAll(/<section id="scroll-([^"]+)">/g)].map((m) => m[1]) : [];
const emptyRun = await invoke('/adapter/run', runBody(emptySource, 'run-empty-1'));
check(6, 'edge cases: plain text renders as a single scroll at 1.1.1/1.1.1/1.1.1; empty input does not crash',
  plainRun?.status === 'completed' && JSON.stringify(plainCoords) === JSON.stringify(['1.1.1/1.1.1/1.1.1']) &&
  plainRun.output.text.includes(escapeHtmlHarness(plainText)) &&
  emptyRun?.status === 'completed' && typeof emptyRun?.output?.text === 'string' &&
  emptyRun.output.text.includes('<h2>1.1.1/1.1.1/1.1.1</h2>'),
  `plain sections=${JSON.stringify(plainCoords)}, empty status=${emptyRun?.status}`);

// --- 7. determinism -------------------------------------------------------------
check(7, 'determinism: two runs on the same input produce byte-identical output',
  run1?.status === 'completed' && run2?.status === 'completed' && run1.output.text === run2.output.text,
  typeof html === 'string' && typeof run2?.output?.text === 'string'
    ? 'output sha256 ' + sha256(Buffer.from(html)) + ' (both runs)' : 'missing output');

stub.close();
console.log('----------------------------------------------------------------');
console.log(failures === 0 ? 'RESULT: PASS (all checks)' : `RESULT: FAIL (${failures} failing checks)`);
process.exit(failures === 0 ? 0 : 1);
