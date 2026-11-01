# Phext Scroll View — an Ink OS adapter prototype

An [Ink OS](https://github.com/siliconjungle/ink-os-platform) adapter that
turns a `.phext` file into a standalone HTML **scroll view**: a table of
contents listing every scroll coordinate in document order, then each
scroll's text under its coordinate heading. Open a `.phext` in Ink OS →
**Open with → Phext scroll view**, and the host preserves the original and
creates a linked HTML result with provenance (source revision, adapter
release, method, configuration fingerprint) — the adapter itself only reads.

- Input: files whose name ends in `.phext`
- Output: `text/html`, extension `.html`, label "Scroll view" — paired by
  the host with apps that accept that type. The bundled Preview app declares
  `desktop.fileTypes: ["*"]` (`ink-app-preview` @ `ae8327c1`, its
  `ink-app.json`), so it can open the result; any HTML-capable app can too.
- Coordinates ride in the TOC links, the `<section id="scroll-…">` anchors,
  and the `<h2>` headings — the full coordinate survives the trip, because a
  phext coordinate is the scroll's address and dropping it would drop the
  point of the format. (Coordinates are internal to one phext; the view is
  of one file, so no cross-file addressing is implied.)
- The transformation is **pure and deterministic**: same source bytes in,
  byte-identical HTML out (no clocks, randomness, or environment reads in
  the render path). A repeated request identity therefore recomputes the
  same result and resubmits no paid work — there is none — which is the
  property the platform requires of repeated request identities.

## Files

| File | Role |
|---|---|
| `ink-adapter.json` | Package manifest (shape derived below) |
| `server.mjs` | The provider module — parser, renderer, protocol, one file |
| `index.html` | Release entry placeholder (bundle validation requires one) |
| `tests/harness.mjs` | Node harness simulating the host protocol exactly |
| `verify.sh` | One-command verification (see below) |
| `evidence/live-scroll-view.html` | Output of the live run through a real host |

## Contract sources — derived, not guessed

Everything below is from `siliconjungle/ink-os-platform` at the pinned
commit **`a1d3b117a845e4d26b6c4a879c048af06d79961e`** (the commit
`ink-os-desktop`'s `platform.json` pins), read via the GitHub API; the docs
were checked against the code, and where they differ in emphasis the code
governed (no material disagreements were found — the docs are a summary;
the exact shapes are only in code).

- **Manifest shape** — `docs/adapters.md` says an `ink-adapter.json`
  "declares an `adapter` with `operation`, method `name`, `description`,
  `input` and `output`", but the full file shape is in
  `cli/bin/ink-os.mjs` (`deploy`, adapter mode): the manifest is an app-style
  manifest — `slug`, `title`, `backend.entry` — plus the `adapter` field,
  which is passed through to app creation and release creation.
  `adapters publish DIR` is literally `deploy DIR --adapter`.
  The `adapter` object itself is validated by `shared/adapters.mjs`
  `adapterManifest()`: `operation` matches `/^[a-z][a-z0-9-]{0,63}$/`;
  `input.fileTypes` entries match the file-type token rule (`.phext` is the
  extension form); `input.kind`/`input.shape` are the optional alternatives
  (not used here); `output` requires a `label`, an exact `mime`
  (`/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/`) and an `extension`
  (`/^\.[a-z0-9]{1,12}$/`).
- **Backend required, no desktop** — `server/platform.mjs` `validateBundle()`:
  "Adapters require a backend and cannot declare a desktop app", and the
  bundle must contain the frontend entry (default `index.html`) and the
  backend entry. Hence `index.html` exists but does nothing.
- **Single-file module** — `server/local-adapter.mjs` extracts **only** the
  backend entry file from the bundle and imports it in a fresh bounded Node
  process. So `server.mjs` is fully self-contained: zero imports, zero npm
  dependencies.
- **Invocation** — `server/local-adapter-worker.mjs`: the host requires
  `typeof module.fetch === 'function'` and calls
  `module.fetch(new Request('https://adapter.invalid' + path, …),
  { ink, namespace })`, JSON-encoding the body.
- **Health** — `docs/adapters.md`: `GET /adapter/health` returns
  `{ "configured": true }` when ready; `server/adapters.mjs`
  `activateAdapter()` refuses to enable an adapter unless
  `health.configured === true`. This adapter needs no configuration or
  credentials, so it always answers `true`.
- **Run request** — `server/adapters.mjs` `startAdapter()` invokes
  `/adapter/run` with `{ requestId, source, contentPath }` where `source` is
  the public World-object snapshot and
  `contentPath = '/api/v1/files/' + source.id + '/content?revision=' + source.revision`
  (a revision-checked content path, exactly as the docs phrase it).
- **Run response** — `server/adapters.mjs` `applyResult()`:
  `{ status: 'completed', output: { text } }` takes the text as UTF-8 bytes
  (canonical `base64` is the alternative), enforces the **24 MiB** output
  limit, and stores the result as a new file object named
  `<source name> — <label><extension>` with provenance in its body.
  `{ status: 'pending', jobId }` and `{ status: 'failed' }` are the other
  legs; this adapter renders synchronously and never returns `pending`, and
  its `/adapter/runs/…` route answers `failed` because no job can exist.
  The host deduplicates runs by (source id, source revision, adapter,
  release, configuration) and reuses a completed result, so the module can
  be re-invoked only when something actually changed.
- **Reading the source bytes** — the module fetches `contentPath` from
  `INK_OS_URL` with `Authorization: Bearer <INK_OS_APP_TOKEN>`: those env
  names are set for the child process by `server/local-adapter.mjs`, and
  the Bearer scheme is the SDK's own (`sdk/src/server.js` `createClient`
  defaults to the same env vars). The injected `ink` SDK client is *not*
  used for this read because its `request()` parses every response as JSON,
  and a `.phext` file's bytes are not JSON. The content endpoint itself is
  `server/files.mjs` `fileContent()`: raw bytes, 409 if the revision query
  no longer matches.

## Phext parsing

`server.mjs` ports **`~/workspace/phext/parse_phext.py`** (Will's
dead-reckoning parser, itself verified against SQ `toc`/`select`) line for
line — no delimiter assignments were invented:

- Levels, highest → lowest: `0x01` Library, `0x1F` Shelf, `0x1E` Series,
  `0x1D` Collection, `0x1C` Volume, `0x1A` Book, `0x19` Chapter, `0x18`
  Section, `0x17` Scroll.
- A delimiter ends the current scroll, increments its level, and resets all
  lower levels to 1. Coordinates are 1-indexed; the first scroll sits at
  `1.1.1/1.1.1/1.1.1`. A trailing empty scroll from a final delimiter is
  dropped; interior empty scrolls are kept.
- The walk is over raw bytes (delimiters are ASCII control codes and cannot
  occur inside a multi-byte UTF-8 sequence); each scroll's bytes decode as
  UTF-8 with replacement, matching the Python parser's `errors="replace"`.
- Scroll text is HTML-escaped (`& < > " '`) inside `<pre>` — content is
  data, never markup.

## Verify

```sh
./verify.sh
```

Builds the expected scroll map with the Python parser (independent of the
JS port), then runs `tests/harness.mjs`, which simulates the host protocol
as cited above (worker-style invocation, server-style run body, a stub
content endpoint with revision checking) and asserts:

1. Health returns configured.
2. Run completes (not pending) with output of the declared mime/extension.
3. All 16 scroll coordinates appear, in the fixture's TOC order.
4. Every scroll's text appears (escaped form) — none dropped or truncated.
5. The fixture's SHA-256 is identical before and after the run.
6. Plain text (no delimiters) renders as one scroll at `1.1.1/1.1.1/1.1.1`;
   empty input does not crash.
7. Two runs produce byte-identical output.

Fixture: `learn-you-phext.phext` (16 scrolls, 13,216 B, SHA-256
`e755d3b5…a16`), the non-personal teaching phext.

## Publish into a local Ink OS instance

The package directory must be a **committed Git working tree** (the CLI
deploys committed source snapshots). Then, with the instance running
(platform: `npm ci && npm run build && npm start`, loopback port 4318):

```sh
export INK_OS_CONFIG=/path/to/platform/.data/client.json
node cli/bin/ink-os.mjs adapters publish /path/to/phext-adapter
# -> { "adapterId": "…", "releaseId": "…", "configured": true }
```

Publishing also activates the adapter (the CLI calls the activation
endpoint, which health-checks the module through the real local runner).
After that it appears in **Open with** for any `.phext` file, and can be
driven headlessly:

```sh
node cli/bin/ink-os.mjs files upload learn-you-phext.phext
node cli/bin/ink-os.mjs adapters run <SOURCE_OBJECT_ID> --adapter <ADAPTER_ID>
node cli/bin/ink-os.mjs files download <OUTPUT_OBJECT_ID> --output view.html
```

No `--env-file` is needed: this adapter has no configuration and no secrets.

## Status and limits

- **Verified twice**: the harness passes all checks, and a **live run
  through a real local instance** (platform @ `a1d3b117`, Node v24.22.1)
  completed with the host creating the linked result — whose SHA-256 is
  identical to the harness output (see `BUILD-REPORT.md` and
  `evidence/live-scroll-view.html`).
- Local only. Nothing has been published anywhere outside a throwaway
  local instance; no external submission has been made.
- Prototype scope: one-way render only (phext → HTML). No reverse
  transformation, no editing, no SQ involvement — the host has no native
  coordinate concept, so coordinates exist in Ink OS only as this HTML
  content, which is exactly the projection the recon predicted.
- The HTML is intentionally minimal (semantic structure, no styling beyond
  the browser default) — it is a proof of the contract, not a product UI.
- Very large phexts inherit the platform's limits: source content is
  fetched whole, and output is capped at 24 MiB by the host.

## License

MIT — see `LICENSE`. Copyright (c) 2026 Will Bickford.
