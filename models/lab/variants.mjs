// Turn designs under test. Each: prompt({ move, foe, memory }) → { system, user }; judge({ move, foe, code }) → { outcome, reason }.
import { isDeepStrictEqual } from 'node:util'
import { renderDeclarations, runBlock } from '../../kernel/index.mjs'
import { TYPES } from '../battle/types.mjs'
import { EXAMPLE_BYTES, FORMATS, HINTS, example, show } from './formats.mjs'
import { LINT } from './lint.mjs'

const persona = (foe, extra, memory) => [
  `You are CHARMANDER, a level ${foe.level} Pokémon. You fight by writing JavaScript.`,
  'When your trainer calls a move, you write the code for it, then stop.',
  'Reply with only one JavaScript code block. No words outside it. Comments inside are fine.',
  ...extra,
  ...(memory ? ['', 'Your memory:', memory] : []),
].join('\n')

const foeLine = (move, foe) => `Foe: ${foe.name} Lv${foe.level} (${foe.types.join('/')}). Your trainer says: use ${move.name}!`
const shapeNote = move => (move.shape === 'no key' ? '' : ` (${move.shape})`)
const scanObj = (foe, field, value) => ({ name: foe.name, level: foe.level, types: foe.types, status: 'none', [field]: value })

function strikeTools(move, scan) {
  return [
    { name: 'scan', description: 'Read the foe.', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object' }, execute: async () => structuredClone(scan) },
    { name: move.fn, description: `${move.name}: strike with your answer as key.`, inputSchema: { type: 'object', properties: { key: {} } }, outputSchema: { type: 'string' }, execute: async () => 'ok' },
  ]
}

async function judgeStrike({ move, foe, code, scan }) {
  const run = await runBlock(code, strikeTools(move, scan))
  if (!run.ok) return { outcome: 'miss', reason: run.error }
  const strikes = run.log.filter(c => c.name === move.fn)
  if (strikes.length !== 1) return { outcome: 'miss', reason: strikes.length ? 'struck more than once' : 'never struck' }
  const want = move.ref(foe.clean, scan), got = strikes[0].args?.key
  return isDeepStrictEqual(got, want) ? { outcome: 'hit' } : { outcome: 'miss', reason: 'wrong answer', got: JSON.stringify(got)?.slice(0, 80), want: JSON.stringify(want)?.slice(0, 80) }
}

// The function the Pokémon defined for this move: its exact name, or the same name in another case (copyPaste, COPYPASTE).
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
export function definedName(code, fn) {
  const names = [...code.matchAll(/(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/g)].map(m => m[1] ?? m[2])
  return names.find(n => n === fn) ?? names.find(n => norm(n) === norm(fn)) ?? fn
}

async function judgeFunction({ move, foe, code, data }) {
  // The block may define the function, or just be its body (using `data`, ending in return): both count.
  const name = definedName(code, move.fn)
  const run = await runBlock(`return (function (data) {\n${code}\n;return typeof ${name} === 'function' ? ${name}(data) : undefined\n})(${JSON.stringify(data)})`, [])
  if (!run.ok) return { outcome: 'miss', reason: run.error }
  const want = move.ref(foe.clean, scanObj(foe, 'bytes', data))
  return isDeepStrictEqual(run.value, want) ? { outcome: 'hit' } : { outcome: 'miss', reason: 'wrong answer', got: JSON.stringify(run.value)?.slice(0, 80), want: JSON.stringify(want)?.slice(0, 80) }
}

const fmt = foe => FORMATS[foe.types[0]]
const encoded = foe => fmt(foe).encode(foe.clean)

export const VARIANTS = {
  // Baseline (battle run 3): junk bytes + a cleanup rule per type, as steps; scan → clean → key → strike.
  'clean-steps': {
    prompt({ move, foe, memory }) {
      const scan = scanObj(foe, 'bytes', foe.dirty)
      const clean = foe.types.map((t, i) => `${i ? 'then ' : ''}${t}: ${TYPES[t].rule}`).join('; ')
      return {
        system: persona(foe, ['The code is the body of an async function: use await; call battle functions with `await tools.<name>(args)`.'], memory),
        user: [foeLine(move, foe), 'Steps:', '1. const foe = await tools.scan()', `2. Clean foe.bytes (${clean}).`,
          `3. key = ${move.spec}, from the cleaned bytes${shapeNote(move)}.`, `4. await tools.${move.fn}({ key }), exactly once.`, '', renderDeclarations({ tools: strikeTools(move, scan) })].join('\n'),
      }
    },
    judge: ({ move, foe, code }) => judgeStrike({ move, foe, code, scan: scanObj(foe, 'bytes', foe.dirty) }),
  },
  // Type = data format; still scan → read → key → strike.
  'format-steps': {
    prompt({ move, foe, memory }) {
      const scan = scanObj(foe, 'data', encoded(foe))
      return {
        system: persona(foe, ['The code is the body of an async function: use await; call battle functions with `await tools.<name>(args)`.'], memory),
        user: [foeLine(move, foe), 'Steps:', '1. const foe = await tools.scan()',
          `2. Read the bytes from foe.data. ${foe.types[0]} data is ${fmt(foe).note}. Example: ${show(example(foe.types[0]))} is [${EXAMPLE_BYTES.join(', ')}].`,
          `3. key = ${move.spec}${shapeNote(move)}.`, `4. await tools.${move.fn}({ key }), exactly once.`, '', renderDeclarations({ tools: strikeTools(move, scan) })].join('\n'),
      }
    },
    judge: ({ move, foe, code }) => judgeStrike({ move, foe, code, scan: scanObj(foe, 'data', encoded(foe)) }),
  },
  // The move is a function the Pokémon writes; the game calls it on the foe's data (type = data format, described).
  'fn-format': {
    prompt({ move, foe, memory }) {
      return {
        system: persona(foe, [], memory),
        user: [foeLine(move, foe), `Write the function: function ${move.fn}(data)`,
          `- data = the foe's bytes in ${foe.types[0]} format: ${fmt(foe).note}. Example: ${show(example(foe.types[0]))} is [${EXAMPLE_BYTES.join(', ')}].`,
          `- ${move.fn} returns ${move.spec}${shapeNote(move)}.`].join('\n'),
      }
    },
    judge: ({ move, foe, code }) => judgeFunction({ move, foe, code, data: encoded(foe) }),
  },
  // Function + the type's format + a Pokédex hint: one line that reads the data.
  'fn-hint': {
    prompt({ move, foe, memory }) {
      return {
        system: persona(foe, [], memory),
        user: [foeLine(move, foe), `Write the function: function ${move.fn}(data)`,
          `- data = the foe's bytes in ${foe.types[0]} format: ${fmt(foe).note}. Example: ${show(example(foe.types[0]))} is [${EXAMPLE_BYTES.join(', ')}].`,
          `- Pokédex: ${foe.types[0]} data reads like this: ${HINTS[foe.types[0]]}`,
          `- ${move.fn} returns ${move.spec}${shapeNote(move)}.`].join('\n'),
      }
    },
    judge: ({ move, foe, code }) => judgeFunction({ move, foe, code, data: encoded(foe) }),
  },
  // Dual types: the data may come in either type's format; the function must read both (the game calls it once per format).
  'fn-dual-format': dualVariant(false),
  'fn-dual-hint': dualVariant(true),
  // First encounter, with a convention: line 1 reads the data into `bytes`. Lets the Pokémon remember its own reader per type.
  'fn-format-conv': {
    prompt({ move, foe, memory }) {
      const ex = [42, 13, 140, 77]
      return {
        system: persona(foe, [], memory),
        user: [foeLine(move, foe), `Write the function: function ${move.fn}(data)`,
          `- data = the foe's bytes in ${foe.types[0]} format: ${fmt(foe).note}. Example: ${show(example(foe.types[0]))} is [${EXAMPLE_BYTES.join(', ')}].`,
          '- First line of the function: const bytes = <read data into a list of numbers>',
          `- ${move.fn} returns ${move.spec}${shapeNote(move)}. On the numbers ${JSON.stringify(ex)} it returns ${JSON.stringify(move.ref(ex, {})) ?? 'nothing'}.`].join('\n'),
      }
    },
    judge: ({ move, foe, code }) => judgeFunction({ move, foe, code, data: encoded(foe) }),
  },
  // Gym battle: first-encounter format + the gym leader's rule (Brock: no loops; Misty: const only).
  'fn-gym': gymVariant(false),
  'fn-gym-dex': gymVariant(true),
  // Same, but only an example with its meaning (no description of the format).
  'fn-example': {
    prompt({ move, foe, memory }) {
      return {
        system: persona(foe, [], memory),
        user: [foeLine(move, foe), `Write the function: function ${move.fn}(data)`,
          `- data = the foe's bytes. Example: ${show(example(foe.types[0]))} is [${EXAMPLE_BYTES.join(', ')}].`,
          `- ${move.fn} returns ${move.spec}${shapeNote(move)}.`].join('\n'),
      }
    },
    judge: ({ move, foe, code }) => judgeFunction({ move, foe, code, data: encoded(foe) }),
  },
  // Plain function + one worked example of the move (input → output), like a move description with a demo.
  'fn-plain-ex': {
    prompt({ move, foe, memory }) {
      const ex = [42, 13, 140, 77]
      return {
        system: persona(foe, [], memory),
        user: [foeLine(move, foe), `Write the function: function ${move.fn}(bytes)`, '- bytes = the foe\'s bytes, a list of numbers.',
          `- ${move.fn} returns ${move.spec}${shapeNote(move)}.`, `- Example: ${move.fn}(${JSON.stringify(ex)}) returns ${JSON.stringify(move.ref(ex, {})) ?? 'nothing'}.`].join('\n'),
      }
    },
    judge: ({ move, foe, code }) => judgeFunction({ move, foe, code, data: [...foe.clean] }),
  },
  // Function + type format + Pokédex hint + a worked example of the move.
  'fn-hint-ex': {
    prompt({ move, foe, memory }) {
      const ex = [42, 13, 140, 77]
      return {
        system: persona(foe, [], memory),
        user: [foeLine(move, foe), `Write the function: function ${move.fn}(data)`,
          `- data = the foe's bytes in ${foe.types[0]} format: ${fmt(foe).note}. Example: ${show(example(foe.types[0]))} is [${EXAMPLE_BYTES.join(', ')}].`,
          `- Pokédex: ${foe.types[0]} data reads like this: ${HINTS[foe.types[0]]}`,
          `- ${move.fn} returns ${move.spec}${shapeNote(move)}. On the numbers ${JSON.stringify(ex)} it returns ${JSON.stringify(move.ref(ex, {})) ?? 'nothing'}.`].join('\n'),
      }
    },
    judge: ({ move, foe, code }) => judgeFunction({ move, foe, code, data: encoded(foe) }),
  },
  // Type = linter rule: plain list of numbers, but the code must follow the foe type's rule.
  'fn-lint': {
    prompt({ move, foe, memory }) {
      const ex = [42, 13, 140, 77]
      return {
        system: persona(foe, [], memory),
        user: [foeLine(move, foe), `Write the function: ${move.fn}(bytes)`, '- bytes = the foe\'s bytes, a list of numbers.',
          `- ${move.fn} returns ${move.spec}${shapeNote(move)}. On ${JSON.stringify(ex)} it returns ${JSON.stringify(move.ref(ex, {})) ?? 'nothing'}.`,
          `- ${foe.types[0]} rule: ${LINT[foe.types[0]].rule}.`].join('\n'),
      }
    },
    async judge({ move, foe, code }) {
      if (!LINT[foe.types[0]].ok(code)) return { outcome: 'miss', reason: `broke the ${foe.types[0]} rule` }
      return judgeFunction({ move, foe, code, data: [...foe.clean] })
    },
  },
  // Plain function on a plain list (no type twist): how hard is the move alone, in function form?
  'fn-plain': {
    prompt({ move, foe, memory }) {
      return {
        system: persona(foe, [], memory),
        user: [foeLine(move, foe), `Write the function: function ${move.fn}(bytes)`, `- bytes = the foe's bytes, a list of numbers. Example: [${EXAMPLE_BYTES.join(', ')}].`,
          `- ${move.fn} returns ${move.spec}${shapeNote(move)}.`].join('\n'),
      }
    },
    judge: ({ move, foe, code }) => judgeFunction({ move, foe, code, data: [...foe.clean] }),
  },
}

function dualVariant(hint) {
  return {
    prompt({ move, foe, memory }) {
      const lines = foe.types.map(t => `  - ${t} format: ${FORMATS[t].note}. Example: ${show(example(t))} is [${EXAMPLE_BYTES.join(', ')}].${hint ? ` Pokédex: ${HINTS[t]}` : ''}`)
      return {
        system: persona(foe, [], memory),
        user: [foeLine(move, foe), `Write the function: function ${move.fn}(data)`,
          `- data = the foe's bytes. A ${foe.types.join('/')} foe sends ${foe.types.length > 1 ? 'either format; your function must handle both' : 'this format'}:`, ...lines,
          `- ${move.fn} returns ${move.spec}${shapeNote(move)}.`].join('\n'),
      }
    },
    async judge({ move, foe, code }) {
      for (const t of foe.types) {
        const v = await judgeFunction({ move, foe, code, data: FORMATS[t].encode(foe.clean) })
        if (v.outcome !== 'hit') return { ...v, reason: `${v.reason} (${t} data)` }
      }
      return { outcome: 'hit' }
    },
  }
}

const GYM_RULE = { ROCK: 'ROCK', WATER: 'WATER' }
function gymVariant(dex) {
  return {
    prompt({ move, foe, memory }) {
      const ex = [42, 13, 140, 77], t = foe.types[0]
      return {
        system: persona(foe, [], memory),
        user: [foeLine(move, foe), `Write the function: function ${move.fn}(data)`,
          `- data = the foe's bytes in ${t} format: ${FORMATS[t].note}. Example: ${show(example(t))} is [${EXAMPLE_BYTES.join(', ')}].`,
          dex ? `- Pokédex: ${t} data reads like this: ${HINTS[t]}` : '- First line of the function: const bytes = <read data into a list of numbers>',
          `- ${move.fn} returns ${move.spec}${shapeNote(move)}. On the numbers ${JSON.stringify(ex)} it returns ${JSON.stringify(move.ref(ex, {})) ?? 'nothing'}.`,
          `- Gym rule: ${LINT[t].rule}.`].join('\n'),
      }
    },
    async judge({ move, foe, code }) {
      if (!LINT[foe.types[0]].ok(code)) return { outcome: 'miss', reason: 'broke the gym rule' }
      return judgeFunction({ move, foe, code, data: encoded(foe) })
    },
  }
}
