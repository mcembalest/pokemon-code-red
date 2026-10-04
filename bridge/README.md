# JavaScript scratchpad and native naming update

ROM SHA1 `0d16f8e90c320b5b737e39ed6c4f2aeafd1da622`; custom core SHA256 `d06d71a9353378f04237db5f095f83fddf660f6a13e63c8ef35a75676d161b0d`. Calculation mailbox is fixed at `0x0203f4a8` (36 bytes); naming mailbox `0x02039990` (60 bytes). Remaining EWRAM budget is 1000 bytes; save structs are unchanged.

PC Code opens a focused JavaScript scratchpad. Expression and function-body/return modes use the same bounded runner, with a fresh disposable VM on every Run. Editable source remains between runs; variables do not. Transcript/source reset on reopening and are not stored. Enter runs, Shift+Enter adds a line, Escape/Close cancels pending work and returns to the game; a last successful integer 0..1530 can be displayed in-game. Cancel run terminates its worker while leaving the editor open. The game pauses while the scratchpad is open; runner wall/CPU limits remain unchanged. Host load/reset/rewind commands cancel and release this pause before the deferred emulator command executes.

Normal naming screens use a fixed allowlisted ASCII transport for letters, numbers, spaces and supported punctuation, preserving their native length/confirmation/default/controller behavior. Enter waits for the latest replacement acknowledgement; Escape returns to game controls and cancels queued confirmation. Desktop focus and mobile tap-to-type use a real native text input. Epoch/session/sequence validation rejects stale edits; load/reset clears queued input. No general guest memory address, script invocation or host capability is introduced.

The exact site patch against PR 6 head `17473765b8e571bb1a81232a792223da69e2484e` also integrates the separate source-cache/10x changes from game integration commit `8b214810e33807d59cb68f837f631bda1948566a`. A verified original is retained independently of build identity and can generate future patched builds locally. Current/old ROM and emulator-state records remain isolated; existing patched-only caches require selecting the original once on their next upgrade. Missing/corrupt/evicted browser data still falls back to the chooser.

Verification: native naming through ordinary intro inputs; ASAN/UBSAN naming transport; actual Chromium naming bounds/epoch/session/confirmation; actual site player/rival typing, PC open/pause, edits/expressions/statements, fresh globals, host names absent, infinite-run Cancel, visible in-game 318, natural menu return/reopen, and load/reset/hide stale rejection. All 12 scratchpad workers terminated with zero external requests/page errors. Site 48 tests/build pass; runner 43 tests pass; scratchpad 11, naming UI 15, keyboard 11 (10x), real BFCache navigation 6 and source-cache browser checks pass. Cache tests use synthetic 16 MiB fixtures; production SHA1 checks are unchanged.

Physical iOS/Android keyboard behavior and achieved 10x throughput are not benchmarked. Common naming templates share the tested handler; player/rival are played end to end. Professor/intro artwork is unchanged by this release.

## Prior PC and NES evidence

# ROM calculation mailbox: browser round trip verified

Home and Pokémon Center PCs now offer **Code**. The bounded demo sends six Bulbasaur base stats to a disposable QuickJS worker, then displays `JS result: 318`. B cancels waiting. Existing storage, mailbox, healing, dialogue and progression remain available; the bedroom NES has its original flavor text. Bill's teleporter and favorite-Pokémon list finish before the Code offer.

Current ROM SHA1 is `26aabc43b16c1da4c0f5eed8b102948289d82639`; the fixed mailbox remains `0x0203f468`. Current PC checks are `python3 bridge/test-pc-native.py` and `python3 bridge/test-browser.py`; both pass, with test fixture details and limits in BROWSER_BUILD.md. The checks below describe the previous NES milestone unless explicitly identified as PC checks. Old native NES navigation drivers require adaptation for the PC menu; they are not evidence for the current ROM.

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

The ROM currently uses 261,080 of 262,144 EWRAM bytes, leaving 1,064 bytes; further additions need a RAM budget. Save structures were not changed, but old emulator states must not be loaded across differing ROM builds. The NES flavor text is restored. PC additions preserve existing services and save structures.
