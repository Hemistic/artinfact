import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {isolatedPdfTask} from '../src/server/pdf-process.ts';
import {evidencePdf,evidenceSentence} from './fixtures/evidence-pdf.ts';
test('sentence lookup respects the MinerU region when the same page repeats the identical sentence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pdf-quote-region-')),path=join(root,'repeated.pdf');await writeFile(path,evidencePdf());
 for(const y of [620,320]){const {value}=await isolatedPdfTask(new URL('../dist/server/pdf-evidence-worker.js',import.meta.url),{path,pageIndex:1,quote:evidenceSentence,sourceRect:[70,y-5,330,y+16]},30000);assert.ok(value.rects.length);assert.ok(Math.abs(value.rects[0][1]-y)<5);}
 const {value}=await isolatedPdfTask(new URL('../dist/server/pdf-evidence-worker.js',import.meta.url),{path,pageIndex:0,quote:evidenceSentence,sourceRect:[70,300,330,650]},30000);assert.deepEqual(value.rects,[]);
});
