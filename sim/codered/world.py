"""Game-state readers/writers and map knowledge, from the decomp's own data.

Offsets come from include/global.h (SaveBlock1/2, Pokemon, BattlePokemon);
maps and collision from data/maps + data/layouts. Nothing hand-copied from
the ROM.
"""
from __future__ import annotations

import json
from collections import deque
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .game import DECOMP, Game

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

    def passable(self, x: int, y: int) -> bool:
        return 0 <= x < self.width and 0 <= y < self.height and not (self.blocks[y * self.width + x] & COLLISION_MASK)


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
def map_info(name: str) -> MapInfo:
    g, n, _, data, layout = _map_index()['name'][name]
    raw = (DECOMP / layout['blockdata_filepath']).read_bytes()
    blocks = tuple(int.from_bytes(raw[i:i + 2], 'little') for i in range(0, len(raw), 2))
    warps = tuple((w['x'], w['y'], w['dest_map'], int(w['dest_warp_id'])) for w in data.get('warp_events', []))
    return MapInfo(name, g, n, layout['width'], layout['height'], blocks, warps)


def map_name(group: int, num: int) -> str | None:
    folder = _map_index()['key'].get((group, num))
    if folder is None:
        return None
    return json.loads((DECOMP / 'data/maps' / folder / 'map.json').read_text())['id']


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

    def map(self) -> str | None:
        loc = self.sb1 + SB1_LOCATION
        g, n = self.read(loc, 2)
        return map_name(int.from_bytes(bytes([g]), 'little', signed=True), int.from_bytes(bytes([n]), 'little', signed=True))

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
        a = self.sb2 + SB2_OPTIONS
        self.w16(a, (self.u16(a) & ~0x7 | 2) | 1 << 10)

    # party / battle
    def party(self) -> list[dict]:
        count = self.u8(self.sym('gPlayerPartyCount'))
        base = self.sym('gPlayerParty')
        return [{'level': self.u8(base + i * MON_SIZE + MON_LEVEL), 'hp': self.u16(base + i * MON_SIZE + MON_HP),
                 'max_hp': self.u16(base + i * MON_SIZE + MON_MAXHP)} for i in range(count)]

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

    def walk_to(self, x: int, y: int, retries: int = 3) -> bool:
        """Pathfind on the current map's collision data and walk there."""
        for _ in range(retries):
            here = self.pos()
            if here == (x, y):
                return True
            route = path(map_info(self.map()), here, (x, y))
            if route is None:
                return False
            start_map = self.map()
            for d in route:
                if not self.step(d):
                    self.mash(self.in_overworld, 'B', limit=120)  # dismiss anything, retry
                    break
                if self.map() != start_map:
                    return True  # walked through a warp
        return self.pos() == (x, y)

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
