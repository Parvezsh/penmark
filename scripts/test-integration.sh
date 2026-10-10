#!/bin/bash
# Runs test/integration in an isolated VS Code window (own profile, temp ~/.claude stand-in).
# Your VS Code, profile and ~/.claude are not touched.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/penmark-int.XXXX")" && pwd -P)"
mkdir -p "$T/claude" "$T/docs" "$T/profile/User"
printf '# Plan\n\nWe ship in March.\n' > "$T/docs/plan.md"
echo '{ "security.workspace.trust.enabled": false, "workbench.startupEditor": "none", "telemetry.telemetryLevel": "off", "update.mode": "none" }' > "$T/profile/User/settings.json"
(cd "$ROOT" && npm run build --silent)
PENMARK_CLAUDE_DIR="$T/claude" PENMARK_RESULT="$T/result.jsonl" \
  code --user-data-dir "$T/profile" --extensions-dir "$T/exts" \
  --extensionDevelopmentPath="$ROOT" --extensionTestsPath="$ROOT/test/integration" "$T/docs" >/dev/null 2>&1
for _ in $(seq 1 60); do grep -qs '"done"' "$T/result.jsonl" && break; sleep 1; done
cat "$T/result.jsonl"
pkill -f "$T/profile" 2>/dev/null || true
if grep -q '"done":true,"failed":0' "$T/result.jsonl"; then
  sleep 2
  rm -rf "$T" 2>/dev/null || true
  echo "PASS"
else
  echo "FAIL (kept $T)"
  exit 1
fi
