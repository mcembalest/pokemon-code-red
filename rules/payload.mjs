// Payload moves (owner, 2026-10-09: bytes are the universal medium; 2026-10-10: make them expressive, the
// pixelated animal sounds of the 90s games). A payload move *makes* bytes instead of answering:
//   sound: 8-bit samples at 8000 a second (128 = silence), up to 4096 (~0.5 s): played once by the GBA's cry player
//   image: 4 frames of a 32×32 picture, color numbers 0–15 (0 = see-through), drawn over the target at 2× and
//          animated, in the move's 16-color palette (FLASH: white-hot to ember, SPARK: white to electric blue)
// There is no single right answer. The checker judges the *character* (it slides down, it trills, it grows…), so a
// Pokémon can make its own version. The first number is still the foe's count (the code must read the foe's format:
// type matters); it is checked, not played or drawn.
// `ref` is a model-sized reference (and the stand-in model's answer: player mockWriter prints ref.toString(), so refs are
// closure-free and built from source text).

export const SAMPLE_RATE = 8000
export const SOUND_MAX = 4096
export const IMAGE_FRAMES = 4
export const IMAGE_PIXELS = 1024 * IMAGE_FRAMES

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
  if (!finite(v) || v.length < 1001) return 'not a list of at least 1000 numbers'
  if (v[0] !== b.length) return `first number should be ${b.length}`
  const s = clampTo(v.slice(1, SOUND_MAX + 1), 255), span = Math.max(...s) - Math.min(...s)
  if (span < loud) return `too quiet (from lowest to highest it spans ${span}, needs ${loud})`
  if (soft && (Math.max(...s) > 196 || Math.min(...s) < 60)) return 'too loud for a soft sound (stay between 60 and 196)'
  if (!fades(s)) return 'it never fades or stops (the end is as loud as the loudest part)'
  return CHARACTER[character].test(s) ? null : CHARACTER[character].why
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
  if (!Array.isArray(v) || v.length < IMAGE_PIXELS + 1) return `not ${IMAGE_PIXELS + 1} numbers (the count, then 4 frames of 1024)`
  if (v[0] !== b.length) return `first number should be ${b.length}`
  if (!finite(v)) return 'not a list of numbers'
  const px = clampTo(v.slice(1, IMAGE_PIXELS + 1), 15)
  const fs = frames(px)
  const counts = fs.map(lit)
  if (counts.some(n => n < 30)) return `every frame needs at least 30 colored pixels (frames have ${counts.join(', ')})`
  if (counts.some(n => n > 900)) return 'leave some of each frame see-through (0): a shape, not a filled square'
  if (new Set(px.filter(c => c > 0)).size < 4) return 'use at least 4 different colors (shades from dim to bright)'
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
const sound = (character, ref, o = {}) => ({ kind: 'sound', character, check: soundCheck({ loud: o.loud ?? 120, soft: o.soft, character }), ref: src(ref) })
const image = (look, palette, ref) => ({ kind: 'image', look, palette: PALETTES[palette], check: imageCheck({ look }), ref: src(ref) })

export const PAYLOAD = {
  // ERROR (Growl): a glitchy growl — a nasal square sliding down 300 → 110 Hz, its voice wobbling (duty), gritty, stuttering, fading
  growl: sound('falls', `b=>{const o=[b.length];let p=0;for(let i=0;i<3199;i++){const t=i/3200,d=0.25+0.15*Math.sin(i/90);p=(p+(300-190*t)/8000)%1;o.push(Math.round(128+(1-t)*(i%480<400?1:0.2)*((p<d?75:-75)+Math.random()*40-20)))}return o}`),
  // BUZZ (Sonic Boom): a bird trill — a square flipping between two high notes every 30 ms, sliding down, fading
  trill: sound('trills', `b=>{const o=[b.length];let p=0;for(let i=0;i<3199;i++){const t=i/3200,f=(Math.floor(i/240)%2?990:740)*(1-0.3*t);p=(p+f/8000)%1;o.push(Math.round(128+(1-0.8*t)*(p<0.5?80:-80)))}return o}`),
  // FEEDBACK (Supersonic): a rising whine — a thin square climbing 300 → 1800 Hz with a fast vibrato, swelling, then cut
  whine: sound('rises', `b=>{const o=[b.length];let p=0;for(let i=0;i<3199;i++){const t=i/3200,f=(300+1500*t*t)*(1+0.04*Math.sin(i/180));p=(p+f/8000)%1;o.push(Math.round(128+(t<0.9?0.3+0.7*t:0)*(p<0.125?100:-60)))}return o}`),
  // DIM (Sing): a soft lullaby — three notes (G, B, D), each swelling and fading, a gentle vibrato, quiet
  lullaby: sound('tune', `b=>{const o=[b.length],n=[392,494,587];let p=0;for(let i=0;i<3199;i++){const k=Math.floor(i/1067),u=(i%1067)/1067;p=(p+n[k]*(1+0.01*Math.sin(i/160))/8000)%1;o.push(Math.round(128+60*Math.sin(Math.PI*u)*(1-4*Math.abs(p-0.5))))}return o}`, { loud: 60, soft: true }),
  // FLASH: a starburst — a hot round core and eight rays growing frame by frame, breaking into sparkles in the last
  flash: image('grows', 'flash', `b=>{const o=[b.length];for(let f=0;f<4;f++)for(let i=0;i<1024;i++){const x=i%32-15.5,y=(i>>5)-15.5,r=Math.hypot(x,y),R=3+4*f;let c=r<R?15-2*r:Math.cos(4*Math.atan2(y,x))**12>.5&&r<2*R?12-r+R:0;if(f>2&&Math.random()<.5)c=0;o.push(Math.max(0,Math.round(c)))}return o}`),
  // SPARK: a jagged bolt from the top row to the bottom, white-hot core, blue glow, a new bolt each frame (it flickers)
  spark: image('crosses', 'spark', `b=>{const o=[b.length];for(let f=0;f<4;f++){const p=Array(1024).fill(0);let x=16;for(let y=0;y<32;y++){x=Math.max(3,Math.min(28,x+Math.floor(Math.random()*5)-2));for(let d=-3;d<4;d++)p[y*32+x+d]=Math.max(p[y*32+x+d],15-4*Math.abs(d))}o.push(...p)}return o}`),
}

/** What every sound and every picture move's prompt adds: how the GBA hears and sees the numbers. */
export const HOW = {
  sound: 'A sound is 8000 numbers a second; 128 is silence, 0 and 255 are loudest. Square wave: keep a phase p, add f/8000 for each number and keep p below 1; output 128 + v when p < d, else 128 − v (d = 0.125, 0.25 or 0.5 changes the voice). Math.random() adds grit.',
  image: 'A picture is 4 frames one after another, each 32 rows of 32 color numbers; 0 is see-through, 1 is the dimmest color and 15 the brightest. It is drawn over the foe, twice the size, frame after frame.',
}

/** One way to write it, for the prompt: the reference body, reading `nums` (the foe's numbers) for the count. */
export const exampleBody = p => p.ref.toString().replace(/^b=>\{/, '').replace(/\}$/, '').replace(/\bb\.length\b/g, 'nums.length')

/** The bytes the GBA gets from a hit (the count dropped): sound samples, or 4 frames of color numbers. */
export const payloadBytes = (p, value) => (p.kind === 'image' ? clampTo(value.slice(1, IMAGE_PIXELS + 1), 15) : clampTo(value.slice(1, SOUND_MAX + 1), 255))
