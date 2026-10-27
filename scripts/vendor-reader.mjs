import { mkdir, readFile, writeFile, cp, readdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const project = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: node scripts/vendor-reader.mjs <pdf-ai-project>');
const reader = join(project, 'reader');
const destination = resolve('vendor/zotero-reader');
await mkdir(destination, { recursive: true });
const runtime = join(destination, 'runtime');
await cp(join(reader, 'build/electron'), runtime, {
  recursive: true,
  filter: path => !path.endsWith('.map') && !/^demo\.(pdf|epub|html)$/.test(path.split(/[\\/]/).at(-1)),
});
// Supply the reference project's modified source alongside its compiled reader.
const source = join(destination, 'source/reader');
await mkdir(source, { recursive: true });
for (const name of ['src', 'res', 'locales', 'pdfjs', 'epubjs']) {
  await cp(join(reader, name), join(source, name), { recursive: true, filter: path => !path.split(/[\\/]/).some(part => ['node_modules', 'build', '.git', 'test', 'tests', 'docs', 'examples', '.github'].includes(part)) });
}
for (const entry of await readdir(reader, { withFileTypes: true })) {
  if (!entry.isFile() || entry.name === '.git') continue;
  await cp(join(reader, entry.name), join(source, entry.name));
}
for (const name of ['bing_translate_test.mjs', 'selection-translation-service.mjs']) {
  await cp(join(project, name), join(destination, 'source', name));
}
await cp(join(reader, 'COPYING'), join(destination, 'COPYING'));
const commit = folder => execFileSync('git', ['-C', folder, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
const sha256 = path => readFile(path).then(bytes => createHash('sha256').update(bytes).digest('hex'));
const provenance = { readerRepository: 'https://github.com/zotero/reader', readerCommit: commit(reader), pdfjsRepository: 'https://github.com/zotero/pdf.js', pdfjsCommit: commit(join(reader, 'pdfjs/pdf.js')), sourceProject: 'pdf-ai', modifiedProjectSnapshot: true, runtimeSha256: await sha256(join(runtime, 'reader.js')), importedAt: new Date().toISOString(), license: 'AGPL-3.0', sourceDirectory: 'source', sourceNotes: 'Reader and PDF.js/EPUB.js source and build configuration are included. Dependency installations, upstream tests, examples, generated build outputs and git metadata are omitted.' };
await writeFile(join(destination, 'PROVENANCE.json'), JSON.stringify(provenance, null, 2) + '\n');
process.stdout.write('Imported Zotero Reader runtime and modified source snapshot.\n');
