"""Scripted routes: deterministic ways to reach checkpoints from power-on.

Each route returns True on success and leaves the game in a known state.
Checkpoints are saved to build/sim/checkpoints/<name>.state.
"""
from __future__ import annotations

from pathlib import Path

from .game import ROOT
from . import world
from .world import World, map_info

import os, sys
CHECKPOINTS = ROOT / 'build/sim/checkpoints' / os.environ.get('CODERED_RUN', '')


def save_checkpoint(g: World, name: str) -> Path:
    CHECKPOINTS.mkdir(parents=True, exist_ok=True)
    fresh_checkpoints()
    path = CHECKPOINTS / f'{name}.state'
    path.write_bytes(g.save_state())
    return path


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


def intro(g: World, player: str = 'RED', rival: str = 'BLUE', title_wait: int = 0) -> bool:
    """Power-on -> title -> Oak's speech (both names typed) -> player in the bedroom.
    `title_wait` frames on the title screen change the RNG seed (FireRed seeds it on START)."""
    g.run(620 + title_wait)
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


def opening(g: World, starter: str = 'BULBASAUR', title_wait: int = 0) -> bool:
    """Power-on to the start of the first rival battle, saving checkpoints on the way."""
    steps = [('bedroom', lambda: intro(g, title_wait=title_wait)), ('lab', lambda: to_lab(g)),
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
import re
from functools import lru_cache
from .game import DECOMP as _DECOMP
from .world import _map_index


def objects(map_name: str) -> list[dict]:
    folder = _map_index()['name'][map_name][2]
    return _json.loads((_DECOMP / 'data/maps' / folder / 'map.json').read_text())['object_events']


@lru_cache(maxsize=None)
def gfx_ids() -> dict[str, int]:
    text = (_DECOMP / 'include/constants/event_objects.h').read_text()
    return {k: int(v) for k, v in re.findall(r'#define (OBJ_EVENT_GFX_\w+)\s+(\d+)', text)}


def talk_to(g: World, gfx: str, across_counter: bool = False, policy=None) -> bool:
    """Walk next to the first NPC with this sprite on the current map (where it stands now), face it, press A, resolve."""
    live = g.npc_at(gfx_ids()[gfx]) if gfx in gfx_ids() else None
    if live is None:
        o = next((o for o in objects(g.map()) if o.get('graphics_id') == gfx), None)
        if o is None:
            return False  # not on this map (we whited out to a Pokémon Center, say)
        live = (o['x'], o['y'])
    x, y = live
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
    try:
        if g.map() != center and not g.travel(center):
            return False
    except ValueError:  # not in a city (a wild battle, a warp or a ledge left us mid-route): no center from here
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


def nearest_center(g: World, cities, avoid: tuple = ()) -> str:
    """Of these cities (each with a Pokémon Center), the one the fewest map hops away from here."""
    from .world import region_route
    def hops(city):
        try:
            r = region_route(g.map(), g.pos(), city, avoid)
        except Exception:
            r = None
        return len(r) if r is not None else 999
    return min(cities, key=hops)


def journey(g: World, dest: str, center_city, avoid: tuple = (), low: float = 0.4, tries: int = 6, at=None) -> bool:
    """travel() that retreats to a Pokémon Center whenever the lead drops below `low` HP: `center_city`'s, or the
    nearest of several (a tuple: on a long route the one behind us is often farther than the one ahead)."""
    hurt = lambda: g.party()[0]['hp'] < low * g.party()[0]['max_hp']
    centers = (center_city,) if isinstance(center_city, str) else tuple(center_city)
    for _ in range(tries):
        if hurt():
            try:
                if g.travel(nearest_center(g, centers, avoid), avoid=avoid):
                    heal(g)
            except ValueError:
                pass  # stranded off the planner's map: the next travel() re-plans from where we are
        try:
            if g.travel(dest, avoid=avoid, stop=hurt, at=at):
                return True
        except ValueError:
            continue
        if not hurt():
            g.screenshot(ROOT / f'build/sim/stuck-{g.map()}.png')
    return g.map() == dest


MT_MOON_AVOID = ('MAP_DIGLETTS_CAVE_NORTH_ENTRANCE', 'MAP_DIGLETTS_CAVE_SOUTH_ENTRANCE')
TRAINER_FLAGS_START, TRAINER_SUPER_NERD_MIGUEL = 0x500, 170  # include/constants/flags.h, opponents.h


def mt_moon_fossil(g: World) -> bool:
    """B2F: trigger Super Nerd Miguel (coord event at 14,11), beat him, take a fossil (Dome at 13,7 or Helix at 14,7);
    he then steps aside and the way to the exit ladder opens. data/maps/MtMoon_B2F/scripts.inc"""
    if not journey(g, 'MAP_MT_MOON_B2F', 'MAP_ROUTE4', MT_MOON_AVOID, at=(15, 11)):
        return False
    if not g.flag(TRAINER_FLAGS_START + TRAINER_SUPER_NERD_MIGUEL):  # the walk in can trip his trigger: then he is beaten already
        if not ready_for_boss(g, 'MAP_ROUTE4', 'MAP_MT_MOON_B2F', MT_MOON_AVOID, spot=(15, 11)):
            return False
        g.walk_to(14, 11)
        g.handle()
    # Either fossil opens the way (the sim has stood under the wrong one and come away empty: 2026-10-11).
    for x in (13, 14):
        if not g.walk_to(x, 8):
            continue
        g.interact('UP')
        g.handle()  # YES (default) -> obtained the fossil
        if 'DOME_FOSSIL' in g.bag() or 'HELIX_FOSSIL' in g.bag():
            return True
    return False


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
    Trainers on the way stay beaten, so each round costs less HP. When the way back keeps costing HP anyway (wild
    Zubats in Mt. Moon: seed 3 came back under 90% eight times), settle for less each round rather than never arriving."""
    for i in range(tries):
        want = need if i < tries // 2 else max(0.5, need - 0.1 * (i - tries // 2 + 1))
        if g.map() == back_to and spot and g.pos() != spot:
            g.walk_to(*spot)
        lead = g.party()[0]
        if g.map() == back_to and (not spot or g.pos() == spot) and lead['hp'] >= want * lead['max_hp']:
            return True
        if lead['hp'] < want * lead['max_hp']:
            try:
                reached = g.travel(center_city, avoid=avoid)
            except ValueError:
                reached = False
            if reached or g.map() == center_city:
                heal(g)
            else:  # stranded mid-route (text timing shifts the RNG, a wild battle moved us): walk out, then try again
                journey(g, center_city, center_city, avoid)
                continue
        journey(g, back_to, center_city, avoid, at=spot)
    return False


# ---- full runs ------------------------------------------------------------------
SYS_FLAGS = 0x800
FLAG_BADGE01_GET, FLAG_BADGE02_GET = SYS_FLAGS + 0x20, SYS_FLAGS + 0x21  # include/constants/flags.h


FOREST = ('MAP_ROUTE2_VIRIDIAN_FOREST_SOUTH_ENTRANCE', 'MAP_VIRIDIAN_FOREST', 'MAP_ROUTE2_VIRIDIAN_FOREST_NORTH_ENTRANCE')


def rival(g: World, log=print) -> bool:
    g.fast_options()
    outcomes = g.handle()
    log(f'               rival battle: {outcomes}')
    return g.free()  # losing the first rival battle is allowed by the game


def parcel(g: World) -> bool:
    return g.travel('MAP_VIRIDIAN_CITY_MART') and (g.handle() or True) and 'OAKS_PARCEL' in g.bag()


def pokedex(g: World) -> bool:
    return g.travel('MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB') and talk_to(g, 'OBJ_EVENT_GFX_PROF_OAK') and 'OAKS_PARCEL' not in g.bag()


def pewter(g: World) -> bool:
    return g.travel('MAP_VIRIDIAN_CITY') and heal(g) and g.travel('MAP_PEWTER_CITY', via=FOREST)


def train_for_brock(g: World) -> bool:
    return heal(g) and grind(g, 13, 'MAP_VIRIDIAN_FOREST', 'MAP_PEWTER_CITY', to_area=('MAP_ROUTE2', FOREST[2]), to_city=(FOREST[2],)) \
        and g.travel('MAP_PEWTER_CITY', via=(FOREST[2],)) and heal(g)


def brock(g: World, tries: int = 3) -> bool:
    return g.travel('MAP_PEWTER_CITY_GYM') and leader(g, 'OBJ_EVENT_GFX_BROCK', FLAG_BADGE01_GET, brock, tries)


def route4(g: World) -> bool:
    return g.travel('MAP_ROUTE4', avoid=MT_MOON_AVOID) and heal(g)


def cerulean(g: World) -> bool:
    return mt_moon_fossil(g) and journey(g, 'MAP_CERULEAN_CITY', 'MAP_ROUTE4', MT_MOON_AVOID) and heal(g)


def misty(g: World, tries: int = 3) -> bool:
    return g.travel('MAP_CERULEAN_CITY_GYM') and leader(g, 'OBJ_EVENT_GFX_MISTY', FLAG_BADGE02_GET, misty, tries)


def to_misty(g: World, starter: str = 'BULBASAUR', log=print, seed: int = 0) -> dict:
    """Power-on -> Boulder Badge -> Cascade Badge (see LEGS)."""
    return play(g, to='misty', starter=starter, log=log, seed=seed)


# ---- Cerulean -> Lt. Surge (2026-10-11) -------------------------------------------------
FLAG_BADGE03_GET = SYS_FLAGS + 0x22
FLAG_GOT_SS_TICKET, FLAG_GOT_HM01 = 0x234, 0x237          # include/constants/flags.h
VAR_TEMP_0, VAR_TEMP_1 = 0x4000, 0x4001                    # the gym's two switch cans (VermilionCity_Gym/scripts.inc)
FLAG_FOUND_BOTH_SWITCHES = 0x264
MOVE_CUT = 15
SAFFRON_AVOID = ('MAP_ROUTE5_SOUTH_ENTRANCE', 'MAP_ROUTE6_NORTH_ENTRANCE', 'MAP_SAFFRON_CITY')  # the thirsty guards


def bill(g: World) -> bool:
    """Route 25's sea cottage: help Bill (he is the Clefairy), run the cell separator on his PC, get the S.S. Ticket."""
    if not g.travel('MAP_ROUTE25_SEA_COTTAGE'):
        return False
    talk_to(g, 'OBJ_EVENT_GFX_CLEFAIRY')  # YES is the default answer
    if not g.walk_to(4, 6):
        return False
    g.interact('UP')  # the PC at (4,5)
    g.handle()
    talk_to(g, 'OBJ_EVENT_GFX_BILL')
    return g.flag(FLAG_GOT_SS_TICKET)


def ss_anne(g: World) -> bool:
    """Board with the ticket, beat the rival outside the captain's office, rub the captain's back: HM01. Then leave
    (the ship sails once you step off)."""
    if not journey(g, 'MAP_SSANNE_CAPTAINS_OFFICE', 'MAP_VERMILION_CITY', SAFFRON_AVOID):
        return False
    talk_to(g, 'OBJ_EVENT_GFX_CAPTAIN')
    if not g.flag(FLAG_GOT_HM01):
        return False
    return journey(g, 'MAP_VERMILION_CITY', 'MAP_VERMILION_CITY', SAFFRON_AVOID)


def teach_cut(g: World, rules) -> int:
    """Put CUT in the lead's least valuable move slot (a sim shortcut for the TM case). Returns the slot."""
    known = g.party_moves(0)
    def value(mid):
        m = rules.moves[mid]
        return m.power * 1.5 if m.power else g.STATUS_VALUE.get(m.name, 0)
    slot = min(range(4), key=lambda k: (value(known[k]) if known[k] else -1, -k))
    g.set_party_move(0, slot, MOVE_CUT, 30)
    world.CAN_CUT = True  # the planner may route through CUTTABLE trees now; walk_to cuts them
    return slot


def use_cut(g: World, tree: tuple[int, int]) -> bool:
    """Stand next to the tree, face it, talk to it: with CUT known the game asks "cut it down?" and the dialog
    driver says YES. True when we can stand where the tree was."""
    from .world import clear_obstacle
    tx, ty = tree
    was, world.CAN_CUT = world.CAN_CUT, False  # no planning through this tree while we work on it (walk_to would call us again)
    try:
        for (dx, dy, face) in ((0, -1, 'DOWN'), (0, 1, 'UP'), (1, 0, 'LEFT'), (-1, 0, 'RIGHT')):
            if g.walk_to(tx + dx, ty + dy) and g.pos() == (tx + dx, ty + dy):
                break
        else:
            return False
        for _ in range(2):  # the prompt can be missed when a wild battle or a trainer cut in: face it and ask again
            g.interact(face)
            g.handle()
            clear_obstacle(g.map(), tree)  # the planner may walk through it now
            if g.walk_to(tx, ty, max_steps=4) and g.pos() == tree:
                return True
            clear_obstacle(g.map(), tree, cleared=False)
            if g.pos() != (tx + dx, ty + dy) and not (g.walk_to(tx + dx, ty + dy) and g.pos() == (tx + dx, ty + dy)):
                break
        g.screenshot(CHECKPOINTS / f'fail-cut-{g.map()}-{tx}-{ty}.png')
        return False
    finally:
        world.CAN_CUT = was or g.party_moves(0).count(MOVE_CUT) > 0


World.cut = use_cut  # walk_to() cuts a CUTTABLE tree as it reaches it (world.py)


# Where to train after losing to a leader: (a route with tall grass near the city, the city, via maps there and back).
TRAINING = {
    'BROCK': ('MAP_VIRIDIAN_FOREST', 'MAP_PEWTER_CITY', (FOREST[2],), (FOREST[2],)),
    'MISTY': ('MAP_ROUTE24', 'MAP_CERULEAN_CITY', (), ()),
    'LT_SURGE': ('MAP_ROUTE11', 'MAP_VERMILION_CITY', (), ()),
    'ERIKA': ('MAP_ROUTE7', 'MAP_CELADON_CITY', (), ()),
}


def leader(g: World, gfx: str, badge_flag: int, again, tries: int) -> bool:
    """Challenge the leader standing in front of us. Losing whites out to the Pokémon Center (healed): a player would
    train a couple of levels nearby (TRAINING), walk back and try again, so do that, `tries` times in all (the
    trainers stay beaten). Two stand-in seeds lost to Erika three times running at L40 before training was added."""
    who = gfx.removeprefix('OBJ_EVENT_GFX_')
    g.leader_tries = {**getattr(g, 'leader_tries', {}), who: getattr(g, 'leader_tries', {}).get(who, 0) + 1}  # for the summary
    talk_to(g, gfx)
    if g.flag(badge_flag):
        return True
    if tries > 1 and g.map().endswith('_POKEMON_CENTER_1F'):
        city = g.map().replace('_POKEMON_CENTER_1F', '')
        g.travel(city)
        if who in TRAINING:
            area, home, to_area, to_city = TRAINING[who]
            grind(g, g.party()[0]['level'] + 2, area, home, to_area=to_area, to_city=to_city)
            g.travel(home, via=to_city) if g.map() != home else None
            heal(g)
        return again(g, tries - 1)
    return False


def enter_vermilion_gym(g: World) -> bool:
    """The tree by the gym grows back whenever the city map reloads: cut it on the way in, every time."""
    from .world import clear_obstacle
    if g.map() != 'MAP_VERMILION_CITY' and not g.travel('MAP_VERMILION_CITY'):
        return False
    if not use_cut(g, (19, 24)):
        return False
    entered = g.travel('MAP_VERMILION_CITY_GYM')
    clear_obstacle('MAP_VERMILION_CITY', (19, 24), cleared=False)
    return entered


def vermilion_gym(g: World, tries: int = 3) -> bool:
    """The trash cans: the two switch cans are in VAR_TEMP_0 / VAR_TEMP_1 (ids 1-15, five a row from (1,10)). Open
    both locks, beat the two trainers on the way, heal, then Lt. Surge."""
    from .world import clear_obstacle
    if not enter_vermilion_gym(g):
        return False
    can = lambda k: (1 + 2 * ((k - 1) % 5), 10 + 2 * ((k - 1) // 5))
    def open_can(k: int) -> bool:
        # From below first; a beaten trainer can end up standing there (Baily walks up to you and stays: seed 2),
        # so any free side of the can will do — it is a tile script, read from whichever way you face it.
        x, y = can(k)
        for sx, sy, face in ((x, y + 1, 'UP'), (x - 1, y, 'RIGHT'), (x + 1, y, 'LEFT'), (x, y - 1, 'DOWN')):
            if (sx, sy) in g.npc_tiles():
                continue
            if g.walk_to(sx, sy) and g.pos() == (sx, sy):
                g.interact(face)
                g.handle()
                return True
        return False
    for _ in range(4):
        first, second = g.var(VAR_TEMP_0), g.var(VAR_TEMP_1)
        for k in (first, second):
            if not open_can(k):
                break
        if g.flag(FLAG_FOUND_BOTH_SWITCHES):
            break
    if not g.flag(FLAG_FOUND_BOTH_SWITCHES):
        return False
    for cell in ((5, 6), (5, 7)):  # the beams are off: the door tiles are floor now
        clear_obstacle('MAP_VERMILION_CITY_GYM', cell)
    # Up the middle column: the Gentleman (7,8) looks left along row 8; met from below he stops at (6,8), not in the doorway.
    g.walk_to(5, 9)
    g.walk_to(5, 3)
    # The switches stay found and the trainers beaten: heal before the leader, like a player would.
    lead = g.party()[0]
    if lead['hp'] < 0.9 * lead['max_hp']:
        g.walk_to(5, 9)  # back below the (static-map) wall first: the region planner doesn't know the door opened
        if not (g.travel('MAP_VERMILION_CITY') and use_cut(g, (19, 24)) and heal(g) and enter_vermilion_gym(g)
                and g.walk_to(5, 9) and g.walk_to(5, 3)):
            return False
    return leader(g, 'OBJ_EVENT_GFX_LT_SURGE', FLAG_BADGE03_GET, vermilion_gym, tries)


def nugget(g: World) -> bool:  # the rival at the bridge, five trainers, the Rocket's offer (declined by walking on)
    return journey(g, 'MAP_ROUTE25', 'MAP_CERULEAN_CITY')


def bill_leg(g: World) -> bool:
    return bill(g) and journey(g, 'MAP_CERULEAN_CITY', 'MAP_CERULEAN_CITY') and heal(g)


def vermilion(g: World) -> bool:
    return journey(g, 'MAP_VERMILION_CITY', ('MAP_CERULEAN_CITY', 'MAP_VERMILION_CITY'), SAFFRON_AVOID) and heal(g)


def cut(g: World) -> bool:
    from .battle import Rules
    teach_cut(g, getattr(g, '_rules', None) or Rules(g))
    return g.travel('MAP_VERMILION_CITY') and use_cut(g, (19, 24)) and heal(g)


def to_surge(g: World, log=print, leg=None, rules=None) -> dict:
    """After Misty: Nugget Bridge, Bill, Vermilion, the S.S. Anne, CUT, Lt. Surge (see LEGS)."""
    return play(g, start='misty', to='surge', log=log, leg=leg)


# ---- Vermilion -> Erika (2026-10-11) --------------------------------------------------------
FLAG_BADGE04_GET = SYS_FLAGS + 0x23
ERIKA_AVOID = SAFFRON_AVOID + ('MAP_ROUTE7_EAST_ENTRANCE', 'MAP_ROUTE8_WEST_ENTRANCE')  # every Saffron gate is shut


def celadon_gym(g: World, tries: int = 3) -> bool:
    """Celadon's gym: the tree in the middle path (6,8) must be cut (it grows back on every reload), then the trainers
    in line, then Erika at the top."""
    from .world import clear_obstacle
    if g.map() != 'MAP_CELADON_CITY_GYM':
        # The gym sits behind a tree at (40,35) on the south path; it grows back on every reload, like Vermilion's.
        if not (g.travel('MAP_CELADON_CITY') and use_cut(g, (40, 35)) and g.travel('MAP_CELADON_CITY_GYM')):
            return False
        clear_obstacle('MAP_CELADON_CITY', (40, 35), cleared=False)
    if not use_cut(g, (6, 8)):
        return False
    g.walk_to(6, 5)
    lead = g.party()[0]
    if lead['hp'] < 0.9 * lead['max_hp']:  # heal before the leader; the trainers stay beaten
        if not (g.travel('MAP_CELADON_CITY') and use_cut(g, (40, 35)) and heal(g)):
            return False
        return celadon_gym(g, tries)
    return leader(g, 'OBJ_EVENT_GFX_ERIKA', FLAG_BADGE04_GET, celadon_gym, tries)


def route10(g: World) -> bool:
    if g.map() == 'MAP_VERMILION_CITY_GYM':  # still in the leader's room: the opened door is floor now
        from .world import clear_obstacle
        for cell in ((5, 6), (5, 7)):
            clear_obstacle('MAP_VERMILION_CITY_GYM', cell)
        g.walk_to(5, 9)
        g.travel('MAP_VERMILION_CITY')
    if g.map() == 'MAP_VERMILION_CITY' and g.pos()[1] >= 25:  # inside the gym's fence: the tree grew back
        use_cut(g, (19, 24))
    return journey(g, 'MAP_CERULEAN_CITY', 'MAP_VERMILION_CITY', ERIKA_AVOID) and heal(g) \
        and g.travel('MAP_ROUTE9', avoid=ERIKA_AVOID) and use_cut(g, (2, 8)) \
        and journey(g, 'MAP_ROUTE10', ('MAP_CERULEAN_CITY', 'MAP_ROUTE10'), ERIKA_AVOID) and heal(g)


def lavender(g: World) -> bool:
    return journey(g, 'MAP_LAVENDER_TOWN', ('MAP_ROUTE10', 'MAP_LAVENDER_TOWN'), ERIKA_AVOID) and heal(g)


def celadon(g: World) -> bool:
    return journey(g, 'MAP_CELADON_CITY', ('MAP_LAVENDER_TOWN', 'MAP_CELADON_CITY'), ERIKA_AVOID) and heal(g)


def to_erika(g: World, log=print, leg=None) -> dict:
    """After Lt. Surge: Route 9, Route 10, Rock Tunnel (dark: the planner doesn't mind), Lavender, Route 8, the
    east-west Underground Path, Route 7, Celadon, Erika (see LEGS)."""
    return play(g, start='surge', to='erika', log=log, leg=leg)


# ---- the route, leg by leg -------------------------------------------------------------------
# Every leg is a function of the world (plus `starter`, `seed`, `log` for the ones that need them). play() runs them
# in order; each one that passes is saved as build/sim/checkpoints/<run>/<leg>.state, so `python3 sim/leg.py <leg>`
# replays any single leg from the one before it in seconds instead of a run from power-on.
def with_ctx(fn):
    fn.with_ctx = True  # the leg takes (g, ctx) rather than (g)
    return fn


LEGS: list[tuple[str, object]] = [
    ('opening', with_ctx(lambda g, ctx: opening(g, ctx['starter'], title_wait=ctx['seed'] * 7))),
    ('rival', with_ctx(lambda g, ctx: rival(g, ctx['log']))),
    ('parcel', parcel), ('pokedex', pokedex), ('pewter', pewter), ('train_brock', train_for_brock), ('brock', brock),
    ('route4', route4), ('cerulean', cerulean), ('misty', misty),
    ('nugget', nugget), ('bill', bill_leg), ('vermilion', vermilion), ('ss_anne', lambda g: ss_anne(g) and heal(g)),
    ('cut', cut), ('surge', vermilion_gym),
    ('route10', route10), ('lavender', lavender), ('celadon', celadon), ('erika', celadon_gym),
]
LEG_NAMES = [n for n, _ in LEGS]
BADGE_FLAGS = (FLAG_BADGE01_GET, FLAG_BADGE02_GET, FLAG_BADGE03_GET, FLAG_BADGE04_GET)


def save_failure(g: World, name: str) -> None:
    """A screenshot, the state and what the planner had learned, so the failure can be looked at (sim/leg.py --at)."""
    import json
    CHECKPOINTS.mkdir(parents=True, exist_ok=True)
    g.screenshot(CHECKPOINTS / f'fail-{name}.png')
    save_checkpoint(g, f'fail-{name}')
    lead = g.party()[0] if g.party() else {}
    (CHECKPOINTS / f'fail-{name}.json').write_text(json.dumps({
        'map': g.map(), 'pos': g.pos(), 'frame': g.frame, 'free': g.free(), 'in_battle': g.in_battle(),
        'lead': {k: lead.get(k) for k in ('species', 'level', 'hp', 'max_hp', 'moves', 'pp')},
        'npcs': sorted(g.npc_tiles()), 'bumped': sorted(list(b) for b in g._bumped if b[0] == g.map()),
        'cleared': {m: sorted(c) for m, c in world.CLEARED.items()}, 'can_cut': world.CAN_CUT, 'battle_log': g.battle_log[-20:],
    }, indent=1, default=str))


def checkpoint_path(name: str) -> Path:
    return CHECKPOINTS / f'{name}.state'


def fresh_checkpoints(where: Path | None = None) -> bool:
    """Checkpoints belong to one ROM build. When the build changed, the old ones (and the browser fixtures beside
    them) are deleted and the stamp moves to this build: they come back by playing again. True if any were dropped."""
    where = where or CHECKPOINTS
    stamp = where / 'rom.txt'
    if not where.exists() or (stamp.exists() and stamp.read_text().strip() == rom_stamp()):
        return False
    stale = [p for p in where.iterdir() if p.is_file() and p.suffix in ('.state', '.raw', '.json', '.png')]
    for p in stale:
        p.unlink()
    stamp.write_text(rom_stamp())
    if stale:
        print(f'the ROM build changed: dropped {len(stale)} old checkpoints and fixtures in {where}', file=sys.stderr)
    return bool(stale)


def load_checkpoint(g: World, name: str) -> None:
    """Load the state saved after leg `name`. Checkpoints of another ROM build are dropped first (fresh_checkpoints),
    so a missing one means: play the legs before it (sim/leg.py does that by itself)."""
    fresh_checkpoints()
    path = checkpoint_path(name)
    if not path.exists():
        raise FileNotFoundError(f'no checkpoint {path}: run the legs before it first (sim/leg.py --to {name})')
    g.load_state(path.read_bytes())
    if g.party_moves(0).count(MOVE_CUT):
        world.CAN_CUT = True


def rom_stamp() -> str:
    from .game import ROM
    import hashlib
    return hashlib.sha1(Path(ROM).read_bytes()).hexdigest()[:12]


def play(g: World, to: str = 'erika', start: str | None = None, log=print, leg=None, starter: str = 'BULBASAUR', seed: int = 0) -> dict:
    """Run the legs after `start` (None: from power-on, the world as it is) through `to`. Each leg that passes is
    checkpointed; a failing leg is screenshotted and raises RuntimeError. `leg(name, fn)`: your own wrapper."""
    names = LEG_NAMES[(LEG_NAMES.index(start) + 1 if start else 0):LEG_NAMES.index(to) + 1]
    ctx = {'starter': starter, 'seed': seed, 'log': log}
    if leg is None:
        def leg(name, fn):
            ok = fn()
            lead = g.party()[0] if g.party() else {}
            log(f'{name:<14} {"ok " if ok else "FAIL"} frame {g.frame:>7} ({g.frame / 59.73 / 60:5.1f} game-min) '
                f'{g.map()} L{lead.get("level")} {lead.get("hp")}/{lead.get("max_hp")}')
            if not ok:
                save_failure(g, name)
                raise RuntimeError(f'leg {name} failed')
            save_checkpoint(g, name)
            (CHECKPOINTS / 'rom.txt').write_text(rom_stamp())
    for name, fn in LEGS:
        if name in names:
            leg(name, (lambda fn=fn: fn(g, ctx)) if getattr(fn, 'with_ctx', False) else (lambda fn=fn: fn(g)))
    return {'frames': g.frame, 'game_minutes': round(g.frame / 59.73 / 60, 1), 'party': g.party(),
            'badges': [g.flag(f) for f in BADGE_FLAGS]}
