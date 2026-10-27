import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedPdfTask} from '../src/server/pdf-process.ts';

function paper(){
 const pages=21,font=3+pages,content=font+1,info=content+1,stream='BT /F1 12 Tf 72 700 Td (Portable document) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${Array.from({length:pages},(_,i)=>(i+3)+' 0 R').join(' ')}] /Count ${pages} >>`,...Array.from({length:pages},()=>`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`),'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,'<< /Title (Portable PDF) /Author (Mac test) >>'];
 let pdf='%PDF-1.7\n';const offsets:number[]=[];
 objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});
 const start=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${start}\n%%EOF\n`;
 return Buffer.from(pdf);
}
test('packaged metadata worker reads title and author using the platform native canvas',async()=>{
 const result=await isolatedPdfTask(new URL('../dist/server/pdf-metadata-worker.js',import.meta.url),{bytes:paper()},30000);
 assert.equal(result.title,'Portable PDF');assert.equal(result.author,'Mac test');
});
test('packaged split worker produces valid 20-page and 1-page PDFs without altering the input',async()=>{
 const bytes=paper(),original=Buffer.from(bytes);
 const result=await isolatedPdfTask(new URL('../dist/server/pdf-split-worker.js',import.meta.url),{bytes,pages:21},30000);
 assert.deepEqual(result.parts.map((p:any)=>[p.startPage,p.endPage]),[[1,20],[21,21]]);
 for(const part of result.parts){const metrics=await isolatedPdfTask(new URL('../dist/server/pdf-metrics-worker.js',import.meta.url),{bytes:part.bytes},30000);assert.equal(metrics.pages.length,part.endPage-part.startPage+1);}
 assert.deepEqual(bytes,original);
});
