"""Battle policy: reads the battle state from RAM and drives the menus.

Move data and the type chart are read from the ROM itself (gBattleMoves,
gTypeEffectiveness), so they always match the build under test.
"""
from __future__ import annotations

import random
import re
from dataclasses import dataclass
from functools import lru_cache

from .game import DECOMP
from .world import World, BMON_SIZE

# include/pokemon.h struct BattlePokemon
BMON_SPECIES, BMON_MOVES, BMON_TYPE1, BMON_TYPE2, BMON_PP = 0x00, 0x0C, 0x21, 0x22, 0x24
ACTION_FIGHT, ACTION_BAG, ACTION_POKEMON, ACTION_RUN = 0, 1, 2, 3


@dataclass(frozen=True)
class Move:
    id: int
    name: str
    power: int
    type: int
    accuracy: int
    pp: int


@lru_cache(maxsize=None)
def move_names() -> dict[int, str]:
    text = (DECOMP / 'include/constants/moves.h').read_text()
    return {int(v): k[5:] for k, v in re.findall(r'#define (MOVE_\w+)\s+(\d+)\b', text)}


class Rules:
    """Move table + type chart read from a ROM image."""
    def __init__(self, g: World):
        rom = g.rom_path.read_bytes()
        at = lambda sym: g.sym(sym) - 0x08000000
        self.moves = {}
        base, names = at('gBattleMoves'), move_names()
        for i in range(max(names) + 1):
            e = rom[base + i * 12: base + i * 12 + 12]  # struct BattleMove, 12 bytes
            self.moves[i] = Move(i, names.get(i, str(i)), e[1], e[2], e[3], e[4])
        self.chart = {}
        p = at('gTypeEffectiveness')
        while rom[p] != 0xFF:  # TYPE_ENDTABLE
            if rom[p] != 0xFE:  # TYPE_FORESIGHT marker
                self.chart[(rom[p], rom[p + 1])] = rom[p + 2] / 10
            p += 3

    def effectiveness(self, move_type: int, def_types: tuple[int, int]) -> float:
        mult = 1.0
        for t in {def_types[0], def_types[1]}:
            mult *= self.chart.get((move_type, t), 1.0)
        return mult


class Battle:
    def __init__(self, g: World):
        self.g = g
        self.rules = getattr(g, '_rules', None) or Rules(g)
        g._rules = self.rules
        # The first rival battle (and the old man's demo) use the Oak/Old Man tutorial controller.
        self._choose_action = {g.sym_in(f, 'HandleInputChooseAction') & ~1 for f in ('battle_controller_player', 'battle_controller_oak_old_man')}
        self._choose_move = {g.sym_in('battle_controller_player', 'HandleInputChooseMove') & ~1,
                             g.sym_in('battle_controller_oak_old_man', 'OakOldManHandleInputChooseMove') & ~1}
        self.log: list[str] = []

    # ---- state
    def mon(self, i: int) -> dict:
        g, b = self.g, self.g.sym('gBattleMons') + i * BMON_SIZE
        return {'species': g.u16(b + BMON_SPECIES), 'hp': g.u16(b + 0x28), 'max_hp': g.u16(b + 0x2C), 'level': g.u8(b + 0x2A),
                'types': (g.u8(b + BMON_TYPE1), g.u8(b + BMON_TYPE2)),
                'moves': [g.u16(b + BMON_MOVES + 2 * k) for k in range(4)], 'pp': list(g.read(b + BMON_PP, 4))}

    def controller(self) -> int:
        return self.g.u32(self.g.sym('gBattlerControllerFuncs')) & ~1  # battler 0 = player

    def choosing_action(self) -> bool: return self.controller() in self._choose_action
    def choosing_move(self) -> bool: return self.controller() in self._choose_move
    def over(self) -> bool: return self.g.battle_outcome() != 'ongoing'
    def is_wild(self) -> bool: return not (self.g.u32(self.g.sym('gBattleTypeFlags')) & 0x8)  # BATTLE_TYPE_TRAINER

    # ---- decisions
    def best_move(self) -> int:
        me, foe = self.mon(0), self.mon(1)
        def score(k):
            mid, pp = me['moves'][k], me['pp'][k]
            if not mid or not pp:
                return -1
            m = self.rules.moves[mid]
            stab = 1.5 if m.type in me['types'] else 1.0
            eff = self.rules.effectiveness(m.type, foe['types'])
            return m.power * (m.accuracy or 100) / 100 * stab * eff + 0.01  # status moves still beat nothing
        return max(range(4), key=score)

    # ---- menu driving
    def _cursor_to(self, cursor_sym: str, target: int) -> None:
        g = self.g
        for _ in range(4):
            cur = g.u8(g.sym(cursor_sym))
            if cur == target:
                return
            if (cur & 1) != (target & 1):
                g.press('RIGHT' if target & 1 else 'LEFT', hold=2, after=4)
            elif (cur >> 1) != (target >> 1):
                g.press('DOWN' if target >> 1 else 'UP', hold=2, after=4)

    def act(self, action: int) -> None:
        self._cursor_to('gActionSelectionCursor', action)
        self.g.press('A', hold=2, after=8)

    def use_move(self, k: int) -> None:
        self._cursor_to('gMoveSelectionCursor', k)
        name = self.rules.moves[self.mon(0)['moves'][k]].name
        self.log.append(f"{name} vs {self.mon(1)['species']} ({self.mon(1)['hp']}/{self.mon(1)['max_hp']})")
        self.g.press('A', hold=2, after=8)

    def play(self, run_from_wild: bool | str = 'auto', limit: int = 60 * 60 * 15) -> str:
        """Play the battle to the end. Returns the outcome."""
        g, start = self.g, self.g.frame
        while not self.over() and g.frame - start < limit:
            if self.choosing_action():
                me = self.mon(0)
                wants_run = run_from_wild is True or (run_from_wild == 'auto' and me['hp'] < 0.35 * me['max_hp'])
                if wants_run and self.is_wild():
                    self.act(ACTION_RUN)
                else:
                    self.act(ACTION_FIGHT)
            elif self.choosing_move():
                hp = (self.mon(0)['hp'], self.mon(1)['hp'])
                stalled = hp == getattr(self, '_last_hp', None)
                self._stall = getattr(self, '_stall', 0) + 1 if stalled else 0
                self._last_hp = hp
                k = self.best_move()
                if self._stall >= 3:  # nothing changes (disabled/ineffective move?): try another with PP
                    usable = [i for i, (mid, pp) in enumerate(zip(self.mon(0)['moves'], self.mon(0)['pp'])) if mid and pp and i != k]
                    k = usable[self._stall % len(usable)] if usable else k
                    self.log.append(f'stall {self._stall}: trying slot {k}')
                self.use_move(k)
            elif g.learn_move_screen():
                g.forget_weakest_move(self.rules)
            else:
                g.press('A', hold=2, after=6)
        return g.battle_outcome()


def finish_battle(g: World, limit: int = 6000) -> None:
    """After the outcome is set: advance text (exp, evolution, move learning) back to the field.
    A (never B): B would cancel an evolution."""
    for _ in range(limit // 8):
        if g.in_overworld():
            return
        if g.learn_move_screen():
            g.forget_weakest_move(Battle(g).rules)
        else:
            g.press('A', hold=2, after=6)
