# Code Red dev loop. `make help` for the list.
.PHONY: help setup deps build rom-bundle core-fetch player dev serve test check smoke export baseline patch browser-setup sim-core sim leg patches names

help:
	@echo "setup       fetch pinned pokefirered/agbcc + emulator packages, npm deps"
	@echo "build       apply patches/ and build build/code-red.gba"
	@echo "rom-bundle  build/rom/: rom.json + copy patch (needs local/baserom.gba)"
	@echo "core-fetch  download pinned emulator core (core/release.json)"
	@echo "player      build player/dist (the thing the website embeds)"
	@echo "dev         build + rom-bundle + player, then serve on :8000"
	@echo "test        fast tests, no ROM needed (CI runs these)"
	@echo "check       test + ROM-dependent checks (smoke, native core)"
	@echo "sim         headless playthrough power-on -> Erika (sim/README.md)"
	@echo "leg         replay one leg from its checkpoint with the stand-in: make leg LEG=route10 [TO=erika]"
	@echo "patches     rewrite patches/ from the edited sources in .cache/pokefirered (CUSTOMIZING.md)"
	@echo "names       regenerate the ROM move-name patch (007) and notes/moves.md from rules/moves.mjs"

setup: deps
	python3 scripts/dev.py setup
	python3 scripts/setup_browser.py
deps:
	cd runner && npm ci
	cd kernel && npm ci
	cd player && npm ci
browser-setup:
	python3 scripts/setup_browser.py
build export baseline:
	python3 scripts/dev.py $@
rom-bundle: build
	python3 scripts/rom_bundle.py
core-fetch:
	python3 scripts/core_fetch.py
player: rom-bundle core-fetch
	cd player && node build.mjs
dev: player
	python3 scripts/serve_player.py
serve:
	python3 scripts/serve_player.py
test:
	python3 -m unittest discover -s tests -v
	node --test rules/test/*.test.mjs
	cd player && npm test && npx tsc --noEmit
check: test smoke
	@test -n "$(CORE_SO)" && python3 core/test_native.py $(CORE_SO) || echo "skip native core test (set CORE_SO=path/to/mgba_libretro.so)"
smoke:
	python3 scripts/smoke.py
patch:
	python3 scripts/ips.py local/baserom.gba build/code-red.gba build/code-red.ips
sim-core:
	sim/build_core.sh
sim: build sim-core
	python3 sim/run.py misty --trace
leg:
	python3 sim/leg.py $(LEG) $(if $(TO),--to $(TO),)
patches:
	python3 scripts/regen_patches.py
names:
	python3 scripts/move_names.py && python3 scripts/regen_patches.py 007
	cd models && node battle/export.mjs ../notes/moves.md
