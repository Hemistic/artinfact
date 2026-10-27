import { readFile, writeFile, mkdir, stat, unlink } from 'node:fs/promises';
import { renameWithRetry } from '../server/atomic-rename.js';
import { resolve, join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProfileSchema, StoreSchema, type Profile, type ProfileStore, type LayoutPlan, type Snapshot } from './profile.js';
export { ProfileSchema } from './profile.js';

export async function resolveWorkspace(workspace: string): Promise<string> {
  if (!workspace.trim() || !isAbsolute(workspace)) throw new Error('工作目录必须是本机绝对路径');
  const resolved = resolve(workspace);
  if (/\/\.codex\/plugins\/cache(?:\/|$)/i.test(resolved.replaceAll('\\', '/'))) throw new Error('这是插件缓存目录，请选择真正的项目目录');
  if (!(await stat(resolved).then(value => value.isDirectory(), () => false))) throw new Error(`项目目录不可用：${resolved}`);
  return resolved;
}

export async function loadStore(workspace: string): Promise<ProfileStore> {
  const root = await resolveWorkspace(workspace);
  let raw: string;
  try { raw = await readFile(join(root, '.codex', 'work-layouts.json'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, profiles: {} };
    throw error;
  }
  try { return StoreSchema.parse(JSON.parse(raw.replace(/^\ufeff/, ''))); }
  catch { throw new Error('已有布局配置无法读取，已保留原文件；请先修复 JSON 格式'); }
}

export async function buildPlan(workspace: string, input: unknown): Promise<LayoutPlan> {
  const root = await resolveWorkspace(workspace);
  const profile = ProfileSchema.parse(input);
  const calls: LayoutPlan['calls'] = [];
  const seen = new Set<string>();
  for (const panel of profile.panels) {
    const target = { ...panel.target };
    if (target.type === 'file') {
      target.path = resolve(root, target.path);
      try { if (!(await stat(target.path)).isFile()) throw new Error(); }
      catch { throw new Error(`找不到文件：${target.path}`); }
    }
    const args = { placement: panel.placement, target };
    const identity = JSON.stringify(args);
    if (!seen.has(identity)) {
      seen.add(identity);
      calls.push({ tool: 'mcp__codex_app__open_in_codex', arguments: args });
    }
  }
  return { name: profile.name, workspace: root, calls, applied: false };
}

const writes = new Map<string, Promise<unknown>>();
async function mutate(workspace: string, edit: (store: ProfileStore) => void): Promise<void> {
  const root = await resolveWorkspace(workspace);
  const previous = writes.get(root) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const data = await loadStore(root);
    edit(data);
    const directory = join(root, '.codex');
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `work-layouts.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
      await renameWithRetry(temporary, join(directory, 'work-layouts.json'));
    } finally { await unlink(temporary).catch(() => undefined); }
  });
  writes.set(root, next);
  try { await next; }
  finally { if (writes.get(root) === next) writes.delete(root); }
}

export async function saveProfile(workspace: string, input: unknown): Promise<Snapshot> {
  const profile = ProfileSchema.parse(input);
  await buildPlan(workspace, profile);
  await mutate(workspace, data => { Object.defineProperty(data.profiles, profile.name, { value: profile, writable: true, enumerable: true, configurable: true }); });
  return snapshot(workspace);
}

export async function deleteProfile(workspace: string, name: string): Promise<Snapshot> {
  await mutate(workspace, data => {
    if (!Object.hasOwn(data.profiles, name)) throw new Error('该预设不存在');
    delete data.profiles[name];
  });
  return snapshot(workspace);
}

export async function snapshot(workspace: string): Promise<Snapshot> {
  const root = await resolveWorkspace(workspace);
  const data = await loadStore(root);
  let suggestedFile = '';
  for (const candidate of ['README.md', 'CLAUDE.md', 'AGENTS.md']) {
    if (await stat(join(root, candidate)).then(item => item.isFile(), () => false)) { suggestedFile = candidate; break; }
  }
  return { workspace: root, storePath: join(root, '.codex', 'work-layouts.json'), profiles: Object.values(data.profiles), suggestedFile };
}
