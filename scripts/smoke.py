#!/usr/bin/env python3
from pathlib import Path
from dev import OUT, ROOT, environment, run

OUT.mkdir(exist_ok=True)
if not (OUT / 'code-red.gba').exists(): raise SystemExit('Run make build first.')
run(['gcc', ROOT / 'scripts/smoke.c', '-o', OUT / 'smoke', '-lmgba'])
run([OUT / 'smoke', OUT / 'code-red.gba', OUT / 'boot.ppm', OUT / 'intro.ppm', OUT / 'marker.ppm'])
try:
    from PIL import Image
    for name in ('boot', 'intro', 'marker'):
        Image.open(OUT / (name + '.ppm')).save(OUT / (name + '.png'))
except ImportError:
    print('PPM captures ready; install Pillow if PNG conversion is desired.')
