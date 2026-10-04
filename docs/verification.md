# Initial cloud verification — 2026-10-03

Working directory: `/workspace/pokemon-code-red`. Isolated branch: `dev/initial-loop`.
Existing HEAD remains `134fa00` (Initial commit). No commits, pushes, PRs, merges, GitHub writes, or public deployment performed.

## Milestones reached

- Inspected the initially README-only repo and workspace `.agents/` / `.codex/`; no existing AGENTS.md or relevant local skills were present. Added scoped AGENTS.md for subsequent sessions.
- Pinned `pret/pokefirered` at `037335f4c725d7c9aecdac87066f2002b4bd7e14` and `pret/agbcc` at `da598c1d918402c42c0c0d7128ba14567f3175e9`.
- Built agbcc and FireRed in this cloud workspace. Missing native dependencies were downloaded as Debian packages and extracted into ignored `.cache/sysroot`, with no system installation needed. General setup uses the documented apt prerequisites or dev container.
- Unmodified baseline: 16,777,216 bytes; SHA-1 **41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc**, exactly matches the upstream FireRed USA v1.0 reference.
- Mod ROM: 16,777,216 bytes; SHA-1 **72dd10ca9b562b2240c307eb0f15aec35ed68338**. The sole game change replaces “Glad to meet you!” with “CODE RED dev build!” in Oak's introductory text.
- mGBA 0.10.5 ran **2,400 frames** with scripted Start/A input using its built-in BIOS implementation. Visually inspected `build/boot.png` (Game Freak startup), `build/intro.png` (Oak and welcome text), and `build/marker.png` (Code Red text). Captures remain ignored and local.
- `make setup` succeeds on repeat. `make build` succeeds incrementally with the patch already applied; output hash stays unchanged.
- **Five unittest cases pass**: IPS long-record/reserved-offset round-trip, 16 MiB FireRed size, unchanged input, invalid sizes, and server file allowlist/traversal checks.
- Actual generated baseline → mod IPS round-trip also passes in memory (3,735 encoded bytes); no patch file or supplied base was used for this internal check.
- Browser check with Chromium, 390×844 touch/mobile viewport: build status loaded, Play button enabled, no horizontal overflow, ROM route returned HTTP 200 and exactly 16,777,216 bytes.
- Browser follow-up: the local EmulatorJS/mGBA WASM core boots, Oak's new-game introduction is visible, and all eight virtual buttons plus the D-pad render. Playwright touch taps on **Start** and **A** reach the core with matching press/release values (`[0,3,1/0]`, `[0,8,1/0]`). Playback requests only loopback resources: **zero external requests**. `scripts/browser_smoke.py` reproduces this check with optional Playwright/Chromium; local evidence is `build/browser-smoke.json` and `build/browser-intro.png`. No physical phone was available for testing.
- `git diff --check` passes; all ROMs, captures, upstream assets, and local packages are ignored.

## Blockers / limits

- **Initial CDN route was policy-denied, then replaced:** the outbound proxy returns HTTP 403 at CONNECT for `cdn.emulatorjs.org`; this is a policy denial, not a transient missing-file/network failure. No proxy bypass was attempted. Authorized official packages from the permitted npm registry now supply both frontend and GBA core locally, with pinned SHA-512 integrity. The optional CDN version check is disabled in the generated local runtime. Mobile Chromium now boots successfully.
- **No supported private preview/forward is exposed in this executor:** inspected available tools and workspace configuration; no authenticated preview tool or private URL exists here. No public tunnel or deployment was used. The supported alternative is GitHub Codespaces after an approved commit/push: open `https://codespaces.new/mcembalest/pokemon-code-red`, select `dev/initial-loop`, create the Codespace, run `make build && make serve`, then open private port 8000 from its Ports tab. Setup and port declaration are checked in. No Codespace has been provisioned; user account/quota and GitHub persistence approval are the remaining steps.
- **Patch packaging intentionally awaits a user-supplied base:** `make patch` currently stops with an actionable message asking for `local/baserom.gba`, English USA FireRed v1.0, 16,777,216 bytes, SHA-1 `41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc`. Wrong revision/dump is rejected. This is not a build blocker: the decompilation builds independently.
- Dev-container configuration was written but not launched in this task. Native build/test was performed directly in the selected cloud environment.
- Smoke verification covers startup and intro, not battles, saving, or extended gameplay. The 18-type mapping and broader mod design remain open.

Build logs remain local in `.cache/`; README gives the commands to reproduce results. No ROM was downloaded and no proprietary artifacts were publicly distributed.

## Exact pending commit scope

19 files, all development tooling, documentation, lock metadata, or the single text patch:

```
README.md
AGENTS.md
.gitignore
Makefile
upstream.lock.json
browser.lock.json
.devcontainer/Dockerfile
.devcontainer/devcontainer.json
docs/verification.md
patches/001-code-red-intro.patch
scripts/dev.py
scripts/ips.py
scripts/serve.py
scripts/setup_browser.py
scripts/smoke.c
scripts/smoke.py
scripts/browser_smoke.py
tests/test_loop.py
web/index.html
```

No `.cache/`, `build/`, `local/`, ROM, save, screenshot, compiler executable, downloaded emulator package, upstream game source, graphics, or audio file is included. These remain ignored. The user explicitly approved committing and pushing this starter scope on 2026-10-04. This does not authorize merging or public deployment.

## Approved commit/push follow-up — 2026-10-04

The executor reconnected with all 19 intended files and ignored build outputs intact. Repeated setup, tooling tests, incremental native build and mGBA smoke checks. Inspected the exact file scope and exclusions before staging.

Dev-container verification: JSON configuration parses; Docker recognizes the Dockerfile, but fetching `mcr.microsoft.com/devcontainers/base:debian` is denied by this executor's outbound policy (HTTP 403 from the registry's blob delivery endpoint). The image was not built or launched here; do not treat native build success as a completed container startup check. No network-policy bypass was attempted. GitHub Codespaces performs its own image build when the user creates a Codespace; account quota and that startup remain to be verified there.
