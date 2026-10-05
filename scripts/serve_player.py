#!/usr/bin/env python3
"""Serve player/dist on localhost with caching off. Not for public hosting."""
import argparse, functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DIST = Path(__file__).resolve().parents[1] / 'player/dist'

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.wasm': 'application/wasm', '.data': 'application/octet-stream'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def list_directory(self, path):
        self.send_error(404)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bind', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    if not (DIST / 'index.html').exists():
        raise SystemExit('player/dist missing: run make player')
    print(f'Code Red player: http://{args.bind}:{args.port}/', flush=True)
    ThreadingHTTPServer((args.bind, args.port), functools.partial(Handler, directory=str(DIST))).serve_forever()
