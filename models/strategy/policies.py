"""Who picks the moves. A policy = f(battle, side, rng) -> move index.

  random       any move with PP
  firered      rough FireRed trainer AI (CHECK_BAD_MOVE + TRY_TO_FAINT + CHECK_VIABILITY): KO if it can,
               else mostly the strongest hit, sometimes a status move; never a useless status move
  power        always the hardest-hitting move (what a new player does), ignores the code
  code         hardest *expected* hit: P(code right) x accuracy x damage (knows its coding odds)
  search       rollouts: for each move, play the battle out N times with `code` for both sides; best win rate
               (a stand-in for the Jaxcalibur-style planner; no training)
"""
from __future__ import annotations
import copy, random
from engine import MOVES, STAT_EFFECTS, accuracy, code_odds, expected_damage


def random_policy(b, s, rng):
    return rng.choice(b.legal(s))


def _useless(b, s, i):
    att, dfn = b.mon(s), b.mon(1 - s)
    eff = MOVES[att.moves[i]]['effect']
    if eff in STAT_EFFECTS:
        who, st, d = STAT_EFFECTS[eff]
        m = att if who == 'self' else dfn
        v = m.stages['def_' if st == 'def' else st]
        return (d > 0 and v >= 6) or (d < 0 and v <= -6)
    if eff in ('SLEEP', 'POISON', 'PARALYZE', 'TOXIC') and dfn.status: return True
    if eff == 'LEECH_SEED' and (dfn.seeded or 'GRASS' in dfn.types): return True
    if eff == 'RESTORE_HP' and att.hp == att.stats['hp']: return True
    if eff == 'TELEPORT': return True
    return False


def firered_policy(b, s, rng):
    att, dfn = b.mon(s), b.mon(1 - s)
    legal = [i for i in b.legal(s) if i < 0 or not _useless(b, s, i)] or b.legal(s)
    if legal == [-1]: return -1
    dmg = {i: expected_damage(att, dfn, att.moves[i]) for i in legal}
    kos = [i for i in legal if dmg[i] * 1.08 >= dfn.hp and dmg[i] > 0]
    if kos and rng.random() < 0.8: return max(kos, key=lambda i: accuracy(att, dfn, att.moves[i]))
    hits = [i for i in legal if dmg[i] > 0]
    status = [i for i in legal if dmg[i] == 0]
    if status and (not hits or rng.random() < 0.25): return rng.choice(status)
    best = max(dmg[i] for i in hits)
    near = [i for i in hits if dmg[i] >= 0.8 * best]
    return rng.choice(near)


def power_policy(b, s, rng):
    att, dfn = b.mon(s), b.mon(1 - s)
    legal = b.legal(s)
    if legal == [-1]: return -1
    return max(legal, key=lambda i: (expected_damage(att, dfn, att.moves[i]), rng.random()))


def code_policy(b, s, rng):
    att, dfn = b.mon(s), b.mon(1 - s)
    legal = b.legal(s)
    if legal == [-1]: return -1
    fmts = dfn.formats()
    def value(i):
        k = att.moves[i]
        p = sum(code_odds(b.code.p(k, att, dfn, f), att.notch if b.code_effects != 'off' else 0) for f in fmts) / len(fmts) if b.code_on else 1.0
        return p * accuracy(att, dfn, k) * expected_damage(att, dfn, k)
    vals = {i: value(i) for i in legal}
    if max(vals.values()) <= 0:  # nothing hurts: a useful status move
        useful = [i for i in legal if not _useless(b, s, i)]
        return rng.choice(useful or legal)
    return max(legal, key=lambda i: (vals[i], rng.random()))


def make_search(rollouts=24, horizon=40, default=code_policy, opponent=None):
    """Monte Carlo planner: try each legal move now, then both sides play `default` (or `opponent` for the foe).
    Value of a rollout = win (1/0) + 0.5 x (my HP left - their HP left, as party fractions): prefers winning
    with more HP and faster, which breaks the ties a plain win/loss gives when every move wins.
    Ties go to the default policy's own pick. Common random numbers across moves cut the noise."""
    def search_policy(b, s, rng):
        legal = b.legal(s)
        if len(legal) == 1: return legal[0]
        opp = opponent or default
        seeds = [rng.random() for _ in range(rollouts)]
        pick = default(b, s, random.Random(seeds[0]))
        best, best_v = pick, -1e9
        for i in legal:
            total = 0.0
            for sd in seeds:
                sim = copy.deepcopy(b); sim.log = None
                sim.rng = random.Random(sd)
                first = True
                while not sim.over() and sim.turns < b.turns + horizon:
                    a = i if first else default(sim, s, sim.rng)
                    o = opp(sim, 1 - s, sim.rng)
                    ch = [0, 0]; ch[s] = a; ch[1 - s] = o
                    sim.step(ch); first = False
                mine = sum(max(0, m.hp) / m.stats['hp'] for m in sim.side[s]) / len(sim.side[s])
                theirs = sum(max(0, m.hp) / m.stats['hp'] for m in sim.side[1 - s]) / len(sim.side[1 - s])
                total += (sim.winner() == s) + 0.5 * (mine - theirs)
            v = total / rollouts + (1e-6 if i == pick else 0)
            if v > best_v: best, best_v = i, v
        return best
    return search_policy


POLICIES = {'random': random_policy, 'firered': firered_policy, 'power': power_policy, 'code': code_policy}
