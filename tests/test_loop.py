import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from ips import encode, apply

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
