// Browser bundle of the kernel → dist/: kernel.js (ESM), codemode-worker.js, quickjs.wasm.
// node:worker_threads is swapped for a web Worker shim; other node: imports are never reached.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, 'dist')
rmSync(dist, { recursive: true, force: true }); mkdirSync(dist)
const shims = threads => ({ name: 'node-shims', setup(b) {
  b.onResolve({ filter: /^node:worker_threads$/ }, () => ({ path: join(here, 'browser', threads) }))
  b.onResolve({ filter: /^node:/ }, () => ({ path: join(here, 'browser/stub.js') }))
} })
const common = { bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, metafile: true, logLevel: 'warning', legalComments: 'linked' }
const out = [
  await build({ ...common, entryPoints: { kernel: join(here, 'browser/index.mjs') }, outdir: dist, plugins: [shims('wt-host.js')] }),
  await build({ ...common, entryPoints: { 'codemode-worker': join(here, 'browser/codemode-worker.js') }, outdir: dist, plugins: [shims('wt-worker.js')] }),
]
const require = createRequire(import.meta.url)
copyFileSync(join(dirname(require.resolve('quickjs-wasi/package.json')), 'quickjs.wasm'), join(dist, 'quickjs.wasm'))
for (const m of out) for (const [f, o] of Object.entries(m.metafile.outputs)) if (!f.endsWith('.map')) console.log(f, o.bytes)
