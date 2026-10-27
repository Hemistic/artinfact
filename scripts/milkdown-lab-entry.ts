import {createNoteSurface} from '../src/whiteboard/note-surface.js';
import {noteWikiTargets} from '../src/whiteboard/note-extension-markdown.js';
import {settleNoteDiagrams} from '../src/whiteboard/note-extensions.js';
import {noteStaticHtml,showStaticNote} from '../src/whiteboard/note-static.js';
import type {NoteSurfaceOptions} from '../src/whiteboard/note-surface.js';

export function startLab(source:string,tableSource:string){
 const byId=(id:string)=>document.getElementById(id)!;
 const host=byId('editor'),saved=byId('saved'),status=byId('status');
 let surface:Awaited<ReturnType<typeof createNoteSurface>>|undefined,current='syntax',preview=false;
 const notes=[{id:'tables',label:'表格专项实测',markdown:tableSource},{id:'syntax',label:'Markdown 全语法实测',markdown:source},{id:'linked-note',label:'双链目标笔记',markdown:'# 双链目标笔记\n\n这是双链跳转的目标。下面的反向链接会列出引用它的笔记。\n\n返回 [[Markdown 全语法实测]]。'}];
 const key='artinfact-milkdown-extension-lab-v1';
 try{const data=JSON.parse(localStorage.getItem(key)??'null');if(data)for(const note of notes)if(typeof data[note.id]==='string')note.markdown=data[note.id];}catch{}
 const persist=()=>localStorage.setItem(key,JSON.stringify(Object.fromEntries(notes.map(note=>[note.id,note.markdown]))));
 const options:NoteSurfaceOptions={references:()=>notes.map(n=>({...n,kind:'note'})),backlinks:()=>{const self=notes.find(n=>n.id===current)!;return notes.filter(n=>n.id!==current&&noteWikiTargets(n.markdown).some(target=>target===self.id||target===self.label)).map(n=>({...n,kind:'note'}));},onReference:async ref=>{current=ref.id;await load(notes.find(n=>n.id===current)!.markdown);}};
 const save=(value:string)=>{notes.find(n=>n.id===current)!.markdown=value;saved.textContent=value;persist();};
 let loading=false;
 async function load(value:string){
  if(loading)return;loading=true;status.textContent='正在加载 Milkdown…';
  try{if(surface)await surface.destroy();surface=undefined;host.replaceChildren();preview=false;byId('preview').textContent='只读预览';surface=await createNoteSurface(host,value,read=>save(read()),{},options);await settleNoteDiagrams(host);save(surface.markdown());status.textContent='Milkdown 已加载';}
  catch(error){status.textContent='加载失败：'+String(error);}finally{loading=false;}
 }
 byId('tables').onclick=()=>{current='tables';void load(notes.find(n=>n.id==='tables')!.markdown);};
 byId('sample').onclick=()=>{current='syntax';void load(source);};
 byId('blank').onclick=()=>{current='syntax';void load('');};
 byId('roundtrip').onclick=()=>void load(surface?.markdown()??notes.find(n=>n.id===current)!.markdown);
 byId('preview').onclick=async()=>{if(loading)return;if(preview){await load(notes.find(n=>n.id===current)!.markdown);return;}if(!surface)return;loading=true;try{save(surface.markdown());await settleNoteDiagrams(host);const html=noteStaticHtml(host);await surface.destroy();surface=undefined;showStaticNote(host,html,options);preview=true;byId('preview').textContent='返回编辑';status.textContent='只读预览 · 与编辑共用 Milkdown 渲染';}finally{loading=false;}};
 byId('apply').onclick=()=>{current='syntax';void load((byId('input')as HTMLTextAreaElement).value);};
 byId('width').onchange=e=>byId('card').style.width=(e.target as HTMLSelectElement).value+'px';
 byId('zoom').onchange=e=>document.querySelector<HTMLElement>('main')!.style.transform='scale('+(e.target as HTMLSelectElement).value+')';
 byId('scrollbox').onchange=e=>{const upper=document.querySelector<HTMLElement>('.wb-study-upper')!;upper.style.maxHeight=(e.target as HTMLInputElement).checked?'400px':'';upper.style.overflowY=(e.target as HTMLInputElement).checked?'auto':'';};
 byId('theme').onclick=()=>document.body.dataset.theme=document.body.dataset.theme==='dark'?'light':'dark';
 void load(notes.find(n=>n.id==='syntax')!.markdown);
}
