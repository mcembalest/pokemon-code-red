"""Game-state readers/writers and map knowledge, from the decomp's own data.

Offsets come from include/global.h (SaveBlock1/2, Pokemon, BattlePokemon);
maps and collision from data/maps + data/layouts. Nothing hand-copied from
the ROM.
"""
from __future__ import annotations

import json
from collections import deque

HM_MOVES = {15, 19, 57, 70, 127, 148, 249}  # CUT, FLY, SURF, STRENGTH, WATERFALL, FLASH, ROCK SMASH (include/constants/moves.h)
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import re
import subprocess
from functools import cached_property

from .game import DECOMP, ROOT, Game

# include/global.h
SB1_POS, SB1_LOCATION, SB1_FLAGS, SB1_VARS = 0x0000, 0x0004, 0x0EE0, 0x1000
SB2_NAME, SB2_OPTIONS = 0x000, 0x014
# include/battle.h: struct BattlePokemon (0x58 bytes)
BMON_SIZE, BMON_HP, BMON_LEVEL, BMON_MAXHP = 0x58, 0x28, 0x2A, 0x2C
# include/pokemon.h: struct Pokemon (100 bytes); level/hp are outside the encrypted box
MON_SIZE, MON_LEVEL, MON_HP, MON_MAXHP = 100, 0x54, 0x56, 0x58
BATTLE_OUTCOMES = {0: 'ongoing', 1: 'won', 2: 'lost', 3: 'drew', 4: 'ran', 5: 'teleported', 6: 'fled', 7: 'caught', 9: 'forfeited'}
COLLISION_MASK = 0x0C00  # include/global.fieldmap.h MAPGRID_COLLISION_MASK


@dataclass(frozen=True)
class MapInfo:
    name: str          # e.g. MAP_PALLET_TOWN
    group: int
    num: int
    width: int
    height: int
    blocks: tuple      # metatile u16 per cell, row-major
    warps: tuple       # (x, y, dest_map, dest_warp_id)
    attrs: tuple = ()  # metatile attributes (u32) per cell; src/fieldmap.c sMetatileAttrMasks
    obstacles: frozenset = frozenset()  # cut trees and strength boulders (object events the collision map doesn't know)

    def encounter_type(self, x: int, y: int) -> int:
        """1 = land (tall grass), 2 = water; bits 24-26."""
        return self.attrs[y * self.width + x] >> 24 & 7 if self.attrs else 0

    def grass(self) -> list[tuple[int, int]]:
        return [(x, y) for y in range(self.height) for x in range(self.width)
                if self.passable(x, y) and self.encounter_type(x, y) == 1]

    LEDGES = {0x38: 'RIGHT', 0x39: 'LEFT', 0x3A: 'UP', 0x3B: 'DOWN'}  # MB_JUMP_*

    def ledge(self, x: int, y: int) -> str | None:
        if not (0 <= x < self.width and 0 <= y < self.height) or not self.attrs:
            return None
        return self.LEDGES.get(self.attrs[y * self.width + x] & 0x1FF)

    def passable(self, x: int, y: int) -> bool:
        if not (0 <= x < self.width and 0 <= y < self.height):
            return False
        if (x, y) in CLEARED.get(self.name, set()):  # a tree cut, a door opened by a script
            return True
        if CAN_CUT and (x, y) in CUTTABLE.get(self.name, ()):  # a tree we will cut when we get to it (walk_to)
            return True
        return not (self.blocks[y * self.width + x] & COLLISION_MASK) and (x, y) not in self.obstacles


# Obstacles the player has cleared this run (a tree cut, a boulder pushed): map name -> cells, now passable.
CLEARED: dict[str, set] = {}
# Trees on the way that CUT clears. They grow back whenever the map reloads, so the planner treats them as passable
# once CUT is known (CAN_CUT) and walk_to() cuts one as it reaches it (World.cut, set by routes.py), every time.
CUTTABLE: dict[str, frozenset] = {
    'MAP_VERMILION_CITY': frozenset({(19, 24)}),    # in front of the gym
    'MAP_ROUTE9': frozenset({(2, 8)}),               # the west entrance
    'MAP_CELADON_CITY': frozenset({(40, 35)}),       # the gym's south path
    'MAP_CELADON_CITY_GYM': frozenset({(6, 8)}),     # the middle path
}
CAN_CUT = False


def clear_obstacle(map_name: str, cell: tuple[int, int], cleared: bool = True) -> None:
    """Mark a cell passable (a tree cut) or not again (it grew back on a map reload); the region planner recomputes."""
    cells = CLEARED.setdefault(map_name, set())
    (cells.add if cleared else cells.discard)(cell)
    regions.cache_clear()
    _region_hops.cache_clear()


@lru_cache(maxsize=None)
def _map_index() -> dict:
    groups = json.loads((DECOMP / 'data/maps/map_groups.json').read_text())
    layouts = {l['id']: l for l in json.loads((DECOMP / 'data/layouts/layouts.json').read_text())['layouts'] if l}
    by_key, by_name = {}, {}
    for g, group in enumerate(groups['group_order']):
        for n, folder in enumerate(groups[group]):
            by_key[(g, n)] = folder
            by_name[None] = None
            data = json.loads((DECOMP / 'data/maps' / folder / 'map.json').read_text())
            by_name[data['id']] = (g, n, folder, data, layouts.get(data['layout']))
    by_name.pop(None, None)
    return {'key': by_key, 'name': by_name}


@lru_cache(maxsize=None)
def _tileset_attrs(tileset: str) -> tuple:
    headers = (DECOMP / 'src/data/tilesets/headers.h').read_text()
    block = headers[headers.index(f'const struct Tileset {tileset} ='):]
    attr_sym = re.search(r'\.metatileAttributes = (\w+)', block).group(1)
    path = re.search(attr_sym + r'\[\] = INCBIN_U32\("([^"]+)"\)', (DECOMP / 'src/data/tilesets/metatiles.h').read_text()).group(1)
    raw = (DECOMP / path).read_bytes()
    return tuple(int.from_bytes(raw[i:i + 4], 'little') for i in range(0, len(raw), 4))


@lru_cache(maxsize=None)
def map_info(name: str) -> MapInfo:
    g, n, _, data, layout = _map_index()['name'][name]
    raw = (DECOMP / layout['blockdata_filepath']).read_bytes()
    blocks = tuple(int.from_bytes(raw[i:i + 2], 'little') for i in range(0, len(raw), 2))
    warps = tuple((w['x'], w['y'], w['dest_map'], int(w['dest_warp_id']) if str(w['dest_warp_id']).isdigit() else -1) for w in data.get('warp_events', []))
    primary, secondary = _tileset_attrs(layout['primary_tileset']), _tileset_attrs(layout['secondary_tileset'])
    def attr(block):
        mid = block & 0x3FF
        table, k = (primary, mid) if mid < 640 else (secondary, mid - 640)  # NUM_METATILES_IN_PRIMARY
        return table[k] if k < len(table) else 0
    obstacles = frozenset((o['x'], o['y']) for o in data.get('object_events', []) if o.get('graphics_id') in ('OBJ_EVENT_GFX_CUT_TREE', 'OBJ_EVENT_GFX_ROCK'))
    return MapInfo(name, g, n, layout['width'], layout['height'], blocks, warps, tuple(attr(b) for b in blocks), obstacles)


def map_name(group: int, num: int) -> str | None:
    folder = _map_index()['key'].get((group, num))
    if folder is None:
        return None
    return json.loads((DECOMP / 'data/maps' / folder / 'map.json').read_text())['id']


@lru_cache(maxsize=None)
def _neighbors(name: str) -> tuple:
    g, n, folder, data, layout = _map_index()['name'][name]
    out = [('edge', c['direction'], c['map']) for c in data.get('connections') or []]
    out += [('warp', None, w['dest_map']) for w in data.get('warp_events', []) if w['dest_map'] in _map_index()['name']]
    return tuple(out)


def path(m: MapInfo, start: tuple[int, int], goal: tuple[int, int], extra_blocked=frozenset()) -> list[str] | None:
    """BFS over passable cells; returns directions. Goal may be a warp/door tile."""
    moves = {'UP': (0, -1), 'DOWN': (0, 1), 'LEFT': (-1, 0), 'RIGHT': (1, 0)}
    prev = {start: None}
    queue = deque([start])
    while queue:
        cur = queue.popleft()
        if cur == goal:
            out = []
            while prev[cur]:
                cur, d = prev[cur]
                out.append(d)
            return out[::-1]
        for d, (dx, dy) in moves.items():
            nxt = (cur[0] + dx, cur[1] + dy)
            if nxt in prev or nxt in extra_blocked:
                continue
            if nxt == goal or m.passable(*nxt):
                prev[nxt] = (cur, d)
                queue.append(nxt)
    return None


class World(Game):
    """Game + typed access to Pokémon FireRed state."""

    # symbols local to one source file (static functions share names across files)
    @cached_property
    def _map_text(self) -> str:
        return (DECOMP / 'pokefirered.map').read_text()

    def text_range(self, obj: str) -> tuple[int, int]:
        m = re.search(r'^ \.text\s+(0x[0-9a-f]+)\s+(0x[0-9a-f]+)\s+src/' + re.escape(obj) + r'\.o$', self._map_text, re.M)
        start = int(m.group(1), 16)
        return start, start + int(m.group(2), 16)

    def sym_in(self, obj: str, name: str) -> int:
        out = subprocess.check_output(['arm-none-eabi-nm', str(DECOMP / f'build/firered/src/{obj}.o')], text=True)
        for line in out.splitlines():
            parts = line.split()
            if len(parts) == 3 and parts[2] == name and parts[1] in 'tT':
                return self.text_range(obj)[0] + int(parts[0], 16)
        raise KeyError(f'{name} not in {obj}.o')

    def in_file(self, address: int, obj: str) -> bool:
        lo, hi = self.text_range(obj)
        return lo <= (address & ~1) < hi

    def learn_move_screen(self) -> bool:
        """Summary screen opened to pick a move to forget."""
        return self.in_file(self.callback2(), 'pokemon_summary_screen')

    # how much we value a move when choosing what to forget (damage moves: by power)
    STATUS_VALUE = {'SLEEP_POWDER': 30, 'LEECH_SEED': 20, 'POISON_POWDER': 10, 'THUNDER_WAVE': 30, 'STUN_SPORE': 25}

    def forget_weakest_move(self, rules) -> None:
        """On the 'forget a move' summary screen: forget the least valuable of the 4 known moves + the
        new one (choosing the new one = don't learn it). Waits for the screen's fade-in first."""
        self.run_until(lambda: self.brightness() > 0.3, 600, 5)  # faded in
        self.run(20)
        known = self.party_moves(0)
        new = self.u16(self.sym('gMoveToLearn'))
        def value(mid):
            if mid in HM_MOVES:  # the game refuses to forget an HM move ("HM moves can't be forgotten now"); the route needs CUT
                return 1e9
            m = rules.moves[mid]
            return m.power * 1.5 if m.power else self.STATUS_VALUE.get(m.name, 0)
        slots = known + [new]
        slot = min(range(5), key=lambda k: (value(slots[k]), -k))  # tie: forget the older move
        self.battle_log.append(f'learn {rules.moves[new].name}: forget {rules.moves[slots[slot]].name}')
        for _ in range(slot):
            self.press('DOWN', hold=2, after=10)
        self.press('A', hold=2, after=20)
        self.mash(lambda: not self.learn_move_screen(), 'A', limit=900, period=10)

    def handle(self, battle_policy=None, limit: int = 60 * 60 * 20) -> list[str]:
        """Resolve whatever has control (dialogue, trainer/wild battle, cutscene) until free to walk.
        Returns battle outcomes seen."""
        from .battle import Battle, finish_battle
        outcomes = []
        start = self.frame
        while self.frame - start < limit:
            if self.in_battle():
                b = Battle(self)
                outcomes.append(b.play(**(battle_policy or {})))
                self.battle_log.extend(b.log)
                finish_battle(self)
            elif self.settled(20):
                return outcomes
            else:
                self.press('A', hold=2, after=8)
        return outcomes

    # pointers
    @property
    def sb1(self) -> int: return self.u32(self.sym('gSaveBlock1Ptr'))
    @property
    def sb2(self) -> int: return self.u32(self.sym('gSaveBlock2Ptr'))

    # main loop
    def callback2(self) -> int: return self.u32(self.sym('gMain') + 4) & ~1
    def in_overworld(self) -> bool: return self.callback2() == self.sym('CB2_Overworld') & ~1
    def in_battle(self) -> bool: return self.callback2() == self.sym('BattleMainCB2') & ~1

    def free(self) -> bool:
        """Player can walk: overworld, no script running, field controls unlocked (src/script.c)."""
        return (self.in_overworld() and self.u8(self.sym('sGlobalScriptContextStatus')) == 2  # CONTEXT_SHUTDOWN: no script
                and not self.u8(self.sym('sLockFieldControls')))

    def settled(self, frames: int = 30) -> bool:
        """free() now and for the next `frames` frames with no input (events can start a few frames late)."""
        for _ in range(frames // 5):
            if not self.free():
                return False
            self.run(5)
        return self.free()

    def advance(self, limit: int = 12000) -> bool:
        """Press A through dialogue/cutscenes until the player is free to move."""
        self.run(10)
        return self.mash(self.settled, 'A', limit=limit, period=10)

    # where
    def pos(self) -> tuple[int, int]:
        return self.s16(self.sb1 + SB1_POS), self.s16(self.sb1 + SB1_POS + 2)

    cut = None  # routes.use_cut(g, tree) once routes is imported: cuts a CUTTABLE tree when walk_to reaches it

    def map(self) -> str | None:
        loc = self.sb1 + SB1_LOCATION
        g, n = self.read(loc, 2)
        name = map_name(int.from_bytes(bytes([g]), 'little', signed=True), int.from_bytes(bytes([n]), 'little', signed=True))
        last = self.__dict__.get('_last_map')
        if name != last:
            self.__dict__['_last_map'] = name
            if last in CUTTABLE and CLEARED.get(last, set()) & CUTTABLE[last]:  # trees grow back when their map reloads
                for cell in CUTTABLE[last]:
                    clear_obstacle(last, cell, cleared=False)
        return name

    # script state
    def flag(self, flag: int) -> bool:
        return bool(self.u8(self.sb1 + SB1_FLAGS + flag // 8) >> (flag % 8) & 1)

    def set_flag(self, flag: int, on: bool = True) -> None:
        a = self.sb1 + SB1_FLAGS + flag // 8
        v = self.u8(a)
        self.w8(a, v | 1 << (flag % 8) if on else v & ~(1 << (flag % 8)))

    def var(self, var: int) -> int: return self.u16(self.sb1 + SB1_VARS + (var - 0x4000) * 2)
    def set_var(self, var: int, value: int) -> None: self.w16(self.sb1 + SB1_VARS + (var - 0x4000) * 2, value)

    # options: textSpeed bits 0-2 (2 = fast), battleSceneOff bit 10
    def fast_options(self) -> None:
        """Options menu settings, same as a player would pick: text FAST, battle style SET
        (no switch prompt), battle scene OFF."""
        a = self.sb2 + SB2_OPTIONS
        self.w16(a, (self.u16(a) & ~0x7 | 2) | 1 << 9 | 1 << 10)

    # bag (include/global.h SaveBlock1 pockets: {u16 item, u16 quantity ^ key})
    POCKETS = {'items': (0x0310, 42), 'key': (0x03B8, 30), 'balls': (0x0430, 13), 'tm': (0x0464, 58), 'berries': (0x054C, 43)}

    @cached_property
    def item_ids(self) -> dict[str, int]:
        text = (DECOMP / 'include/constants/items.h').read_text()
        return {k[5:]: int(v, 0) for k, v in re.findall(r'#define (ITEM_\w+)\s+(0x[0-9A-Fa-f]+|\d+)\b', text)}

    def bag(self) -> dict[str, int]:
        names = {v: k for k, v in self.item_ids.items()}
        key = self.u32(self.sb2 + 0xF20) & 0xFFFF  # encryptionKey (quantities are XORed)
        out = {}
        for off, n in self.POCKETS.values():
            for i in range(n):
                item = self.u16(self.sb1 + off + 4 * i)
                if item:
                    out[names.get(item, str(item))] = self.u16(self.sb1 + off + 4 * i + 2) ^ key
        return out

    # party / battle
    def party(self) -> list[dict]:
        count = self.u8(self.sym('gPlayerPartyCount'))
        base = self.sym('gPlayerParty')
        return [{'level': self.u8(base + i * MON_SIZE + MON_LEVEL), 'hp': self.u16(base + i * MON_SIZE + MON_HP),
                 'max_hp': self.u16(base + i * MON_SIZE + MON_MAXHP)} for i in range(count)]

    def party_moves(self, i: int) -> list[int]:
        """Moves of party slot i, decrypted from the BoxPokemon (include/pokemon.h; substruct order by personality % 24)."""
        base = self.sym('gPlayerParty') + i * MON_SIZE
        personality, ot = self.u32(base), self.u32(base + 4)
        key = personality ^ ot
        data = self.read(base + 0x20, 48)
        words = [int.from_bytes(data[k:k + 4], 'little') ^ key for k in range(0, 48, 4)]
        order = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
                 'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'][personality % 24]
        a = order.index('A')  # attacks substruct: u16 moves[4], u8 pp[4]
        w0, w1 = words[a * 3], words[a * 3 + 1]
        return [w0 & 0xFFFF, w0 >> 16, w1 & 0xFFFF, w1 >> 16]

    def set_party_move(self, i: int, slot: int, move: int, pp: int) -> None:
        """Write a move into party slot i's move slot (0-3): decrypt the substructs, set the move and its PP, fix the
        checksum, re-encrypt. A sim shortcut for teaching an HM (the TM-case menus are long to drive)."""
        base = self.sym('gPlayerParty') + i * MON_SIZE
        personality, ot = self.u32(base), self.u32(base + 4)
        key = personality ^ ot
        data = bytearray(self.read(base + 0x20, 48))
        words = [int.from_bytes(data[k:k + 4], 'little') ^ key for k in range(0, 48, 4)]
        order = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
                 'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'][personality % 24]
        a = order.index('A') * 3
        wm, wp = a + slot // 2, a + 2
        words[wm] = (words[wm] & ~(0xFFFF << (16 * (slot % 2)))) | (move << (16 * (slot % 2)))
        words[wp] = (words[wp] & ~(0xFF << (8 * slot))) | (pp << (8 * slot))
        plain = b''.join(w.to_bytes(4, 'little') for w in words)
        checksum = sum(int.from_bytes(plain[k:k + 2], 'little') for k in range(0, 48, 2)) & 0xFFFF
        self.w16(base + 0x1C, checksum)
        self.write(base + 0x20, b''.join((w ^ key).to_bytes(4, 'little') for w in words))
        # the party struct's cached PP (struct Pokemon has none beyond the box data) - nothing else to fix

    def battlers(self) -> list[dict]:
        base = self.sym('gBattleMons')
        return [{'hp': self.u16(base + i * BMON_SIZE + BMON_HP), 'max_hp': self.u16(base + i * BMON_SIZE + BMON_MAXHP),
                 'level': self.u8(base + i * BMON_SIZE + BMON_LEVEL)} for i in range(self.u8(self.sym('gBattlersCount')))]

    def battle_outcome(self) -> str:
        return BATTLE_OUTCOMES.get(self.u8(self.sym('gBattleOutcome')), 'other')

    # movement
    def step(self, direction: str, max_frames: int = 40) -> bool:
        """Walk one tile. True if position changed."""
        before = (self.map(), self.pos())
        self.run(2, direction)  # turn
        for _ in range(max_frames // 4):
            if (self.map(), self.pos()) != before:
                self.run(10)
                return True
            self.run(4, direction)
        return (self.map(), self.pos()) != before

    def face(self, direction: str) -> None:
        """Turn toward something in front (blocked tile/NPC). Needs ~8 frames held."""
        self.run(8, direction)
        self.run(8)

    def interact(self, direction: str) -> None:
        """Face something and press A."""
        self.face(direction)
        self.press('A', hold=3, after=20)

    # ---- navigation
    OBJ_SIZE, OBJ_COORDS = 0x24, 0x10  # include/global.fieldmap.h struct ObjectEvent

    def npc_tiles(self) -> set[tuple[int, int]]:
        base, out = self.sym('gObjectEvents'), set()
        for i in range(16):
            o = base + i * self.OBJ_SIZE
            flags = self.u32(o)
            if flags & 1 and not flags >> 16 & 1:  # active, not the player
                out.add((self.s16(o + self.OBJ_COORDS) - 7, self.s16(o + self.OBJ_COORDS + 2) - 7))
        return out

    def npc_at(self, graphics_id: int) -> tuple[int, int] | None:
        """Where the first active NPC with this sprite stands right now (NPCs walk; map.json has only where they start)."""
        base = self.sym('gObjectEvents')
        for i in range(16):
            o = base + i * self.OBJ_SIZE
            flags = self.u32(o)
            if flags & 1 and not flags >> 16 & 1 and self.u8(o + 5) == graphics_id:
                return (self.s16(o + self.OBJ_COORDS) - 7, self.s16(o + self.OBJ_COORDS + 2) - 7)
        return None

    @cached_property
    def _bumped(self) -> set:
        return set()  # (map, (x, y), direction) we could not walk through (ledges, water, counters)

    def _plan(self, goal: tuple[int, int]) -> list[str] | None:
        here, m = self.pos(), map_info(self.map())
        npcs = (self.npc_tiles() | {(w[0], w[1]) for w in m.warps}) - {goal}  # never step on other warps
        if CAN_CUT and self.cut:
            npcs -= CUTTABLE.get(m.name, frozenset())  # a tree is an object event too; walk_to cuts it on arrival
        moves = {'UP': (0, -1), 'DOWN': (0, 1), 'LEFT': (-1, 0), 'RIGHT': (1, 0)}
        prev, queue, name = {here: None}, deque([here]), m.name
        while queue:
            cur = queue.popleft()
            if cur == goal:
                out = []
                while prev[cur]:
                    cur, d = prev[cur]
                    out.append(d)
                return out[::-1]
            for d, (dx, dy) in moves.items():
                nxt = (cur[0] + dx, cur[1] + dy)
                if m.ledge(*nxt) == d:  # one-way jump lands two tiles on
                    nxt = (nxt[0] + dx, nxt[1] + dy)
                    if not m.passable(*nxt):
                        continue
                elif not (nxt == goal or m.passable(*nxt)):
                    continue
                if nxt in prev or nxt in npcs or (name, cur, d) in self._bumped:
                    continue
                prev[nxt] = (cur, d)
                queue.append(nxt)
        return None

    def walk_to(self, x: int, y: int, max_steps: int = 400, battle_policy=None, stop_on_event: bool = False) -> bool:
        """Walk to (x, y) on the current map: replan every step, learn blocked moves,
        fight whatever starts on the way (or, with stop_on_event, return False as soon as
        something takes control). True when there (or when a warp moved us)."""
        start_map = self.map()
        for _ in range(max_steps):
            if not self.free():
                if stop_on_event:
                    return False
                self.handle(battle_policy)
            if self.map() != start_map:
                return True
            if self.pos() == (x, y):
                return True
            route = self._plan((x, y))
            if not route:
                return False
            here, d = self.pos(), route[0]
            nxt = (here[0] + {'UP': 0, 'DOWN': 0, 'LEFT': -1, 'RIGHT': 1}[d], here[1] + {'UP': -1, 'DOWN': 1, 'LEFT': 0, 'RIGHT': 0}[d])
            if nxt in CUTTABLE.get(start_map, ()) and nxt not in CLEARED.get(start_map, set()) and self.cut:
                if not self.cut(nxt):  # bound: routes.use_cut(g, tree) stands beside it, cuts it, clears it
                    return False
                continue
            if not self.step(d):
                if self.free():
                    self._bumped.add((start_map, here, d))
        return self.pos() == (x, y)

    def edge_exit(self, direction: str, battle_policy=None) -> bool:
        """Leave the current map across its edge (map connection) in `direction`."""
        m, start = map_info(self.map()), self.map()
        d = direction.upper()
        if d == 'UP':
            cells = [(x, 0) for x in range(m.width)]
        elif d == 'DOWN':
            cells = [(x, m.height - 1) for x in range(m.width)]
        elif d == 'LEFT':
            cells = [(0, y) for y in range(m.height)]
        else:
            cells = [(m.width - 1, y) for y in range(m.height)]
        here = self.pos()
        cells = sorted((c for c in cells if m.passable(*c)), key=lambda c: abs(c[0] - here[0]) + abs(c[1] - here[1]))
        for c in cells:
            if self.walk_to(*c, battle_policy=battle_policy) and self.map() == start and self.pos() == c:
                for _ in range(4):
                    self.step(d)
                    if self.map() != start:
                        self.run_until(self.free, 120)
                        return True
            if self.map() != start:
                return True
        return False

    def travel(self, dest: str, battle_policy=None, avoid: tuple = (), via: tuple = (), attempts: int = 6, stop=None, at=None) -> bool:
        """Go to another map, planning over walkable regions (warps, map edges, one-way ledges).
        `avoid`: maps that are story-gated right now. `via`: maps to pass through in order. `at`: a cell on `dest`
        whose area we must reach (then walk to it)."""
        for waypoint in via:
            if not self.travel(waypoint, battle_policy, avoid):
                return False
        for _attempt in range(attempts):
            if self.map() == dest and (at is None or _region_of(dest, self.pos()) == _region_of(dest, at)):
                return at is None or self.pos() == tuple(at) or self.walk_to(*at)
            hops = region_route(self.map(), self.pos(), dest, avoid, at)
            if hops is None:
                raise ValueError(f'no route {self.map()} {self.pos()} -> {dest}')
            for kind, arg, nxt, _rid in hops:
                if stop and stop():
                    return False
                here = self.map()
                if kind == 'edge':
                    ok = self.edge_exit(arg, battle_policy)
                elif kind == 'warp':
                    # several door/mat tiles may lead there; only some are real exits
                    ok = self.take_warp(*arg) and self.map() == nxt
                    if not ok and self.map() == here:
                        ok = self.warp_to(nxt)
                else:  # ledge
                    (sx, sy), d = arg
                    ok = self.walk_to(sx, sy, battle_policy=battle_policy) and self.step(d)
                if not ok or (kind != 'ledge' and self.map() != nxt):
                    break  # replan from wherever we ended up
        return self.map() == dest

    def take_warp(self, x: int, y: int) -> bool:
        """Walk onto a warp (door, stairs, exit) and through it. True when the map changed."""
        start = self.map()
        if not self.walk_to(x, y):
            return self.map() != start
        if self.map() != start:
            return True
        here = self.save_state()
        for d in ('UP', 'DOWN', 'LEFT', 'RIGHT'):
            self.run(16, d)
            if self.run_until(lambda: self.map() != start, 90):
                self.run_until(self.in_overworld, 300)
                self.run(30)
                return True
            if not self.free():
                # A trainer saw us, or a sign spoke: resolve it here. Never rewind through a battle: the state goes
                # back but the code brain does not, so it was asked the same move over and over (seed 0, 2026-10-12:
                # 210 model calls at one frame beside a Rocket grunt on Mt. Moon B2F).
                self.handle()
                if self.map() != start:
                    return True
                self.walk_to(x, y)
                here = self.save_state()
                continue
            if self.pos() != (x, y):  # stepped off a warp we were already standing on (an arrival tile): step back onto it
                self.walk_to(x, y)
                if self.run_until(lambda: self.map() != start, 90):
                    self.run_until(self.in_overworld, 300)
                    self.run(30)
                    return True
            self.load_state(here)
        return False

    def warp_to(self, dest_map: str) -> bool:
        """Go through a warp on this map that leads to dest_map (tries each candidate)."""
        candidates = [(x, y) for x, y, dest, _ in map_info(self.map()).warps if dest == dest_map]
        if not candidates:
            raise ValueError(f'no warp from {self.map()} to {dest_map}')
        here = self.save_state()
        for x, y in candidates:
            if self.take_warp(x, y) and self.map() == dest_map:
                return True
            self.load_state(here)
        return False


# ---- region-level routing (connected walkable areas, so split maps like Route 4 / Mt. Moon work)
@lru_cache(maxsize=None)
def regions(name: str) -> dict:
    """cell -> region id for passable cells (warp tiles count as passable)."""
    m = map_info(name)
    warps = {(w[0], w[1]) for w in m.warps}
    ok = lambda c: 0 <= c[0] < m.width and 0 <= c[1] < m.height and (m.passable(*c) or c in warps)
    comp, rid = {}, 0
    for y in range(m.height):
        for x in range(m.width):
            if (x, y) in comp or not ok((x, y)):
                continue
            queue = deque([(x, y)])
            comp[(x, y)] = rid
            while queue:
                cx, cy = queue.popleft()
                for nxt in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if nxt not in comp and ok(nxt):
                        comp[nxt] = rid
                        queue.append(nxt)
            rid += 1
    return comp


def _region_of(name: str, cell) -> int | None:
    r = regions(name)
    if cell in r:
        return r[cell]
    # nearest region within 1 tile (arrival tiles next to doors)
    for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        if (cell[0] + dx, cell[1] + dy) in r:
            return r[(cell[0] + dx, cell[1] + dy)]
    return None


@lru_cache(maxsize=None)
def _region_hops(name: str, rid: int) -> tuple:
    """Moves out of (map, region): ('warp', (x, y), dest_map, dest_region) / ('edge', dir, dest_map, dest_region)."""
    g, n, folder, data, layout = _map_index()['name'][name]
    m, comp, out = map_info(name), regions(name), []
    for x, y, dest, wid in m.warps:
        if comp.get((x, y)) != rid or dest not in _map_index()['name']:
            continue
        dw = map_info(dest).warps
        if 0 <= wid < len(dw):
            drid = _region_of(dest, (dw[wid][0], dw[wid][1]))
            if drid is not None:
                out.append(('warp', (x, y), dest, drid))
    step = {'UP': (0, -1), 'DOWN': (0, 1), 'LEFT': (-1, 0), 'RIGHT': (1, 0)}
    seen_ledge = set()
    for y in range(m.height):
        for x in range(m.width):
            d = m.ledge(x, y)
            if not d:
                continue
            dx, dy = step[d]
            src, dst = (x - dx, y - dy), (x + dx, y + dy)
            if comp.get(src) == rid and dst in comp and comp[dst] != rid and comp[dst] not in seen_ledge:
                seen_ledge.add(comp[dst])
                out.append(('ledge', (src, d), name, comp[dst]))
    for c in data.get('connections') or []:
        d, other, off = c['direction'], c['map'], int(c['offset'])
        if other not in _map_index()['name']:
            continue
        om = map_info(other)
        if d == 'up':
            pairs = [((x, 0), (x - off, om.height - 1)) for x in range(m.width)]
        elif d == 'down':
            pairs = [((x, m.height - 1), (x - off, 0)) for x in range(m.width)]
        elif d == 'left':
            pairs = [((0, y), (om.width - 1, y - off)) for y in range(m.height)]
        else:
            pairs = [((m.width - 1, y), (0, y - off)) for y in range(m.height)]
        seen = set()
        for mine, theirs in pairs:
            if comp.get(mine) == rid and theirs in regions(other) and om.passable(*theirs):
                drid = regions(other)[theirs]
                if drid not in seen:
                    seen.add(drid)
                    out.append(('edge', d, other, drid))
    return tuple(out)


def region_route(src: str, src_pos, dest: str, avoid: tuple = (), dest_pos=None) -> list | None:
    """Hops from (src, src_pos) to `dest` — to the region holding `dest_pos` when given (a floor can be several
    disconnected areas: Mt. Moon B2F's fossil room is not its arrival ladder's area)."""
    want = _region_of(dest, dest_pos) if dest_pos else None
    start = (src, _region_of(src, src_pos))
    prev, queue = {start: None}, deque([start])
    while queue:
        cur = queue.popleft()
        if cur[0] == dest and (want is None or cur[1] == want):
            out = []
            while prev[cur]:
                cur, hop = prev[cur]
                out.append(hop)
            return out[::-1]
        for hop in _region_hops(*cur):
            nxt = (hop[2], hop[3])
            if nxt not in prev and hop[2] not in avoid:
                prev[nxt] = (cur, hop)
                queue.append(nxt)
    return None
