#!/usr/bin/env python3
"""Native check of the ROM-agnostic core adapter (ABI 1).

Loads the libretro core built from core/mgba.patch + core/adapter.inc and the
local Code Red ROM, plays the normal intro to the native naming screen, then
drives the naming mailbox ONLY through the ejs_cr_ewram pointer, i.e. the
same way the browser player does. Also checks epoch changes on reset/load.

usage: core/test_native.py path/to/mgba_libretro.so
needs: build/code-red.gba, build/symbols.json (make build && python3 scripts/symbols.py)
"""
import ctypes as C, json, struct, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
lib = C.CDLL(sys.argv[1])
symbols = json.loads((ROOT / 'build/symbols.json').read_text())['symbols']

ENV = C.CFUNCTYPE(C.c_bool, C.c_uint, C.c_void_p)
VIDEO = C.CFUNCTYPE(None, C.c_void_p, C.c_uint, C.c_uint, C.c_size_t)
AUDIO = C.CFUNCTYPE(None, C.c_int16, C.c_int16)
BATCH = C.CFUNCTYPE(C.c_size_t, C.c_void_p, C.c_size_t)
POLL = C.CFUNCTYPE(None)
INPUT = C.CFUNCTYPE(C.c_int16, C.c_uint, C.c_uint, C.c_uint, C.c_uint)
RETRO_A, RETRO_START = 8, 3
keys = 0

@ENV
def env(command, data):
    if command in (9, 31):  # system / save directory
        C.cast(data, C.POINTER(C.c_char_p))[0] = b'/tmp'
        return True
    if command == 10:  # pixel format
        return True
    return False

callbacks = [
    ('environment', env), ('video_refresh', VIDEO(lambda *_: None)),
    ('audio_sample', AUDIO(lambda *_: None)), ('audio_sample_batch', BATCH(lambda _, n: n)),
    ('input_poll', POLL(lambda: None)),
    ('input_state', INPUT(lambda port, device, index, key: 1 if keys & (1 << key) else 0)),
]
for name, cb in callbacks:
    getattr(lib, 'retro_set_' + name)(cb)

class Game(C.Structure):
    _fields_ = [('path', C.c_char_p), ('data', C.c_void_p), ('size', C.c_size_t), ('meta', C.c_char_p)]

lib.retro_load_game.argtypes = [C.POINTER(Game)]; lib.retro_load_game.restype = C.c_bool
lib.retro_get_memory_data.argtypes = [C.c_uint]; lib.retro_get_memory_data.restype = C.c_void_p
lib.retro_serialize_size.restype = C.c_size_t
lib.retro_serialize.argtypes = [C.c_void_p, C.c_size_t]; lib.retro_serialize.restype = C.c_bool
lib.retro_unserialize.argtypes = [C.c_void_p, C.c_size_t]; lib.retro_unserialize.restype = C.c_bool
for f in ('ejs_cr_ewram', 'ejs_cr_iwram'):
    getattr(lib, f).restype = C.c_void_p
for f in ('ejs_cr_abi', 'ejs_cr_epoch', 'ejs_cr_ewram_size', 'ejs_cr_iwram_size'):
    getattr(lib, f).restype = C.c_uint

def check(cond, what):
    if not cond:
        sys.exit(f'FAIL: {what}')
    print(f'ok  {what}')

lib.retro_init()
check(lib.ejs_cr_ewram() is None and lib.ejs_cr_ewram_size() == 0, 'no RAM exposed before a game loads')
game = Game(str(ROOT / 'build/code-red.gba').encode(), None, 0, None)
check(lib.retro_load_game(C.byref(game)), 'ROM loads')
check(lib.ejs_cr_abi() == 1, 'abi == 1')
check(lib.ejs_cr_ewram_size() == 0x40000, 'ewram size 256 KiB (not the GB WRAM size)')
check(lib.ejs_cr_iwram_size() == 0x8000, 'iwram size 32 KiB')
ewram, iwram = lib.ejs_cr_ewram(), lib.ejs_cr_iwram()
check(ewram == lib.retro_get_memory_data(2), 'ewram pointer == retro SYSTEM_RAM pointer')

def ew(addr, n):
    return C.string_at(ewram + addr - 0x02000000, n)
def ew_write(addr, data):
    C.memmove(ewram + addr - 0x02000000, bytes(data), len(data))
def iw32(addr):
    return struct.unpack('<I', C.string_at(iwram + addr - 0x03000000, 4))[0]
def frames(n, held=0):
    global keys
    keys = held
    for _ in range(n):
        lib.retro_run()
    keys = 0

box = symbols['gCodeRedNamingMailbox']['address']
found = False
for frame in range(10000):
    keys = (1 << RETRO_START) if frame == 600 else ((1 << RETRO_A) if frame > 630 and frame % 60 < 5 else 0)
    lib.retro_run()
    head = ew(box, 8)
    if head[:4] == b'CRN1' and head[6]:
        found = True
        break
check(found, f'naming mailbox visible via ewram pointer at {box:#x} (frame {frame})')
frames(3)
session = struct.unpack('<I', ew(box + 8, 4))[0]
check(session != 0 and ew(box + 7, 1)[0] == 7, 'active naming session, max length 7')

def request(seq, action, text):
    data = text.encode()
    ew_write(box + 24, [0])
    ew_write(box + 12, struct.pack('<I', session))
    ew_write(box + 16, struct.pack('<I', seq))
    ew_write(box + 25, [len(data)])
    ew_write(box + 44, data.ljust(16, b'\0'))
    ew_write(box + 24, [action])
    frames(2)
def current():
    n = ew(box + 27, 1)[0]
    return ew(box + 28, n).decode()

request(1, 1, 'RED')
check(current() == 'RED' and ew(box + 26, 1)[0] == 0, 'write through pointer replaces name in game')

epoch = lib.ejs_cr_epoch()
size = lib.retro_serialize_size(); state = C.create_string_buffer(size)
check(lib.retro_serialize(state, size), 'serialize')
check(lib.retro_unserialize(state, size) and lib.ejs_cr_epoch() != epoch, 'epoch changes on state load')
check(lib.ejs_cr_ewram() == ewram, 'ewram pointer stable across state load')
epoch = lib.ejs_cr_epoch(); lib.retro_reset()
check(lib.ejs_cr_epoch() != epoch, 'epoch changes on reset')
sb2 = symbols['gSaveBlock2Ptr']['address']
frames(60)
check(0x02000000 <= iw32(sb2) < 0x02040000, f'iwram gSaveBlock2Ptr -> {iw32(sb2):#x} (in EWRAM)')
lib.retro_unload_game(); lib.retro_deinit()
print('native core adapter: all checks passed')
