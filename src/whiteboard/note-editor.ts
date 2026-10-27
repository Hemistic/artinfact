import {observeElementConnection} from '../shared/element-lifecycle.js';
import {createNoteSurface,type NoteSurfaceOptions} from './note-surface.js';
import {fitNoteTitle,observeNoteTitle} from '../shared/note-title.js';
import {synchronizeNoteHeading} from '../shared/note-heading.js';
import {runNoteMenuCommand} from './note-menu-command.js';
export function noteEditor(value:{title:string;markdown:string;assets?:Record<string,string>;needsTitleSync?:boolean},save:(value:{title:string;markdown:string})=>Promise<void>,close:()=>void,options:{autoSaveMs?:number;surface?:NoteSurfaceOptions}={}){
 const wrap=document.createElement('section');wrap.className='wb-inline-note-editor';
 const canonical=synchronizeNoteHeading(value.title,value.markdown);
 const title=document.createElement('textarea');title.className='wb-note-title';title.hidden=true;title.rows=1;title.value=canonical.title;title.maxLength=240;title.setAttribute('aria-label','笔记标题');
 const body=document.createElement('div');body.className='wb-note-editor-body';let markdown=canonical.markdown,savedMarkdown=markdown,savedTitle=canonical.title,pendingTitleSync=!!value.needsTitleSync||canonical.title!==value.title||canonical.markdown!==value.markdown;
 const status=document.createElement('p');status.setAttribute('role','status');status.textContent='正在载入编辑器…';
 const commit=document.createElement('button');commit.textContent='重试保存';commit.type='button';commit.disabled=true;commit.hidden=true;commit.onclick=()=>{void flush().catch(()=>{});};
 const done=document.createElement('button');done.textContent='关闭';done.type='button';done.dataset.action='close';done.onclick=()=>{done.disabled=true;void flush().then(close).catch(()=>{}).finally(()=>done.disabled=false);};
 const actions=document.createElement('footer');actions.className='wb-note-editor-actions';actions.setAttribute('role','toolbar');actions.setAttribute('aria-label','笔记操作');actions.append(commit,done,status);wrap.append(title,body,actions);
 let mounted=false,disposed=false,readOnly=!!options.surface?.readOnly,surface:Awaited<ReturnType<typeof createNoteSurface>>|undefined,running:Promise<void>|undefined,loadError:unknown,timer:ReturnType<typeof setTimeout>|undefined;
 let loaded!:()=>void;const ready=new Promise<void>(resolve=>loaded=resolve);
 const isDirty=()=>!readOnly&&pendingTitleSync||title.value.trim()!==savedTitle||(surface?.markdown()??markdown)!==savedMarkdown;
 const clear=()=>{clearTimeout(timer);timer=undefined;};
 function changed(){if(disposed||readOnly)return;clear();if(!running){status.textContent='等待保存…';commit.hidden=true;}timer=setTimeout(()=>{void flush().catch(()=>{});},options.autoSaveMs??600);}
 let stopTitleResize:(()=>void)|undefined;
 const dispose=()=>{if(disposed)return;disposed=true;clear();stopTitleResize?.();stopConnection();void surface?.destroy();};
 title.oninput=()=>{title.value=title.value.replace(/[\r\n]+/g,' ');fitNoteTitle(title);changed();};title.onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();body.querySelector<HTMLElement>('.ProseMirror')?.focus();}};
 function flush(){
  clear();if(running)return running;
  const task=(async()=>{await ready;if(loadError&&isDirty())throw loadError;
   // Keep the surface active while the previous snapshot is saved; drain newer edits before navigation.
   while(isDirty()){
    const next={title:title.value.trim(),markdown:surface?.markdown()??markdown};if(!next.title)throw Error('请输入标题');if(next.markdown.length>120000)throw Error('笔记过长');
    commit.disabled=true;status.textContent='正在保存…';await save(next);savedTitle=next.title;savedMarkdown=next.markdown;pendingTitleSync=false;wrap.dataset.noteContent=JSON.stringify([next.title,next.markdown]);
   }
   status.textContent='已保存';commit.hidden=true;
  })();
  running=task.catch(error=>{status.textContent='尚未保存：'+String(error);commit.hidden=false;throw error;}).finally(()=>{running=undefined;commit.disabled=false;clear();});return running;
 }
 const stopConnection=observeElementConnection(wrap,()=>{mounted=true;stopTitleResize=observeNoteTitle(title);void createNoteSurface(body,markdown,()=>{if(surface)changed();},value.assets,{...options.surface,onTitleChange:heading=>{title.value=heading;if(surface)changed();}}).then(async result=>{
   if(disposed){await result.destroy();return;}surface=result;surface.setReadOnly(readOnly);savedMarkdown=result.markdown();commit.disabled=false;status.textContent='修改自动保存';if(isDirty())changed();
  }).catch(error=>{loadError=error;status.textContent='编辑器加载失败：'+String(error);}).finally(loaded);
 },dispose);
 return Object.assign(wrap,{flush,isDirty,actions,ready,dispose,command:async(name:string)=>{await ready;if(!surface)throw loadError??Error("笔记尚未载入");runNoteMenuCommand(surface.editor,name);},titleControl:title,closeControl:done,setReadOnly:(value:boolean)=>{readOnly=value;title.readOnly=value;surface?.setReadOnly(value);if(!value&&surface&&isDirty())changed();}});
}
