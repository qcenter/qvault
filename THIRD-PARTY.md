# Source references

- QKMS SDK core source and RSA wasm source: fetched at build time by `build/fetch-sdk.mjs` from https://github.com/qcenter/qkms-sdk at commit 1c631fd2583055b189d512b67d129bd548066506, a public fork of https://github.com/QuilibriumNetwork/qkms-sdk/tree/51b6eecda82c1508181627ce8197e48f0176c352 . These sources are not stored in this repository; the bundles in `dist/` and the module in `vendor/mpc/` are built from them. The fork's changes, not part of upstream, are two commits on top of that upstream commit. In `packages/core/src/sidecar/`: `dispatch.ts` (a session may revisit the same round), `index.ts` (options `reusePeerSession`, `operationsWithoutPeerSession`, `acceptTask`, `onProgress`, `onError`), `peer-channel.ts` (peer sessions can be scoped per task or reused across tasks), `poll.ts` (task filtering and normalisation, progress and error reporting, stricter party mapping, and `operationsWithoutPeerSession`: sign/decrypt tasks are dispatched without the peer channel if the E2EE peer session is not ready, while key creation still requires it) and `sessions/rsa.ts` (prepared key material, no private-share export unless explicitly enabled for tests, operation state per task, stricter validation). In `wasm/mpc-wasm/`: `main.go`, `mpcrsa/rsa_nparty.go` and `mpcrsa/precompute.go` (RSA key material can be prepared before the key is requested). QVault enables `operationsWithoutPeerSession` only for hosted participants; a live check with it switched off showed that the hosted service does not complete a decrypt for a restarted participant otherwise.
- Channel, channel-wasm, ed448-rust, nekryptology: https://github.com/QuilibriumNetwork/monorepo/tree/v2.1.0.23 . The compatibility patch is shipped separately in `build/`; native installed code is untouched.
- Go runtime support: https://go.dev/LICENSE . The license is bundled with the runtime.
- wasm-bindgen: https://github.com/wasm-bindgen/wasm-bindgen/tree/0.2.117 . MIT/Apache-2.0 runtime bindings.
- aws4fetch 1.0.20: https://github.com/mhart/aws4fetch . MIT; signed S3 requests, no hand-rolled request signer.
- @noble/curves 1.9.7, @noble/hashes 1.8.0, @scure/base 1.2.6: https://github.com/paulmillr . MIT.
- idb 8.0.3: https://github.com/jakearchibald/idb . ISC; included in pinned development dependencies, no persistent storage enabled by the lab.
- esbuild 0.25.12: https://github.com/evanw/esbuild . MIT; build tooling.

Package-lock pins registry dependencies and their integrity metadata. This inventory is not a legal clearance statement for publishing upstream code or a security audit.

Rust acceleration dependencies (exact transitive versions in build/rust-primes/Cargo.lock):
- crypto-primes 0.7.2: https://github.com/entropyxyz/crypto-primes (MIT OR Apache-2.0).
- crypto-bigint 0.7.11: https://github.com/RustCrypto/crypto-bigint (MIT OR Apache-2.0).
- rand_chacha 0.10.0 and rand_core 0.10.1: https://github.com/rust-random/rand (MIT OR Apache-2.0).
License texts from downloaded crates are bundled under vendor/rust-primes/licenses. These are library reuse, not an audit of this integration.

Protected-profile test dependency: fake-indexeddb 6.2.4, Apache-2.0, https://github.com/dumbmatter/fakeIndexedDB . Test bundles include this mock; the browser runtime uses its native IndexedDB. License included at tests/FAKE-INDEXEDDB-LICENSE. Profile cryptography uses built-in WebCrypto APIs.
