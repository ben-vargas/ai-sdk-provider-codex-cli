#!/usr/bin/env bash
set -euo pipefail

OUT_DIR=${1:-/tmp/codex-protocol-ref}

codex app-server generate-ts --experimental --out "$OUT_DIR"

echo "Generated protocol reference types in: $OUT_DIR"
echo "Copy the needed subset into src/app-server/protocol/types.ts and update validators/tests."
