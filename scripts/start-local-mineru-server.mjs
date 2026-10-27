import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
const source = resolve(process.argv[2] || '');
if (!process.argv[2] || !existsSync(join(source, 'src/index.ts')) || !existsSync(join(source, 'node_modules/tsx/dist/cli.mjs'))) throw new Error('用法：node scripts/start-local-mineru-server.mjs <原项目 server 目录>；该目录须已安装依赖。');
const require = createRequire(join(source, 'package.json'));
const env = require('dotenv').parse(await readFile(join(source, '.env')));
const data = join(homedir(), '.codex/plugin-data/codex-work-layout/local-server');
await mkdir(data, { recursive: true });
for (const name of ['upstreams.json', 'pricing.json', 'image-upstreams.json', 'mineru-upstreams.json']) {
  if (!existsSync(join(data, name)) && existsSync(join(source, 'config', name))) await copyFile(join(source, 'config', name), join(data, name));
}
const adminFile = join(data, 'admin-token');
const admin = existsSync(adminFile) ? (await readFile(adminFile, 'utf8')).trim() : randomBytes(32).toString('hex');
if (!existsSync(adminFile)) await writeFile(adminFile, admin, { mode: 0o600 });
const baseUrl = 'http://127.0.0.1:4197';
try {
  const runtime = JSON.parse(await readFile(join(data, 'runtime.json'), 'utf8'));
  if (runtime.baseUrl === baseUrl && (await fetch(baseUrl + '/health', { signal: AbortSignal.timeout(2000) })).ok) {
    process.stdout.write(JSON.stringify({ baseUrl, alreadyRunning: true, log: join(data, 'server.log') }) + '\n'); process.exit(0);
  }
} catch { /* Start the local Server when its previous process is unavailable. */ }
const log = createWriteStream(join(data, 'server.log'), { flags: 'a' });
const child = spawn(process.execPath, [join(source, 'node_modules/tsx/dist/cli.mjs'), join(source, 'src/index.ts')], {
  cwd: source, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ...env, HOST: '127.0.0.1', PORT: '4197', ADMIN_TOKEN: admin, LOG_LEVEL: 'warn', DATABASE_PATH: join(data, 'relay.db'), UPSTREAMS_FILE: join(data, 'upstreams.json'), PRICING_FILE: join(data, 'pricing.json'), MINERU_UPSTREAMS_FILE: join(data, 'mineru-upstreams.json'), IMAGE_UPSTREAMS_FILE: join(data, 'image-upstreams.json'), API_RELAY_ENABLED: 'false', OPENAI_RESPONSES_RELAY_ENABLED: 'false', IMAGE_GENERATION_ENABLED: 'false', PDF_CONVERSION_ENABLED: 'true', MIHOMO_MANAGED_SUBSCRIPTION_URL: '', MIHOMO_PROXY_PROFILES_FILE: join(data, 'mihomo-proxy-profiles.json'), MIHOMO_PROFILES_DIR: join(data, 'mihomo-profiles') },
});
child.stdout.pipe(log); child.stderr.pipe(log);
let exited = false; child.once('exit', () => { exited = true; });
for (let n = 0; n < 80; n++) { if (exited) throw new Error('Server 启动失败，请查看本机 server.log'); try { if ((await fetch(baseUrl + '/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
if (!(await fetch(baseUrl + '/health')).ok) throw new Error('本机 Server 未就绪');
const settingsFile = join(homedir(), '.codex/plugin-data/codex-work-layout/pdf-reader/mineru-settings.json');
await mkdir(join(homedir(), '.codex/plugin-data/codex-work-layout/pdf-reader'), { recursive: true });
if (!existsSync(settingsFile)) {
  const response = await fetch(baseUrl + '/admin/client-keys', { method: 'POST', headers: { 'x-admin-token': admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'codex-work-layout-local', quota: 100 }) });
  if (!response.ok) throw new Error('创建本机 Client Key 失败：' + response.status);
  const payload = await response.json(); if (!payload.secret) throw new Error('Server 没有返回 Client Key');
  await writeFile(settingsFile, JSON.stringify({ version: 1, baseUrl, clientKey: payload.secret }), { mode: 0o600 });
}
const channel = await fetch(baseUrl + '/admin/mineru', { headers: { 'x-admin-token': admin } }).then(r => r.json());
await writeFile(join(data, 'runtime.json'), JSON.stringify({ baseUrl, pid: child.pid, source, startedAt: new Date().toISOString() }));
process.stdout.write(JSON.stringify({ baseUrl, clientKeySavedLocally: true, isolatedDatabase: true, mineruConfigured: channel.channel?.hasApiToken ?? channel.channel?.apiTokenConfigured ?? 'see admin', log: join(data, 'server.log') }) + '\n');
process.once('SIGINT', () => child.kill()); process.once('SIGTERM', () => child.kill());
await new Promise(r => child.once('exit', r));
