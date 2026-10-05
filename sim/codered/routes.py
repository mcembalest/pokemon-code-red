"""Scripted routes: deterministic ways to reach checkpoints from power-on.

Each route returns True on success and leaves the game in a known state.
Checkpoints are saved to build/sim/checkpoints/<name>.state.
"""
from __future__ import annotations

from pathlib import Path

from .game import ROOT
from .world import World

CHECKPOINTS = ROOT / 'build/sim/checkpoints'


def save_checkpoint(g: World, name: str) -> Path:
    CHECKPOINTS.mkdir(parents=True, exist_ok=True)
    path = CHECKPOINTS / f'{name}.state'
    path.write_bytes(g.save_state())
    return path


def load_checkpoint(g: World, name: str) -> None:
    g.load_state((CHECKPOINTS / f'{name}.state').read_bytes())


# ---- naming mailbox (patches/005-text-entry.patch; same protocol as player/src/bridge/naming.ts)
def naming_active(g: World) -> bool:
    box = g.sym('gCodeRedNamingMailbox')
    return g.read(box, 4) == b'CRN1' and g.u8(box + 6) == 1


def type_name(g: World, text: str) -> bool:
    box = g.sym('gCodeRedNamingMailbox')
    session, ack = g.u32(box + 8), g.u32(box + 20)
    for seq, action, value in ((ack + 1, 1, text), (ack + 2, 2, '')):
        data = value.encode('ascii')
        g.w8(box + 24, 0)
        g.w32(box + 12, session)
        g.w32(box + 16, seq)
        g.w8(box + 25, len(data))
        g.write(box + 44, data.ljust(16, b'\0'))
        g.w8(box + 24, action)
        if not g.run_until(lambda: g.u32(box + 20) >= seq or not naming_active(g), 120):
            return False
    return g.run_until(lambda: not naming_active(g), 300)


def intro(g: World, player: str = 'RED', rival: str = 'BLUE') -> bool:
    """Power-on -> title -> Oak's speech (both names typed) -> player in the bedroom."""
    g.run(620)
    g.press('START')
    if not g.mash(lambda: naming_active(g), 'A', limit=12000) or not type_name(g, player):
        return False
    if not g.mash(lambda: naming_active(g), 'A', limit=6000) or not type_name(g, rival):
        return False
    if not g.mash(g.in_overworld, 'A', limit=6000):
        return False
    g.run(60)
    g.fast_options()
    return g.map() == 'MAP_PALLET_TOWN_PLAYERS_HOUSE_2F'


STARTER_BALLS = {'BULBASAUR': 8, 'SQUIRTLE': 9, 'CHARMANDER': 10}  # x on the lab table (y=4), data/maps/PalletTown_ProfessorOaksLab/map.json


def to_lab(g: World) -> bool:
    """Bedroom -> outside -> trigger Oak's escort north of Pallet -> free in the lab."""
    if not (g.warp_to('MAP_PALLET_TOWN_PLAYERS_HOUSE_1F') and g.warp_to('MAP_PALLET_TOWN')):
        return False
    g.walk_to(12, 1)
    return g.advance() and g.map() == 'MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB'


def choose_starter(g: World, species: str = 'BULBASAUR') -> bool:
    """In the lab: take a starter, decline nothing, keep its default name, until free again."""
    x = STARTER_BALLS[species]
    if not g.walk_to(x, 5):
        return False
    g.interact('UP')
    count = lambda: g.u8(g.sym('gPlayerPartyCount'))
    for _ in range(600):
        if naming_active(g):
            type_name(g, '')  # empty = keep the species name
        if count() >= 1 and g.settled():
            return True
        g.press('A', hold=3, after=7)
    return False


def to_rival_battle(g: World) -> bool:
    """After choosing: walk toward the exit; the rival challenges. Returns once the battle is running."""
    g.walk_to(6, 8)  # rival stops you on the way out
    return g.mash(g.in_battle, 'A', limit=6000, period=10)


def opening(g: World, starter: str = 'BULBASAUR') -> bool:
    """Power-on to the start of the first rival battle, saving checkpoints on the way."""
    steps = [('bedroom', lambda: intro(g)), ('lab', lambda: to_lab(g)),
             (f'starter_{starter.lower()}', lambda: choose_starter(g, starter)),
             (f'rival_battle_{starter.lower()}', lambda: to_rival_battle(g))]
    for name, step in steps:
        if not step():
            print(f'route failed at {name} (map={g.map()} pos={g.pos()} frame={g.frame})')
            return False
        save_checkpoint(g, name)
    return True
