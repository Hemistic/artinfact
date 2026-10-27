import {wikiRuntime} from './retained-runtimes.js';
import { readFile, writeFile, mkdir, lstat, readdir, unlink, open, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { renameWithRetry } from './atomic-rename.js';
import type { WorkspaceLibrary } from './workspaces.js';
import type { WorkspaceRuntime } from './workspace-runtime.js';
import { collapseDocumentRepresentations, type DocumentBinding } from './wiki-document-links.js';

const locate = wikiRuntime;
const revision = (text: string) => createHash('sha256').update(text).digest('hex');
async function atomic(path: string, text: string) { await mkdir(dirname(path), { recursive: true }); const tmp = `${path}.${randomUUID()}.tmp`; try { await writeFile(tmp, text, { mode: 0o600 }); await renameWithRetry(tmp, path); } finally { await unlink(tmp).catch(() => undefined); } }

export class ResearchWiki {
  constructor(readonly library: WorkspaceLibrary, private runtime?: WorkspaceRuntime) {}
  private async root(id: string) { return join((await this.library.get(id)).rootDir, 'claude-obsidian-graph-vault'); }
  private async check(root: string, sub = '') {
    let path = root;
    for (const part of ['', ...sub.split('/').filter(Boolean)]) {
      if (part) path = join(path, part);
      try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Wiki 路径不能包含符号链接'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    return path;
  }
  private async walk(root: string, sub = ''): Promise<string[]> {
    await this.check(root, sub); const result: string[] = [];
    for (const entry of await readdir(join(root, sub), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Wiki 包含符号链接，已停止扫描');
      const path = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.isDirectory()) result.push(...await this.walk(root, path)); else result.push(path);
      if (result.length > 20000) throw new Error('Wiki 文件数量超过限制');
    }
    return result;
  }
  private safe(path: string) { if (!/^(wiki\/[\p{L}\p{N}_ .\/-]+\.md|(?:CLAUDE|WIKI)\.md)$/u.test(path) || path.split('/').some(p => p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('Wiki 页面路径无效'); return path; }
  async initialize(id: string) { const root = await this.root(id); await this.check(root); await mkdir(root, { recursive: true }); await this.walk(root); return locate().ensureClaudeObsidianVault(root); }
  async list(id: string) { const rootDir = await this.root(id); try { return { rootDir, pages: (await this.walk(rootDir)).filter(p => p.endsWith('.md') && !p.startsWith('.raw/')) }; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { rootDir, pages: [] }; throw e; } }
  async read(id: string, path: string) { const root = await this.root(id); const file = await this.check(root, this.safe(path)); const size = (await lstat(file)).size; if (size > 2 * 1024 * 1024) throw new Error('Wiki 页面超过 2 MB'); const text = await readFile(file, 'utf8'); return { path, text, revision: revision(text) }; }
  async write(id: string, path: string, text: string, expected: string | null) {
    if (text.length > 2 * 1024 * 1024) throw new Error('Wiki 页面超过 2 MB');
    await this.initialize(id); const root = await this.root(id); const file = await this.check(root, this.safe(path));
    const match = /^wiki\/sources\/([a-f0-9]{64})\.md$/.exec(path);
    if (match) {
      const binding = await this.binding(id, match[1]);
      if (!binding || !locate().fieldList(locate().parseFrontmatter(text).fields, 'sources').includes(binding.markdownPath)) throw new Error('此 PDF 必须先完成 MinerU Markdown 转换并 wiki_import_sources，来源页只能摄入对应 Markdown');
    }
    await mkdir(dirname(file), { recursive: true });
    const lockPath = `${file}.lock`; const lock = await open(lockPath, 'wx').catch(() => { throw new Error('页面正在保存，请稍后重试'); });
    try {
      let prior: string | null = null; try { prior = await readFile(file, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      if ((prior === null ? null : revision(prior)) !== expected) throw new Error('Wiki 页面已改变，请重新读取再合并');
      await this.check(root, path); await atomic(file, text); return { path, revision: revision(text) };
    } finally { await lock.close(); await unlink(lockPath).catch(() => undefined); }
  }
  async importSources(id: string, documentIds: string[]) {
    if (!this.runtime) throw new Error('工作区解析服务不可用');
    const { rootDir } = await this.initialize(id); const sources = []; const prepared = [];
    for (const docId of [...new Set(documentIds)]) {
      const doc = await this.library.document(id, docId); const scope = await this.runtime.scope(id, docId); const result = await scope.mineru.result(docId); if (!result) throw new Error(`${doc.name} 尚未完成 MinerU 转换`);
      if(result.format==='markdown-only')throw Error(`${doc.name} 仍为旧的轻量转换，请先用本机 MinerU 标准版生成 JSON。`);
      const md = await readFile(join(result.directory, 'document-mineru.md'), 'utf8'); if (!md.trim()) throw new Error(`${doc.name} 的 MinerU Markdown 为空`);
      const raw = await readFile(join(result.directory, 'document-mineru.json'), 'utf8'); JSON.parse(raw);
      prepared.push({ docId, doc, result, md, raw });
    }
    for (const { docId, doc, result, md, raw } of prepared) {
      const folder = `.raw/imports/${docId}`; await this.check(rootDir, folder); await mkdir(join(rootDir, folder), { recursive: true });
      await atomic(join(rootDir, folder, 'source.md'), md); if (raw !== undefined) await atomic(join(rootDir, folder, 'source.json'), raw);
      const pdfTarget = await this.check(rootDir, `${folder}/source.pdf`); await copyFile(doc.sourcePath, pdfTarget);
      const copyAssets = async (source: string, target: string) => { await this.check(rootDir, target); await mkdir(join(rootDir, target), { recursive: true }); for (const entry of await readdir(source, { withFileTypes: true })) { if (entry.isSymbolicLink()) throw new Error('解析图片目录不能包含符号链接'); if (entry.isDirectory()) await copyAssets(join(source, entry.name), `${target}/${entry.name}`); else { const file = await this.check(rootDir, `${target}/${entry.name}`); await copyFile(join(source, entry.name), file); } } };
      try { await copyAssets(join(result.directory, 'images'), `${folder}/images`); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      // Source identity is stable across renames and graph clicks resolve through the workspace inventory.
      const manifest: DocumentBinding & { importedAt: string } = { kind: 'mineru-markdown', workspaceId: id, documentId: docId, title: doc.title || doc.name, originalPdf: doc.sourcePath, importedAt: new Date().toISOString(), markdownPath: `${folder}/source.md`, pdfPath: `${folder}/source.pdf`, ...(raw !== undefined ? { jsonPath: `${folder}/source.json` } : {}), format: result.format ?? 'structured', segments: result.segments, markdownSha256: revision(md) };
      for (const [name, key] of [['tree.json', 'structurePath'], ['layout.json', 'layoutPath']] as const) { try { const value = await readFile(join(result.directory, name), 'utf8'); JSON.parse(value); await atomic(join(rootDir, folder, name), value); manifest[key] = `${folder}/${name}`; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
      await atomic(join(rootDir, folder, 'manifest.json'), JSON.stringify(manifest, null, 2)); sources.push(manifest);
    }
    return { rootDir, sources };
  }
  private async binding(id: string, docId: string): Promise<DocumentBinding | undefined> {
    const root = await this.root(id), folder = `.raw/imports/${docId}`;
    await this.check(root, folder);
    let manifest: any; try { manifest = JSON.parse(await readFile(join(root, folder, 'manifest.json'), 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
    const doc = await this.library.document(id, docId);
    if (manifest.workspaceId !== id || manifest.documentId !== docId || manifest.originalPdf !== doc.sourcePath || (manifest.kind && manifest.kind !== 'mineru-markdown')) throw new Error('Markdown 与 PDF 的来源身份不一致，请重新摄入 MinerU 结果');
    for (const file of ['source.md', 'source.json', 'source.pdf']) await this.check(root, `${folder}/${file}`);
    const md = await readFile(join(root, folder, 'source.md'), 'utf8');
    if (manifest.format !== 'markdown-only') JSON.parse(await readFile(join(root, folder, 'source.json'), 'utf8'));
    if (!md.trim() || (manifest.markdownSha256 && manifest.markdownSha256 !== revision(md))) throw new Error('MinerU Markdown 已改变，请重新摄入并更新图谱');
    return { ...manifest, kind: 'mineru-markdown', title: doc.title || doc.name, markdownPath: `${folder}/source.md`, pdfPath: `${folder}/source.pdf`, jsonPath: manifest.format === 'markdown-only' ? undefined : `${folder}/source.json`, markdownSha256: revision(md) };
  }
  async graph(id: string, persist = true): Promise<any> {
    const { rootDir } = await this.initialize(id); await this.walk(rootDir);
    const graph = await locate().buildWikiGraph({ rootDir, ensureVault: false, includeFolderAffinity: false });
    const workspace = await this.library.get(id); const bindings: DocumentBinding[] = [];
    for (const doc of workspace.documents) { const binding = await this.binding(id, doc.id); if (binding) bindings.push(binding); }
    for (const page of graph.pages) {
      const docId = /^wiki\/sources\/([a-f0-9]{64})\.md$/.exec(page.relativePath)?.[1]; if (!docId) continue;
      const binding = bindings.find(b => b.documentId === docId);
      if (!binding || !page.sources.includes(binding.markdownPath)) throw new Error(`${page.title} 尚未摄入 MinerU Markdown，不能使用 PDF 原文提取结果构建知识图谱`);
    }
    collapseDocumentRepresentations(graph, bindings);
    graph.sourceStatus = { totalDocuments: workspace.documents.length, markdownImported: bindings.length, literaturePages: graph.pages.filter((p: any) => /^wiki\/sources\/[a-f0-9]{64}\.md$/.test(p.relativePath)).length };
    // A second plugin panel reading unchanged data must not make every other panel reload its iframe.
    const content = (value: any) => { const { generatedAt: _time, ...data } = value; return JSON.stringify(data); };
    try { const previous = JSON.parse(await readFile(join(rootDir, 'wiki-graph.json'), 'utf8')); if (content(previous) === content(graph)) graph.generatedAt = previous.generatedAt; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
    if (persist) { await atomic(join(rootDir, 'wiki-graph.json'), JSON.stringify(graph)); await atomic(join(rootDir, 'rendered/index.html'), locate().renderClaudeWikiGraphHtml(graph, (await this.library.get(id)).name)); }
    return graph;
  }
  async view(id: string) { const graph = await this.graph(id); return { html: locate().renderClaudeWikiGraphHtml(graph, (await this.library.get(id)).name), generatedAt: graph.generatedAt, summary: graph.summary, sourceStatus: graph.sourceStatus }; }
  async html(id: string) { return (await this.view(id)).html; }
  async status(id: string) { const root = await this.root(id); await this.check(root, 'wiki-graph.json'); try { const graph = JSON.parse(await readFile(join(root, 'wiki-graph.json'), 'utf8')); return { generatedAt: graph.generatedAt, summary: graph.summary }; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { generatedAt: null }; throw e; } }
  async lint(id: string) { const graph = await this.graph(id); return { summary: graph.summary, missing: graph.nodes.filter((n: any) => n.type === 'missing'), orphans: graph.nodes.filter((n: any) => n.type !== 'raw' && n.type !== 'missing' && n.degree === 0), pages: graph.pages }; }
}
