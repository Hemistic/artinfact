import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const workspace = resolve('.preview-data');
await mkdir(workspace, { recursive: true });
await writeFile(resolve(workspace, 'README.md'), '# 布局预览测试文件\n');
// The same production CLI handles preview writes in a separate test directory.
function runCli(command, profile, name, folder = workspace) {
  return new Promise(async (resolveResult, reject) => {
    const input = profile ? resolve(workspace, 'profile-input.json') : undefined;
    if (input) await writeFile(input, JSON.stringify(profile));
    const args = ['dist/layouts.js', command, ...(name ? [name] : []), '--workspace', folder, ...(input ? ['--input', input] : [])];
    const child = spawn(process.execPath, args, { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolveResult(JSON.parse(stdout)) : reject(new Error(JSON.parse(stderr).error)));
  });
}
createServer(async (request, response) => {
  try {
    if (request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(await readFile('dist/ui/index.html')); return;
    }
    if (request.method !== 'POST' || request.url !== '/preview/tool') { response.writeHead(404); response.end(); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    const args = payload.arguments;
    const command = ({ layout_open: 'list', layout_list: 'list', layout_save: 'save', layout_plan: 'plan', layout_delete: 'delete' })[payload.name];
    if (!command) throw new Error('未知预览操作');
    const result = await runCli(command, args.profile, args.name, args.workspace);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ structuredContent: result }));
  } catch (error) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ isError: true, content: [{ type: 'text', text: error.message }] })); }
}).listen(4177, '127.0.0.1', () => process.stdout.write('Sidebar UI preview: http://127.0.0.1:4177/?preview=1\n'));
