# Isolated JavaScript fixture runner

This developer harness executes a JavaScript function body in QuickJS/WASM inside a fresh disposable browser Worker. It is separate from the FireRed player, ROM and live battles. The tiny JSON fixture contains Bulbasaur's Gen III base stats from [Serebii](https://www.serebii.net/pokedex-rs/001.shtml), total 318. It is not a damage calculator or a complete stats database.

```sh
cd runner
npm ci --cache ../.cache/npm
npm test
python3 -m http.server 8002 --bind 127.0.0.1 --directory dist
```

Open the harness through an authenticated private port forward. `npm test` needs Python Playwright and Chromium installed; dependencies for it are not installed automatically. `npm run build` only needs Node/npm. Generated bundles, WASM and dependencies are ignored. `package-lock.json` pins dependency versions and registry integrity hashes; QuickJS bindings 0.32.0 and esbuild 0.28.2 are exact versions.

The guest receives one JSON value named `input`. It returns JSON-serializable data synchronously. No host functions or module loader are installed, and pending promise jobs are not executed. Network, DOM, filesystem, storage, process, credentials and emulator objects are not exposed to the guest. Guest code never runs through host `eval` or host `Function`.

Limits: 8 KiB UTF-8 source, 4 KiB UTF-8 input/output, JSON depth 8, 8 MiB QuickJS heap, 128 KiB QuickJS stack, 250 ms monotonic VM deadline covering evaluation and serialization, and 3 seconds outer worker lifetime including WASM startup. Reserved prototype-related keys are rejected. Serialization uses an intrinsic captured before execution; guest getters and `toJSON` remain inside the VM under its deadline. Only the bounded serialized string crosses back to the page. Guest error objects/strings do not cross the boundary.

Each run replaces the previous run. Completion, failure, timeout, cancellation, pagehide and hidden-document events terminate its Worker. Replies must match the current request ID; late/stale replies are ignored. Handles/context/runtime are disposed on normal worker completion. Hard termination provides cleanup when the VM cannot complete. There is no persistence or external side effect to replay.

The trusted outer Worker still has browser capabilities needed to load its local bundle and WASM; these are not guest APIs. The QuickJS heap limit is not a total browser-process/WASM memory quota. Browser suspension can delay timers, and engine/browser vulnerabilities remain outside these checks. This is a scoped prototype, not an absolute security guarantee or an OS sandbox. Test inputs must not contain secrets; no live battle state or ROM bridge is connected.

The browser suite checks known results, absent capability names, infinite computation, allocation/heap/stack failures, serialization loops, oversized and invalid outputs, malformed/oversized input, imports/promises, cancel/replacement/stale IDs, hide lifecycle, startup timeout, UI heartbeat and repeated-worker cleanup. Hidden-document testing uses a synthetic visibility event; physical mobile backgrounding remains unverified. Counts prove workers are terminated, not that a browser immediately returns every allocation to the operating system.

Primary API reference: [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten), particularly runtime memory/stack/interrupt limits and explicit handle disposal. QuickJS bindings and WASM use MIT licenses; esbuild uses MIT. No paid backend, mailbox bridge or deployment is included.
