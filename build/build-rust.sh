#!/bin/sh
set -eu
# This script lives in build/; everything else is addressed from the repository root.
TASK_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
: "${QVAULT_RUST_TARGET_DIR:=$TASK_ROOT/.rust-target}"
CARGO_TARGET_DIR="$QVAULT_RUST_TARGET_DIR" cargo build --locked --manifest-path "$TASK_ROOT/build/rust-primes/Cargo.toml" --target wasm32-unknown-unknown --release
wasm-bindgen --version | grep -q '0.2.117' || { echo 'Use wasm-bindgen-cli 0.2.117 to match Cargo.lock.' >&2; exit 1; }
wasm-bindgen --target web --out-dir "$TASK_ROOT/vendor/rust-primes" "$QVAULT_RUST_TARGET_DIR/wasm32-unknown-unknown/release/qvault_rust_primes.wasm"
echo 'Rust safe-prime module rebuilt. Rebuild Go MPC and JS separately, then run tests.'
