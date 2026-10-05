// Build the embeddable player bundle into player/dist/.
//   dist/code-red.js, code-red.css, index.html  player
//   dist/runner/                                  QuickJS worker (../runner)
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
const core = readFileSync(need(join(root, 'build/core/code-red-mgba-wasm.data'), 'make core-fetch (or core/build.sh)'))
const coreSha = createHash('sha256').update(core).digest('hex')
if (coreSha !== coreLock.sha256 && !process.env.CODE_RED_UNPINNED_CORE) {
  console.error(`core sha256 ${coreSha} != core/release.json ${coreLock.sha256}\n  -> make core-fetch, or set CODE_RED_UNPINNED_CORE=1 to test a local core build`)
  process.exit(1)
}
writeFileSync(join(dist, 'emulator/cores/code-red-mgba-wasm.data'), core)
writeFileSync(join(dist, 'emulator/code-red-core.json'), JSON.stringify({ ...coreLock, sha256: coreSha, sources: JSON.parse(readFileSync(join(root, 'core/sources.lock.json'), 'utf8')) }, null, 2))
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

// Player.
cpSync(join(here, 'index.html'), join(dist, 'index.html'))
const options = {
  entryPoints: { 'code-red': join(here, 'src/main.ts') },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  outdir: dist, sourcemap: true, logLevel: 'info',
}
if (watch) { const ctx = await context(options); await ctx.watch() } else await build(options)
