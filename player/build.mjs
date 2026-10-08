// Build the embeddable player bundle into player/dist/.
//   dist/code-red.js, code-red.css, index.html  player
//   dist/runner/                                  QuickJS worker (../runner)
//   dist/kernel/                                  pi-ai models + streaming (../kernel)
//   dist/emulator/                                pinned EmulatorJS + Code Red core
//   dist/rom/                                     rom.json + copy patch (no ROM bytes)
// Inputs: ../.cache/browser/data (make browser-setup), ../build/core/ (core),
//         ../build/rom/ (make rom-bundle). Pass --watch to rebuild the player JS on change.
import { build, context } from 'esbuild'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const dist = join(here, 'dist')
const watch = process.argv.includes('--watch')
const need = (path, hint) => { if (!existsSync(path)) { console.error(`missing ${path}\n  -> ${hint}`); process.exit(1) } return path }

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

// Emulator: pinned EmulatorJS frontend + the ROM-agnostic Code Red core.
cpSync(need(join(root, '.cache/browser/data'), 'make browser-setup'), join(dist, 'emulator'), { recursive: true })
cpSync(join(root, '.cache/browser/frontend/package/LICENSE'), join(dist, 'emulator/LICENSE'))
const coreLock = JSON.parse(readFileSync(join(root, 'core/release.json'), 'utf8'))
for (const [name, pinned] of Object.entries(coreLock.files)) {
  const core = readFileSync(need(join(root, 'build/core', name), 'make core-fetch (or core/build.sh)'))
  const sha = createHash('sha256').update(core).digest('hex')
  if (sha !== pinned && !process.env.CODE_RED_UNPINNED_CORE) {
    console.error(`${name} sha256 ${sha} != core/release.json ${pinned}\n  -> make core-fetch, or set CODE_RED_UNPINNED_CORE=1 to test a local core build`)
    process.exit(1)
  }
  writeFileSync(join(dist, 'emulator/cores', name), core)
}
writeFileSync(join(dist, 'emulator/code-red-core.json'), JSON.stringify({ ...coreLock, sources: JSON.parse(readFileSync(join(root, 'core/sources.lock.json'), 'utf8')) }, null, 2))
writeFileSync(join(dist, 'emulator/SOURCES.txt'), [
  'EmulatorJS 4.2.3 (GPL-3.0): https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3',
  'Code Red mGBA core: built by .github/workflows/core.yml in https://github.com/mcembalest/pokemon-code-red',
  '  from pinned EmulatorJS/mgba (MPL-2.0) and EmulatorJS/RetroArch (GPL-3.0) sources; see code-red-core.json',
  '  adapter + patches: https://github.com/mcembalest/pokemon-code-red/tree/main/core',
  'Local change: optional CDN update check disabled.', '',
].join('\n'))

// ROM side: copy patch + build identity. Never ROM bytes.
const romDir = need(join(root, 'build/rom'), 'make rom-bundle (needs local/baserom.gba)')
cpSync(romDir, join(dist, 'rom'), { recursive: true })

// Runner: bundled QuickJS worker from ../runner.
need(join(root, 'runner/node_modules'), 'cd runner && npm ci')
execFileSync(process.execPath, ['build.mjs'], { cwd: join(root, 'runner'), stdio: 'inherit' })
mkdirSync(join(dist, 'runner'))
for (const file of ['client.js', 'worker.js', 'emscripten-module.wasm', 'LICENSES.txt']) cpSync(join(root, 'runner/dist', file), join(dist, 'runner', file))

// Kernel: pi-ai models + streaming (the code a Pokémon writes in battle comes through it).
need(join(root, 'kernel/node_modules'), 'cd kernel && npm ci')
execFileSync(process.execPath, ['build.mjs'], { cwd: join(root, 'kernel'), stdio: 'inherit' })
mkdirSync(join(dist, 'kernel'))
for (const file of ['kernel.js', 'codemode-worker.js', 'quickjs.wasm']) cpSync(join(root, 'kernel/dist', file), join(dist, 'kernel', file))
for (const file of ['kernel.js.LEGAL.txt', 'codemode-worker.js.LEGAL.txt']) if (existsSync(join(root, 'kernel/dist', file))) cpSync(join(root, 'kernel/dist', file), join(dist, 'kernel', file))

// Player.
cpSync(join(here, 'index.html'), join(dist, 'index.html'))
const options = {
  entryPoints: { 'code-red': join(here, 'src/main.ts') },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  outdir: dist, sourcemap: true, logLevel: 'info',
}
if (watch) { const ctx = await context(options); await ctx.watch() } else await build(options)
