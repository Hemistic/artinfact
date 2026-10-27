import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { packagePlatform } from '../scripts/package-platform.mjs';

test('published bundle stays below the desktop download cap and preserves real runtime assets and complete sources', async () => {
 const manifest=JSON.parse(await readFile('plugin.json','utf8'));
 const output=process.env.CODEX_PACKAGE_OUTPUT_DIR??'..';
 const archive=join(output,`${manifest.name}-${manifest.version}.zip`);
 const bytes=await readFile(archive);
 assert.ok(bytes.length < 100*1024*1024,`Desktop download cap exceeded: ${bytes.length}`);
 const entries=unzipSync(bytes),root=manifest.name+'/';
 for(const path of ['mcp.json','.mcp.json']){const server=JSON.parse(new TextDecoder().decode(entries[root+path])).mcpServers['work-layout'];assert.equal(server.command,'node');assert.deepEqual(server.env,{});}
 for(const file of ['Install-MinerU.ps1','Install-MinerU.cmd','README.md'])assert.ok(entries[root+'scripts/mineru-local/'+file]?.length>100,`Installation script missing: ${file}`);
 for(const path of Object.keys(entries))assert.ok(!/\.(?:whl|gguf)$|\/(?:cpu-env|processors\/mineru|home\/models)\/|\/tools\/uv\.exe$/i.test(path),`MinerU processor installation payload bundled: ${path}`);
 for(const file of ['dist/server/index.js','dist/ui/pdf.html','vendor/zotero-reader/runtime/reader-local.html','vendor/pdf-worker/runtime/worker.cjs','skills/pdf-reader/SKILL.md','vendor/zotero-reader/COPYING','LICENSE',...packagePlatform().required]) assert.ok(entries[root+file]?.length>100,`Runtime asset missing or empty: ${file}`);
 for(const path of Object.keys(entries))assert.ok(!/\/vendor\/yolo\/|\/(?:src|dist)\/(?:server|shared|ui)\/yolo-[^/]+\.(?:ts|js)$|\/tests\/yolo-[^/]+\.test\.ts$/.test(path),`Retired standalone detector remains: ${path}`);
 if(process.platform==='darwin') for(const path of Object.keys(entries))assert.ok(!/\.(?:exe|dll)$/i.test(path),`Windows binary in Mac archive: ${path}`);
 const retired=JSON.parse(await readFile('scripts/removed-markdown-files.json','utf8'));
 for(const file of retired) assert.equal(entries[root+file]?.length,0,`Retired Markdown code still packaged: ${file}`);
 assert.ok((await stat(join(output,`${manifest.name}-${manifest.version}-source.zip`))).size>bytes.length);
});
