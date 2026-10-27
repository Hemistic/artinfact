import type {PdfEvidence,PdfEvidencePosition} from '../shared/pdf-evidence.js';
import {showDropdown} from './dropdown.js';
export type EvidenceReturn=()=>Promise<void>;
type BeforeEvidenceOpen=()=>Promise<EvidenceReturn>;
type Hooks={call(name:string,args:Record<string,unknown>):Promise<any>;open(workspaceId:string,id:string):Promise<void>;navigate(position:PdfEvidencePosition):Promise<void>;notice(text:string,error?:boolean):void;returnAvailable(available:boolean):void};
export function createPdfEvidenceNavigation(root:HTMLElement,hooks:Hooks){
 let epoch=0,dialog:HTMLDialogElement|undefined,preserving=false,resume:EvidenceReturn|undefined;
 function clearReturn(){resume=undefined;hooks.returnAvailable(false);}
 const read=(result:any)=>{if(result.isError)throw Error(result.content?.find((c:any)=>c.type==='text')?.text||'PDF 原句定位失败');return result.structuredContent?.research??result._meta?.research;};
 async function locate(workspaceId:string,evidence:PdfEvidence,beforeOpen:BeforeEvidenceOpen,mine:number){
  hooks.notice('正在定位 PDF 原句…');
  const value=read(await hooks.call('pdf_source_locate',{workspaceId,evidence}));if(mine!==epoch)return;
  preserving=true;
  try{
   resume=await beforeOpen();if(mine!==epoch)return;dialog?.close();dialog?.remove();dialog=undefined;
   await hooks.open(workspaceId,value.documentId);if(mine!==epoch)return;
   hooks.returnAvailable(true);await hooks.navigate(value.position);
   hooks.notice('已定位原句 · '+value.title+' · 第 '+(value.pageIndex+1)+' 页 · 点击回退箭头返回图谱');
  }catch(error){if(resume){await resume();clearReturn();}throw error;}
  finally{preserving=false;}
 }
 return {get preserving(){return preserving;},clearReturn,async back(){if(!resume||preserving)return false;preserving=true;try{await resume();clearReturn();return true;}finally{preserving=false;}},cancel(){epoch++;dialog?.close();dialog?.remove();dialog=undefined;clearReturn();},async show(workspaceId:string,target:{nodePath?:string;boardId?:string;nodeId?:string;citationIndex?:number;referenceIndex?:number;referenceRevision?:string},beforeOpen:BeforeEvidenceOpen,anchor?:{left:number;right:number;bottom:number}){
  const mine=++epoch;dialog?.remove();dialog=undefined;
  const value=read(await hooks.call('pdf_source_locations',{workspaceId,...target}));if(mine!==epoch)return;
  const choices:PdfEvidence[]=value.locations??[];
  if(!choices.length){hooks.notice(value.message+(value.warnings?.length?' '+value.warnings.join('；'):''),true);return;}
  if(choices.length===1){await locate(workspaceId,choices[0],beforeOpen,mine);return;}
  dialog=document.createElement('dialog');dialog.className='pdf-evidence-menu';dialog.setAttribute('aria-label','选择 PDF 原句');
  const title=document.createElement('strong');title.textContent='选择要定位的原句';dialog.append(title);
  for(const evidence of choices){const button=document.createElement('button');button.type='button';const name=document.createElement('small'),quote=document.createElement('span');name.textContent=evidence.title+' · 第 '+(evidence.pageIndex+1)+' 页';quote.textContent=evidence.quote;button.append(name,quote);button.onclick=()=>{button.disabled=true;void locate(workspaceId,evidence,beforeOpen,mine).catch(e=>{button.disabled=false;hooks.notice(e instanceof Error?e.message:String(e),true);});};dialog.append(button);}
  root.append(dialog);showDropdown(dialog,anchor);
 }};
}
