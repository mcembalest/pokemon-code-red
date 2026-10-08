"""A fast, simplified FireRed (Gen 3) singles battle engine with Code Red's rule on top.

Code Red rule: before a move's normal FireRed resolution, the attacker's code must be right:
P(code hit) comes from the real model's measured rates (lab move table), by move and by whether
the attacker knows how to read the target's format. A code miss fails the move completely.

Covers what matters before Misty: Gen 3 damage (physical/special by type, STAB, type chart, crits,
random roll, burn), accuracy/evasion stages, stat-stage moves, sleep/poison/paralysis/burn/confusion,
flinch, trapping, Leech Seed, Recover, multi-hit, drain, fixed damage, the starters' pinch abilities,
Sturdy/Rock Head trivia ignored. Not covered: items, weather, switching AI, double battles.
"""
from __future__ import annotations
import json, math, random
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).parent
DATA = json.loads((HERE / 'kanto.json').read_text())
CODERED = json.loads((HERE / 'codered-moves.json').read_text())
SPECIES, MOVES = DATA['species'], DATA['moves']
CHART = {(a, d): m / 10 for a, d, m in DATA['chart']}
PHYSICAL = {'NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST', 'STEEL'}
FORMATS = {'NORMAL', 'FLYING', 'WATER', 'GRASS', 'ROCK', 'ELECTRIC', 'GROUND', 'FIRE', 'POISON', 'BUG', 'PSYCHIC', 'FIGHTING', 'STEEL'}
STAGE = [2 / 8, 2 / 7, 2 / 6, 2 / 5, 2 / 4, 2 / 3, 1, 3 / 2, 4 / 2, 5 / 2, 6 / 2, 7 / 2, 8 / 2]
ACC_STAGE = [33 / 100, 36 / 100, 43 / 100, 50 / 100, 60 / 100, 75 / 100, 1, 133 / 100, 166 / 100, 2, 233 / 100, 133 / 50, 3]
PINCH = {'BLAZE': 'FIRE', 'TORRENT': 'WATER', 'OVERGROW': 'GRASS', 'SWARM': 'BUG'}

# stat-stage effects: effect -> (target 'self'|'foe', stat, delta)
STAT_EFFECTS = {
    'ATTACK_UP': ('self', 'atk', 1), 'DEFENSE_UP': ('self', 'def', 1), 'SPEED_UP': ('self', 'spe', 1), 'SPECIAL_ATTACK_UP': ('self', 'spa', 1),
    'EVASION_UP': ('self', 'eva', 1), 'ATTACK_UP_2': ('self', 'atk', 2), 'DEFENSE_UP_2': ('self', 'def', 2), 'SPEED_UP_2': ('self', 'spe', 2),
    'SPECIAL_DEFENSE_UP_2': ('self', 'spd', 2), 'DEFENSE_CURL': ('self', 'def', 1), 'MINIMIZE': ('self', 'eva', 1),
    'ATTACK_DOWN': ('foe', 'atk', -1), 'DEFENSE_DOWN': ('foe', 'def', -1), 'SPEED_DOWN': ('foe', 'spe', -1), 'ACCURACY_DOWN': ('foe', 'acc', -1),
    'EVASION_DOWN': ('foe', 'eva', -1), 'ATTACK_DOWN_2': ('foe', 'atk', -2), 'DEFENSE_DOWN_2': ('foe', 'def', -2), 'SPEED_DOWN_2': ('foe', 'spe', -2),
    'SPECIAL_DEFENSE_DOWN_2': ('foe', 'spd', -2), 'TICKLE': ('foe', 'atk', -1),
}
HIT_EFFECTS = {  # damaging move + chance of a secondary effect
    'BURN_HIT': ('status', 'brn'), 'PARALYZE_HIT': ('status', 'par'), 'POISON_HIT': ('status', 'psn'), 'FREEZE_HIT': ('status', 'par'),
    'FLINCH_HIT': ('flinch',), 'CONFUSE_HIT': ('confuse',), 'SPEED_DOWN_HIT': ('stat', 'foe', 'spe', -1), 'ATTACK_DOWN_HIT': ('stat', 'foe', 'atk', -1),
    'DEFENSE_DOWN_HIT': ('stat', 'foe', 'def', -1), 'SPECIAL_DEFENSE_DOWN_HIT': ('stat', 'foe', 'spd', -1), 'ACCURACY_DOWN_HIT': ('stat', 'foe', 'acc', -1),
    'ATTACK_UP_HIT': ('stat', 'self', 'atk', 1), 'DEFENSE_UP_HIT': ('stat', 'self', 'def', 1), 'TRAP': ('trap',), 'ABSORB': ('drain',),
}


def stat(base, level, iv, hp=False):
    return (2 * base + iv) * level // 100 + (level + 10 if hp else 5)


def default_moves(species, level):
    """FireRed: a trainer/wild mon knows the last 4 level-up moves at its level."""
    seen = []
    for l, m in SPECIES[species]['learnset']:
        if l <= level and m not in seen: seen.append(m)
    return seen[-4:]


@dataclass
class Mon:
    species: str
    level: int
    iv: int = 15
    moves: list = None
    hp: int = 0
    stats: dict = field(default_factory=dict)
    stages: dict = field(default_factory=lambda: dict(atk=0, def_=0, spa=0, spd=0, spe=0, acc=0, eva=0))
    status: str | None = None
    sleep: int = 0
    confused: int = 0
    trapped: int = 0
    seeded: bool = False
    flinch: bool = False
    crit_up: bool = False
    known: set = field(default_factory=set)  # formats this mon can read (memory + Pokédex)
    code_stage: int = 0  # Code Red idea under test: status moves that hit the foe's code (focus), -6..6

    def __post_init__(self):
        b = SPECIES[self.species]['base']
        self.stats = {'hp': stat(b[0], self.level, self.iv, True), 'atk': stat(b[1], self.level, self.iv), 'def': stat(b[2], self.level, self.iv),
                      'spe': stat(b[3], self.level, self.iv), 'spa': stat(b[4], self.level, self.iv), 'spd': stat(b[5], self.level, self.iv)}
        self.hp = self.hp or self.stats['hp']
        self.moves = list(self.moves or default_moves(self.species, self.level))
        self.pp = [MOVES[m]['pp'] for m in self.moves]
        self.types = SPECIES[self.species]['types']
        self.ability = SPECIES[self.species]['abilities'][0]

    def eff(self, s):
        key = 'def_' if s == 'def' else s
        v = self.stats[s] * STAGE[self.stages[key] + 6]
        if s == 'spe' and self.status == 'par': v /= 4
        return max(1, int(v))

    def stage(self, s, d):
        key = 'def_' if s == 'def' else s
        old = self.stages[key]
        self.stages[key] = max(-6, min(6, old + d))
        return self.stages[key] != old

    def formats(self):
        return [t if t in FORMATS else 'NORMAL' for t in dict.fromkeys(self.types)]

    def fainted(self): return self.hp <= 0


class CodeModel:
    """P(code hit) per Code Red move, first time vs known reader (lab move table), with defaults."""
    def __init__(self, table: dict | None = None, first=0.70, known=0.94, scale=1.0):
        self.table, self.first, self.known, self.scale = table or {}, first, known, scale

    def p(self, move_key, attacker: Mon, target: Mon, fmt: str):
        name = CODERED.get(move_key, {}).get('name')
        row = self.table.get(name)
        known = fmt in attacker.known
        if row:
            base = row['known'] if known else row['first']
        else:
            base = self.known if known else self.first
        return max(0.0, min(1.0, base * self.scale))


def code_odds(p, stage):
    """Shift P(code right) by focus stages: each stage moves the log-odds by 0.4."""
    if stage == 0 or p <= 0 or p >= 1: return p if stage == 0 or p <= 0 else (p if stage > 0 else 1 / (1 + math.exp(-(4.6 + 0.4 * stage))))
    z = math.log(p / (1 - p)) + 0.4 * stage
    return 1 / (1 + math.exp(-z))


def type_mult(mtype, target: Mon):
    m = 1.0
    for t in dict.fromkeys(target.types):
        m *= CHART.get((mtype, t), 1.0)
    return m


def damage(att: Mon, dfn: Mon, key, rng: random.Random, crit=None, roll=None):
    mv = MOVES[key]
    power = mv['power']
    if mv['effect'] == 'DRAGON_RAGE': return 40, False
    if mv['effect'] == 'SONICBOOM': return 20, False
    if mv['effect'] == 'LEVEL_DAMAGE': return att.level, False
    if power <= 1: return 0, False
    t = mv['type']
    if PINCH.get(att.ability) == t and att.hp * 3 <= att.stats['hp']: power = power * 3 // 2
    phys = t in PHYSICAL
    a, d = (att.eff('atk'), dfn.eff('def')) if phys else (att.eff('spa'), dfn.eff('spd'))
    if crit is None:
        crit = rng.random() < (1 / 8 if mv['effect'] == 'HIGH_CRITICAL' or att.crit_up else 1 / 16)
    if crit:  # crits ignore the attacker's drops and the defender's boosts
        a = max(a, att.stats['atk' if phys else 'spa']); d = min(d, dfn.stats['def' if phys else 'spd'])
    base = (2 * att.level // 5 + 2) * power * a // d // 50
    if phys and att.status == 'brn': base //= 2
    base += 2
    if crit: base *= 2
    if t in att.types: base = base * 3 // 2
    base = int(base * type_mult(t, dfn))
    if base == 0: return 0, crit
    r = roll if roll is not None else rng.randint(85, 100)
    return max(1, base * r // 100), crit


def expected_damage(att, dfn, key):
    """Mean damage of one landed hit (no crit, average roll)."""
    d, _ = damage(att, dfn, key, None, crit=False, roll=92)
    eff = MOVES[key]['effect']
    if eff == 'MULTI_HIT': d *= 3
    if eff == 'DOUBLE_HIT': d *= 2
    return d


def accuracy(att, dfn, key):
    mv = MOVES[key]
    if mv['effect'] in ('ALWAYS_HIT',) or mv['acc'] == 0: return 1.0
    st = max(-6, min(6, att.stages['acc'] - dfn.stages['eva']))
    return min(1.0, mv['acc'] / 100 * ACC_STAGE[st + 6])


class Battle:
    """One trainer's party vs another's, singles, no switching (the next mon comes in on a faint)."""
    def __init__(self, a: list[Mon], b: list[Mon], code: CodeModel, rng: random.Random, code_on=True, log=False, code_effects='off'):
        self.side = [a, b]; self.active = [0, 0]; self.code, self.rng, self.code_on = code, rng, code_on
        self.code_effects = code_effects  # 'off' | 'add' (stat moves also move code focus) | 'replace' (they only move code focus)
        self.turns = 0; self.log = [] if log else None
        self.stats = {'code_miss': [0, 0], 'moves': [0, 0]}

    def mon(self, s): return self.side[s][self.active[s]]

    def say(self, *a):
        if self.log is not None: self.log.append(' '.join(str(x) for x in a))

    def over(self):
        return any(all(m.fainted() for m in party) for party in self.side)

    def winner(self):
        if all(m.fainted() for m in self.side[1]): return 0
        if all(m.fainted() for m in self.side[0]): return 1
        return None

    def legal(self, s):
        m = self.mon(s)
        return [i for i, p in enumerate(m.pp) if p > 0] or [-1]  # -1 = Struggle

    def step(self, choice):
        """choice = [move index side 0, move index side 1]."""
        self.turns += 1
        order = [0, 1]
        def pri(s): return MOVES[self.mon(s).moves[choice[s]]]['priority'] if choice[s] >= 0 else 0
        k0, k1 = (pri(0), self.mon(0).eff('spe')), (pri(1), self.mon(1).eff('spe'))
        if k1 > k0 or (k1 == k0 and self.rng.random() < 0.5): order = [1, 0]
        for s in order:
            if self.over(): break
            self.act(s, choice[s])
        for s in (0, 1): self.end_of_turn(s)
        for s in (0, 1):
            self.mon(s).flinch = False
            if self.mon(s).fainted():
                nxt = [i for i, m in enumerate(self.side[s]) if not m.fainted()]
                if nxt: self.active[s] = nxt[0]

    def act(self, s, i):
        att, dfn, rng = self.mon(s), self.mon(1 - s), self.rng
        if att.fainted(): return
        if att.status == 'slp':
            att.sleep -= 1
            if att.sleep > 0: return self.say(s, 'asleep')
            att.status = None
        if att.flinch: return self.say(s, 'flinched')
        if att.confused:
            att.confused -= 1
            if rng.random() < 0.5:
                d = (2 * att.level // 5 + 2) * 40 * att.eff('atk') // att.eff('def') // 50 + 2
                att.hp -= d; return self.say(s, 'hurt itself in confusion', d)
        if att.status == 'par' and rng.random() < 0.25: return self.say(s, 'fully paralyzed')
        if i < 0:  # Struggle
            d, _ = damage(att, dfn, 'STRUGGLE', rng) if 'STRUGGLE' in MOVES else (1, False)
            dfn.hp -= d; att.hp -= max(1, d // 4); return
        key = att.moves[i]; att.pp[i] -= 1; mv = MOVES[key]
        self.stats['moves'][s] += 1
        if self.code_on:
            fmt = rng.choice(dfn.formats())
            if rng.random() >= code_odds(self.code.p(key, att, dfn, fmt), att.code_stage):
                self.stats['code_miss'][s] += 1
                return self.say(s, key, "code missed")
        eff = mv['effect']
        if mv['target'] != 'USER' and rng.random() >= accuracy(att, dfn, key): return self.say(s, key, 'missed')
        if eff in STAT_EFFECTS:
            who, st, d = STAT_EFFECTS[eff]
            m = att if who == 'self' else dfn
            if self.code_effects != 'off': m.code_stage = max(-6, min(6, m.code_stage + d))
            if self.code_effects != 'replace': m.stage(st, d)
            return self.say(s, key, who, st, d)
        if eff in ('SLEEP', 'POISON', 'TOXIC', 'PARALYZE'):
            if dfn.status: return
            if eff == 'PARALYZE' and key == 'THUNDER_WAVE' and 'GROUND' in dfn.types: return
            if eff in ('POISON', 'TOXIC') and ({'POISON', 'STEEL'} & set(dfn.types)): return
            dfn.status = {'SLEEP': 'slp', 'POISON': 'psn', 'TOXIC': 'psn', 'PARALYZE': 'par'}[eff]
            if eff == 'SLEEP': dfn.sleep = rng.randint(2, 5)
            return self.say(s, key, 'status', dfn.status)
        if eff == 'CONFUSE':
            if not dfn.confused: dfn.confused = rng.randint(2, 5)
            return
        if eff == 'RESTORE_HP':
            att.hp = min(att.stats['hp'], att.hp + att.stats['hp'] // 2); return
        if eff == 'LEECH_SEED':
            if 'GRASS' not in dfn.types: dfn.seeded = True
            return
        if eff == 'FOCUS_ENERGY': att.crit_up = True; return
        hits = rng.choice([2, 2, 2, 3, 3, 3, 4, 5]) if eff == 'MULTI_HIT' else 2 if eff == 'DOUBLE_HIT' else 1
        total = 0
        for _ in range(hits):
            d, crit = damage(att, dfn, key, rng)
            dfn.hp -= d; total += d
            if dfn.fainted(): break
        self.say(s, key, 'dealt', total)
        if total == 0: return
        if eff in HIT_EFFECTS and (mv['chance'] == 0 or rng.random() < mv['chance'] / 100 or eff in ('TRAP', 'ABSORB')):
            e = HIT_EFFECTS[eff]
            if e[0] == 'status' and not dfn.status and not dfn.fainted():
                if not (e[1] == 'brn' and 'FIRE' in dfn.types) and not (e[1] == 'psn' and {'POISON', 'STEEL'} & set(dfn.types)): dfn.status = e[1]
            elif e[0] == 'flinch': dfn.flinch = True
            elif e[0] == 'confuse' and not dfn.confused: dfn.confused = rng.randint(2, 5)
            elif e[0] == 'stat': (att if e[1] == 'self' else dfn).stage(e[2], e[3])
            elif e[0] == 'trap' and not dfn.trapped: dfn.trapped = rng.randint(2, 5)
            elif e[0] == 'drain': att.hp = min(att.stats['hp'], att.hp + max(1, total // 2))

    def end_of_turn(self, s):
        m = self.mon(s)
        if m.fainted(): return
        if m.status in ('psn', 'brn'): m.hp -= max(1, m.stats['hp'] // 8)
        if m.trapped: m.trapped -= 1; m.hp -= max(1, m.stats['hp'] // 16)
        if m.seeded and not m.fainted():
            d = max(1, m.stats['hp'] // 8); m.hp -= d
            o = self.mon(1 - s)
            if not o.fainted(): o.hp = min(o.stats['hp'], o.hp + d)


def party(spec, iv=None, known=()):
    """[{species, level, iv(0-255 trainer scale), moves}] -> [Mon]"""
    out = []
    for m in spec:
        v = iv if iv is not None else m.get('iv', 0) * 31 // 255
        out.append(Mon(m['species'], m['level'], v, m.get('moves'), known=set(known)))
    return out
