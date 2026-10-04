// Trusted Node test adapter; guest sees only its independent QuickJS VM.
import { parentPort } from 'node:worker_threads';
globalThis.self = {postMessage: data => parentPort.postMessage(data), close: () => parentPort.close()};
await import('../runner/worker.js');
parentPort.on('message', data => self.onmessage({ data }));
