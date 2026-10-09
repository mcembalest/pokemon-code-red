#!/usr/bin/env python3
"""The PokÉEG in the real ROM (patches/008-pokeeg.patch): from the lab checkpoint take CHARMANDER, go home,
open the bedroom PC → PokÉEG. With no host the mind lines say so; with a mock host (this script) the
mailbox is answered the way the page will: readers, Pokédex, budget, focus, last turns, hot memory.

  python3 sim/experiments/pokeeg.py

Writes build/sim/results/pokeeg.json + screenshots; exits 1 on a failed check.
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from codered import World
from codered.game import ROOT
from codered.routes import CHECKPOINTS, intro, to_lab, choose_starter
from codered.eeg import EegHost, encode_text

OUT = ROOT / 'build/sim/results'
SHOTS = ROOT / 'build/sim/shots'


def to_bedroom_pc(g: World) -> bool:
    for dest in ('MAP_PALLET_TOWN', 'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F', 'MAP_PALLET_TOWN_PLAYERS_HOUSE_2F'):
        if not g.warp_to(dest):
            return False
    return g.walk_to(1, 2)


def open_eeg(g: World) -> bool:
    """At the bedroom PC: A → top menu (ITEM STORAGE, MAILBOX, PokÉEG, Code, TURN OFF) → PokÉEG."""
    g.interact('UP')
    g.run(120)  # "RED booted up the PC."
    g.press('A'); g.run(90)  # "What would you like to do?" + the top menu
    g.press('DOWN', after=8); g.press('DOWN', after=8); g.press('A')
    return g.run_until(lambda: g.u8(g.sym('gCodeRedEeg') + 0x17) == 1, limit=900)  # open flag


def main():
    OUT.mkdir(parents=True, exist_ok=True); SHOTS.mkdir(parents=True, exist_ok=True)
    g = World()
    assert intro(g) and to_lab(g), 'opening'
    assert choose_starter(g, 'CHARMANDER'), 'starter'
    assert to_bedroom_pc(g), 'home'
    at_pc = g.save_state()
    results = {}

    # 1. No host: the list shows CHARMANDER; the mind says to open the page.
    assert open_eeg(g), 'PokÉEG did not open'
    g.run(400)
    g.screenshot(SHOTS / 'pokeeg-nohost.png')
    eeg = g.sym('gCodeRedEeg')
    results['nohost'] = {'species': g.u16(eeg + 0x14), 'level': g.u8(eeg + 0x16), 'state': g.u8(eeg + 6)}
    assert results['nohost']['species'] == 4 and results['nohost']['state'] == 0, results  # CHARMANDER, request timed out and cleared
    g.press('B'); g.run(120)
    assert g.u8(eeg + 0x17) == 0, 'open flag must clear on exit'

    # 2. Mock host answers like the page will.
    g.load_state(at_pc)
    g.run = type(g).run.__get__(g)
    host = EegHost(g, lambda r: {'readers': 2, 'dex': 3, 'budget': 350, 'focus': 80, 'history': [1, 1, 0, 1, 1],
                                 'format': 'write log', 'hot': 'return a plain number', 'readers_text': 'Water, Rock', 'dex_text': 'Normal, Rock, Ground'})
    host.attach(); host.enable()
    assert open_eeg(g), 'PokÉEG did not open (host)'
    g.run(120)
    g.screenshot(SHOTS / 'pokeeg-host.png')
    results['host'] = {'requests': [r['op'] for r in host.requests], 'personality': host.requests[0]['personality'] if host.requests else None}
    assert host.requests and host.requests[0]['op'] == 1, results
    # R steps through the tabs: SYSTEM → READERS → CODE → NOTE; a screenshot of each.
    for tab in ('readers', 'code', 'note'):
        g.press('RIGHT'); g.run(20)
        g.screenshot(SHOTS / f'pokeeg-tab-{tab}.png')
    # A on the NOTE tab → the game asks the page to edit (op 2); the host replies with a new note.
    host.hot_reply = 'be brave'
    g.press('A'); g.run(200)
    g.screenshot(SHOTS / 'pokeeg-edited.png')
    results['edit'] = [r['op'] for r in host.requests]
    assert results['edit'] == [1, 2, 1], results  # summary, edit, summary again
    g.press('B'); g.run(120)
    (OUT / 'pokeeg.json').write_text(json.dumps(results, indent=1))
    print(json.dumps(results))


if __name__ == '__main__':
    main()
