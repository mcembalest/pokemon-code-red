#!/usr/bin/env python3
"""Read a rehearsal's results off the `rehearsal` release and say what happened, seed by seed.

  python3 sim/results.py 964b924            the run for that commit (its short sha; `--latest` for the newest)
  python3 sim/results.py nightly-20261013   a nightly run (one seed, the real models, from rehearsal.yml's schedule)
  python3 sim/results.py 964b924 --turns    also fetch turns.jsonl and show the last turns before a failure
  python3 sim/results.py --file build/sim/rehearsal/summary.json    a local run

Needs `gh` (REST only). Files land in build/sim/results/<sha7>/.
"""
import argparse, json, subprocess, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = 'mcembalest/pokemon-code-red'


def gh(*args: str) -> str:
    return subprocess.run(['gh', 'api', *args], capture_output=True, text=True, check=True).stdout


def assets() -> list[dict]:
    return json.loads(gh(f'repos/{REPO}/releases/tags/rehearsal', '--jq', '[.assets[] | {id, name, created_at}]'))


def fetch(a: dict, into: Path) -> Path:
    path = into / a['name']
    if not path.exists():
        path.write_bytes(subprocess.run(['gh', 'api', '-H', 'Accept: application/octet-stream', f'repos/{REPO}/releases/assets/{a["id"]}'],
                                        capture_output=True, check=True).stdout)
    return path


def show(summary: Path, turns: Path | None) -> None:
    d = json.loads(summary.read_text())
    seed = summary.name.split('-')[1] if '-' in summary.name else summary.parent.name
    print(f'== {seed}: {"ok" if d.get("ok") else "FAILED: " + str(d.get("error"))} · {d["wall_seconds"] // 60} min · {d["tokens"]:,} tokens · '
          f'yours {d["your_hit_rate"]:.0%} of {d["your_turns"]} turns, foes {d["foe_hit_rate"]:.0%} · doubted {d["doubted"]} · waits {d["wait_median"]}s / p90 {d["wait_p90"]}s')
    legs = d.get('legs', [])
    if legs:
        print('   legs: ' + ' '.join(f'{l["leg"]}{"" if l["ok"] else "✗"}@{l["wall_s"] // 60}m' for l in legs))
    if d.get('leader_tries'):
        print('   leaders: ' + ', '.join(f'{k} ×{v}' for k, v in d['leader_tries'].items()))
    print('   misses: ' + ', '.join(f'{k} {v}' for k, v in d.get('your_misses', {}).items()))
    for key, label in (('by_type', 'yours by format'), ('foe_by_type', 'foes by format')):
        if d.get(key):
            print(f'   {label}: ' + ', '.join(f'{t} {v["hit"]:.0%}/{v["n"]}' for t, v in d[key].items()))
    if d.get('runes'):
        print('   runes: ' + ', '.join(f'{m} {v["hit"]:.0%}/{v["n"]}' + (f' ({", ".join(f"{k} {n}" for k, n in v["misses"].items())})' if v['misses'] else '') for m, v in d['runes'].items()))
    print(f'   memory: used on {d["memory_used"]:.0%} of turns, hit {d["hit_with_memory"]:.0%} with / {d["hit_without_memory"]:.0%} without · '
          f'{d.get("consolidations", 0)} consolidations · gym states {", ".join(s.split("-")[-1] for s in d.get("gym_states", []))}')
    if turns and not d.get('ok'):
        rows = [json.loads(l) for l in turns.read_text().splitlines()]
        print(f'   last turns before the failure ({len(rows)} in all):')
        for r in rows[-8:]:
            print(f'     f{r.get("frame")} {str(r.get("map", "")).removeprefix("MAP_")} t{r.get("trainer")} side{r.get("side")} '
                  f'{r.get("attacker")} {r.get("move")} on {r.get("type")}: {r.get("verdict")} {r.get("reason") or ""}')
        frames = Counter(r.get('frame') for r in rows)
        if frames and frames.most_common(1)[0][1] > 3:
            f, n = frames.most_common(1)[0]
            print(f'   ! {n} turns at frame {f}: the game was not advancing between model calls')


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('sha', nargs='?', help='short sha of the rehearsal commit')
    ap.add_argument('--latest', action='store_true')
    ap.add_argument('--turns', action='store_true')
    ap.add_argument('--file', help='a local summary.json instead of the release')
    args = ap.parse_args()
    if args.file:
        f = Path(args.file)
        t = f.with_name('turns.jsonl')
        show(f, t if t.exists() else None)
        return 0
    all_assets = assets()
    sha = args.sha
    if args.latest or not sha:
        sha = max(all_assets, key=lambda a: a['created_at'])['name'].split('-')[0]
    mine = [a for a in all_assets if a['name'].startswith(sha + '-')]
    if not mine:
        print(f'no results for {sha}; runs on the release: {", ".join(sorted({a["name"].split("-")[0] for a in all_assets}))}')
        return 1
    into = ROOT / 'build/sim/results' / sha
    into.mkdir(parents=True, exist_ok=True)
    print(f'rehearsal {sha}: {len(mine)} files → {into}')
    for a in sorted(mine, key=lambda a: a['name']):
        if a['name'].endswith('summary.json'):
            s = fetch(a, into)
            t = next((fetch(b, into) for b in mine if b['name'] == a['name'].replace('summary.json', 'turns.jsonl')), None) if args.turns else None
            show(s, t)
    live = next((a for a in mine if a['name'].endswith('live.json')), None)
    if live:
        d = json.loads(fetch(live, into).read_text())
        print(f'== live: {json.dumps(d.get("summary"))}')
        for s in d.get('steps', []):
            print(f'   {"ok  " if s.get("ok") else "FAIL"} {s.get("step")} ({s.get("seconds")}s) {s.get("error") or ""}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
