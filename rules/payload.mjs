// Payload moves (owner, 2026-10-09: bytes are the universal medium; 2026-10-10: make them expressive, the
// pixelated animal sounds of the 90s games; 2026-10-13: "cool and synthy, and at the same time sound like the old
// Pokémon moves"). A payload move *makes* bytes instead of answering, and the move's own FireRed animation plays them:
//   sound: 8-bit samples at 8000 a second (128 = silence), up to 4096 (~0.5 s): it *is* the Pokémon's cry wherever the
//          move's animation plays one (ERROR: GROWL's double cry, the growl twice, the way FireRed plays it)
//   voice: one cycle of a wave, 16–256 samples: the *instrument* the move's own sound effects play with — FireRed's
//          tune, rhythm and timing in the Pokémon's synth voice (DIM: SING's tune · FEEDBACK: SUPERSONIC's rings ·
//          BUZZ: SONIC BOOM's whooshes). Recorded side by side: sim/experiments/move_sounds.py
//   image: 4 frames of a 32×32 picture, color numbers 0–15 (0 = see-through), drawn over the target at 2× and
//          animated, in the move's 16-color palette (FLASH: white-hot to ember, SPARK: white to electric blue)
// There is no single right answer. The checker judges the *character* (it slides down, it trills, it grows…), so a
// Pokémon can make its own version. A payload move only makes: it reads nothing of the foe (owner, 2026-10-13: the
// old "first number is the foe's count" rule is gone; it dated from when every move had to read the foe's format).
// `ref` is a model-sized reference (and the stand-in model's answer: player mockWriter prints ref.toString(), so refs are
// closure-free and built from source text).

import { PAYLOAD_LIMITS } from './knobs.mjs'
export const SAMPLE_RATE = PAYLOAD_LIMITS.sampleRate
export const SOUND_MAX = PAYLOAD_LIMITS.soundMax
export const IMAGE_FRAMES = PAYLOAD_LIMITS.imageFrames
export const IMAGE_PIXELS = 1024 * IMAGE_FRAMES
export const VOICE_MIN = PAYLOAD_LIMITS.voiceMin
export const VOICE_MAX = PAYLOAD_LIMITS.voiceMax

const finite = v => Array.isArray(v) && v.every(x => typeof x === 'number' && Number.isFinite(x))
/** Bytes are bytes: a fraction rounds, and anything past the edge sticks to it (0–255 for sound, 0–15 for color). */
export const clampTo = (v, hi) => v.map(x => Math.max(0, Math.min(hi, Math.round(x))))

// ---------- what a sound sounds like, measured ----------

/** Pitch (Hz) and loudness per window: zero crossings of 128 with a little hysteresis, so noise under ±10 doesn't count. */
export function soundFeatures(samples, win = 320) {
  const out = []
  for (let s = 0; s + win <= samples.length; s += win) {
    let crossings = 0, side = 0, sum = 0
    for (let i = s; i < s + win; i++) {
      const x = samples[i] - 128
      sum += x * x
      const now = x > 10 ? 1 : x < -10 ? -1 : side
      if (side && now !== side) crossings++
      side = now
    }
    out.push({ hz: crossings / 2 / (win / SAMPLE_RATE), rms: Math.sqrt(sum / win) })
  }
  return out
}

const mean = xs => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0)
const voiced = fs => fs.filter(f => f.rms > 8 && f.hz > 40)
const third = (fs, k) => fs.slice(Math.floor((k * fs.length) / 3), Math.floor(((k + 1) * fs.length) / 3))

/** How the pitch moves: the ratio of the last third's pitch to the first third's (voiced windows only). */
export const pitchSlope = s => { const v = voiced(soundFeatures(s)); const a = mean(third(v, 0).map(f => f.hz)), b = mean(third(v, 2).map(f => f.hz)); return a ? b / a : 1 }
/** Pitch jumps of 15% or more between neighboring short windows (a trill flips back and forth). */
export const pitchJumps = s => { const v = voiced(soundFeatures(s, 160)); let n = 0; for (let i = 1; i < v.length; i++) { const r = v[i].hz / v[i - 1].hz; if (r > 1.15 || r < 1 / 1.15) n++ } return n }
/** Distinct steady pitches (notes): voiced windows grouped within 6%, a note needs two windows. */
export function notes(s) {
  const groups = []
  for (const f of voiced(soundFeatures(s))) { const g = groups.find(x => Math.abs(x.hz / f.hz - 1) < 0.06); if (g) g.n++; else groups.push({ hz: f.hz, n: 1 }) }
  return groups.filter(g => g.n >= 2).length
}
const rmsOf = xs => Math.sqrt(mean(xs.map(x => (x - 128) ** 2)))
/** It has a shape: its last tenth is quieter than its loudest moment (it fades or stops). */
export const fades = s => { const fs = soundFeatures(s); if (fs.length < 3) return false; return rmsOf(s.slice(-Math.round(s.length / 10))) < 0.8 * Math.max(...fs.map(f => f.rms)) }

const CHARACTER = {
  falls: { test: s => pitchSlope(s) < 0.75, why: 'its pitch should slide down (it stays level or rises)' },
  rises: { test: s => pitchSlope(s) > 1.3, why: 'its pitch should climb (it stays level or falls)' },
  trills: { test: s => pitchJumps(s) >= 4, why: 'it should flip between two notes (a trill), fewer than 4 jumps' },
  tune: { test: s => notes(s) >= 3, why: 'it should play at least 3 different notes' },
}

const soundCheck = ({ loud, soft = false, character }) => (v, b) => {
  if (!finite(v) || v.length < 1000) return 'not a list of at least 1000 numbers'
  const s = clampTo(v.slice(0, SOUND_MAX), 255), span = Math.max(...s) - Math.min(...s)
  if (span < loud) return `too quiet (from lowest to highest it spans ${span}, needs ${loud})`
  if (soft && (Math.max(...s) > 196 || Math.min(...s) < 60)) return 'too loud for a soft sound (stay between 60 and 196)'
  if (!fades(s)) return 'it never fades or stops (the end is as loud as the loudest part)'
  return CHARACTER[character].test(s) ? null : CHARACTER[character].why
}

// ---------- what a voice sounds like, measured (one cycle of a wave) ----------

/** How many times one cycle crosses the center (128), with a little hysteresis: 2 is a plain tone, more is overtones or grit. */
export function crossings(c) {
  let n = 0, side = 0
  for (const x of [...c, c[0]]) { const now = x > 136 ? 1 : x < 120 ? -1 : side; if (side && now !== side) n++; side = now }
  return n
}
/** The share of the cycle spent above the center: a thin pulse spends little time up. */
export const upShare = c => c.filter(x => x > 128).length / c.length
/** The biggest jump between neighbors, against the span: a smooth wave never jumps far. */
export const roughness = c => { const span = Math.max(...c) - Math.min(...c) || 1; let j = 0; for (let i = 1; i < c.length; i++) j = Math.max(j, Math.abs(c[i] - c[i - 1])); return j / span }

const VOICE_CHARACTER = {
  soft: { test: c => crossings(c) <= 2 && roughness(c) <= 0.25, why: 'it should be smooth and round: up once, down once, no jumps (crosses 128 more than twice, or jumps)' },
  bright: { test: c => upShare(c) <= 0.3, why: 'it should be a thin pulse: high for a short part of the cycle (under 30%), low the rest' },
  rough: { test: c => crossings(c) >= 6, why: 'it should be gritty: crossing 128 at least 6 times in the cycle (add noise or overtones)' },
}

const voiceCheck = ({ character }) => (v, b) => {
  if (!finite(v) || v.length < VOICE_MIN) return `not a list of at least ${VOICE_MIN} numbers (one cycle of a wave)`
  if (v.length > VOICE_MAX) return `one cycle is at most ${VOICE_MAX} numbers (it has ${v.length})`
  const c = clampTo(v, 255), span = Math.max(...c) - Math.min(...c)
  if (span < 60) return `too quiet (from lowest to highest it spans ${span}, needs 60)`
  if (Math.abs(mean(c) - 128) > 24) return `it should sit around 128 (its middle is ${Math.round(mean(c))}): lopsided waves thump`
  return VOICE_CHARACTER[character].test(c) ? null : VOICE_CHARACTER[character].why
}

// ---------- what a picture looks like, measured ----------

export const frames = px => Array.from({ length: IMAGE_FRAMES }, (_, f) => px.slice(f * 1024, (f + 1) * 1024))
const lit = fr => fr.filter(c => c > 0).length
const rowLit = (fr, y) => fr.slice(y * 32, y * 32 + 32).some(c => c > 0)

const LOOK = {
  grows: { test: fs => Math.max(...fs.slice(1).map(lit)) >= 1.5 * Math.max(1, lit(fs[0])), why: 'it should grow (a later frame has 1.5× the colored pixels of the first)' },
  crosses: { test: fs => fs.filter(fr => [0, 1, 2].some(y => rowLit(fr, y)) && [29, 30, 31].some(y => rowLit(fr, y))).length >= 2, why: 'it should reach from the top rows to the bottom rows (in at least 2 frames)' },
}

const imageCheck = ({ look }) => (v, b) => {
  if (!Array.isArray(v) || v.length < IMAGE_PIXELS) return `not ${IMAGE_PIXELS} numbers (4 frames of 1024)`
  if (!finite(v)) return 'not a list of numbers'
  const px = clampTo(v.slice(0, IMAGE_PIXELS), 15)
  const fs = frames(px)
  const counts = fs.map(lit)
  if (counts.some(n => n < 16)) return `every frame needs at least 16 colored pixels (frames have ${counts.join(', ')})`
  if (counts.some(n => n > 900)) return 'leave some of each frame see-through (0): a shape, not a filled square'
  if (new Set(px.filter(c => c > 0)).size < 3) return 'use at least 3 different colors (shades from dim to bright)'
  for (let f = 1; f < IMAGE_FRAMES; f++) if (fs[f].filter((c, i) => c !== fs[f - 1][i]).length < 30) return `frame ${f + 1} barely changes from frame ${f} (it should move)`
  return LOOK[look].test(fs) ? null : LOOK[look].why
}

// ---------- palettes (16 colors, [r, g, b]; index 0 is see-through) ----------

const ramp = stops => Array.from({ length: 16 }, (_, i) => {
  if (!i) return [0, 0, 0]
  const t = ((i - 1) / 14) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(t)), u = t - k
  return stops[k].map((x, j) => Math.round(x + (stops[k + 1][j] - x) * u))
})
export const PALETTES = {
  flash: ramp([[120, 40, 0], [240, 140, 20], [255, 230, 90], [255, 255, 255]]),   // ember → amber → white-hot
  spark: ramp([[20, 30, 120], [40, 160, 255], [250, 240, 80], [255, 255, 255]]),  // night blue → electric → yellow → white
  grey: ramp([[0, 0, 0], [255, 255, 255]]),
}

// ---------- the moves ----------

const src = s => (0, eval)(s)

// ---------- voices: every species sounds and draws a little differently (like its cry in the old games) ----------

const hash = text => { let h = 2166136261; for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
const pick = (h, xs, k) => xs[(h >>> k) % xs.length]
const MOTIFS = [[1, 1.26, 1.5], [1.5, 1.26, 1], [1, 1.5, 1.26], [1.26, 1, 1.5], [1, 1.19, 1.5], [1.5, 1.19, 1]]
/** A species' voice (stable: the same Pokémon always sounds like itself). */
export function voiceOf(name = '') {
  const h = hash(String(name).toUpperCase())
  return {
    m: +(0.6 + ((h % 1000) / 1000) * 1.1).toFixed(2),   // pitch ×0.6 … ×1.7
    d: pick(h, [0.125, 0.25, 0.375], 3),                  // the square's duty: thin, nasal, round
    w: pick(h, [60, 90, 140], 7),                         // how fast its voice wobbles
    s: pick(h, [320, 480, 720], 11),                      // its stutter
    motif: pick(h, MOTIFS, 13),                           // its lullaby's three notes
    k: pick(h, [2, 3, 4, 5], 17),                         // FLASH: 4, 6, 8 or 10 rays
    g: pick(h, [3, 4, 5], 19),                            // FLASH: how fast it grows
    j: pick(h, [3, 5], 23),                               // SPARK: how jagged
    gw: pick(h, [2, 3], 29),                              // SPARK: glow width
  }
}
const DEFAULT_VOICE = { m: 1, d: 0.25, w: 90, s: 480, motif: [1, 1.26, 1.5], k: 4, g: 4, j: 5, gw: 3 }
const hz = x => Math.round(x)

const SOURCES = {
  // ERROR (Growl): a glitchy growl — a nasal square sliding down, its voice wobbling (duty), gritty, stuttering, fading
  growl: v => `b=>{const o=[];let p=0;for(let i=0;i<3199;i++){const t=i/3200,d=${v.d}+.12*Math.sin(i/${v.w});p=(p+(${hz(300 * v.m)}-${hz(190 * v.m)}*t)/8e3)%1;o.push((128+(1-t)*(i%${v.s}<${v.s - 80}?1:.2)*((p<d?75:-75)+Math.random()*40-20)))}return o}`,
  // BUZZ (Sonic Boom): a rough voice for SONIC BOOM's whooshes — a square in its own duty, a buzzing 13th overtone (SONIC BOOM hisses high), grit
  buzz: v => `b=>{const o=[];for(let i=0;i<64;i++){const p=i/64;o.push(128+(p<${v.d * 2 > .5 ? .5 : v.d * 2}?30:-30)+50*Math.sin(2*Math.PI*p*13)+Math.random()*40-20)}return o}`,
  // FEEDBACK (Supersonic): a thin ringing voice for SUPERSONIC's rings — a narrow pulse with a faint overtone
  ring: v => `b=>{const o=[];for(let i=0;i<64;i++){const p=i/64;o.push(128+(p<${v.d >= .25 ? .125 : v.d}?100:-16)+8*Math.sin(2*Math.PI*p*${v.k}))}return o}`,
  // DIM (Sing): a soft round voice for SING's tune — a sine with a little of its own second harmonic
  lullaby: v => `b=>{const o=[];for(let i=0;i<64;i++){const p=i/64;o.push(128+60*Math.sin(2*Math.PI*p)+${Math.round(v.w / 9)}*Math.sin(4*Math.PI*p))}return o}`,
  // FLASH: a starburst — a hot round core and rays growing frame by frame, breaking into sparkles in the last
  flash: v => `b=>{const o=[];for(let f=0;f<4;f++)for(let i=0;i<1024;i++){const x=i%32-15.5,y=(i>>5)-15.5,r=Math.hypot(x,y),R=3+${v.g}*f;let c=r<R?15-2*r:Math.cos(${v.k}*Math.atan2(y,x))**12>.5&&r<2*R?12-r+R:0;if(f>2&&Math.random()<.5)c=0;o.push(c)}return o}`,
  // SPARK: a jagged bolt from the top row to the bottom, white-hot core, a glow, a new bolt each frame (it flickers)
  spark: v => `b=>{const o=[];for(let f=0;f<4;f++){const p=Array(1024).fill(0);let x=16;for(let y=0;y<32;y++){x=Math.max(3,Math.min(28,x+Math.floor(Math.random()*${v.j})-${(v.j - 1) / 2}));for(let d=-${v.gw};d<${v.gw + 1};d++)p[y*32+x+d]=Math.max(p[y*32+x+d],15-${v.gw === 3 ? 4 : 6}*Math.abs(d))}o.push(...p)}return o}`,
}

const sound = (key, character, o = {}) => ({ kind: 'sound', key, character, check: soundCheck({ loud: o.loud ?? 120, soft: o.soft, character }), ref: src(SOURCES[key](DEFAULT_VOICE)) })
const voice = (key, character) => ({ kind: 'voice', key, character, check: voiceCheck({ character }), ref: src(SOURCES[key](DEFAULT_VOICE)) })
const image = (key, look, palette) => ({ kind: 'image', key, look, palette: PALETTES[palette], check: imageCheck({ look }), ref: src(SOURCES[key](DEFAULT_VOICE)) })

export const PAYLOAD = {
  growl: sound('growl', 'falls'),
  buzz: voice('buzz', 'rough'),
  ring: voice('ring', 'bright'),
  lullaby: voice('lullaby', 'soft'),
  flash: image('flash', 'grows', 'flash'),
  spark: image('spark', 'crosses', 'spark'),
}

/** The reference in a species' voice (what the prompt shows it as one way to write its own). */
export const voicedRef = (p, name) => src(SOURCES[p.key](voiceOf(name)))

/** What every sound and every picture move's prompt adds: how the GBA hears and sees the numbers. */
export const HOW = {
  sound: 'A sound is 8000 numbers a second; 128 is silence, 0 and 255 are loudest (the game rounds and clamps, so no Math.round). Square wave: keep a phase p, add f/8000 for each number and keep p below 1; output 128 + v when p < d, else 128 − v (d = 0.125, 0.25 or 0.5 changes the voice). Math.random() adds grit.',
  voice: 'A voice is one cycle of a wave: 16 to 256 numbers, 128 is the center, 0 and 255 the loudest (the game rounds and clamps). The game loops the cycle and plays the move\'s own tune with it, so its shape is the sound: a sine is soft and round, a thin pulse is bright and ringing, noise or many crossings is gritty. Keep it centered on 128.',
  image: 'A picture is 4 frames one after another, each 32 rows of 32 color numbers; 0 is see-through, 1 is the dimmest color and 15 the brightest (the game rounds and clamps). It is drawn over the foe, twice the size, frame after frame.',
}

/** One way to write it, for the prompt: the reference body (it reads nothing: a payload move only makes). */
export const exampleBody = (p, name) => (name ? voicedRef(p, name) : p.ref).toString().replace(/^b=>\{/, '').replace(/\}$/, '')

/** The bytes the GBA gets from a hit: sound samples, a voice's cycle, or 4 frames of color numbers. */
export const payloadBytes = (p, value) => (p.kind === 'image' ? clampTo(value.slice(0, IMAGE_PIXELS), 15) : clampTo(value.slice(0, p.kind === 'voice' ? VOICE_MAX : SOUND_MAX), 255))
