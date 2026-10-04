import { LIMITS, bytes, jsonShape } from './limits.js';
export class Runner {
  #active;
  #next = 0;
  constructor() {
    this.hide = () => { if (document.hidden) this.cancel(); };
    this.leave = () => this.cancel();
    document.addEventListener('visibilitychange', this.hide);
    window.addEventListener('pagehide', this.leave);
  }
  get active() { return Boolean(this.#active); }
  cancel() { this.#active?.finish({ ok: false, error: 'cancelled' }); }
  dispose() {
    this.cancel();
    document.removeEventListener('visibilitychange', this.hide);
    window.removeEventListener('pagehide', this.leave);
  }
  run(source, inputJSON) {
    this.cancel();
    try {
      if (typeof source !== 'string' || bytes(source) > LIMITS.source || typeof inputJSON !== 'string' || bytes(inputJSON) > LIMITS.input) throw Error('size');
      jsonShape(JSON.parse(inputJSON));
    } catch { return Promise.resolve({ ok: false, error: 'input' }); }
    return new Promise(resolve => {
      const id = ++this.#next;
      const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      let timer;
      const finish = result => {
        if (this.#active?.id !== id) return;
        clearTimeout(timer);
        worker.terminate();
        this.#active = undefined;
        resolve(result);
      };
      this.#active = { id, finish };
      timer = setTimeout(() => finish({ ok: false, error: 'wall-timeout' }), LIMITS.wallMs);
      worker.onerror = () => finish({ ok: false, error: 'worker' });
      worker.onmessage = ({ data }) => {
        if (data.id !== id || this.#active?.id !== id) return;
        if (!data.ok) return finish({ ok: false, error: data.error });
        try {
          if (typeof data.json !== 'string' || bytes(data.json) > LIMITS.output) throw Error();
          const value = JSON.parse(data.json);
          jsonShape(value);
          finish({ ok: true, value });
        } catch { finish({ ok: false, error: 'output' }); }
      };
      worker.postMessage({ id, source, input: inputJSON });
    });
  }
}
