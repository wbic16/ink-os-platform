// Phext Scroll View adapter — provider module for Ink OS.
//
// Contract derived from siliconjungle/ink-os-platform @ a1d3b117 (see README.md
// "Contract sources" for the file-by-file citations). In short:
//   * This file is the whole module. The local host extracts ONLY the backend
//     entry file from the published bundle and imports it in a fresh process
//     (server/local-adapter.mjs), so everything must live in this one file:
//     zero imports, zero npm dependencies.
//   * Export `fetch(request, { ink, namespace })` (server/local-adapter-worker.mjs
//     checks `typeof module.fetch === 'function'` and wraps a non-Response
//     return value with Response.json()).
//   * GET  /adapter/health        -> { configured: true }
//     (server/adapters.mjs activateAdapter rejects unless configured === true;
//     this adapter needs no configuration, so it is always ready.)
//   * POST /adapter/run           -> { status: 'completed', output: { text } }
//     Request body, built by server/adapters.mjs startAdapter:
//       { requestId, source: <public World object snapshot>, contentPath }
//     where contentPath is '/api/v1/files/<id>/content?revision=<n>'.
//   * The transformation is pure and deterministic: same source bytes in,
//     byte-identical HTML out. A repeated requestId therefore recomputes the
//     same result and resubmits no paid work (there is none) — the property
//     docs/adapters.md requires of repeated request identities.
//
// Source bytes are fetched from contentPath against INK_OS_URL with the
// app-scoped bearer token in INK_OS_APP_TOKEN — the exact env names and
// Authorization scheme the platform itself uses (server/local-adapter.mjs
// sets them for the child process; sdk/src/server.js createClient defaults
// to them). The injected `ink` SDK client is deliberately NOT used for the
// content read: its request() parses every response as JSON
// (sdk/src/server.js), and a .phext file's bytes are not JSON.

// ---------------------------------------------------------------------------
// Phext parser — a line-for-line port of ~/workspace/phext/parse_phext.py
// (Will's dead-reckoning parser, verified against SQ toc/select by the
// Learn You Phext verify.sh). Delimiter hierarchy, highest -> lowest:
//   0x01 Library, 0x1F Shelf, 0x1E Series, 0x1D Collection, 0x1C Volume,
//   0x1A Book,    0x19 Chapter, 0x18 Section, 0x17 Scroll
// Hitting a delimiter appends the current scroll, increments that level and
// resets all lower levels to 1. Coordinates are 1-indexed; the first scroll
// sits at 1.1.1/1.1.1/1.1.1. The walk is over raw bytes: the delimiter bytes
// are ASCII control codes and can never appear inside a multi-byte UTF-8
// sequence, so slicing scroll bytes and decoding each scroll as UTF-8
// (replacement on error, matching the Python parser) is exact.
// ---------------------------------------------------------------------------
const LEVELS = [0x01, 0x1f, 0x1e, 0x1d, 0x1c, 0x1a, 0x19, 0x18, 0x17];
const DELIM_TO_LEVEL = new Map(LEVELS.map((byte, i) => [byte, i]));

function formatCoord(coord) {
  return (
    `${coord[0]}.${coord[1]}.${coord[2]}/` +
    `${coord[3]}.${coord[4]}.${coord[5]}/` +
    `${coord[6]}.${coord[7]}.${coord[8]}`
  );
}

// bytes: Uint8Array -> [{ coordinate, text }] in document order.
// Mirrors parse_phext.py parse(): a trailing empty scroll produced by a
// final delimiter is dropped; interior empty scrolls are kept.
export function parsePhext(bytes) {
  const decoder = new TextDecoder('utf-8'); // fatal:false == Python errors="replace"
  const coord = [1, 1, 1, 1, 1, 1, 1, 1, 1];
  const scrolls = [];
  let start = 0;
  let current = formatCoord(coord);
  for (let i = 0; i < bytes.length; i++) {
    const lvl = DELIM_TO_LEVEL.get(bytes[i]);
    if (lvl === undefined) continue;
    scrolls.push({ coordinate: current, text: decoder.decode(bytes.subarray(start, i)) });
    start = i + 1;
    coord[lvl] += 1;
    for (let j = lvl + 1; j < 9; j++) coord[j] = 1;
    current = formatCoord(coord);
  }
  scrolls.push({ coordinate: current, text: decoder.decode(bytes.subarray(start)) });
  if (scrolls.length && scrolls[scrolls.length - 1].text === '') scrolls.pop();
  return scrolls;
}

// ---------------------------------------------------------------------------
// Rendering — deterministic: no clocks, no randomness, no environment reads.
// The coordinate is the address of the scroll inside this one phext
// (coordinates are internal to a phext); it rides in the TOC link, the
// section id, and the heading, so it survives the trip into HTML intact.
// ---------------------------------------------------------------------------
export function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderScrollView(scrolls, title) {
  // An empty phext still has an origin: the parser's walk starts at
  // 1.1.1/1.1.1/1.1.1, so render that single (empty) scroll rather than
  // an empty document.
  const list = scrolls.length
    ? scrolls
    : [{ coordinate: '1.1.1/1.1.1/1.1.1', text: '' }];
  const toc = list
    .map(
      (s) =>
        `      <li><a href="#scroll-${s.coordinate}">${s.coordinate}</a></li>`
    )
    .join('\n');
  const sections = list
    .map(
      (s) =>
        `    <section id="scroll-${s.coordinate}">\n` +
        `      <h2>${s.coordinate}</h2>\n` +
        `      <pre>${escapeHtml(s.text)}</pre>\n` +
        `    </section>`
    )
    .join('\n');
  return (
    '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    `<title>${escapeHtml(title)} — phext scroll view</title>\n` +
    '</head>\n' +
    '<body>\n' +
    `  <h1>${escapeHtml(title)}</h1>\n` +
    `  <p>${list.length} scroll${list.length === 1 ? '' : 's'}</p>\n` +
    '  <nav>\n' +
    '    <ol>\n' +
    toc +
    '\n    </ol>\n' +
    '  </nav>\n' +
    sections +
    '\n</body>\n' +
    '</html>\n'
  );
}

// ---------------------------------------------------------------------------
// Provider protocol
// ---------------------------------------------------------------------------
// The exported provider handler below is itself named `fetch`, which would
// shadow the global inside this module — keep a distinctly named reference
// to the real HTTP fetch for the content read.
const httpFetch = globalThis.fetch;

async function fetchSourceBytes(input) {
  const contentPath = input && input.contentPath;
  if (typeof contentPath !== 'string' || !contentPath) {
    throw new Error('Adapter run request is missing its content path');
  }
  const base = process.env.INK_OS_URL;
  if (!base) throw new Error('INK_OS_URL is not set for this adapter process');
  const headers = {};
  if (process.env.INK_OS_APP_TOKEN) {
    headers.Authorization = 'Bearer ' + process.env.INK_OS_APP_TOKEN;
  }
  const response = await httpFetch(new URL(contentPath, base), { headers, redirect: 'error' });
  if (!response.ok) {
    throw new Error(`Source content fetch failed with HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function fetch(request, _context) {
  const path = new URL(request.url).pathname;
  if (request.method === 'GET' && path === '/adapter/health') {
    return Response.json({ configured: true });
  }
  if (request.method === 'POST' && path === '/adapter/run') {
    try {
      const input = await request.json();
      const bytes = await fetchSourceBytes(input);
      const scrolls = parsePhext(bytes);
      const title =
        (input.source && typeof input.source.title === 'string' && input.source.title) ||
        'Untitled phext';
      return Response.json({
        status: 'completed',
        output: { text: renderScrollView(scrolls, title) },
      });
    } catch {
      // server/adapters.mjs applyResult maps status:'failed' to a durable
      // failed run without touching the source; details stay out of the
      // response, matching the host's own error hygiene.
      return Response.json({ status: 'failed' });
    }
  }
  if (request.method === 'GET' && path.startsWith('/adapter/runs/')) {
    // This adapter never returns 'pending' (the render is synchronous), so
    // there is no job to poll. Answer in the same result contract.
    return Response.json({ status: 'failed' });
  }
  return Response.json({ error: 'Unknown adapter route' }, { status: 404 });
}
