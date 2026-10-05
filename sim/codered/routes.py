"""Scripted routes: deterministic ways to reach checkpoints from power-on.

Each route returns True on success and leaves the game in a known state.
Checkpoints are saved to build/sim/checkpoints/<name>.state.
"""
from __future__ import annotations

from pathlib import Path

from .game import ROOT
from .world import World, map_info

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
    g.walk_to(6, 8, stop_on_event=True)  # rival stops you on the way out
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


# ---- general errands -------------------------------------------------------
import json as _json
from .game import DECOMP as _DECOMP
from .world import _map_index


def objects(map_name: str) -> list[dict]:
    folder = _map_index()['name'][map_name][2]
    return _json.loads((_DECOMP / 'data/maps' / folder / 'map.json').read_text())['object_events']


def talk_to(g: World, gfx: str, across_counter: bool = False, policy=None) -> bool:
    """Walk next to the first NPC with this sprite on the current map, face it, press A, resolve."""
    o = next(o for o in objects(g.map()) if o.get('graphics_id') == gfx)
    x, y = o['x'], o['y']
    gap = 2 if across_counter else 1
    for (dx, dy, face) in ((0, gap, 'UP'), (0, -gap, 'DOWN'), (-gap, 0, 'RIGHT'), (gap, 0, 'LEFT')):
        if g.walk_to(x + dx, y + dy, battle_policy=policy) and g.pos() == (x + dx, y + dy):
            g.interact(face)
            g.handle(policy)
            return True
    return False


def heal(g: World) -> bool:
    """From a city (or its center): heal at the Pokémon Center, then step back outside."""
    city = g.map()
    center = city + '_POKEMON_CENTER_1F' if not city.endswith('_POKEMON_CENTER_1F') else city
    if g.map() != center and not g.travel(center):
        return False
    talk_to(g, 'OBJ_EVENT_GFX_NURSE', across_counter=True)
    ok = all(m['hp'] == m['max_hp'] for m in g.party())
    g.travel(city if city != center else center.replace('_POKEMON_CENTER_1F', ''))
    return ok


def grind(g: World, level: int, area: str, city: str, policy=None, max_rounds: int = 40, to_area: tuple = (), to_city: tuple = ()) -> bool:
    """Walk around `area` (a route with grass) fighting wild Pokémon until the lead is `level`;
    heal in `city` whenever HP < 40%. Returns True when the level is reached."""
    import random as _r
    rng = _r.Random(g.frame)
    for _ in range(max_rounds):
        lead = g.party()[0]
        if lead['level'] >= level:
            return True
        if lead['hp'] < 0.5 * lead['max_hp']:
            if g.map() != city:
                g.travel(city, policy, via=to_city)
            heal(g)
        if g.map() != area and not g.travel(area, policy):
            g.travel(area, policy, via=to_area)
        if g.map() != area:
            continue
        m = map_info(area)
        grass = set(m.grass())
        pairs = [((x, y), (x + 1, y)) for x, y in grass if (x + 1, y) in grass]
        if not pairs:
            raise ValueError(f'no tall grass on {area}')
        here = g.pos()
        a, b = min(pairs, key=lambda p: abs(p[0][0] - here[0]) + abs(p[0][1] - here[1]))
        if not g.walk_to(*a, battle_policy=policy) or g.map() != area:
            continue
        for k in range(200):  # pace in the grass until something needs attention
            g.step('RIGHT' if k % 2 == 0 else 'LEFT')
            if not g.free():
                g.handle(policy)
            lead = g.party()[0]
            if lead['hp'] < 0.5 * lead['max_hp'] or g.map() != area or lead['level'] >= level:
                break
    return g.party()[0]['level'] >= level


def journey(g: World, dest: str, center_city: str, avoid: tuple = (), low: float = 0.4, tries: int = 6) -> bool:
    """travel() that retreats to `center_city`'s Pokémon Center whenever the lead drops below `low` HP."""
    hurt = lambda: g.party()[0]['hp'] < low * g.party()[0]['max_hp']
    for _ in range(tries):
        if hurt():
            g.travel(center_city, avoid=avoid)
            heal(g)
        if g.travel(dest, avoid=avoid, stop=hurt):
            return True
        if not hurt():
            g.screenshot(ROOT / f'build/sim/stuck-{g.map()}.png')
    return g.map() == dest


MT_MOON_AVOID = ('MAP_DIGLETTS_CAVE_NORTH_ENTRANCE', 'MAP_DIGLETTS_CAVE_SOUTH_ENTRANCE')


def mt_moon_fossil(g: World) -> bool:
    """B2F: trigger Super Nerd Miguel (coord event at 14,11), beat him, take the Dome Fossil (13,7);
    he then steps aside and the way to the exit ladder opens. data/maps/MtMoon_B2F/scripts.inc"""
    if not journey(g, 'MAP_MT_MOON_B2F', 'MAP_ROUTE4', MT_MOON_AVOID):
        return False
    if not ready_for_boss(g, 'MAP_ROUTE4', 'MAP_MT_MOON_B2F', MT_MOON_AVOID, spot=(15, 11)):
        return False
    g.walk_to(14, 11)
    g.handle()
    if not g.walk_to(13, 8):
        return False
    g.interact('UP')
    g.handle()  # YES (default) -> obtained DOME FOSSIL
    return 'DOME_FOSSIL' in g.bag()


def progress_trace(path=None):
    """A trace callback: one line of where/what, plus a screenshot at `path`."""
    import time
    t0 = time.time()
    def trace(g):
        lead = g.party()[0] if g.party() else {}
        print(f"{time.time() - t0:6.0f}s f{g.frame} {g.map()} {g.pos()} L{lead.get('level')} "
              f"{lead.get('hp')}/{lead.get('max_hp')} free={g.free()} battle={g.in_battle()}", flush=True)
        if path:
            g.screenshot(path)
    return trace


def ready_for_boss(g: World, center_city: str, back_to: str, avoid: tuple = (), need: float = 0.9,
                   spot: tuple | None = None, tries: int = 8) -> bool:
    """Arrive at `spot` on `back_to` with >= `need` HP: heal and return as often as needed.
    Trainers on the way stay beaten, so each round costs less HP."""
    for _ in range(tries):
        if g.map() == back_to and spot and g.pos() != spot:
            g.walk_to(*spot)
        lead = g.party()[0]
        if g.map() == back_to and (not spot or g.pos() == spot) and lead['hp'] >= need * lead['max_hp']:
            return True
        if lead['hp'] < need * lead['max_hp']:
            g.travel(center_city, avoid=avoid)
            heal(g)
        journey(g, back_to, center_city, avoid)
    return False


# ---- full runs ------------------------------------------------------------------
SYS_FLAGS = 0x800
FLAG_BADGE01_GET, FLAG_BADGE02_GET = SYS_FLAGS + 0x20, SYS_FLAGS + 0x21  # include/constants/flags.h


def to_misty(g: World, starter: str = 'BULBASAUR', log=print) -> dict:
    """Power-on -> Brock -> Mt. Moon -> Misty, inputs only (plus Options-menu settings and nothing else).
    Returns a summary; checkpoints are saved after each leg."""
    forest = ('MAP_ROUTE2_VIRIDIAN_FOREST_SOUTH_ENTRANCE', 'MAP_VIRIDIAN_FOREST', 'MAP_ROUTE2_VIRIDIAN_FOREST_NORTH_ENTRANCE')
    def leg(name, fn):
        ok = fn()
        lead = g.party()[0] if g.party() else {}
        log(f'{name:<14} {"ok " if ok else "FAIL"} frame {g.frame:>7} ({g.frame / 59.73 / 60:5.1f} game-min) '
            f'{g.map()} L{lead.get("level")} {lead.get("hp")}/{lead.get("max_hp")}')
        if not ok:
            g.screenshot(CHECKPOINTS / f'fail-{name}.png')
            raise RuntimeError(f'leg {name} failed')
        save_checkpoint(g, name)

    def rival():
        g.fast_options()
        outcomes = g.handle()
        log(f'               rival battle: {outcomes}')
        return g.free()  # losing the first rival battle is allowed by the game

    def parcel():
        return g.travel('MAP_VIRIDIAN_CITY_MART') and (g.handle() or True) and 'OAKS_PARCEL' in g.bag()

    def pokedex():
        return g.travel('MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB') and talk_to(g, 'OBJ_EVENT_GFX_PROF_OAK') and 'OAKS_PARCEL' not in g.bag()

    def pewter():
        return g.travel('MAP_VIRIDIAN_CITY') and heal(g) and g.travel('MAP_PEWTER_CITY', via=forest)

    def train_for_brock():
        return heal(g) and grind(g, 13, 'MAP_VIRIDIAN_FOREST', 'MAP_PEWTER_CITY', to_area=('MAP_ROUTE2', forest[2]), to_city=(forest[2],)) \
            and g.travel('MAP_PEWTER_CITY', via=(forest[2],)) and heal(g)

    def brock():
        return g.travel('MAP_PEWTER_CITY_GYM') and talk_to(g, 'OBJ_EVENT_GFX_BROCK') and g.flag(FLAG_BADGE01_GET)

    def route4():
        return g.travel('MAP_ROUTE4', avoid=MT_MOON_AVOID) and heal(g)

    def cerulean():
        return mt_moon_fossil(g) and journey(g, 'MAP_CERULEAN_CITY', 'MAP_ROUTE4', MT_MOON_AVOID) and heal(g)

    def misty():
        return g.travel('MAP_CERULEAN_CITY_GYM') and talk_to(g, 'OBJ_EVENT_GFX_MISTY') and g.flag(FLAG_BADGE02_GET)

    leg('opening', lambda: opening(g, starter))
    for name, fn in [('rival', rival), ('parcel', parcel), ('pokedex', pokedex), ('pewter', pewter),
                     ('train_brock', train_for_brock), ('brock', brock), ('route4', route4),
                     ('cerulean', cerulean), ('misty', misty)]:
        leg(name, fn)
    return {'frames': g.frame, 'game_minutes': round(g.frame / 59.73 / 60, 1), 'party': g.party(),
            'badges': [g.flag(FLAG_BADGE01_GET), g.flag(FLAG_BADGE02_GET)]}
