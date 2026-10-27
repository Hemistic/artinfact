import { readFile } from 'node:fs/promises';
import { snapshot, saveProfile, deleteProfile, buildPlan, loadStore } from './shared/layout.js';
import { friendlyError } from './shared/profile.js';

const [command, ...args] = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
const workspace = option('--workspace') ?? process.cwd();
try {
  let result: unknown;
  if (command === 'list') result = await snapshot(workspace);
  else if (command === 'delete') result = await deleteProfile(workspace, args[0]);
  else if (command === 'save' || command === 'plan') {
    const input = option('--input');
    const profile = input ? JSON.parse((await readFile(input, 'utf8')).replace(/^\ufeff/, '')) : (await loadStore(workspace)).profiles[args[0]];
    if (!profile) throw new Error('需要 --input <profile.json> 或已保存的预设名称');
    result = command === 'save' ? await saveProfile(workspace, profile) : await buildPlan(workspace, profile);
  } else throw new Error('用法：node dist/layouts.js list|save|plan [名称] --workspace <项目路径> [--input <JSON>]');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ error: friendlyError(error) }) + '\n');
  process.exitCode = 1;
}
