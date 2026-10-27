import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
if (!process.argv[2]) throw new Error('Usage: node scripts/vendor-pdf-worker.mjs <pdf-worker-project>');
const input = resolve(process.argv[2]);
const output = resolve('vendor/pdf-worker');
await mkdir(`${output}/runtime`, { recursive: true });
await mkdir(`${output}/source/pdf.js`, { recursive: true });
await cp(`${input}/build/worker.js`, `${output}/runtime/worker.cjs`);
for (const name of ['cmaps', 'standard_fonts']) await cp(`${input}/build/${name}`, `${output}/runtime/${name}`, { recursive: true });
for (const name of ['src', 'scripts', 'package.json', 'package-lock.json', 'webpack.config.cjs', 'README.md']) await cp(`${input}/${name}`, `${output}/source/${name}`, { recursive: true });
for (const name of ['src', 'external', 'web', 'l10n', 'extensions', 'gulpfile.mjs', 'package.json', 'package-lock.json', 'pdfjs.config', 'tsconfig.json', 'LICENSE']) await cp(`${input}/pdf.js/${name}`, `${output}/source/pdf.js/${name}`, { recursive: true });
await cp(`${input}/COPYING`, `${output}/COPYING`);
await mkdir(`${output}/licenses`, { recursive: true });
for (const [name, license] of [['pako', 'LICENSE'], ['core-js', 'LICENSE'], ['fastest-levenshtein', 'LICENSE.md']]) {
  await cp(`${input}/node_modules/${name}/${license}`, `${output}/licenses/${name}.txt`);
  await cp(`${input}/node_modules/${name}/package.json`, `${output}/licenses/${name}.package.json`);
}
await writeFile(`${output}/PROVENANCE.json`, JSON.stringify({ repository: 'https://github.com/zotero/pdf-worker', importedFrom: 'pdf-ai/pdf-worker', commit: execFileSync('git', ['-C', input, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), pdfJsCommit: execFileSync('git', ['-C', `${input}/pdf.js`, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), workerSha256: createHash('sha256').update(await readFile(`${input}/build/worker.js`)).digest('hex'), license: 'AGPL-3.0', modifiedRuntime: false }, null, 2));
