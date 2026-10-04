import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['worker.js', 'client.js'], bundle: true, format: 'esm', platform: 'browser', outdir: 'dist', target: 'es2022' });
await copyFile('node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', 'dist/emscripten-module.wasm');
await copyFile('index.html', 'dist/index.html');
await copyFile('fixture.json', 'dist/fixture.json');
await writeFile('dist/LICENSES.txt', await readFile('node_modules/@jitl/quickjs-wasmfile-release-sync/LICENSE', 'utf8'));
