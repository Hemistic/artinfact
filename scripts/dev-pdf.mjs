import { spawn, fork } from 'node:child_process';
import { watch } from 'node:fs';
import { resolve } from 'node:path';

let preview; let building = false; let dirty = true; let closed = false; let timer;
const watchers = [];
async function stopPreview() {
  if (!preview) return;
  const child = preview; preview = undefined;
  if (child.exitCode !== null || child.signalCode !== null || !child.connected) return;
  await new Promise(resolve => { child.once('exit', resolve); child.send('stop'); });
}
async function rebuild() {
  if (building || closed) return;
  building = true;
  try {
    while (dirty && !closed) {
      dirty = false;
      const code = await new Promise(resolve => {
        const child = spawn(process.execPath, ['scripts/build.mjs'], { env: { ...process.env, CODEX_PLUGIN_DEBUG: '1' }, stdio: 'inherit', windowsHide: true });
        child.once('error', error => { process.stderr.write(`${error.message}\n`); resolve(1); }); child.once('exit', resolve);
      });
      if (code !== 0 || closed) continue;
      await stopPreview();
      preview = fork(resolve('scripts/preview-pdf.mjs'), [], { env: process.env, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], windowsHide: true });
      process.stdout.write('源码映射已启用；修改后自动重建并重启服务，刷新浏览器查看。\n');
    }
  } finally { building = false; }
}
function changed() { dirty = true; clearTimeout(timer); timer = setTimeout(() => { void rebuild(); }, 250); }
watchers.push(watch('src', { recursive: true }, changed));
for (const file of ['scripts/build.mjs', 'scripts/build-reader.mjs', 'vendor/zotero-reader/runtime/reader.js', 'vendor/zotero-reader/runtime/reader.css']) watchers.push(watch(file, changed));
async function close() { closed = true; clearTimeout(timer); for (const watcher of watchers) watcher.close(); await stopPreview(); }
process.once('SIGINT', () => { void close(); }); process.once('SIGTERM', () => { void close(); });
await rebuild();
