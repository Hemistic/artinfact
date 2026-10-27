import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { resolveWorkspace } from '../shared/layout.js';

export async function documentsFolder(): Promise<string> {
  if (process.platform !== 'win32') return join(homedir(), 'Documents');
  // The Windows Known Folder can be redirected to OneDrive or another drive.
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); [Environment]::GetFolderPath('MyDocuments')"], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  const path = stdout.trim();
  if (!path || !isAbsolute(path)) throw new Error('无法确定系统文档文件夹，请配置 CODEX_LAYOUT_WORKSPACE');
  return path;
}
export async function prepareWorkspace(override?: string, documents = documentsFolder): Promise<string> {
  if (override?.trim()) return resolveWorkspace(override);
  const path = join(await documents(), 'Artinfact');
  await mkdir(path, { recursive: true });
  return resolveWorkspace(path);
}
