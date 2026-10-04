import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from ips import encode, apply
from serve import Handler
from http.server import ThreadingHTTPServer
import threading
from urllib.request import urlopen
from urllib.error import HTTPError

class PatchTests(unittest.TestCase):
    def test_roundtrip_large_span_and_reserved_offset(self):
        base = bytes(0x454F50)
        target = bytearray(base)
        target[1:70000] = b'X' * 69999
        target[0x454F46] = 123
        self.assertEqual(apply(base, encode(base, target)), target)
    def test_full_size_firered(self):
        base = bytes(16 * 1024 * 1024)
        target = bytearray(base)
        target[-1] = 42
        self.assertEqual(apply(base, encode(base, target)), target)
    def test_no_changes(self):
        self.assertEqual(encode(b'abc', b'abc'), b'PATCHEOF')
    def test_wrong_size(self):
        with self.assertRaises(ValueError): encode(b'a', b'ab')

class ServerTests(unittest.TestCase):
    def test_private_files_and_traversal_not_served(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}'
        try:
            with urlopen(url + '/') as response:
                self.assertIn(b'Code Red', response.read())
            for path in ('/.git/config', '/local/baserom.gba', '/.cache/', '/../README.md', '/%2e%2e/README.md', '/emulator/../frontend/package/LICENSE', '/emulator/%2e%2e/frontend/package/LICENSE'):
                with self.assertRaises(HTTPError) as caught: urlopen(url + path)
                self.assertEqual(caught.exception.code, 404)
        finally:
            server.shutdown(); server.server_close(); thread.join()
