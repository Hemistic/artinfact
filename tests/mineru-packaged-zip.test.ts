import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { zipSync, strToU8 } from 'fflate';

test('packaged MinerU ZIP extraction works without development node_modules and rejects traversal', async () => {
  const root=await mkdtemp(join(tmpdir(),'artinfact-packaged-zip-'));
  try {
    const entry=resolve('src/server/mineru-local.ts');
    const bundle=join(root,'extract.mjs');
    await build({entryPoints:[entry],outfile:bundle,bundle:true,platform:'node',format:'esm',target:'node22',banner:{js:'import {createRequire as __bundleRequire} from "node:module"; const require=__bundleRequire(import.meta.url);'}});
    const {extractLocalMineruZip}=await import(pathToFileURL(bundle).href);
    const archive=join(root,'result.zip'), output=join(root,'output');
    await writeFile(archive,zipSync({'markdown.md':strToU8('# Sample'),'middle_json.json':strToU8('{}'),'images/sample.png':new Uint8Array([1,2,3])}));
    await extractLocalMineruZip(archive,output);
    assert.equal(await readFile(join(output,'markdown.md'),'utf8'),'# Sample');
    assert.deepEqual(await readFile(join(output,'images/sample.png')),Buffer.from([1,2,3]));
    await writeFile(archive,zipSync({'../escape.txt':strToU8('reject')}));
    await assert.rejects(extractLocalMineruZip(archive,join(root,'unsafe')),/invalid relative path|路径无效/);
  } finally {await rm(root,{recursive:true,force:true});}
});

