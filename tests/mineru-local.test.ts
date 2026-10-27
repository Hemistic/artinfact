import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LocalMineruPipeline, normalizeMineruMiddle, localMineruEnvironment, localParseArguments } from '../src/server/mineru-local.ts';
import { PdfStateStore } from '../src/server/pdf-store.ts';
import { simplePdf } from './fixtures/simple-pdf.ts';

const middle = { schema: 'docvortex.middle', schema_version: '2.0', is_full_document: true, pages: [{ page_idx: 0, blocks: [
  { type: 'doc_title', index: 0, level: 1, bbox: [.1,.1,.9,.2], content: [{ type: 'text', content: 'Local sample' }] },
  { type: 'image', index: 1, bbox: [.1,.3,.4,.5], content: [{ type: 'image_body', image_path: 'images/sample.png', content: 'Diagram' }, { type: 'image_caption', content: [{ type: 'text', content: 'Figure 1. Demo' }] }] },
  { type: 'table', index: 2, bbox: [.1,.6,.5,.8], content: [{ type: 'table_body', content: '<table><tr><td>42</td></tr></table>' }] },
  { type: 'equation', index: 3, bbox: [.2,.82,.7,.9], content: 'x=1' },
  { type: 'ref_text', index: 4, bbox: [.1,.91,.8,.95], content: [{ type: 'text', content: '[1] Example paper, 2026.' }] },
] }] };

test('MinerU 4 normalized boxes use the PDF page dimensions, with chart/table/formula and references preserved', () => {
  const result = normalizeMineruMiddle(middle, [{ width: 612, height: 792 }], 'a'.repeat(64), '/data/document-mineru.json');
  assert.deepEqual(result.annotations[0].position, { pageIndex: 0, rects: [[61.2,396,244.8,554.4]] });
  assert.deepEqual(result.annotations.map(a => a.layoutKind), ['figure','table','equation']);
  assert.equal(result.contentList[1].img_path, 'images/sample.png');
  assert.match(JSON.stringify(result.contentList), /Example paper/);
  assert.throws(() => normalizeMineruMiddle({ ...middle, is_full_document: false }, [{width:612,height:792}], 'a'.repeat(64), '/data/a.json'), /完整/);
  assert.throws(() => normalizeMineruMiddle({ ...middle, pages: [{page_idx:2,blocks:[]}] }, [{width:612,height:792}], 'a'.repeat(64), '/data/a.json'), /页/);
  assert.throws(() => normalizeMineruMiddle({ ...middle, pages: [{page_idx:0,blocks:[{type:'image',index:0,bbox:[0,0,800,900],content:[]}]}] }, [{width:612,height:792}], 'a'.repeat(64), '/data/a.json'), /坐标/);
});

test('base installation keeps automatic acceleration without Torch or imposed GPU masks', () => {
  const env = localMineruEnvironment('/local/mineru', { MINERU_API_URL:'https://example.com', MINERU_MODEL_VLM_SERVER_URL:'https://example.com', CUDA_VISIBLE_DEVICES:'0', GGML_VK_VISIBLE_DEVICES:'1', LLAMA_ARG_N_GPU_LAYERS:'0' });
  assert.equal(env.MINERU_MODEL_SMALL_BACKEND, 'onnx'); assert.equal(env.MINERU_MODEL_VLM_ENGINE,'llama-cpp');
  assert.equal(env.CUDA_VISIBLE_DEVICES,'0'); assert.equal(env.GGML_VK_VISIBLE_DEVICES,'1'); assert.equal(env.LLAMA_ARG_N_GPU_LAYERS,undefined); assert.equal(env.MINERU_TABLE_DEVICE,undefined); assert.equal(env.MINERU_MODEL_SOURCE,'local');
  assert.equal(env.MINERU_API_URL,undefined); assert.equal(env.MINERU_MODEL_VLM_SERVER_URL,undefined);
  assert.deepEqual(localParseArguments('source.pdf','result.zip',true), ['parse','source.pdf','-o','result.zip','--tier','standard','--format','zip','--pages','all','--ocr-mode','ocr']);
});

test('layout parsing produces one linked Markdown/JSON result, survives reopening, keeps manual annotations and never uploads', async () => {
  const root = await mkdtemp(join(tmpdir(),'artinfact-local-')), store = new PdfStateStore(root);
  const bytes = simplePdf(), id = createHash('sha256').update(bytes).digest('hex'), pdf = join(root,'source.pdf');
  await writeFile(pdf,bytes); await store.update(id,{annotations:[{id:'manual',type:'highlight',comment:'Keep me'}]});
  let runs = 0, failNext = false;
  const service = new LocalMineruPipeline(store,{ installation: async () => ({ root:'/local/mineru',executable:'/local/mineru/mineru-kit.exe' }), run: async job => {
    runs++; if(failNext)throw new Error('Fixture parser failed'); await mkdir(job.output,{recursive:true}); await writeFile(join(job.output,'markdown.md'),'# Local sample\n\n[1] Example paper, 2026.');
    await writeFile(join(job.output,'middle_json.json'),JSON.stringify(middle));
    await mkdir(join(job.output,'images')); await writeFile(join(job.output,'images/sample.png'),Buffer.from('sample'));
  } });
  try {
    const args = { documentId:id, name:'sample.pdf',size:bytes.length,pages:[{width:612,height:792}],sourcePath:pdf };
    await service.startBatch([args]); await service.settled(id);
    assert.equal((await service.status(id)).phase,'completed'); assert.equal((await service.status(id)).engine,'local');
    assert.equal((await service.layoutStatus(id)).phase,'completed');
    assert.equal(runs,1); assert.ok((await service.markdown(id,0,1000)).text.includes('Local sample'));
    assert.ok((await store.read(id)).annotations.some(a => a.id === 'manual'));
    assert.equal((await service.tree(id)).stats.imageCount,1);
    const result = await service.result(id); assert.ok(JSON.parse(await readFile(join(result.directory,'middle_json.json'),'utf8')).schema === 'docvortex.middle');
    assert.equal((await new LocalMineruPipeline(store).status(id)).phase,'completed');
    const original=(await store.read(id)).annotations.find(a=>a.projectOrigin==='layout-json')!;
    await store.update(id,{annotations:[{...original,comment:'User edited caption',dateModified:'2030-01-01T00:00:00Z'}]});
    await service.startBatch([args],{reconvertCompleted:true}); await service.settled(id); assert.equal(runs,2);
    assert.equal((await store.read(id)).annotations.filter(a=>a.projectOrigin==='layout-json').length,3);
    assert.equal((await service.layout(id)).find(a=>a.id===original.id)?.comment,'User edited caption');
    const successfulDirectory=(await service.result(id)).directory;
    failNext=true;await service.startBatch([args],{reconvertCompleted:true});await service.settled(id);
    assert.equal((await service.status(id)).phase,'failed');assert.equal((await service.result(id)).directory,successfulDirectory);
    assert.ok((await service.markdown(id,0,1000)).text.includes('Local sample'));
    const offline=new LocalMineruPipeline(store,{installation:async()=>{throw Error('Processor intentionally removed');}});
    assert.equal((await offline.layoutStatus(id)).phase,'completed');assert.equal((await offline.cachedLayoutStatus(id))?.figures,1);
    assert.equal((await offline.layout(id)).find(a=>a.id===original.id)?.comment,'User edited caption');await offline.close();
  } finally { await service.close(); await rm(root,{recursive:true,force:true}); }
});

test('missing local processor produces an actionable installation error without changing old results', async () => {
  const root = await mkdtemp(join(tmpdir(),'artinfact-local-missing-')), bytes=simplePdf(), id=createHash('sha256').update(bytes).digest('hex');
  const path=join(root,'source.pdf'); await writeFile(path,bytes);
  const service=new LocalMineruPipeline(new PdfStateStore(root),{installation:async()=>{throw new Error('请运行 Install-MinerU.cmd');}});
  try { await assert.rejects(service.startBatch([{documentId:id,name:'a.pdf',size:bytes.length,pages:[{width:612,height:792}],sourcePath:path}]),/Install-MinerU/); assert.equal((await service.status(id)).phase,'idle'); }
  finally { await service.close(); await rm(root,{recursive:true,force:true}); }
});
