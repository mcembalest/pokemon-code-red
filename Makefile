.PHONY: setup baseline build export test serve smoke patch browser-setup
setup:
	python3 scripts/dev.py setup
	python3 scripts/setup_browser.py
browser-setup:
	python3 scripts/setup_browser.py
baseline build export:
	python3 scripts/dev.py $@
test:
	python3 -m unittest discover -s tests -v
serve:
	python3 scripts/serve.py
smoke:
	python3 scripts/smoke.py
patch:
	python3 scripts/ips.py local/baserom.gba build/code-red.gba build/code-red.ips
