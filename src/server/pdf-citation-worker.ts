import {parentPort,workerData} from './pdf-process-entry.js';
import {readFile} from 'node:fs/promises';
import {initializePdfCanvas} from './pdf-native-canvas.js';
import {findCitationRects} from '../shared/pdf-citations.js';
import {referenceNoteRect} from '../shared/reference-note-position.js';
try{
 initializePdfCanvas();
 (globalThis as any).pdfjsWorker=await import(new URL('../../vendor/zotero-reader/runtime/pdf/build/pdf.worker.mjs',import.meta.url).href);
 const api=await import(new URL('../../vendor/zotero-reader/runtime/pdf/build/pdf.mjs',import.meta.url).href);
 const doc=await api.getDocument({data:new Uint8Array(await readFile(workerData.path)),useSystemFonts:true,disableFontFace:true,isEvalSupported:false}).promise;
 try{const page=await doc.getPageData({pageIndex:workerData.marker.pageIndex});const rects=findCitationRects(page.chars,workerData.marker.text,workerData.marker.sourceRect,workerData.marker.ordinal,workerData.marker.count,workerData.marker.kind==='bibliography-entry');if(!rects.length)throw Error('引用在 PDF 文本层中无法唯一定位，未使用段落框代替');const physical=await doc.getPage(workerData.marker.pageIndex+1),noteRect=referenceNoteRect(page.chars,physical.view,{rects,sourceRect:workerData.marker.sourceRect},workerData.occupied??[]);parentPort!.postMessage({value:{pageIndex:workerData.marker.pageIndex,rects,...(noteRect?{noteRect}:{})}});}finally{await doc.destroy();}
}catch(error){parentPort!.postMessage({error:error instanceof Error?error.message:String(error)});}
