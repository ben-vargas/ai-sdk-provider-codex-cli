#!/usr/bin/env bash
set -euo pipefail

OUT_DIR=${1:-/tmp/codex-protocol-ref}
# Override with the exact CLI you are syncing against, e.g.
#   CODEX_BIN=~/.local/bin/codex scripts/sync-protocol-types.sh
# The locally installed optional-dep binary may not match the target release.
CODEX_BIN=${CODEX_BIN:-codex}

"$CODEX_BIN" app-server generate-ts --experimental --out "$OUT_DIR"

echo "Generated protocol reference types in: $OUT_DIR"
echo "Copy the needed subset into src/app-server/protocol/types.ts and update validators/tests."
