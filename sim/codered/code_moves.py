"""Host side of code moves (patches/006-code-moves.patch, struct CodeRedMove, 48 B) for the simulator.

  0 u32 magic 'CRM1'  4 u16 version=1  6 u8 state (0 idle, 1 pending, 2 reply, 4 cancelled)  7 u8 enabled (host)
  8 u32 requestId  12 u32 epoch  16 u16 move  18 u8 attackerSide  19 u8 attackerLevel  20 u16 attackerSpecies
 22 u16 targetSpecies  24 u32 attackerPersonality  28 u32 targetPersonality  32 u8 targetLevel  33 u8 targetType1
 34 u8 targetType2  35 u8 verdict (host: 0 vanilla, 1 hit, 2 miss)  36 u32 battleTypeFlags  40 u16 trainerId
 42 u8 reason (host, on a miss: 0 crashed, 1 wrong, 2 too long, 3 no code)  43 s8 attackerStages  44 u16 waited  46 u8 trainerClass

decide(request) -> ('hit' | 'miss' | 'vanilla', reason) is called once per move use; the reply goes out after
`delay` frames (the browser takes ~1-3 s to write and run the code).
"""
MAGIC = 0x314D5243
VERDICT = {'vanilla': 0, 'hit': 1, 'miss': 2}
REASON = {'crashed': 0, 'wrong answer': 1, 'over budget': 2, 'no code': 3}


class CodeMoveHost:
    def __init__(self, g, decide, delay: int = 30):
        self.g, self.decide, self.delay = g, decide, delay
        self.a = g.sym('gCodeRedMove')
        self.requests: list[dict] = []
        self._due = None

    def enable(self, on: bool = True) -> None:
        g, a = self.g, self.a
        if g.u32(a) != MAGIC or g.u16(a + 4) != 1:
            g.w32(a, MAGIC); g.w16(a + 4, 1); g.w8(a + 6, 0)
        g.w8(a + 7, 1 if on else 0)

    def request(self) -> dict | None:
        g, a = self.g, self.a
        if g.u32(a) != MAGIC or g.u8(a + 6) != 1:
            return None
        return {'id': g.u32(a + 8), 'move': g.u16(a + 16), 'side': g.u8(a + 18), 'level': g.u8(a + 19),
                'attacker': g.u16(a + 20), 'target': g.u16(a + 22), 'attacker_pid': g.u32(a + 24), 'target_pid': g.u32(a + 28),
                'target_level': g.u8(a + 32), 'target_types': (g.u8(a + 33), g.u8(a + 34)),
                'battle_flags': g.u32(a + 36), 'trainer': g.u16(a + 40), 'stages': (g.u8(a + 43) ^ 0x80) - 0x80, 'class': g.u8(a + 46), 'frame': g.frame}

    def service(self) -> None:
        """Call every frame."""
        r = self.request()
        if r is None:
            self._due = None
            return
        if self._due is None or self._due[0] != r['id']:
            verdict, reason = self.decide(r)
            r['verdict'], r['reason'] = verdict, reason
            self.requests.append(r)
            self._due = (r['id'], self.g.frame + self.delay, verdict, reason)
            return
        rid, at, verdict, reason = self._due
        if self.g.frame >= at:
            g, a = self.g, self.a
            g.w8(a + 35, VERDICT[verdict])
            g.w8(a + 42, REASON.get(reason, 0))
            g.w8(a + 6, 2)  # publish last
            self._due = None

    def attach(self) -> None:
        """Service the mailbox after every emulated frame (wraps Game.run)."""
        g, run = self.g, self.g.run

        def stepped(frames: int = 1, *buttons: str) -> None:
            for _ in range(frames):
                run(1, *buttons)
                self.service()
        g.run = stepped


# ---------------------------------------------------------------- payloads (patches/009-payload.patch)
PAYLOAD_MAGIC = 0x31505243
PAYLOAD_KIND = {'sound': 1, 'image': 2}


def pack_image(pixels: list[int]) -> bytes:
    """1024 brightness bytes → 512 bytes of 4bpp tiles (1D 32×32 sprite order), like the page does."""
    out = bytearray(512)
    for y in range(32):
        for x in range(32):
            shade = 1 + round(max(0, min(255, pixels[y * 32 + x])) * 14 / 255)  # 1..15: index 0 is transparent on the GBA
            at = ((y >> 3) * 4 + (x >> 3)) * 32 + (y & 7) * 4 + ((x & 7) >> 1)
            out[at] = (out[at] & 0x0F) | (shade << 4) if x & 1 else (out[at] & 0xF0) | shade
    return bytes(out)


def pack_sound(samples: list[int]) -> bytes:
    return bytes(((max(0, min(255, s)) - 128) & 0xFF) for s in samples[:512])


class PayloadHost:
    """Writes a move's bytes into gCodeRedPayload before the hit is reported; `played()` says the game took them."""
    def __init__(self, g):
        self.g, self.a = g, g.sym('gCodeRedPayload')

    def deliver(self, kind: str, data: list[int]) -> None:
        g, a = self.g, self.a
        packed = pack_image(data) if kind == 'image' else pack_sound(data)
        g.w8(a + 6, 0)
        g.w32(a, PAYLOAD_MAGIC); g.w16(a + 4, 1); g.w16(a + 8, len(packed))
        g.write(a + 28, packed)
        g.w8(a + 6, PAYLOAD_KIND[kind])

    def kind(self) -> int: return self.g.u8(self.a + 6)
    def played(self) -> int: return self.g.u16(self.a + 10) if self.g.u32(self.a) == PAYLOAD_MAGIC else 0
