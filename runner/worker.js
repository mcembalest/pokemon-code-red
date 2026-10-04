import { getQuickJS } from 'quickjs-emscripten';
import { LIMITS, bytes, jsonShape } from './limits.js';
let used = false;
self.onmessage = async ({ data }) => {
  if (used) return;
  used = true;
  const { id, source, input } = data;
  let runtime, vm;
  const handles = [];
  const hold = handle => { handles.push(handle); return handle; };
  let deadline = Infinity;
  try {
    if (typeof source !== 'string' || bytes(source) > LIMITS.source || typeof input !== 'string' || bytes(input) > LIMITS.input) throw Error('size');
    jsonShape(JSON.parse(input));
    const QuickJS = await getQuickJS();
    runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(LIMITS.heap);
    runtime.setMaxStackSize(LIMITS.stack);
    deadline = performance.now() + LIMITS.cpuMs;
    runtime.setInterruptHandler(() => performance.now() >= deadline);
    // No module loader, host functions, or job queue execution.
    vm = runtime.newContext();
    const unwrap = result => {
      if (result.error) { result.error.dispose(); throw Error(performance.now() >= deadline ? 'deadline' : 'guest'); }
      return hold(result.value);
    };
    // Capture serialization before guest code. Getters/toJSON run inside the VM,
    // under the same interrupt deadline and heap limit.
    const serialize = unwrap(vm.evalCode(`(()=>{const stringify=JSON.stringify;return value=>{if(value && typeof value.then==='function')throw Error('async');const text=stringify(value);if(typeof text!=='string'||text.length>${LIMITS.output})throw Error('output');return text}})()`));
    const argument = unwrap(vm.evalCode(`JSON.parse(${JSON.stringify(input)})`));
    const fn = unwrap(vm.evalCode(`(function(input){"use strict";\n${source}\n})`, 'guest.js', { type: 'global' }));
    const result = unwrap(vm.callFunction(fn, vm.undefined, argument));
    const encoded = unwrap(vm.callFunction(serialize, vm.undefined, result));
    const text = vm.getString(encoded);
    if (bytes(text) > LIMITS.output) throw Error('output');
    jsonShape(JSON.parse(text));
    if (performance.now() >= deadline) throw Error('deadline');
    self.postMessage({ id, ok: true, json: text });
  } catch (error) {
    self.postMessage({ id, ok: false, error: ['size','schema','output','deadline'].includes(error.message) ? error.message : 'guest' });
  } finally {
    for (const handle of handles.reverse()) handle.dispose();
    vm?.dispose();
    runtime?.dispose();
    self.close();
  }
};
