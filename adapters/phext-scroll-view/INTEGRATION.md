# Integration — Phext Scroll View adapter (in-tree copy)

This directory carries the **phext Scroll View adapter** (operation
`render-phext`) in-tree on branch `emise/phext-adapter` of the wbic16 fork
of `siliconjungle/ink-os-platform`.

- **Additions only.** No existing upstream file is modified by this branch;
  everything here is new, under `adapters/phext-scroll-view/`.
- **Same publication route as any adapter — with one correction.**
  Upstream, adapters are independently published packages (per
  `docs/adapters.md`). CORRECTED 2026-11-01 after a clean-room test:
  `ink-os adapters publish adapters/phext-scroll-view` from inside this
  platform checkout is REFUSED — the CLI's `committedSource()` requires
  the adapter directory to be a Git repository root, which a subdirectory
  of this checkout is not. The working route is to publish a standalone
  committed copy of this directory (its own Git repo), which is exactly
  how the original live verification was run and what the downloadable
  `ink-os-phext-example` bundle's `run-example.sh` does automatically.
  The host preserves the source file and creates a linked result — here,
  a `text/html` "Scroll view" — with provenance.
- **What it does.** Input: `.phext` files. Output: a standalone HTML scroll
  view — a table of contents listing every scroll coordinate in document
  order, then each scroll under its coordinate heading, text HTML-escaped
  in `<pre>`. The transform is pure and deterministic; the original file
  is never modified.

## Live verification (receipts)

Verified live against a real local Ink OS platform instance before this
branch was created (full receipts in the canonical package's
BUILD-REPORT.md, in wbic16/emise-tools — see below):

- Platform pinned at commit `a1d3b117a845e4d26b6c4a879c048af06d79961e`
  (Node v24.22.1, loopback host)
- `adapters publish` → adapterId `e8f13ff41877b7082f66c928e480f22c`,
  releaseId `9ce2eee0a36a380d6402d7dee84a87a2`, health `configured: true`
  through the real local runner (no Docker)
- `adapters run` → run `bcb5becd6f73d8a3ab01e3369a6bec38`, **completed**;
  the host created the linked result with full provenance; re-running
  returned the same run and output (host dedup)
- Fixture: "Learn You Phext" teaching phext, SHA-256
  `e755d3b591adfe928f7e05413a5a944996bef5069b07d813e04a17e3ae59ab16`,
  unchanged before and after
- Output: **16/16 scrolls**, coordinates in the independent Python parser's
  order, downloaded result SHA-256
  `574983375a4cd1289a18698ae0ca7efb4f0f99c8a01d9120989f699237033bd2`
  — byte-identical to the adapter's harness output
  (`evidence/live-scroll-view.html` in this directory is that output)

## Canonical package

The canonical package also lives at **wbic16/emise-tools @ exo**,
`ink-os/phext-adapter/` (commit `a676e1ba`), where it was first published
under the tooling-archive rule. This in-tree copy is byte-identical for
the shared files.

## Status

Branch `emise/phext-adapter` awaits Will's merge / PR decision. **No
upstream PR has been opened** — submitting to siliconjungle upstream is
Will's call.
