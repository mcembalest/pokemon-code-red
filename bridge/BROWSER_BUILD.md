# Authorized browser-core build environment

## Exact cloud blocker

Attempted SDK: **Emscripten 3.1.74**, selected from pinned EmulatorJS build instructions. The pinned SDK manager resolved it to `sdk-releases-c2655005234810c7c42e02a18e4696554abe0352-64bit`.

First denied dependency URL:

```text
https://storage.googleapis.com/webassembly/emscripten-releases-builds/deps/node-v24.19.0-linux-x64.tar.xz
```

Domain: `storage.googleapis.com`. Exact error:

```text
<urlopen error Tunnel connection failed: 403 Forbidden>
```

This is a proxy tunnel rejection, before a normal origin-server response. The log contains no allowlist rule, response body, or evidence distinguishing a persistent policy restriction from a transient proxy denial. No additional download was attempted after it failed. The compiler package was never reached. The currently available host Node does not establish that the SDK's managed dependency or compiler is installed.

Inventory: `emcc`, `emmake`, `emcmake`, `clang`, and `wasm-ld` are absent from PATH. Targeted scans of `/opt`, `/usr/local` and `/usr/lib/llvm-19` found no such executables; LLVM 19 has libclang shared libraries only. `.cache/emsdk` contains the cloned SDK manager, with no installed `upstream` toolchain or managed Node directory. Native GCC, Node v24.19.0, and local mGBA 0.10.5 development files are present. These are checked locations, not an exhaustive scan of inaccessible paths.

The supplied environment configuration says network access is enabled, but provides no permitted-domain list, allowlist editor or user-facing network configuration capability. Do not assume the user can change one. Smallest supported unblock: provide a build environment with authorized access to the SDK's official dependencies, or an already installed Emscripten 3.1.74 toolchain. No proxy bypass, alternate download route or policy change is prescribed.

## Reproducible source preparation

Use a private Linux amd64 development environment. Install the normal FireRed prerequisites plus the upstream core build prerequisites (`build-essential`, Python, git, `p7zip-full`, pkg-config). Keep ROMs, generated assets and private saves local. Work on `dev/rom-runner-mailbox`, not main.

1. Follow the normal project setup and `make build`. Confirm the ROM manifest and mailbox linker symbol belong to that exact build.
2. Fetch the exact revisions recorded in `bridge/core-sources.lock.json` into `.cache/core-mgba`, `.cache/core-retroarch`, `.cache/core-build`, and `.cache/emsdk`. For each repository, use `git init`, set its recorded origin, `git fetch --depth=1 origin <revision>`, then `git checkout --detach FETCH_HEAD`. Do not use upstream `build.sh` unchanged: it runs `git pull` and would move the source pins.
3. **Only in an environment authorized for official SDK downloads**, run `.cache/emsdk/emsdk install 3.1.74`, `.cache/emsdk/emsdk activate 3.1.74`, then `source .cache/emsdk/emsdk_env.sh`. An existing authorized 3.1.74 installation is also sufficient.
4. Run `bash bridge/build-browser-core.sh`. It verifies available tools/source revisions, prepares the bounded core adapter, explicitly adds its three exports, builds only the non-threaded modern mGBA core, and packages local source/license/build metadata. It does no downloads or git pulls. The output is ignored `build/browser-core/mgba-wasm.data`, with a printed SHA256.

**The browser build script has been syntax-checked, not executed successfully here.** Further SDK/system prerequisites or source compatibility failures may appear once the toolchain is available; the native source compile does not rule them out. The recorded source pins establish new-core provenance, not equivalence to the stock npm 4.2.3 core.

Before use on the site, load the custom core locally with pinned EmulatorJS frontend 4.2.3, enumerate `_ejs_code_red_epoch`, `_ejs_code_red_snapshot`, `_ejs_code_red_reply`, and connect a trusted browser controller to the existing disposable Runner. Check the exact ROM hash and use only that build's compiled mailbox address. Validate actual game action/result, failures/timeouts, repeated actions, pending save-state load/reset/rewind, hidden page cancellation and mobile touch. The controller and website integration are still outstanding; packaging a core alone does not complete them. Publish only reviewed source patches and custom emulator artifacts, never the ROM or proprietary assets.

## Native demo architecture and provenance

`bridge/test-native.py` compiles `native-demo.c` against existing mGBA **0.10.5** (`projectVersion` verified; its exported git commit is `(unknown)`). Scripted Start/A button inputs run the ROM normally and interact with the bedroom NES; no native script injection is used. The trusted test driver reads the 36-byte mailbox through `mailbox.c`, sends only the six numeric stats to `calculate.mjs`, then writes a validated numeric reply. The captured in-game text is `JS result: 318`.

`calculate.mjs` starts a new Node `worker_threads` Worker for each calculation. `node-worker.mjs` provides a trusted message adapter and imports the same `runner/worker.js` used by the browser fixture. That worker creates a QuickJS/WASM VM with the existing limits and no host functions or module loader. Node APIs belong to the trusted driver/adapter and are not exposed to the guest. It is not a server, browser mailbox controller or general host-code execution service.

Separately, `bridge/test-core.py` loads the **actual custom native libretro build** from EmulatorJS/mGBA commit `db6592a591523ef9c45d129ed1ec792c71566d18`, with the tracked mailbox adapter and generated fixed-address header. It invokes its actual exported mailbox functions, verifies the ROM display string, and tests pending state-load/reset hooks. This test does not use RetroArch or the stock npm core. RetroArch commit `1eb5edf2b3becf0a7b29520a34545628db0c5416` is pinned for the future browser build but has not been compiled here. Full source pins are in the lock file.
