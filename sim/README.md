# sim — headless Code Red

Plays the real ROM at full speed through the same mGBA core the browser uses (built natively).
Reads game state from RAM by symbol, decides from decomp data (maps, collision, tile attributes,
move table + type chart read from the ROM). No memory edits except Options-menu settings
(fast text, battle style SET, scene off) and RNG reseeding for branches.

```sh
make build && sim/build_core.sh            # ROM + native core
python3 sim/run.py misty --trace           # power-on -> Misty, prints each leg
python3 sim/run.py misty --seed 3          # a different RNG branch
```

Last full run (this workspace, 1 core): power-on -> BADGE02 in 94 game-minutes, 6.6 min wall (~14x).

## Layout
- `codered/game.py` — libretro wrapper: run/press, save/load state, RAM, screenshot, reseed, trace
- `codered/world.py` — FireRed state (map, pos, flags, vars, bag, party moves), map data from decomp,
  pathfinding (collision, ledges, NPCs, learned bumps), region routing across warps/edges, `handle()`
- `codered/battle.py` — reads menus from RAM (controller funcs), best move by power x type x STAB,
  run from wild when low, move-learning, stall watchdog
- `codered/routes.py` — scripted legs + checkpoints (`build/sim/checkpoints/`), heal, grind, journey,
  boss prep, `to_misty()`
- `codered/parallel.py` — fork one state into N reseeded branches across processes

## Story gates the data can't express (encoded in routes.py)
- Diglett's Cave is avoided before Cut
- Mt. Moon B2F: trigger Miguel at (14,11), take the Dome Fossil, he steps aside
- First rival battle uses the Oak tutorial controller

## CI
`.github/workflows/sim.yml`: 6 seeds in parallel on push to sim/patches/core and nightly;
each job annotates badges / game-minutes / speed or the failing leg.
