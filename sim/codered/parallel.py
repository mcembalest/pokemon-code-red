"""Fork one saved state into many branches across processes.

    from codered.parallel import branches
    results = branches(state_bytes, my_trial, seeds=range(1000), workers=8)

`my_trial(game, seed) -> dict` must be a top-level (picklable) function.
Each branch starts from the same state with the game's RNG reseeded, so the
only differences are the seed and whatever the trial does with it.
"""
from __future__ import annotations

import multiprocessing as mp
import os
import time
from typing import Callable, Iterable

_game = None
_base = None


def _init(state: bytes) -> None:
    global _game, _base
    from .world import World
    _game = World()
    _base = state


def _one(job):
    trial, seed = job
    _game.load_state(_base)
    _game.reseed(seed)
    start = _game.frame
    t = time.perf_counter()
    out = trial(_game, seed)
    out.setdefault('seed', seed)
    out['frames'] = _game.frame - start
    out['wall_s'] = round(time.perf_counter() - t, 3)
    return out


def branches(state: bytes, trial: Callable, seeds: Iterable[int], workers: int | None = None) -> list[dict]:
    workers = workers or os.cpu_count() or 1
    ctx = mp.get_context('spawn')
    with ctx.Pool(workers, initializer=_init, initargs=(state,)) as pool:
        return pool.map(_one, [(trial, s) for s in seeds], chunksize=1)
