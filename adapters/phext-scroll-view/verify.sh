#!/bin/sh
# verify.sh — verify the Phext Scroll View adapter against the host protocol.
#
# Generates the expected scroll map from Will's Python parser
# (~/workspace/phext/parse_phext.py — an implementation independent of this
# module's JS port), then runs the Node harness (tests/harness.mjs), which
# simulates the Ink OS host protocol as derived from
# siliconjungle/ink-os-platform @ a1d3b117 and checks:
#   1. health returns configured
#   2. run completes with output of the declared mime/extension
#   3. all 16 scroll coordinates present, in the fixture's TOC order
#   4. every scroll's text appears (escaped) — none dropped or truncated
#   5. input SHA-256 identical before/after (original preserved)
#   6. plain text -> single scroll at 1.1.1/1.1.1/1.1.1; empty input safe
#   7. determinism: two runs are byte-identical
# Prints PASS/FAIL per check; exit 0 only if every check passes.
#
# The fixture is only ever read. The harness's stub content server serves
# bytes it read into memory; nothing writes to the fixture path.

set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FIXTURE="$HOME/workspace/goals/public-read-only-demo-exocortex/files/learn-you-phext.phext"
PARSER="$HOME/workspace/phext/parse_phext.py"

command -v node >/dev/null 2>&1 || { echo "FAIL: node not found"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: python3 not found"; exit 1; }
[ -f "$FIXTURE" ] || { echo "FAIL: fixture not found: $FIXTURE"; exit 1; }
[ -f "$PARSER" ] || { echo "FAIL: parser not found: $PARSER"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

# Independent expected map: coordinates + full scroll texts, from the
# Python parser's parse() (all scroll slots, in document order).
python3 - "$PARSER" "$FIXTURE" "$TMP/expected.json" <<'PYEOF'
import importlib.util, json, sys
parser_path, fixture, out = sys.argv[1:4]
spec = importlib.util.spec_from_file_location("parse_phext", parser_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
scrolls = mod.parse(fixture)
with open(out, "w") as f:
    json.dump([{"coordinate": c, "text": t} for c, t in scrolls], f)
print(f"expected: {len(scrolls)} scrolls from Python parser")
PYEOF
[ -f "$TMP/expected.json" ] || { echo "FAIL: could not build expected map"; exit 1; }

node "$HERE/tests/harness.mjs" "$TMP/expected.json" "$FIXTURE"
