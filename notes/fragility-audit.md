# Fragility audit — browser, runtime, dev cycle

Ranked by how much each blocks fast iteration.

## 1. Custom core is welded to one ROM build
- core hardcodes mailbox addresses read from the ROM link map
  - G: `bridge/prepare-core.py`:
    > `address=re.search(r'(0x[0-9a-f]+)\s+gCodeRedMailbox',maptext).group(1)`
    > `(folder/'code_red_address.h').write_text(f'#define CODE_RED_MAILBOX_ADDRESS {address}\n…`
  - S: `tools/code-red-core/source/code_red_address.h`:
    > `#define CODE_RED_MAILBOX_ADDRESS 0x0203f4a8`
    > `#define CODE_RED_NAMING_MAILBOX_ADDRESS 0x02039990`
- consequence: any game change that shifts EWRAM layout → rebuild core with Emscripten 3.1.74 + pinned RetroArch → new 1 MB binary → re-commit to site
- addresses already moved once: `0x0203f468` (NES/PC milestone) → `0x0203f4a8` (scratchpad)
- fix → ROM-independent core (see foundation-plan §1)

## 2. Saves are emulator states keyed to exact ROM hash
- S: `src/things/pokemon-code-red/storage.ts`:
  > ``export const STATE_KEY = `state:${MOD_SHA1}:emulatorjs-4.2.3:mailbox-core-v2` ``
- player.ts saves via `gameManager.getState()` / `loadState()`
- page copy admits it:
  > "This PC-menu update starts a new save slot. Earlier local saves remain stored; use the earlier build to access them. Do not import earlier ROM/core states here."
- consequence: every deploy orphans every player's progress
- in-game battery save (SRAM/.sav) survives ROM changes as long as save structs unchanged; EmulatorJS exposes it:
  - `GameManager.js:417` `getSaveFile(save)` → `FS.readFile(getSaveFilePath())`
  - `GameManager.js:424` `loadSaveFiles()` → `refresh_save_files`
- fix → persist .sav keyed by base game, not ROM hash (foundation-plan §2)

## 3. Two repos, copy-pasted code, manual handoff
- identical copies (sha1 prefix match):
  - G:`runner/worker.js` = S:`tools/code-red-runner/worker.js` (`e2b2ee72`)
  - G:`runner/client.js` = S:`tools/code-red-runner/client.js`
  - G:`runner/limits.js` = S:`tools/code-red-runner/limits.js`
  - G:`bridge/core-adapter.inc` = S:`tools/code-red-core/source/core-adapter.inc`
  - G:`bridge/mailbox.c` = S:`tools/code-red-core/source/mailbox.c`
- already drifted: G:`bridge/browser-controller.js` (`9dbc1bcc`) ≠ S:`tools/code-red-runner/mailbox.js` (`7c3dd2e0`)
- handoff = JSON blob of 31 files + hashes applied by hand:
  - G: `.integration/code-red-scratchpad-naming/README.txt`:
    > "Publish only these listed paths atomically via parent publisher after verifying head."
- binaries committed to site repo: 1 MB core, 764 KB copy patch — every game change = new binary commits in site history
- fix → game repo owns the player; site only embeds a built bundle (foundation-plan §3)

## 4. Two players
- G: `web/index.html` (dev player, stock core, no bridge)
- G: `bridge/browser-test.html` (private test page)
- S: `pokemon-code-red.astro` (real player)
- features + tests exist only on the site side (keyboard, naming UI, cache, repl)
- consequence: can't play the real thing from the game repo's dev loop

## 5. Bridge is single-purpose
- one op: sum six u16 stats; reply int 0..1530
  - G: `bridge/browser-controller.js`: `const SOURCE = 'return input.stats.reduce(...)'`, `result >= 0 && result <= 1530`
- naming = a second, separate mailbox + second set of core exports
- every new game↔code feature today = new mailbox + new core exports + core rebuild
- fix → one versioned channel, ops defined in JS + ROM only (bridge-v2.md)

## 6. Dev loop is Linux/cloud-shaped
- `scripts/dev.py` hardwires a Debian sysroot: `lib = str(sysroot / 'usr/lib/x86_64-linux-gnu')`
- README phone route = Codespaces; mentions "cloud Codex conversation"
- no documented macOS path; no single "build → open real player" command
- fix → one `make dev` that builds ROM + copy patch + serves the real player w/ live reload

## 7. Tests: many, scattered, no CI
- Python Playwright scripts: `bridge/test-browser.py`, `test-repl-browser.py`, `test-naming-browser.py`, `runner/tests/browser.py`, `scripts/browser_smoke.py`; site `tools/code-red-core/tests/*.py`
- native C drivers: `bridge/test-native.py`, `test-core.py`, `test-pc-native.py`, `test-naming-native.py`
- no `.github/workflows` in either repo
- many need a ROM → can't run in CI as-is
- fix → split: ROM-free tests in CI (runner, protocol, player w/ fixture core), ROM tests local `make check`

## 8. Docs are evidence logs, not instructions
- `bridge/README.md` and `bridge/BROWSER_BUILD.md` open with the same section verbatim
- stacked "Prior … evidence" milestones; stale ROM SHA1s in body
- README phone route references `dev/initial-loop`, superseded

## Non-issues / keep
- legal model: user supplies base ROM, copy patch has no ROM bytes (`CRCP1`: "only source offsets/lengths and no ROM bytes")
- QuickJS sandbox + limits (`runner/README.md`) — solid, reuse
- pinned upstreams + integrity hashes
- epoch invalidation on reset / state load — real problem, keep the idea
