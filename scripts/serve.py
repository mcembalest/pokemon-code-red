#!/usr/bin/env python3
"""Private development server with a strict file allowlist, no directory listings."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import mimetypes
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
ROUTES = {'/': ('web/index.html', 'text/html; charset=utf-8'),
          '/game.gba': ('build/code-red.gba', 'application/octet-stream'),
          '/manifest.json': ('build/manifest.json', 'application/json')}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        route = ROUTES.get(path)
        if path.startswith('/emulator/'):
            directory = (ROOT / '.cache/browser/data').resolve()
            file = (directory / path.removeprefix('/emulator/')).resolve()
            if file.is_relative_to(directory) and file.is_file():
                route = (str(file), mimetypes.guess_type(file)[0] or 'application/octet-stream')
        if route is None:
            self.send_error(404); return
        file, kind = route
        try: data = (ROOT / file).read_bytes()
        except FileNotFoundError:
            self.send_error(404, 'Run make build first'); return
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bind', default='127.0.0.1', help='Use 0.0.0.0 only behind an authenticated private port forward')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    print(f'Playtest: http://{args.bind}:{args.port} — keep forwarded port PRIVATE.', flush=True)
    ThreadingHTTPServer((args.bind, args.port), Handler).serve_forever()
