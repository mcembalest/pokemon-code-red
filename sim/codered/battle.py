"""Battle policies and a trial runner for outcome distributions."""
from __future__ import annotations

import random

from .world import World

# Inputs a random policy may press during battle (no START/SELECT).
RANDOM_BUTTONS = ['A', 'A', 'A', 'B', 'UP', 'DOWN', 'LEFT', 'RIGHT']


def wait_for_battlers(g: World, limit: int = 1200) -> bool:
    return g.run_until(lambda: len(g.battlers()) >= 2 and g.battlers()[0]['max_hp'] > 0, limit, 5)


def fight(g: World, policy: str = 'first_move', seed: int = 0, limit: int = 60 * 60 * 10) -> dict:
    """Play the current battle to the end with a simple policy.

    first_move: always FIGHT -> first move (mash A)
    random:     random button presses (explores other moves/menus)
    """
    rng = random.Random(seed)
    wait_for_battlers(g)
    start_mon = g.battlers()
    end = lambda: g.battle_outcome() != 'ongoing'
    frames = 0
    while not end() and frames < limit:
        button = 'A' if policy == 'first_move' else rng.choice(RANDOM_BUTTONS)
        g.press(button, hold=3, after=7)
        frames += 10
    final = g.battlers()
    return {
        'policy': policy,
        'outcome': g.battle_outcome(),
        'player_hp': final[0]['hp'] if final else None,
        'player_max_hp': start_mon[0]['max_hp'] if start_mon else None,
        'enemy_hp': final[1]['hp'] if len(final) > 1 else None,
        'timed_out': not end(),
    }


def fight_first_move(g: World, seed: int) -> dict:
    return fight(g, 'first_move', seed)


def fight_random(g: World, seed: int) -> dict:
    return fight(g, 'random', seed)
