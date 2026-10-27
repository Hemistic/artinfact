import {snapshotNoteCode,bindStaticNoteCode} from './note-code.js';
import {createNoteSurface,type NoteSurfaceOptions} from './note-surface.js';
import {observeElementConnection} from '../shared/element-lifecycle.js';
import {settleNoteDiagrams,uniqueNoteDiagrams,bindNoteExtensions} from './note-extensions.js';
const cache=new Map<string,string>();let cacheBytes=0;
export function noteStaticHtml(host:HTMLElement){const node=host.querySelector('.milkdown');if(!node)return '';const clone=node.cloneNode(true) as HTMLElement;for(const item of clone.querySelectorAll('[contenteditable]'))item.setAttribute('contenteditable','false');for(const item of clone.querySelectorAll('.milkdown-toolbar,.wb-note-table-toolbar,.milkdown-block-handle,.milkdown-slash-menu,.milkdown-ai-instruction,.milkdown-diff-actions'))item.remove();snapshotNoteCode(clone);return clone.outerHTML;}
export function showStaticNote(host:HTMLElement,html:string,options:NoteSurfaceOptions={}){host.classList.add('wb-note-surface','flow-markdown');host.classList.toggle('wb-note-document',options.variant!=='excerpt');host.dataset.readonly='true';host.innerHTML=html;uniqueNoteDiagrams(host);bindNoteExtensions(host,options);bindStaticNoteCode(host);}
type Job={host:HTMLElement;target:Element;run():Promise<void>;resolve():void;reject(error:unknown):void;stop():void};
const jobs:Job[]=[],visible=new Set<Element>();let running=false,scheduled=false;
const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting)visible.add(entry.target);else visible.delete(entry.target);}schedule();},{rootMargin:'240px'});
function forget(job:Job){job.stop();if(!jobs.some(other=>other.target===job.target)){observer.unobserve(job.target);visible.delete(job.target);}}
function schedule(){if(scheduled||running)return;scheduled=true;setTimeout(()=>{scheduled=false;void drain();},0);}
async function drain(){if(running||document.hidden)return;running=true;try{
 while(jobs.length){
  for(const job of [...jobs])if(!job.host.isConnected){jobs.splice(jobs.indexOf(job),1);forget(job);job.resolve();}
  const available=(job:Job)=>{const canvas=job.host.closest<HTMLElement>('.wb-editor');return job.host.isConnected&&!canvas?.hidden&&canvas?.dataset.zooming!=='true'&&!canvas?.querySelector('.flow-editor-viewport[data-panning=true],.wb-card[data-dragging=true],.wb-card[data-resizing=true],.wb-group[data-dragging=true]')&&(visible.has(job.target)||(job.target as HTMLElement).dataset.selected==='true');};
  const job=jobs.find(job=>available(job)&&(job.target as HTMLElement).dataset.selected==='true')??jobs.find(available);if(!job)break;
  jobs.splice(jobs.indexOf(job),1);forget(job);try{await job.run();job.resolve();}catch(error){job.reject(error);}
  // Yield between Milkdown documents, allowing wheel, pointer and selection work.
  await new Promise(resolve=>setTimeout(resolve,0));if(document.hidden)break;
 }
}finally{running=false;}}
document.addEventListener('visibilitychange',schedule);
document.addEventListener('artinfact:canvas-idle',schedule);
document.addEventListener('pointerup',()=>setTimeout(schedule,0),{passive:true});
document.addEventListener('pointercancel',schedule,{passive:true});
function enqueue(host:HTMLElement,run:()=>Promise<void>){return new Promise<void>((resolve,reject)=>{
 const target=host.closest('.wb-card')??host,job:Job={host,target,run,resolve,reject,stop:()=>{}};
 job.stop=observeElementConnection(host,()=>{},()=>{const index=jobs.indexOf(job);if(index>=0){jobs.splice(index,1);forget(job);resolve();}});
 jobs.push(job);observer.observe(target);schedule();
});}
export async function renderStaticNote(host:HTMLElement,markdown:string,assets:Record<string,string>={},options:NoteSurfaceOptions={}){
 if(!host.isConnected)return;const key=JSON.stringify([markdown,options.variant,options.highlights,Object.keys(assets)]),cached=cache.get(key);
 if(cached!==undefined){cache.delete(key);cache.set(key,cached);showStaticNote(host,cached,options);return;}
 return enqueue(host,async()=>{
  if(!host.isConnected)return;const shared=cache.get(key);if(shared!==undefined){showStaticNote(host,shared,options);return;}
  const surface=await createNoteSurface(host,markdown,()=>{},assets,{...options,readOnly:true,menuToolbar:true});let html:string|undefined;
  try{await settleNoteDiagrams(host);if(host.isConnected)html=noteStaticHtml(host);}finally{await surface.destroy();}
  if(html===undefined||!host.isConnected)return;cache.set(key,html);cacheBytes+=2*(key.length+html.length);
  while(cache.size>40||cacheBytes>8*1024*1024){const first=cache.keys().next().value!;cacheBytes-=2*(first.length+cache.get(first)!.length);cache.delete(first);}
  showStaticNote(host,html,options);
 });
}
