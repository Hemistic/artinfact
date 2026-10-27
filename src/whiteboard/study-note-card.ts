import {observeElementConnection} from '../shared/element-lifecycle.js';
import type {BoardNode} from './whiteboard-domain.js';
import type {NoteSurfaceOptions} from './note-surface.js';
import {renderStaticNote,noteStaticHtml,showStaticNote} from './note-static.js';
import {noteEditor} from './note-editor.js';

type SourceLabel={id:string;name:string;page?:number};
type Hooks={save(value:{title:string;markdown:string}):Promise<void>;locate(citationIndex:number):Promise<void>;fold?(open:boolean):void;measure?():void};
type Options={readOnly?:boolean;expanded?:boolean;assets?:Record<string,string>;editor?:NoteSurfaceOptions};
export function studyNoteCard(node:BoardNode,sources:SourceLabel[],hooks:Hooks,options:Options={}){
 if(!node.studyNote)throw Error('STUDY_NOTE_REQUIRED');
 const doc=document,card=doc.createElement('section');card.className='wb-study-note';card.setAttribute('aria-label','研读笔记：'+node.title);
 card.dataset.readonly=String(!!options.readOnly);
 const label=doc.createElement('small');label.className='wb-study-label';label.textContent=node.studyNote.label;card.append(label);
 const upper=doc.createElement('div');upper.className='wb-study-upper';card.append(upper);
 const details=doc.createElement('details');details.className='wb-study-evidence';details.open=options.expanded??true;
 const summary=doc.createElement('summary');summary.textContent='原文证据'+((node.citations?.length??0)>1?' · '+node.citations!.length+' 段':'');details.append(summary);
 const evidence=doc.createElement('div');evidence.className='wb-study-excerpts';details.append(evidence);card.append(details);
 const footer=doc.createElement('footer');footer.className='wb-study-footer';const provenance=doc.createElement('span');provenance.className='wb-study-source';
 const labels=[...new Set((node.citations??[]).map(c=>{const source=sources.find(s=>s.id===c.sourceId);return source?source.name+(source.page?' · 第 '+source.page+' 页':''):'PDF 来源';}))];
 provenance.textContent=labels.join('、');provenance.title=provenance.textContent;
 const link=doc.createElement('a');link.href='#pdf-original';link.textContent='定位 PDF 原文';link.className='wb-study-locate';footer.append(provenance);if(node.citations?.length===1)footer.append(link);card.append(footer);
 let editor=options.readOnly?undefined:noteEditor({title:node.title,markdown:node.note,assets:options.assets},async value=>{await hooks.save(value);node.title=value.title;node.note=value.markdown;card.dataset.noteContent=JSON.stringify([value.title,value.markdown]);},()=>{},{surface:options.editor});
 if(editor){editor.titleControl.hidden=true;editor.closeControl.hidden=true;upper.append(editor);footer.append(editor.actions);}
 let mounted=false,disposed=false,loadedEvidence:Promise<void>|undefined,desiredReadOnly=!!options.readOnly;let modeTask=Promise.resolve();
 const markError=(error:unknown)=>{let status=footer.querySelector<HTMLElement>('.wb-study-error');if(!status){status=doc.createElement('span');status.className='wb-study-error';status.setAttribute('role','status');footer.append(status);}status.textContent=String(error);};
 async function mountSurface(host:HTMLElement,markdown:string,highlights:string[],label:string){await renderStaticNote(host,markdown,options.assets,{label,highlights,variant:host.classList.contains('wb-study-source-body')?'excerpt':'document'});}
 async function loadEvidence(){
  if(loadedEvidence)return loadedEvidence;
  loadedEvidence=Promise.all((node.citations??[]).map(async(c,index)=>{
   const section=doc.createElement('section');section.className='wb-study-excerpt';
   if((node.citations?.length??0)>1){const header=doc.createElement('div');header.className='wb-study-excerpt-head';const source=doc.createElement('small');source.textContent='第 '+(index+1)+' 段 · '+(sources.find(s=>s.id===c.sourceId)?.name??'PDF 原文');const locate=doc.createElement('a');locate.href='#pdf-original-'+index;locate.className='wb-study-locate';locate.textContent='定位这一段';bindLocate(locate,index);header.append(source,locate);section.append(header);}
   const body=doc.createElement('div');body.className='wb-study-source-body';section.append(body);evidence.append(section);
   await mountSurface(body,c.quote,node.studyNote!.highlights.filter(h=>h.citation===index).map(h=>h.text),'PDF 原文证据 '+(index+1));
  })).then(()=>hooks.measure?.());return loadedEvidence;
 }
 let resolveReady!:()=>void;const ready=new Promise<void>(resolve=>resolveReady=resolve);
 const stopConnection=observeElementConnection(card,()=>{mounted=true;void(async()=>{if(options.readOnly)await mountSurface(upper,node.note,[],'研读笔记正文');else await editor!.ready;if(details.open)await loadEvidence();hooks.measure?.();})().catch(markError).finally(resolveReady);
 },()=>{disposed=true;editor?.dispose();});
 details.addEventListener('toggle',()=>{hooks.fold?.(details.open);if(details.open&&mounted)void loadEvidence().catch(markError);hooks.measure?.();});
 const flush=()=>editor?.flush()??Promise.resolve();
 function bindLocate(link:HTMLAnchorElement,index:number){link.onclick=event=>{event.preventDefault();event.stopPropagation();if(link.getAttribute('aria-busy')==='true')return;link.setAttribute('aria-busy','true');void flush().then(()=>hooks.locate(index)).catch(markError).finally(()=>link.removeAttribute('aria-busy'));};}
 bindLocate(link,0);

 function setReadOnly(value:boolean){if(value===desiredReadOnly)return modeTask;desiredReadOnly=value;modeTask=modeTask.then(async()=>{await ready;if(disposed)return;if(desiredReadOnly){if(editor){await editor.flush();if(!desiredReadOnly||disposed)return;const html=noteStaticHtml(editor);editor.dispose();editor=undefined;showStaticNote(upper,html);}}else if(!editor){editor=noteEditor({title:node.title,markdown:node.note,assets:options.assets},async value=>{await hooks.save(value);node.title=value.title;node.note=value.markdown;card.dataset.noteContent=JSON.stringify([value.title,value.markdown]);},()=>{},{surface:options.editor});upper.classList.remove('wb-note-surface','flow-markdown','wb-note-document');delete upper.dataset.readonly;upper.replaceChildren(editor);await editor.ready;}card.dataset.readonly=String(desiredReadOnly);hooks.measure?.();}).catch(markError);return modeTask;}
 const result=Object.assign(card,{flush,isDirty:()=>!!editor?.isDirty(),ready,command:(name:string)=>editor?.command(name),setReadOnly});Object.defineProperty(result,'actions',{get:()=>editor?.actions});return result as typeof result&{actions?:ReturnType<typeof noteEditor>['actions']};
}
