import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { resolve, relative, dirname, join } from 'node:path';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { Validator } from '@cfworker/json-schema';
import { packagePlatform, portableMcp } from './package-platform.mjs';

const directory = process.cwd();
const platform = packagePlatform();
const manifest = JSON.parse(await readFile('plugin.json', 'utf8'));
const mcp = JSON.parse(await readFile('mcp.json', 'utf8'));
for (const document of [manifest, mcp]) {
  let schema;
  if (/^https:\/\/agent-plugins\.org\/schemas\/1\.0\.0\/(plugin|mcp)\.schema\.json$/.test(document.$schema)) {
    schema = JSON.parse(await readFile(new URL(`./schemas/${document.$schema.split('/').pop()}`, import.meta.url), 'utf8'));
    if (schema.$id !== document.$schema) throw new Error('Bundled schema identity mismatch');
  } else {
    const response = await fetch(document.$schema);
    if (!response.ok) throw new Error(`Cannot fetch schema: ${response.status}`);
    schema = await response.json();
  }
  const result = new Validator(schema).validate(document);
  if (!result.valid) throw new Error(JSON.stringify(result.errors));
}
const previous = JSON.parse(await readFile('scripts/baseline.json', 'utf8'));
if (manifest.name !== previous.name) throw new Error('Plugin identity changed');
if (JSON.stringify(manifest.extensions['com.openai'].interface.defaultPrompt) !== JSON.stringify(previous.defaultPrompt)) throw new Error('Original default prompts changed');
if ([...manifest.extensions['com.openai'].interface.shortDescription].length > 30) throw new Error('Plugin subtitle is too long');
const overlay = {
  name: manifest.name, version: manifest.version, description: manifest.description,
  author: manifest.author, keywords: manifest.keywords, skills: './skills/', mcpServers: './.mcp.json',
  interface: manifest.extensions['com.openai'].interface,
};
await writeFile('.codex-plugin/plugin.json', JSON.stringify(overlay, null, 2) + '\n');
const files = {};
const excluded = new Set(['node_modules', '__pycache__', '.preview-data', '.git']);
async function collect(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (excluded.has(entry.name) && !(entry.name === 'node_modules' && relative(directory, folder).replaceAll('\\', '/') === 'vendor/mineru/runtime')) continue;
    const path = join(folder, entry.name);
    if (!platform.include(relative(directory, path).replaceAll('\\', '/'))) continue;
    if (entry.isSymbolicLink()) throw new Error('Symlinks cannot be packaged');
    if (entry.isDirectory()) await collect(path);
    else if (!entry.name.endsWith('.pyc') && !entry.name.endsWith('.py') && !entry.name.endsWith('.tmp') && !entry.name.endsWith('.zip')) {
      files[manifest.name + '/' + relative(directory, path).replaceAll('\\', '/')] = new Uint8Array(await readFile(path));
    }
  }
}
await collect(directory);
for(const path of ['mcp.json','.mcp.json']) files[manifest.name+'/'+path]=strToU8(JSON.stringify(portableMcp(JSON.parse(await readFile(path,'utf8'))),null,2)+'\n');
const removedMarkdownFiles = JSON.parse(await readFile('scripts/removed-markdown-files.json', 'utf8'));
for (const path of removedMarkdownFiles) {
  if (path.startsWith('/') || path.includes('..') || path.includes('\\')) throw new Error('Invalid retired path');
  if (files[manifest.name + '/' + path]) throw new Error(`Retired Markdown code reintroduced: ${path}`);
  // The cloud updater overlays releases; empty entries clear the old implementation there.
  files[manifest.name + '/' + path] = new Uint8Array();
}
for (const path of ['skills/work-layout/scripts/layouts.py', 'tests/test_layouts.py']) files[manifest.name + '/' + path] = strToU8('');
const outputDirectory = resolve(process.env.CODEX_PACKAGE_OUTPUT_DIR ?? dirname(directory));
await mkdir(outputDirectory, {recursive:true});
const archive = resolve(outputDirectory, `${manifest.name}-${manifest.version}.zip`);
const sourceArchive = resolve(outputDirectory, `${manifest.name}-${manifest.version}-source.zip`);
await writeFile(sourceArchive, zipSync(files, { level: 6 }));
// Cloud updates overlay old releases; explicit small replacements prevent old build-only copies from remaining in the download.
const runtimeFiles = { ...files };
const sourceOnly = path => /^vendor\/[^/]+\/source\//.test(path) || path.startsWith('vendor/workspace-ui/fonts/') || path === 'src/ui/workspace-shell.css' || /^dist\/ui\/(?:app|pdf)\.(?:js|css)$/.test(path);
const sourcePlaceholder = strToU8(`Build-only file. Complete corresponding source is provided in ${manifest.name}-${manifest.version}-source.zip; see SOURCE-BUNDLE.md.\n`);
for (const path of Object.keys(runtimeFiles)) {
  const relativePath = path.slice(manifest.name.length + 1);
  if (sourceOnly(relativePath) && !removedMarkdownFiles.includes(relativePath)) runtimeFiles[path] = sourcePlaceholder;
}
const bytes = zipSync(runtimeFiles, { level: 9 });
if (bytes.length >= 100 * 1024 * 1024) throw new Error(`Desktop plugin download exceeds 100 MiB: ${bytes.length} bytes`);
const extracted = unzipSync(bytes);
if (Object.keys(extracted).length !== Object.keys(files).length) throw new Error('Archive verification failed');
for (const required of ['plugin.json', 'mcp.json', '.mcp.json', '.codex-plugin/plugin.json', 'dist/server/index.js', 'dist/server/pdf-export-worker.js', 'dist/server/pdf-split-worker.js', 'vendor/pdf-worker/runtime/worker.cjs', 'vendor/pdf-worker/COPYING', 'dist/ui/index.html', 'dist/layouts.js', 'skills/work-layout/SKILL.md']) {
  if (!extracted[manifest.name + '/' + required]) throw new Error(`Missing archive entry: ${required}`);
}
await writeFile(archive, bytes);
for (const path of platform.required) {
  if (!extracted[manifest.name + '/' + path]) throw new Error(`Missing MinerU runtime: ${path}`);
}
process.stdout.write(JSON.stringify({ archive, bytes: (await stat(archive)).size, files: Object.keys(files).length, sourceArchive, desktopDownloadCap: 'passed', manifestValidation: 'passed', mcpValidation: 'passed', originalIdentityAndPrompts: 'preserved', legacyPython: 'empty and unreferenced' }, null, 2) + '\n');
