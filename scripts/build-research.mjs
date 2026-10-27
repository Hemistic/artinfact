import { build } from 'esbuild';
import {uiLanguagePlugin} from './ui-language.mjs';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = 'vendor/research/source';
const scratch = '.preview-data/research-build';
await mkdir(scratch, { recursive: true });
await writeFile(`${scratch}/pdf.ts`, `export { getPageMetrics, findTextRects } from ${JSON.stringify(resolve('vendor/pdf-worker/source/src/index.js'))};\n`);
await build({ entryPoints: [`${scratch}/pdf.ts`], outfile: 'vendor/research/runtime/pdf.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs', minify: true, define: { 'import.meta.url': '__codexPdfModuleUrl' }, banner: { js: 'const __codexPdfModuleUrl=require("node:url").pathToFileURL(__filename).href;' }, nodePaths: [resolve('node_modules')], plugins: [{ name: 'optional-browser-canvas', setup(build) { build.onResolve({ filter: /^canvas$/ }, () => ({ path: 'canvas', namespace: 'empty' })); build.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: 'module.exports={};' })); } }] });
for (const name of ['pdfai-context-store', 'pdfai-context-pdf', 'ai-outline-service', 'ai-insight-service', 'project-state-lock', 'mineru-content-tree']) {
  let text = await readFile(`${source}/${name}.js`, 'utf8');
  if (name === 'pdfai-context-store') text = text.replaceAll("requireContextRuntimeModule('", "require('./");
  if (name === 'pdfai-context-pdf') text = text.replace("const entryPath = path.join(resolvePdfWorkerDir(), 'src', 'index.js');", 'const entryPath = process.env.CODEX_RESEARCH_PDF_WORKER;').replace('import(pathToFileURL(entryPath).href).catch', 'Promise.resolve(require(entryPath)).catch');
  await writeFile(`${scratch}/${name}.cjs`, text.replace(/require\('\.\/([^']+?)(?:\.js)?'\)/g, "require('./$1.cjs')"));
}
await build({ entryPoints: [`${scratch}/pdfai-context-store.cjs`], outfile: 'vendor/research/runtime/context.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs', minify: true });
const graphBundle = await build({ entryPoints: ['src/ui/wiki-graph.ts'], bundle: true, write: false, platform: 'browser', target: 'es2022', format: 'iife', minify: true, legalComments: 'none',plugins:[uiLanguagePlugin()] });
const graphScript = graphBundle.outputFiles[0].text.replaceAll('</script', '<\\/script');
const graphStyle = await readFile('src/ui/wiki-graph.css', 'utf8');
const graphTemplate = (await readFile('src/ui/wiki-graph.html', 'utf8')).replace('<!--GRAPH_STYLE-->', () => `<style>${graphStyle}</style>`).replace('<!--GRAPH_SCRIPT-->', () => graphScript);
await writeFile(`${scratch}/renderer.ts`, `import { renderGraphDocument } from ${JSON.stringify(resolve('src/server/wiki-graph-render.ts'))};\nconst template = ${JSON.stringify(graphTemplate)};\nexport function renderClaudeWikiGraphHtml(graph: unknown, title = '知识图谱') { return renderGraphDocument(template, graph, title); }\n`);
await writeFile(`${scratch}/wiki.ts`, `export { buildWikiGraph } from ${JSON.stringify(resolve(source, 'wiki/graph.ts'))};\nexport { ensureClaudeObsidianVault } from ${JSON.stringify(resolve(source, 'wiki/vault.ts'))};\nexport { parseFrontmatter, fieldList } from ${JSON.stringify(resolve(source, 'wiki/markdown.ts'))};\nexport { renderClaudeWikiGraphHtml } from './renderer';\n`);
await build({ entryPoints: [`${scratch}/wiki.ts`], outfile: 'vendor/research/runtime/wiki.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs', minify: true });
await rm(scratch, { recursive: true, force: true });

