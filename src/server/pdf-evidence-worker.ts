import {parentPort,workerData} from './pdf-process-entry.js';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {initializePdfCanvas} from './pdf-native-canvas.js';
const require=createRequire(import.meta.url),root=new URL('../../vendor/pdf-worker/runtime/',import.meta.url);
const asset=(folder:string,name:string)=>{if(!/^[A-Za-z0-9_.-]+$/.test(name)||name==='.'||name==='..')throw Error('PDF 字体资源无效');return readFile(new URL(`${folder}/${name}`,root));};
try{
 initializePdfCanvas();
 const toolkit=require(fileURLToPath(new URL('../../vendor/research/runtime/pdf.cjs',import.meta.url)));
 const bytes=await readFile(workerData.path);
 const positions=await toolkit.findTextRects(Uint8Array.from(bytes).buffer,[{id:'evidence',pageIndex:workerData.pageIndex,quote:workerData.quote,sourceRect:workerData.sourceRect}],'',async(name:string)=>({compressionType:1,cMapData:await asset('cmaps',name+'.bcmap')}),(name:string)=>asset('standard_fonts',name));
 parentPort!.postMessage({value:positions[0]});
}catch(error){parentPort!.postMessage({error:error instanceof Error?error.message:String(error)});}
