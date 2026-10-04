# Pokémon Code Red

A minimal FireRed mod development loop: coding agents as Pokémon, tools/skills as moves. The 18-type mapping and broader game design are deliberately undecided. The first change is only a visible development marker in Oak's new-game introduction: **CODE RED dev build!**

## Quick start (Linux / cloud)

Prerequisites: `git`, `python3`, `make`, `gcc`, `g++`, `binutils-arm-none-eabi`, `libpng-dev`; `libmgba-dev` for the headless boot check. On Debian/Ubuntu:

```sh
sudo apt-get update
sudo apt-get install build-essential binutils-arm-none-eabi libpng-dev python3 libmgba-dev
make setup
make baseline  # optional first-time checksum check, BEFORE applying the mod
make build
make test
make smoke
make serve
```

`make setup` fetches source, not a ROM, from pinned `pret/pokefirered` and `pret/agbcc` revisions in [upstream.lock.json](upstream.lock.json), builds the compiler, and fetches integrity-pinned official browser emulator packages. The checked-in dev container installs prerequisites and runs setup. Initial setup needs permitted GitHub source and npm-registry access; subsequent source builds are local. Baseline matches English FireRed USA v1.0. This decompilation can build without a supplied base ROM. A user-supplied base is required for `make patch`, described below.

Output stays ignored in `build/`: `code-red.gba`, `manifest.json`, headless captures. Upstream source/toolchain stays ignored in `.cache/`. No game assets or binaries are checked into this repo. Never publish generated ROMs, extracted assets, saves, or the ignored upstream checkout. Downloaded emulator packages also remain ignored in `.cache/browser/`.

## Small edit → build → play

1. Edit a source file under `.cache/pokefirered/`. The first editable text is `data/text/new_game_intro.inc`.
2. For intro-text edits, run `make export` to capture the change in `patches/001-code-red-intro.patch`. For other source files, export a separate scoped patch, for example:
   ```sh
   git -C .cache/pokefirered diff --binary -- data/maps/PalletTown_ProfessorOaksLab/scripts.inc > patches/002-lab.patch
   ```
   Export source edits before leaving a session: `.cache/` is not retained through Git. Avoid overlapping patches for the same edits.
3. `make build` applies unapplied patches, leaves existing applied patches alone, and runs incremental `make`. Conflicting patches fail without resetting source changes.
4. `make smoke` runs 2,400 mGBA frames with scripted Start/A input and writes `build/boot.ppm` and `build/intro.ppm` (also PNG if Pillow is installed). Inspect images; this is a boot/intro smoke check, not a full gameplay test.
5. `make serve`, open the player, and press **Play latest build**. Reload the player after rebuilding. Start a **new game** to verify the intro marker; existing saves skip it.

Do not use `make baseline` after editing the source: it intentionally refuses a dirty checkout. It never resets work. To rerun a baseline later, use a separate clean checkout at the pinned revision.

## Continue and play from a phone

**Coding from your phone:** continue the same cloud Codex conversation or open the branch in a Codespace. Uncommitted working-tree changes belong to the current session; do not start a fresh session and expect it to contain them. Capture source edits as patches before leaving. The starter tooling, patch, and docs were approved for commit/push on 2026-10-04; further commits/pushes require explicit approval. Merges and public deployment are not authorized.

**Exact supported phone route:**

1. Open [Create a Codespace for this repo](https://codespaces.new/mcembalest/pokemon-code-red), select **dev/initial-loop** in the branch dropdown, and choose **Create codespace**. Use the approved starter branch `dev/initial-loop`. The checked-in dev container installs prerequisites and runs `make setup` automatically.
2. In the browser terminal, run `make build && make serve`.
3. Open the **Ports** tab, find **8000 / Code Red private playtest**, confirm **Private**, and tap **Open in Browser**. Sign into the same GitHub account if prompted. Tap **Play latest build**. Bookmark that authenticated URL for your phone; return to the Codespace browser tab for edits.

No Codespace was created by this task. GitHub account access and Codespaces quota are required. Use landscape mode for the terminal. The phone route stays inside the Codespace, with no proprietary assets uploaded to a public host.

**Private forwarding details:** port **8000** is already declared in `.devcontainer/devcontainer.json`; Codespaces forwards it when the server starts. Keep visibility **Private**. Open its authenticated HTTPS URL on the phone while signed into the same GitHub account. Codespaces forwards a loopback-bound server. If another cloud provider requires binding all interfaces, use `python3 scripts/serve.py --bind 0.0.0.0` only behind that provider's authenticated private forward. This server has no authentication of its own. Do not expose it through a public tunnel.

The browser player uses official `@emulatorjs/emulatorjs@4.2.3` and `@emulatorjs/core-mgba@4.2.3` packages, SHA-512 pinned in `browser.lock.json`. `make browser-setup` fetches them from the permitted npm registry and serves them locally. The optional upstream CDN update check is disabled in the local runtime; browser playback makes no external requests. Phone touch controls come from the emulator. The ROM comes from the private development server or a selected local file. Save progress in-game and export a save using the emulator menu before changing devices or ROM versions; do not assume browser storage will sync.

**Fallback if browser playback fails:** tap **Download this build**, then open the local `.gba` in a GBA emulator on your phone. Use a locally installed emulator if browser sound/touch or save persistence is unreliable. Mobile Chromium boot and touch-input delivery are verified; physical iOS/Android testing remains to be done. No shareable phone URL was published. This selected Codex cloud executor exposes no supported authenticated private preview/port-forward capability through its tools or workspace configuration. Use the concrete Codespaces route above; a loopback link from this executor will not open on the phone.

## Base requirement for local patch packaging

Supply your own lawfully obtained cartridge dump at ignored `local/baserom.gba`:

- Pokémon FireRed, English USA, **v1.0 / revision 0** (`BPRE`)
- Size: **16,777,216 bytes**
- SHA-1: **41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc**
- Not v1.1 (`dd5945db9b930750cb39d00c84da8571feebf417`), LeafGreen, or a previously patched ROM.

Then run `make patch`. It verifies the base checksum and patch round-trip before writing ignored `build/code-red.ips`. No ROM is downloaded by the tooling. Patch distribution still requires review and approval; generating an IPS does not grant permission to publish it.

## Verified in the initial cloud session

Optional browser recheck: with `make serve` running and Python Playwright plus Chromium installed, run `python3 scripts/browser_smoke.py`. This verifies touch Start/A input reaches the core, captures the screen, and asserts zero external requests.

See [docs/verification.md](docs/verification.md) for actual build, emulator, test and phone-route results. No full-mod design is included.

References: [pret build instructions](https://github.com/pret/pokefirered/blob/037335f4c725d7c9aecdac87066f2002b4bd7e14/INSTALL.md), [EmulatorJS documentation](https://emulatorjs.org/docs/), [EmulatorJS CDN versions](https://emulatorjs.org/docs/cdn/), [GitHub private port forwarding](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace).
