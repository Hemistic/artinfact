import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PDF_FEATURES,requirePdfAi} from '../src/shared/pdf-features.js';
import {researchArtifactsFingerprint} from '../src/server/research-artifacts.js';

test('AI outline and insights are enabled while internal Markdown export stays disabled',()=>{
 assert.equal(PDF_FEATURES.aiAnalysis,true);assert.doesNotThrow(requirePdfAi);
 assert.equal(PDF_FEATURES.markdownExport,false);
});
test('AI requires both MinerU artifacts and tracks changes inside the same output directory',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'ai-artifacts-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const result={directory,format:'structured' as const};
 await assert.rejects(researchArtifactsFingerprint(result),/布局解析/);
 await writeFile(join(directory,'document-mineru.md'),'# Introduction\nSource evidence.');
 await assert.rejects(researchArtifactsFingerprint({...result,format:'markdown-only'}),/布局解析/);
 await assert.rejects(researchArtifactsFingerprint(result),/布局解析/);
 await writeFile(join(directory,'document-mineru.json'),JSON.stringify([{type:'text',text:'Source evidence.'}]));
 const first=await researchArtifactsFingerprint(result);assert.equal(first,await researchArtifactsFingerprint(result));
 await writeFile(join(directory,'document-mineru.md'),'# Introduction\nChanged source evidence.');
 assert.notEqual(first,await researchArtifactsFingerprint(result));
 const second=await researchArtifactsFingerprint(result);
 await writeFile(join(directory,'document-mineru.json'),JSON.stringify([{type:'text',text:'Changed source evidence.'}]));
 assert.notEqual(second,await researchArtifactsFingerprint(result));
 await writeFile(join(directory,'document-mineru.json'),'invalid JSON');await assert.rejects(researchArtifactsFingerprint(result),/JSON.*无效/);
});
