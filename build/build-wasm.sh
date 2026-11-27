#!/bin/sh
set -eu
# This script lives in build/; everything else is addressed from the repository root.
TASK_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
: "${QVAULT_CEREMONYCLIENT:?Set QVAULT_CEREMONYCLIENT to an isolated monorepo v2.1.0.23 source checkout}"
[ -f "$QVAULT_CEREMONYCLIENT/nekryptology/go.mod" ] || { echo 'Compatible nekryptology source not found.' >&2; exit 1; }
go -C "$TASK_ROOT/upstream/mpc-wasm" mod edit "-replace=source.quilibrium.com/quilibrium/monorepo/nekryptology=$QVAULT_CEREMONYCLIENT/nekryptology"
GOOS=js GOARCH=wasm go -C "$TASK_ROOT/upstream/mpc-wasm" build -o "$TASK_ROOT/vendor/mpc/mpc.wasm" .
TASK_GOROOT=$(go env GOROOT)
if [ -f "$TASK_GOROOT/lib/wasm/wasm_exec.js" ]; then
 cp "$TASK_GOROOT/lib/wasm/wasm_exec.js" "$TASK_ROOT/vendor/mpc/wasm_exec.js"
else
 cp "$TASK_GOROOT/misc/wasm/wasm_exec.js" "$TASK_ROOT/vendor/mpc/wasm_exec.js"
fi
echo 'Rebuilt MPC WASM and copied its matching Go runtime. Run the local tests before live use.'
