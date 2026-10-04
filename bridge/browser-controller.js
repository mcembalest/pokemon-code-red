import { Runner } from '/runner/client.js';
const SOURCE = 'return input.stats.reduce((sum, value) => sum + value, 0);';
// Trusted transport only: no guest pointers, source, or emulator commands.
export class MailboxController {
  constructor(module, runner, interactive) {
    this.interactive = interactive;
    for (const name of ['_ejs_code_red_epoch', '_ejs_code_red_snapshot', '_ejs_code_red_reply']) {
      if (typeof module[name] !== 'function') throw Error(`Missing custom core export ${name}`);
    }
    this.module = module;
    this.runner = runner ?? new Runner();
    this.pointer = module._malloc(36);
    if (!this.pointer) throw Error('Mailbox allocation failed');
    this.hide = () => { if (document.hidden) this.cancel(true); };
    this.leave = () => this.cancel(true);
    document.addEventListener('visibilitychange', this.hide);
    window.addEventListener('pagehide', this.leave);
    this.timer = setInterval(() => this.poll(), 16);
  }
  snapshot() {
    const m = this.module;
    if (!m._ejs_code_red_snapshot(this.pointer, 36)) return null;
    const view = new DataView(m.HEAPU8.slice(this.pointer, this.pointer + 36).buffer);
    if (view.getUint32(0, true) !== 0x31445243 || view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== 1 || ![1, 2].includes(view.getUint16(16, true))) return null;
    const stats = Array.from({length: 6}, (_, i) => view.getUint16(20 + i * 2, true));
    if (stats.some(value => value > 255)) return null;
    return { operation: view.getUint16(16, true), id: view.getUint32(8, true), epoch: view.getUint32(12, true), stats };
  }
  cancel(reply = false) {
    const pending = this.pending;
    this.pending = null;
    this.runner.cancel();
    this.interactive?.close();
    if (reply && pending) this.module._ejs_code_red_reply(pending.epoch, pending.id, 2, 0);
  }
  poll() {
    const current = this.snapshot();
    if (this.pending && (!current || current.id !== this.pending.id || current.epoch !== this.pending.epoch)) this.cancel();
    if (document.hidden || !current || this.pending) return;
    const pending = this.pending = current;
    if (current.operation === 2 && this.interactive) {
      this.interactive.open(pending, (result) => {
        if (this.pending !== pending) return;
        const now = this.snapshot();
        this.pending = null;
        if (!now || now.id !== pending.id || now.epoch !== pending.epoch || this.module._ejs_code_red_epoch() !== pending.epoch) return;
        const numeric = Number.isInteger(result) && result >= 0 && result <= 1530;
        this.module._ejs_code_red_reply(pending.epoch, pending.id, numeric ? 0 : 2, numeric ? result : 0);
      });
      return;
    }
    this.runner.run(SOURCE, JSON.stringify({stats: current.stats})).then(result => {
      if (this.pending !== pending) return;
      const now = this.snapshot();
      if (!now || now.id !== pending.id || now.epoch !== pending.epoch || this.module._ejs_code_red_epoch() !== pending.epoch) { this.cancel(); return; }
      this.pending = null;
      const valid = result.ok && Number.isInteger(result.value) && result.value >= 0 && result.value <= 1530;
      this.module._ejs_code_red_reply(pending.epoch, pending.id, valid ? 0 : 1, valid ? result.value : 0);
    }).catch(() => {
      if (this.pending !== pending) return;
      this.pending = null;
      this.module._ejs_code_red_reply(pending.epoch, pending.id, 1, 0);
    });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.timer);
    this.cancel(true);
    this.runner.dispose();
    document.removeEventListener('visibilitychange', this.hide);
    window.removeEventListener('pagehide', this.leave);
    this.module._free(this.pointer);
  }
}
