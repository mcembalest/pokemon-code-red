#!/usr/bin/env python3
"""Save-state fixtures for browser tests. The simulator and the browser run the
same mGBA core, so these load in the page via EJS gameManager.loadState(bytes).
Raw libretro states (no sim frame suffix) in build/sim/checkpoints/*.raw. Private:
states hold game RAM; never publish.

  python3 sim/make_states.py            # all fixtures
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from codered.world import World
from codered import routes
from codered.battle import Battle

OUT = Path(__file__).resolve().parents[1] / 'build/sim/checkpoints'


def rival_choose_action(g: World) -> bool:
    """First rival battle (CHARMANDER vs SQUIRTLE), at the FIGHT/BAG menu."""
    return routes.opening(g, 'CHARMANDER') and g.mash(Battle(g).choosing_action, 'A', limit=6000, period=20)


def lab_at_charmander(g: World) -> bool:
    """Oak's lab, free to move, facing CHARMANDER's ball (press A to be offered it)."""
    if not (routes.intro(g) and routes.to_lab(g) and g.walk_to(routes.STARTER_BALLS['CHARMANDER'], 5)):
        return False
    g.face('UP')
    return True


FIXTURES = {'rival_choose_action': rival_choose_action, 'lab_at_charmander': lab_at_charmander}

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    g = World()
    boot = g.save_state()
    for name, make in FIXTURES.items():
        g.load_state(boot)
        if not make(g):
            sys.exit(f'fixture {name} failed (map={g.map()} frame={g.frame})')
        (OUT / f'{name}.raw').write_bytes(g.save_state()[:-8])
        print(f'{name}: frame {g.frame}')
