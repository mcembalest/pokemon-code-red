// Browser stand-in for node:worker_threads (worker side). workerData arrives as the first message.
const listeners = []
export const workerData = await new Promise(resolve => {
  self.onmessage = e => {
    if (e.data && '__workerData' in e.data) { resolve(e.data.__workerData); self.onmessage = ev => listeners.forEach(h => h(ev.data)) }
  }
})
export const parentPort = { postMessage: m => self.postMessage(m), on: (t, h) => { if (t === 'message') listeners.push(h) } }
export class Worker {}
