// Browser stand-in for node:worker_threads (host side): web Worker with Node's event API.
export class Worker {
  constructor(url, { workerData } = {}) {
    this.w = new globalThis.Worker(url, { type: 'module' })
    this.handlers = { message: [], error: [], exit: [] }
    this.w.onmessage = e => this.handlers.message.forEach(h => h(e.data))
    this.w.onerror = e => { e.preventDefault?.(); this.handlers.error.forEach(h => h(new Error(e.message || 'worker error'))) }
    this.w.postMessage({ __workerData: workerData })
  }
  on(type, h) { this.handlers[type].push(h); return this }
  postMessage(m) { this.w.postMessage(m) }
  terminate() { this.w.terminate(); this.handlers.exit.forEach(h => h(1)); return Promise.resolve(1) }
}
export const parentPort = null, workerData = undefined
