"""Host side of the PokÉEG mailbox (patches/008-pokeeg.patch, struct CodeRedEeg, 264 B (v3)) for the simulator.
The symbol gCodeRedEeg is a pointer: the game allocates the struct on its heap while the screen is open (0 when closed).

  0 u32 magic 'CRE1'  4 u16 version  6 u8 state (0 idle, 1 request, 2 reply, 4 cancelled)  7 u8 op (1 mind, 2 edit hot)
  8 u32 requestId  12 u32 epoch  16 u32 personality  20 u16 species  22 u8 level  23 u8 open
 24 u8 readers  25 u8 dex  26 u16 budget  28 u8 focus×100  29 u8 nHistory  30 u8 history[10]
 40 u8 format[24] (game text)  64 u8 hot[100] (game text; one '\n' allowed)  164 u8 readersText[48]  212 u8 dexText[48]  260 u8 trust (0-100)

mind(request) -> dict(readers, dex, budget, focus, history, format, hot) answers op 1; for op 2 the host
"types" `hot_reply` (the page opens an editor) and answers with state 2.
"""
MAGIC = 0x31455243

# FireRed charmap, the subset the page and the sim need (reverse of player/src/agents/battle.ts decodeText).
CHARS = {' ': 0x00, 'é': 0x1B, 'É': 0x06, '!': 0xAB, '?': 0xAC, '.': 0xAD, '-': 0xAE, '·': 0xAF, '…': 0xB0, "'": 0xB4, '’': 0xB4,
         ',': 0xB8, '/': 0xBA, ':': 0xF0, '×': 0xB9, '(': 0x5C, ')': 0x5D}


def encode_text(text: str, size: int) -> bytes:
    out = bytearray()
    for c in text:
        if len(out) >= size - 1:
            break
        if c == '\n': out.append(0xFE)
        elif '0' <= c <= '9': out.append(0xA1 + ord(c) - 48)
        elif 'A' <= c <= 'Z': out.append(0xBB + ord(c) - 65)
        elif 'a' <= c <= 'z': out.append(0xD5 + ord(c) - 97)
        else: out.append(CHARS.get(c, 0xAC))
    out.append(0xFF)
    return bytes(out.ljust(size, b'\xff'))


def wrap(text: str, width: int = 30) -> str:
    """Two lines at most (what the mind window holds), like the page does."""
    words, lines, cur = text.split(), [], ''
    for w in words:
        if len(cur) + len(w) + (1 if cur else 0) > width and cur:
            lines.append(cur); cur = w
        else:
            cur = (cur + ' ' + w).strip()
    if cur: lines.append(cur)
    out = '\n'.join(lines[:2])
    return out if len(lines) <= 2 else out[:-1] + '…'


class EegHost:
    def __init__(self, g, mind, delay: int = 2):
        self.g, self.mind, self.delay = g, mind, delay
        self.ptr = g.sym('gCodeRedEeg')
        self.requests: list[dict] = []
        self.hot_reply: str | None = None
        self._pending = None

    @property
    def a(self) -> int:
        a = self.g.u32(self.ptr)
        return a if 0x02000000 <= a < 0x02040000 else 0

    def enable(self) -> None:
        pass  # the game publishes requests whether or not a host is there

    def request(self) -> dict | None:
        g, a = self.g, self.a
        if not a or g.u32(a) != MAGIC or g.u8(a + 6) != 1:
            return None
        return {'id': g.u32(a + 8), 'op': g.u8(a + 7), 'personality': g.u32(a + 16), 'species': g.u16(a + 20), 'level': g.u8(a + 22), 'frame': g.frame}

    def service(self) -> None:
        r = self.request()
        if r is None:
            self._pending = None
            return
        if self._pending is None or self._pending[0] != r['id']:
            self.requests.append(r)
            self._pending = (r['id'], self.g.frame + self.delay)
            return
        if self.g.frame < self._pending[1]:
            return
        g, a = self.g, self.a
        if r['op'] == 1:
            m = self.mind(r)
            if self.hot_reply is not None:
                m = {**m, 'hot': self.hot_reply}
            g.w8(a + 24, m.get('readers', 0)); g.w8(a + 25, m.get('dex', 0)); g.w16(a + 26, m.get('budget', 0)); g.w8(a + 28, m.get('focus', 0))
            h = list(m.get('history', []))[-10:]
            g.w8(a + 29, len(h)); g.write(a + 30, bytes(h).ljust(10, b'\0'))
            g.write(a + 40, encode_text(m.get('format', ''), 24))
            g.write(a + 64, encode_text(wrap(m.get('hot', '')), 100))
            g.write(a + 164, encode_text(m.get('readers_text', ''), 48))
            g.write(a + 212, encode_text(m.get('dex_text', ''), 48))
            g.w8(a + 260, m.get('trust', 0))
        g.w8(a + 6, 2)  # reply (op 2: the page's editor closed)
        self._pending = None

    def attach(self) -> None:
        g, run = self.g, self.g.run

        def stepped(frames: int = 1, *buttons: str) -> None:
            for _ in range(frames):
                run(1, *buttons)
                self.service()
        g.run = stepped
