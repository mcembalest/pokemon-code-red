"""Headless Code Red: drive the ROM at full speed from Python.

Uses the same mGBA libretro core as the browser (built natively by
sim/build_core.sh), so RAM layout, mailboxes and save behavior match.

    from codered import Game
    g = Game()                       # loads build/code-red.gba
    g.run(600)                       # emulate 600 frames
    g.press('A')                     # tap a button
    s = g.save_state(); ...; g.load_state(s)   # fork / restore
    g.u16(g.sym('gSaveBlock1Ptr'))   # read RAM by symbol

One Game per process (libretro cores are process-global). For parallel
branches use codered.parallel.
"""
from __future__ import annotations

import ctypes as C
import json
import random
import subprocess
from functools import cached_property
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DECOMP = ROOT / '.cache/pokefirered'
CORE = ROOT / 'build/sim/mgba_libretro.so'
ROM = ROOT / 'build/code-red.gba'
EWRAM, IWRAM = 0x02000000, 0x03000000

# libretro joypad ids
BUTTONS = {'B': 0, 'Y': 1, 'SELECT': 2, 'START': 3, 'UP': 4, 'DOWN': 5, 'LEFT': 6, 'RIGHT': 7,
           'A': 8, 'X': 9, 'L': 10, 'R': 11}

_ENV = C.CFUNCTYPE(C.c_bool, C.c_uint, C.c_void_p)
_VIDEO = C.CFUNCTYPE(None, C.c_void_p, C.c_uint, C.c_uint, C.c_size_t)
_AUDIO = C.CFUNCTYPE(None, C.c_int16, C.c_int16)
_BATCH = C.CFUNCTYPE(C.c_size_t, C.c_void_p, C.c_size_t)
_POLL = C.CFUNCTYPE(None)
_INPUT = C.CFUNCTYPE(C.c_int16, C.c_uint, C.c_uint, C.c_uint, C.c_uint)


class _GameInfo(C.Structure):
    _fields_ = [('path', C.c_char_p), ('data', C.c_void_p), ('size', C.c_size_t), ('meta', C.c_char_p)]


def elf_symbols(elf: Path = DECOMP / 'pokefirered.elf') -> dict[str, int]:
    """All named symbols from the build's ELF (cached next to the ROM)."""
    cache = ROOT / 'build/sim/elf-symbols.json'
    if cache.exists() and cache.stat().st_mtime >= elf.stat().st_mtime:
        return json.loads(cache.read_text())
    out = subprocess.check_output(['arm-none-eabi-nm', str(elf)], text=True)
    table = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 3:
            table[parts[2]] = int(parts[0], 16)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(table))
    return table


class Game:
    _loaded = False

    def __init__(self, rom: Path | str = ROM, core: Path | str = CORE):
        if Game._loaded:
            raise RuntimeError('one Game per process (libretro cores are process-global)')
        Game._loaded = True
        self.lib = lib = C.CDLL(str(core))
        self.keys = 0
        self.frame = 0
        self._video = (None, 0, 0, 0)

        @_ENV
        def env(cmd, data):
            if cmd in (9, 31):  # system / save dir
                C.cast(data, C.POINTER(C.c_char_p))[0] = str(ROOT / 'build/sim').encode()
                return True
            return cmd == 10  # pixel format
        @_VIDEO
        def video(data, w, h, pitch):
            if data:
                self._video = (data, w, h, pitch)
        self._callbacks = [env, video, _AUDIO(lambda *_: None), _BATCH(lambda _, n: n), _POLL(lambda: None),
                           _INPUT(lambda port, dev, idx, key: 1 if port == 0 and self.keys >> key & 1 else 0)]
        for name, cb in zip(['environment', 'video_refresh', 'audio_sample', 'audio_sample_batch', 'input_poll', 'input_state'], self._callbacks):
            getattr(lib, 'retro_set_' + name)(cb)
        lib.retro_load_game.argtypes = [C.POINTER(_GameInfo)]; lib.retro_load_game.restype = C.c_bool
        lib.retro_serialize_size.restype = C.c_size_t
        lib.retro_serialize.argtypes = [C.c_void_p, C.c_size_t]; lib.retro_serialize.restype = C.c_bool
        lib.retro_unserialize.argtypes = [C.c_void_p, C.c_size_t]; lib.retro_unserialize.restype = C.c_bool
        lib.ejs_cr_ewram.restype = lib.ejs_cr_iwram.restype = C.c_void_p
        lib.retro_init()
        self.rom_path = Path(rom)
        if not lib.retro_load_game(C.byref(_GameInfo(str(self.rom_path).encode(), None, 0, None))):
            raise RuntimeError(f'could not load {rom}')
        self._ewram, self._iwram = lib.ejs_cr_ewram(), lib.ejs_cr_iwram()

    # ---- time and input -------------------------------------------------
    def run(self, frames: int = 1, *buttons: str) -> None:
        self.keys = self._mask(buttons)
        for _ in range(frames):
            self.lib.retro_run()
        self.frame += frames
        self.keys = 0

    def press(self, *buttons: str, hold: int = 4, after: int = 12) -> None:
        self.run(hold, *buttons)
        self.run(after)

    def run_until(self, cond, limit: int = 6000, step: int = 1, *buttons: str) -> bool:
        """Run (optionally holding buttons) until cond() is true. Returns whether it became true."""
        for _ in range(0, limit, step):
            if cond():
                return True
            self.run(step, *buttons)
        return cond()

    def mash(self, cond, button: str = 'A', limit: int = 6000, period: int = 16) -> bool:
        """Tap a button every `period` frames until cond() is true."""
        for _ in range(0, limit, period):
            if cond():
                return True
            self.press(button, hold=3, after=period - 3)
        return cond()

    @staticmethod
    def _mask(buttons) -> int:
        mask = 0
        for b in buttons:
            mask |= 1 << BUTTONS[b.upper()]
        return mask

    # ---- state ----------------------------------------------------------
    def save_state(self) -> bytes:
        size = self.lib.retro_serialize_size()
        buf = C.create_string_buffer(size)
        if not self.lib.retro_serialize(buf, size):
            raise RuntimeError('serialize failed')
        return bytes(buf.raw) + self.frame.to_bytes(8, 'little')

    def load_state(self, state: bytes) -> None:
        body, frame = state[:-8], int.from_bytes(state[-8:], 'little')
        buf = C.create_string_buffer(body, len(body))
        if not self.lib.retro_unserialize(buf, len(body)):
            raise RuntimeError('unserialize failed')
        self.frame = frame

    def reset(self) -> None:
        self.lib.retro_reset()
        self.frame = 0

    # ---- memory ---------------------------------------------------------
    @cached_property
    def symbols(self) -> dict[str, int]:
        return elf_symbols()

    def sym(self, name: str) -> int:
        return self.symbols[name]

    def _ptr(self, address: int, n: int) -> int:
        if EWRAM <= address and address + n <= EWRAM + 0x40000:
            return self._ewram + address - EWRAM
        if IWRAM <= address and address + n <= IWRAM + 0x8000:
            return self._iwram + address - IWRAM
        raise ValueError(f'{address:#x}+{n} is not in EWRAM/IWRAM')

    def read(self, address: int, n: int) -> bytes:
        return C.string_at(self._ptr(address, n), n)

    def write(self, address: int, data: bytes) -> None:
        C.memmove(self._ptr(address, len(data)), bytes(data), len(data))

    def u8(self, a: int) -> int: return self.read(a, 1)[0]
    def u16(self, a: int) -> int: return int.from_bytes(self.read(a, 2), 'little')
    def u32(self, a: int) -> int: return int.from_bytes(self.read(a, 4), 'little')
    def s16(self, a: int) -> int: return int.from_bytes(self.read(a, 2), 'little', signed=True)
    def w8(self, a: int, v: int) -> None: self.write(a, (v & 0xFF).to_bytes(1, 'little'))
    def w16(self, a: int, v: int) -> None: self.write(a, (v & 0xFFFF).to_bytes(2, 'little'))
    def w32(self, a: int, v: int) -> None: self.write(a, (v & 0xFFFFFFFF).to_bytes(4, 'little'))

    # ---- screen ---------------------------------------------------------
    def screenshot(self, path: Path | str | None = None):
        """Last frame as a PIL image (RGB565 from the core); saved if path given."""
        from PIL import Image
        data, w, h, pitch = self._video
        if not data:
            raise RuntimeError('no frame yet')
        raw = C.string_at(data, pitch * h)
        img = Image.frombuffer('RGB', (w, h), raw, 'raw', 'BGR;16', pitch, 1)
        if path:
            img.save(path)
        return img

    # ---- randomness -----------------------------------------------------
    def reseed(self, seed: int) -> None:
        """Replace the game's RNG state: same state + different seed = different branch."""
        self.w32(self.sym('gRngValue'), random.Random(seed).getrandbits(32))
