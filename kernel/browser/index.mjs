// Browser entry of the kernel. The host passes where it serves the sandbox files.
//   import { setupBrowserKernel } from '.../kernel.js'
//   setupBrowserKernel(new URL('./', import.meta.url))
import { configureSandbox } from '../code.mjs'

/** No cross-origin isolation on the site: plain ArrayBuffer instead (timeouts still terminate the worker). */
globalThis.SharedArrayBuffer ??= ArrayBuffer

export function setupBrowserKernel(base) {
  configureSandbox({
    wasm: WebAssembly.compileStreaming(fetch(new URL('quickjs.wasm', base))),
    workerUrl: new URL('codemode-worker.js', base),
  })
}
export * from '../index.mjs'
export { createModels } from '@earendil-works/pi-ai/models'
