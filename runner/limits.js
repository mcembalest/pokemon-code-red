export const LIMITS = Object.freeze({ source: 8192, input: 4096, output: 4096, heap: 8 * 1024 * 1024, stack: 128 * 1024, cpuMs: 250, wallMs: 3000 });
export const bytes = text => new TextEncoder().encode(text).length;
export function jsonShape(value, depth = 0) {
  if (depth > 8) throw Error('schema');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) jsonShape(item, depth + 1); return; }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('schema');
      jsonShape(item, depth + 1);
    }
    return;
  }
  throw Error('schema');
}
