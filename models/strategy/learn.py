#!/usr/bin/env python3
"""A tiny decision network, Jaxcalibur-style but small: each move is a token of features; a shared MLP scores
each move (policy) and a pooled head guesses the win chance (value). Trained by policy gradient (REINFORCE with
the value as baseline) against a mix of opponents, on random pre-Misty matchups. The code check stays in the
environment: the net sees each move's coding odds as a feature, so it learns to weigh the code brain's
reliability against power.

  python3 models/strategy/learn.py --battles 60000 --mode add --out build/strategy/net-add.npz
"""
from __future__ import annotations
import argparse, json, math, random, sys, time
from pathlib import Path
import numpy as np
import jax, jax.numpy as jnp
sys.path.insert(0, str(Path(__file__).parent))
from engine import DATA, MOVES, STAT_EFFECTS, Battle, Mon, accuracy, code_odds, expected_damage, party
from policies import POLICIES, _useless
from arena import code_model

CATS = ['hit', 'stat_self', 'stat_foe', 'status', 'heal', 'trap', 'other']
F = 25  # features per move token


def move_cat(eff):
    if eff in STAT_EFFECTS: return 'stat_self' if STAT_EFFECTS[eff][0] == 'self' else 'stat_foe'
    if eff in ('SLEEP', 'POISON', 'PARALYZE', 'TOXIC', 'CONFUSE', 'LEECH_SEED'): return 'status'
    if eff == 'RESTORE_HP': return 'heal'
    if eff == 'TRAP': return 'trap'
    return 'hit' if MOVES and eff not in ('SPLASH', 'TELEPORT') else 'other'


def features(b, s):
    """[4, F] move tokens + mask. Battle context is broadcast into every token."""
    att, dfn = b.mon(s), b.mon(1 - s)
    ctx = [att.hp / att.stats['hp'], dfn.hp / dfn.stats['hp'], float(att.eff('spe') > dfn.eff('spe')),
           att.notch / 2, dfn.notch / 2, sum(att.stages.values()) / 12, sum(dfn.stages.values()) / 12,
           float(att.status is not None), float(dfn.status is not None),
           sum(1 for m in b.side[1 - s] if not m.fainted()) / 3]
    # the foe's threat: its best expected hit on me, with its coding odds (what code-focus moves change)
    mine = att.formats()
    threat, foe_code = 0.0, 0.0
    for j, k in enumerate(dfn.moves):
        if dfn.pp[j] <= 0: continue
        pc = sum(code_odds(b.code.p(k, dfn, att, f), dfn.notch) for f in mine) / len(mine)
        t = pc * accuracy(dfn, att, k) * expected_damage(dfn, att, k) / max(1, att.hp)
        if t > threat: threat, foe_code = t, pc
    ctx += [min(threat, 2.0), foe_code, float(threat >= 1.0)]
    X = np.zeros((4, F), np.float32); mask = np.zeros(4, bool)
    fmts = dfn.formats()
    for i, k in enumerate(att.moves[:4]):
        if att.pp[i] <= 0: continue
        mask[i] = True
        mv = MOVES[k]
        p = sum(code_odds(b.code.p(k, att, dfn, f), att.notch) for f in fmts) / len(fmts)
        acc = accuracy(att, dfn, k)
        d = expected_damage(att, dfn, k) / max(1, dfn.hp)
        cat = move_cat(mv['effect'])
        X[i, :3] = [p, acc, min(d, 2.0)]
        X[i, 3] = float(d >= 1.0)
        X[i, 4] = float(_useless(b, s, i))
        X[i, 5 + CATS.index(cat)] = 1
        X[i, 12:25] = ctx
    if not mask.any(): mask[0] = True
    return X, mask


def init(key, h=32):
    k1, k2, k3, k4 = jax.random.split(key, 4)
    g = lambda k, a, b: jax.random.normal(k, (a, b)) * math.sqrt(2 / a)
    return {'w1': g(k1, F, h), 'b1': jnp.zeros(h), 'w2': g(k2, h, h), 'b2': jnp.zeros(h), 'wp': g(k3, h, 1) * 0.1, 'wv': g(k4, h, 1) * 0.1, 'bv': jnp.zeros(1)}


def forward(P, X, mask):
    h = jax.nn.relu(X @ P['w1'] + P['b1'])
    h = jax.nn.relu(h @ P['w2'] + P['b2'])
    logits = (h @ P['wp'])[..., 0]
    logits = jnp.where(mask, logits, -1e9)
    pooled = jnp.sum(h * mask[..., None], -2) / jnp.maximum(1, mask.sum(-1, keepdims=True))
    value = jax.nn.sigmoid((pooled @ P['wv'] + P['bv'])[..., 0])
    return logits, value


@jax.jit
def act_probs(P, X, mask):
    logits, value = forward(P, X, mask)
    return jax.nn.softmax(logits), value


def loss(P, X, mask, a, ret, ent=0.01):
    logits, value = forward(P, X, mask)
    logp = jax.nn.log_softmax(logits)
    adv = ret - jax.lax.stop_gradient(value)
    lp = jnp.take_along_axis(logp, a[:, None], 1)[:, 0]
    probs = jnp.exp(logp)
    entropy = -jnp.sum(jnp.where(mask, probs * logp, 0), -1)
    return -jnp.mean(lp * adv) + 0.5 * jnp.mean((ret - value) ** 2) - ent * jnp.mean(entropy)


grad = jax.jit(jax.grad(loss))


def net_policy(P, greedy=True):
    def pol(b, s, rng):
        X, mask = features(b, s)
        pr, _ = act_probs(P, jnp.asarray(X), jnp.asarray(mask))
        pr = np.asarray(pr)
        i = int(pr.argmax()) if greedy else int(rng.choices(range(4), weights=pr)[0])
        return i if i < len(b.mon(s).moves) and b.mon(s).pp[i] > 0 else b.legal(s)[0]
    return pol


POOL = None
def random_matchup(rng):
    """Player: a starter or a route mon at 5-21; foe: a trainer party from before Misty, or a wild mon."""
    global POOL
    if POOL is None:
        names = ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'PIDGEY', 'RATTATA', 'SPEAROW', 'MANKEY', 'CATERPIE', 'METAPOD', 'BUTTERFREE', 'WEEDLE', 'KAKUNA',
                 'PIKACHU', 'NIDORAN_F', 'NIDORAN_M', 'JIGGLYPUFF', 'ZUBAT', 'GEODUDE', 'PARAS', 'CLEFAIRY', 'EKANS', 'SANDSHREW', 'ODDISH', 'IVYSAUR', 'CHARMELEON', 'WARTORTLE', 'PIDGEOTTO']
        POOL = [n for n in names if n in DATA['species']]
    lv = rng.randint(6, 21)
    me = [Mon(rng.choice(POOL), lv, rng.randint(0, 31))]
    if rng.random() < 0.3:
        foe = [Mon(rng.choice(POOL), max(3, lv + rng.randint(-4, 3)), rng.randint(0, 31))]
    else:
        t = rng.choice(['LEADER_BROCK', 'LEADER_MISTY', 'RIVAL_CERULEAN_SQUIRTLE', 'RIVAL_CERULEAN_BULBASAUR', 'RIVAL_CERULEAN_CHARMANDER', 'CAMPER_LIAM'])
        foe = party(DATA['trainers'][t]['party'])
        me = [Mon(me[0].species, max(lv, max(m.level for m in foe) + rng.randint(-2, 3)), me[0].iv)]
    for m in me: m.known = set(rng.sample(sorted({t for f in foe for t in f.formats()}), k=rng.randint(0, 1)))
    return me, foe


def train(a):
    rng = random.Random(a.seed)
    code = code_model()
    P = init(jax.random.PRNGKey(a.seed))
    opt_m = jax.tree_util.tree_map(jnp.zeros_like, P); opt_v = jax.tree_util.tree_map(jnp.zeros_like, P); t = 0
    opponents = [POLICIES['firered'], POLICIES['code'], POLICIES['power']]
    buf, wins, log = [], [], []
    t0 = time.time()
    for ep in range(a.battles):
        me, foe = random_matchup(rng)
        bt = Battle(me, foe, code, rng, code_effects=a.mode)
        opp = rng.choice(opponents) if rng.random() > a.selfplay else net_policy(P, greedy=False)
        traj = []
        while not bt.over() and bt.turns < 60:
            X, mask = features(bt, 0)
            pr, _ = act_probs(P, jnp.asarray(X), jnp.asarray(mask))
            i = int(rng.choices(range(4), weights=np.asarray(pr))[0])
            traj.append((X, mask, i))
            bt.step([i if bt.mon(0).pp[i] > 0 else bt.legal(0)[0], opp(bt, 1, rng)])
        r = 1.0 if bt.winner() == 0 else 0.0
        wins.append(r)
        buf += [(X, m, i, r) for X, m, i in traj]
        if len(buf) >= a.batch:
            X = jnp.asarray(np.stack([x[0] for x in buf])); M = jnp.asarray(np.stack([x[1] for x in buf]))
            A = jnp.asarray([x[2] for x in buf]); R = jnp.asarray([x[3] for x in buf], jnp.float32)
            g = grad(P, X, M, A, R)
            t += 1
            opt_m = jax.tree_util.tree_map(lambda m, g: 0.9 * m + 0.1 * g, opt_m, g)
            opt_v = jax.tree_util.tree_map(lambda v, g: 0.999 * v + 0.001 * g * g, opt_v, g)
            P = jax.tree_util.tree_map(lambda p, m, v: p - a.lr * (m / (1 - 0.9 ** t)) / (jnp.sqrt(v / (1 - 0.999 ** t)) + 1e-8), P, opt_m, opt_v)
            buf = []
        if (ep + 1) % 2000 == 0:
            w = sum(wins[-2000:]) / 2000
            log.append({'battles': ep + 1, 'win_rate_train': round(w, 3), 's': round(time.time() - t0)})
            print(json.dumps(log[-1]), flush=True)
    out = Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
    np.savez(out, **{k: np.asarray(v) for k, v in P.items()})
    (out.with_suffix('.json')).write_text(json.dumps({'args': vars(a), 'log': log}, indent=1))
    return P


def load(path):
    d = np.load(path)
    return {k: jnp.asarray(d[k]) for k in d.files}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--battles', type=int, default=40000)
    ap.add_argument('--batch', type=int, default=2048)
    ap.add_argument('--lr', type=float, default=3e-3)
    ap.add_argument('--mode', default='off')
    ap.add_argument('--selfplay', type=float, default=0.3)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--out', default='build/strategy/net.npz')
    train(ap.parse_args())
