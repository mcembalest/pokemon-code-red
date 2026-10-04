#!/usr/bin/env python3
"""Create a local IPS patch only from a verified user-supplied FireRed v1.0 dump."""
import hashlib
from pathlib import Path
import sys

BASE_SHA1 = '41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc'

def encode(base, target):
    if len(base) != len(target) or len(target) > 0x1000000:
        raise ValueError('IPS starter requires equal ROM sizes at most 16 MiB.')
    out = bytearray(b'PATCH')
    i = 0
    while i < len(target):
        if base[i] == target[i]:
            i += 1
            continue
        start = i
        while i < len(target) and base[i] != target[i] and i - start < (65534 if start == 0x454F46 else 65535):
            i += 1
        # 0x454f46 is reserved for EOF; include one unchanged preceding byte.
        if start == 0x454F46:
            start -= 1
        out += start.to_bytes(3, 'big') + (i-start).to_bytes(2, 'big') + target[start:i]
    return bytes(out + b'EOF')

def apply(base, patch):
    if not patch.startswith(b'PATCH'):
        raise ValueError('Invalid IPS header')
    result = bytearray(base)
    pos = 5
    while patch[pos:pos+3] != b'EOF':
        if pos + 5 > len(patch): raise ValueError('Truncated IPS')
        offset = int.from_bytes(patch[pos:pos+3], 'big')
        size = int.from_bytes(patch[pos+3:pos+5], 'big')
        pos += 5
        if not size: raise ValueError('RLE not supported by starter verifier')
        if pos+size > len(patch) or offset+size > len(result): raise ValueError('Invalid IPS record')
        result[offset:offset+size] = patch[pos:pos+size]
        pos += size
    if pos+3 != len(patch): raise ValueError('Unexpected IPS trailer')
    return bytes(result)

def main():
    if len(sys.argv) != 4:
        raise SystemExit('Usage: ips.py local/baserom.gba build/code-red.gba build/code-red.ips')
    source, target, output = map(Path, sys.argv[1:])
    if not source.exists():
        raise SystemExit('Supply your own English FireRed USA v1.0 dump at local/baserom.gba. SHA-1: ' + BASE_SHA1)
    base, mod = source.read_bytes(), target.read_bytes()
    if hashlib.sha1(base).hexdigest() != BASE_SHA1:
        raise SystemExit('Wrong base. Need English FireRed USA v1.0, SHA-1 ' + BASE_SHA1)
    patch = encode(base, mod)
    if apply(base, patch) != mod: raise SystemExit('Patch round-trip failed')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(patch)
    print(f'Verified patch: {output} ({len(patch)} bytes). Keep local pending distribution review.')

if __name__ == '__main__': main()
