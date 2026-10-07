// "Type = linter": each foe type only takes hits from code that follows its rule (draft for the lab).
const noComments = code => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
export const LINT = {
  NORMAL: { rule: 'no rule', ok: () => true },
  ROCK: { rule: 'no loops: no for or while (hardware does one thing at a time)', ok: c => !/\b(for|while)\b/.test(noComments(c)) },
  WATER: { rule: 'no let or var: only const (water flows, nothing gets reassigned)', ok: c => !/\b(let|var)\b/.test(noComments(c)) },
  ELECTRIC: { rule: 'the function body is a single return statement (save power)', ok: c => { const b = noComments(c).match(/\{([\s\S]*)\}/)?.[1]?.trim() ?? ''; return /^return\b[^;]*;?$/.test(b) && !/\n\s*\S/.test(b.replace(/^return[\s\S]*?;?$/, '')) } },
  FIRE: { rule: 'no comments at all (fire burns them)', ok: c => !/\/\/|\/\*/.test(c) },
  GRASS: { rule: 'at least one comment (grass loves to sprawl)', ok: c => /\/\/|\/\*/.test(c) },
  FLYING: { rule: 'write it as an arrow function: const name = (bytes) => …', ok: c => /const\s+\w+\s*=\s*\(?[\w\s,]*\)?\s*=>/.test(noComments(c)) },
  PSYCHIC: { rule: 'never write the word bytes in your code; name the parameter something else', ok: c => !/\bbytes\b/.test(noComments(c)) },
  BUG: { rule: 'no if statements and no ? : (no branches for bugs to hide in)', ok: c => !/\bif\b|\?(?![.?])/.test(noComments(c)) },
  POISON: { rule: 'no Math (malware hijacked it)', ok: c => !/\bMath\b/.test(noComments(c)) },
  GROUND: { rule: 'use a for loop (do the physical work by hand)', ok: c => /\bfor\b/.test(noComments(c)) },
  FIGHTING: { rule: 'no .map, .filter or .reduce (brute force only)', ok: c => !/\.(map|filter|reduce)\s*\(/.test(noComments(c)) },
  STEEL: { rule: 'at most 3 lines of code in total (armor is tight)', ok: c => noComments(c).split('\n').filter(l => l.trim()).length <= 3 },
}
