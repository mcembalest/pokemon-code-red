# ROM calculation mailbox: browser round trip verified

The bedroom NES now starts one asynchronous calculation. Press A while facing the NES directly above the starting position after a new game. The ROM publishes six Gen III Bulbasaur base stats ([Serebii](https://www.serebii.net/pokedex-rs/001.shtml)); a disposable QuickJS worker sums them; the ROM displays `JS result: 318`. B cancels waiting. An ordinary emulator without the bridge times out; the site integration is prepared and tested locally, but has not been published.

## Verified here

- `make build`: success; ROM SHA1 `d3ddd18cc5466b78624e3ce7c6db779ed2a15cd9`.
- `make smoke`: boot and original introduction marker inspected.
- `make test`: five existing tooling tests pass.
- `python3 bridge/test-native.py`: actual Start/A core inputs reach the NES; two requests return 318 from independent QuickJS workers. Runner failure, no-response timeout, B cancellation, pending-state load and reset reject stale responses. Captures in ignored `build/mailbox-*.ppm` were inspected; success/error/timeout/cancel messages are inside the game, not HTML overlays.
- Protocol test below: bounds, version, operation, ID, epoch, duplicate reply and result limits pass.
- Prepared pinned mGBA source compiles with native `Makefile.libretro`. Its three custom exports are present in the shared library.
- `python3 bridge/test-core.py`: uses those actual exports in the pinned native libretro build. Real ROM input produces a request, QuickJS returns 318, and the ROM's encoded display string is verified. Loading a pending state through `retro_unserialize` changes epoch and cancels the ROM request. Reset changes epoch and rejects the pending reply.

The **WebAssembly/browser round trip now passes** in real Chromium: in-game NES → disposable QuickJS → in-game `318`, repeat/error/timeout/B-cancel/load/rewind/reset/hide/stale-output and mobile touch checks. Stable frontend 4.2.3 uses a compatible pinned RetroArch/build generation; no compatibility guard was bypassed. Full sources, selection evidence and artifact SHA256 are in `core-sources.lock.json` and BROWSER_BUILD.md. Site local-file patching and Save/reload were also verified on the prepared PR 6 changes, which are not published. Physical iOS/Android verification remains outstanding.

See [browser results, authorized build instructions and native architecture](BROWSER_BUILD.md).

## Reproduce independent checks

```sh
make build
cd runner && npm ci --cache ../.cache/npm && npm test && cd ..
python3 bridge/test-native.py
cc -Wall -Wextra -Werror bridge/tests/mailbox.c bridge/mailbox.c -o /tmp/mailbox-test
/tmp/mailbox-test
```

The native tests use the project's existing mGBA development prerequisites through `scripts/dev.py`'s sysroot environment. They load only ignored local build ROMs. No ROM, save, framebuffer or binary is tracked or distributed.

To prepare the custom core, obtain the exact source revisions in `core-sources.lock.json` into `.cache/core-mgba`, `.cache/core-retroarch`, and `.cache/core-build`; then run `python3 bridge/prepare-core.py`. It checks the mGBA revision, refuses an initially dirty core checkout, copies the scoped adapter, and derives its fixed address from the ROM linker map. Native compile/check:

```sh
make -C .cache/core-mgba -f Makefile.libretro -j2
python3 bridge/test-core.py
```

The browser milestone now passes via `browser-controller.js` and `test-browser.py` on the compatible pinned core. Run the private test page and checks described in BROWSER_BUILD.md. Site integration has been prepared and tested locally but is awaiting the parent publisher. The next playtest should cover physical iOS/Android and the reviewed private preview; preserve the local-file/save flow and exact artifact/ROM binding.

## Narrow transport

The 36-byte little-endian record contains magic `CRD1`, protocol version 1, state, request ID, epoch, operation ID 1, status, six u16 stats and one u32 result. State 1 is pending, 2 is a reply and 4 is cancelled. ROM fields publish the pending state last; reply fields publish completion last. Only the fixed stats-sum operation is accepted; stats are bounded to 255 and results to 1530. No guest code, pointers, files, credentials or general emulator commands cross the mailbox.

The trusted adapter has exactly three intended browser exports: `ejs_code_red_epoch`, `ejs_code_red_snapshot(out, 36)` and `ejs_code_red_reply(epoch, request, status, result)`. Capacity must equal 36; the mailbox address is compiled from the verified build. Replies must match the pending ID and current core epoch. The epoch lives outside serialized game state. Reset and every core unserialization invalidate it and cancel a restored pending record. Standard RetroArch rewind calls `content_deserialize_state`, which reaches the same unserialization path; the actual browser rewind path is now tested and rejects stale replies. Threaded cores, runahead and netplay are not supported by this prototype.

The ROM waits for at most 600 emulated frames, independently of the runner's 250 ms VM / 3-second outer worker deadline. Emulator pause/backgrounding can delay this frame deadline. The browser controller terminates pending work on hide/cancel or epoch change and rejects stale outputs; those paths are verified. The native harness pauses between frames only to let its independent test worker respond; it is not a server or production transport.

The QuickJS guest has the existing runner's bounded JSON interface and no host functions/module loader. `calculate.mjs`/`node-worker.mjs` are trusted local test adapters and expose none of Node's APIs to the guest. These controls are a prototype boundary, not an absolute safety guarantee or a total browser-memory quota.

The ROM currently uses 261,080 of 262,144 EWRAM bytes, leaving 1,064 bytes; further additions need a RAM budget. Save structures were not changed, but old emulator states must not be loaded across differing ROM builds. The NES interaction replaces only its original flavor text; bedroom PC and the broader game remain intact.
