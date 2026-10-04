# Current PC-menu update

The ROM builds with SHA1 `26aabc43b16c1da4c0f5eed8b102948289d82639` and mailbox `0x0203f468`. The core was compiled against the same bounded adapter/address, then repackaged with current ROM provenance; final archive SHA256 is `d294346470e1543875778c07400841a81ee232bb53939e2957cdaafb7b672175`.

The site patch targets fresh PR 6 head `704f7db7b7ffe1b492928a27d6e7a210fa2db937`. It uses the official pinned 4.2.3 frontend, focused arrows and held Space 3x, and a new ROM/core-v2 local save key. Older local records remain stored; do not import older-ROM emulator states. Build and eleven focused keyboard checks pass. Actual PC browser evidence is recorded separately below when complete. No site merge/deployment is performed here.

## Previous NES milestone evidence

# Authorized browser-core build environment

## Current result (2026-10-04)

Official SDK downloads now succeed. The pinned SDK manager installed and activated Emscripten 3.1.74 from official Google Storage dependencies.

**The browser round trip is verified in real Chromium.** Scripted Start/A inputs reach the bedroom NES; the mailbox controller sends only six bounded stats to a new QuickJS Worker; the game displays `JS result: 318`. Three repeated actions, runner error, ROM frame timeout, B cancellation, stale output, pending state load, actual rewind, reset, hidden-page cancellation, and mobile A/Start touch delivery pass. Ten calculation workers were created and terminated; no external browser requests occurred. Evidence lives in ignored `build/browser-mailbox.json` and `build/browser-mailbox-*.png`. Physical iOS/Android testing remains outstanding.

The verified custom archive SHA256 is `4a0744b88a8c74c026dc57c35b97d0c45adb275a31601b455c9678688368cbf4`. ROM SHA1 is `d3ddd18cc5466b78624e3ce7c6db779ed2a15cd9`, mailbox address `0x0203f468`.

### Compatible source selection

The original RetroArch pin `1eb5edf2b3becf0a7b29520a34545628db0c5416` and build pin `7f4d2d7354d7b25766bf5229f8a5c4b121515a68` compiled, but their unchanged metadata requires EmulatorJS 4.3.0. The real 4.2.3 loader rejected that archive. No version guard was bypassed or metadata spoofed. Upstream offers only a 4.3.0 prerelease, while stable/npm remain 4.2.3; see https://github.com/EmulatorJS/EmulatorJS/releases/tag/v4.3.0-pre and https://github.com/EmulatorJS/EmulatorJS/releases/tag/v4.2.3.

The authorized fallback uses the stable-compatible generation: RetroArch `6dd4353937ef48b6ec0bfbdbb15d1c5992d86927` (last first-parent commit before the official 4.2.2 core report build start, 2025-06-14T18:10:32Z) and build `b24e5b535034dc7c3428d76f236d4793881969b6`. Its unchanged upstream metadata requires frontend 4.2.2 and declares core version 2.0.2. The mGBA pin remains `db6592a591523ef9c45d129ed1ec792c71566d18`; the SDK pin remains unchanged. This is a tested custom build with recorded provenance, not a claim of binary equivalence to the stock npm core. Newer original checkouts/archive are preserved locally under ignored `*-newer` paths.

Packaging preserves upstream `build.json`; ROM/source provenance lives in `code-red.json`. The previous packaging script omitted the compatibility field, causing a loader exception; that issue is fixed.

### Run the browser verification

After the build below, install/build the runner with `cd runner && npm ci && npm run build`, run `python3 scripts/serve.py`, then `python3 bridge/test-browser.py` in another terminal. `/bridge/test` is a private verification page that loads the custom core and controller. The ordinary player remains independent unless wired to the custom artifact.

The prepared site changes were tested against `mcembalest/maxcembalest.com` PR 6 head `ca35ab659d2aef9d019a4437327fc14c43473d1f`: a locally selected base file is patched to the exact ROM, real NES/QuickJS returns 318, A/Start touch inputs reach the core, and Save/reload resumes locally. Save keys separate the new ROM/core combination from earlier builds; old local data is retained. No site change was pushed, merged, or deployed by this executor.

A plain IPS delta embeds shifted unchanged assets. `make-copy-patch.py` instead produces `CRCP1`, containing only source offsets/lengths and no ROM bytes. Every output byte is copied from the user's local base, then the player verifies the resulting SHA1. The compressed copy patch and custom core are inputs to the site's normal asset preparation pipeline, not fetched from an invented artifact URL. ROMs, raw IPS deltas, assets, captures and private saves remain ignored/local.

## Previous cloud blocker

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

**The browser build script has now compiled successfully; see the current compatibility blocker above.** The compatible pinned source generation above has passed real browser validation. The recorded source pins establish new-core provenance, not equivalence to the stock npm 4.2.3 core.

Before use on the site, load the custom core locally with pinned EmulatorJS frontend 4.2.3, enumerate `_ejs_code_red_epoch`, `_ejs_code_red_snapshot`, `_ejs_code_red_reply`, and connect a trusted browser controller to the existing disposable Runner. Check the exact ROM hash and use only that build's compiled mailbox address. Validate actual game action/result, failures/timeouts, repeated actions, pending save-state load/reset/rewind, hidden page cancellation and mobile touch. The controller and website integration are still outstanding; packaging a core alone does not complete them. Publish only reviewed source patches and custom emulator artifacts, never the ROM or proprietary assets.

## Native demo architecture and provenance

`bridge/test-native.py` compiles `native-demo.c` against existing mGBA **0.10.5** (`projectVersion` verified; its exported git commit is `(unknown)`). Scripted Start/A button inputs run the ROM normally and interact with the bedroom NES; no native script injection is used. The trusted test driver reads the 36-byte mailbox through `mailbox.c`, sends only the six numeric stats to `calculate.mjs`, then writes a validated numeric reply. The captured in-game text is `JS result: 318`.

`calculate.mjs` starts a new Node `worker_threads` Worker for each calculation. `node-worker.mjs` provides a trusted message adapter and imports the same `runner/worker.js` used by the browser fixture. That worker creates a QuickJS/WASM VM with the existing limits and no host functions or module loader. Node APIs belong to the trusted driver/adapter and are not exposed to the guest. It is not a server, browser mailbox controller or general host-code execution service.

Separately, `bridge/test-core.py` loads the **actual custom native libretro build** from EmulatorJS/mGBA commit `db6592a591523ef9c45d129ed1ec792c71566d18`, with the tracked mailbox adapter and generated fixed-address header. It invokes its actual exported mailbox functions, verifies the ROM display string, and tests pending state-load/reset hooks. This test does not use RetroArch or the stock npm core. The compatible RetroArch/browser build is verified above; the original newer pin was compiled and rejected by the frontend version guard. Full source pins are in the lock file.
