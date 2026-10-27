import { build } from 'esbuild';
import { readFile, mkdir, writeFile, cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const root = 'vendor/mineru';
await mkdir(`${root}/runtime`, { recursive: true });
const project = await readFile(`${root}/source/pdf-project-store.js`, 'utf8');
const start = project.indexOf('function normalizePageLabel(');
const end = project.indexOf('function adjustAnnotationsForDeletedPages(');
if (start < 0 || end < start) throw new Error('Unsupported reference layout mapping source');
const prefix = `const {randomUUID}=require('node:crypto');const createID=()=>randomUUID().replaceAll('-','').slice(0,16);const nowISO=()=>new Date().toISOString();const {normalizeMineruContentListPages,buildMineruLayoutMediaGroups}=require('./mineru-layout-normalizer');\n`;
await writeFile(`${root}/source/layout-derived.js`, prefix + project.slice(start, end) + '\nmodule.exports={extractLayoutAnnotationsFromContentList,extractLayoutAnnotationsFromLegacyJson,mapContentListRectToPdfRect,buildContentListCoordinateSpace};\n');
await writeFile(`${root}/source/runtime-paths.js`, "exports.getPdfWorkerDir=()=>__dirname;\n");
for (const [source, target] of [['mineru-markdown-service.js','client'], ['mineru-content-tree.js','tree'], ['layout-derived.js','layout']]) {
  await build({ entryPoints: [`${root}/source/${source}`], bundle: true, outfile: `${root}/runtime/${target}.cjs`, platform: 'node', target: 'node22', format: 'cjs', minify: false, legalComments: 'inline', external: ['@napi-rs/canvas'] });
}
const require = createRequire(import.meta.url);
if (!['win32', 'darwin'].includes(process.platform)) throw new Error('Native canvas packaging currently supports Windows and macOS');
const nativeCanvas = `@napi-rs/canvas-${process.platform}-${process.arch}${process.platform === 'win32' ? '-msvc' : ''}`;
for (const name of ['@napi-rs/canvas', nativeCanvas]) {
  const folder = dirname(require.resolve(name + '/package.json'));
  await cp(folder, join(root, 'runtime/node_modules', name), { recursive: true });
}
process.stdout.write('Built reference MinerU client, layout mapping, structure tree and local image compositor.\n');
