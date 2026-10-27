import {noteEditor} from './note-editor.js';
import {noteAssetIds} from './flow-notes.js';
import {synchronizeNoteHeading} from '../shared/note-heading.js';
import {renderStaticNote,noteStaticHtml,showStaticNote} from './note-static.js';
import type {NoteSurfaceOptions} from './note-surface.js';
type Editor=ReturnType<typeof noteEditor>;
type Value={title:string;markdown:string;revision:string;needsTitleSync?:boolean;boardId?:string};
type Entry={id:string;host:HTMLElement;card:HTMLElement;title:string;markdown:string;assets:Record<string,string>;editor?:Editor;disposed?:boolean;loading?:boolean;rendered?:boolean};
type Hooks={read(id:string):Promise<Value>;save(id:string,value:Value):Promise<Value>;options(id:string,assets:Record<string,string>):NoteSurfaceOptions;error(error:unknown):void};
export function canvasNoteSurfaces(viewport:HTMLElement,asset:(id:string)=>Promise<string>,measure:(id:string)=>void,hooks:Hooks){
 const entries=new Map<string,Entry>(),hosts=new Map<HTMLElement,Entry>(),queued=new Set<Entry>();let draining=false,selected='',generation=0,selectionTask=Promise.resolve();
 const observer=new IntersectionObserver(changes=>{for(const change of changes){const entry=hosts.get(change.target as HTMLElement);if(change.isIntersecting&&entry&&!entry.rendered&&!entry.loading){queued.add(entry);void drain();}}},{root:viewport,rootMargin:'180px'});
 async function loadAssets(entry:Entry){await Promise.all(noteAssetIds(entry.markdown).map(async id=>{if(entry.assets[id])return;try{entry.assets[id]=await asset(id);}catch{}}));}
 async function drain(){if(draining)return;draining=true;try{while(queued.size){const entry=queued.values().next().value!;queued.delete(entry);if(entry.disposed||!entry.host.isConnected||entry.editor||entry.id===selected)continue;entry.loading=true;
  try{await loadAssets(entry);if(entry.disposed)continue;await renderStaticNote(entry.host,entry.markdown,entry.assets);entry.rendered=true;}
  catch(error){if(!entry.disposed){entry.host.textContent='笔记加载失败：'+String(error);hooks.error(error);}}
  finally{entry.loading=false;if(!entry.disposed){delete entry.card.dataset.loading;entry.card.style.removeProperty('min-height');measure(entry.id);}}
  await new Promise(resolve=>setTimeout(resolve,16));
 }}finally{draining=false;}}
 async function deactivate(entry:Entry){if(!entry.editor)return;const editor=entry.editor;await editor.flush();if(entry.disposed)return;const html=noteStaticHtml(editor),height=entry.card.offsetHeight,scrollTop=entry.host.scrollTop;entry.card.style.minHeight=height+'px';entry.editor=undefined;editor.dispose();showStaticNote(entry.host,html);entry.host.scrollTop=scrollTop;entry.card.style.removeProperty('min-height');measure(entry.id);}
 function select(id:string){if(id===selected)return selectionTask;selected=id;const token=++generation;
  const task=selectionTask.then(async()=>{for(const entry of entries.values())if(entry.id!==selected&&entry.editor)await deactivate(entry);if(token!==generation)return;const entry=entries.get(selected);if(!entry||entry.disposed||entry.editor)return;while(entry.loading)await new Promise(resolve=>setTimeout(resolve,16));if(token!==generation||entry.disposed)return;
   const value=await hooks.read(entry.id);if(token!==generation||entry.disposed)return;entry.title=value.title;entry.markdown=value.markdown;await loadAssets(entry);if(token!==generation||entry.disposed)return;const height=entry.card.offsetHeight,scrollTop=entry.host.scrollTop;entry.card.style.minHeight=height+'px';
   const editor=noteEditor({...value,assets:entry.assets},async next=>{const saved=await hooks.save(entry.id,{...next,revision:value.revision,boardId:value.boardId});value.revision=saved.revision;entry.title=saved.title;entry.markdown=saved.markdown;},()=>{},{surface:{...hooks.options(entry.id,entry.assets),menuToolbar:true}});entry.editor=editor;editor.dataset.nodeId=entry.id;
   // Static previews mark this wrapper read-only. That marker must not hide
   // menus inside the live editor mounted into the same wrapper.
   entry.host.classList.remove('wb-note-surface','flow-markdown','wb-note-document');delete entry.host.dataset.readonly;
   entry.host.replaceChildren(editor);await editor.ready;if(entry.disposed)return;entry.card.style.removeProperty('min-height');if(token===generation)entry.host.querySelector<HTMLElement>('.ProseMirror')?.focus({preventScroll:true});entry.host.scrollTop=scrollTop;measure(entry.id);
  }).catch(error=>hooks.error(error));selectionTask=task;return task;
 }
 function remove(id:string){const entry=entries.get(id);if(!entry)return;entry.disposed=true;entry.editor?.dispose();observer.unobserve(entry.host);queued.delete(entry);entries.delete(id);hosts.delete(entry.host);}
 return{mount(id:string,host:HTMLElement,card:HTMLElement,title:string,markdown:string){remove(id);const entry:Entry={id,host,card,title,markdown:synchronizeNoteHeading(title,markdown).markdown,assets:{}};entries.set(id,entry);hosts.set(host,entry);observer.observe(host);if(id===selected){selected='';void select(id);}},select,editor(id:string){return entries.get(id)?.editor;},async flush(){await selectionTask;for(const entry of entries.values())if(entry.editor?.isDirty())await entry.editor.flush();},isDirty(){return [...entries.values()].some(entry=>entry.editor?.isDirty());},remove,clear(){++generation;selected='';for(const id of entries.keys())remove(id);}};
}
