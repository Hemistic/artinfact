import {markdownHtml} from './flow-notes.js';
import type {BoardNode} from './whiteboard-domain.js';
import type {ReferenceLocation} from '../shared/bibliography.js';
type ReferenceRead={raw:string;revision:string;entry:ReferenceLocation;occurrences:ReferenceLocation[];offset:number;totalOccurrences:number;nextOffset:number|null};
export function referenceCardHtml(node:BoardNode,source?:{preview?:string;referenceCount?:number}){
 return '<div class="wb-reference-note">'+(markdownHtml(node.note)||'<p class="wb-note-placeholder">添加研读笔记，或让 Agent 解释这条引用。</p>')+'</div><details class="wb-reference-raw"><summary>参考文献条目'+(source?.referenceCount?' · 被引用 '+source.referenceCount+' 处':'')+'</summary><div class="flow-markdown">'+markdownHtml(source?.preview??'完整条目可在侧栏查看。')+'</div></details>';
}
export function referenceInspector(host:HTMLElement,read:(offset:number)=>Promise<ReferenceRead>,locate:(index:number,revision:string)=>Promise<unknown>,current:()=>boolean){
 const doc=host.ownerDocument;host.className='wb-reference-details';host.textContent='正在读取参考文献与引用位置…';let next:number|null=0,revision='';
 const action=(label:string,index:number,location:ReferenceLocation)=>{const b=doc.createElement('button');b.type='button';b.textContent=label;b.disabled=location.match!=='matched'||!location.blockIds.length||!location.quote;b.onclick=()=>{b.disabled=true;void locate(index,revision).catch(error=>{b.title=String(error);}).finally(()=>b.disabled=false);};if(b.disabled)b.title=location.match==='ambiguous'?'同作者同年份匹配有歧义，请先核对文献信息':'尚未找到与 Markdown 一致的 JSON 定位';return b;};
 async function load(offset:number){const value=await read(offset);if(!current()||!host.isConnected)return;if(revision&&revision!==value.revision)throw Error('引用列表已更新，请重新打开卡片');revision=value.revision;
  if(offset===0){host.replaceChildren();const entry=doc.createElement('details');entry.open=true;const title=doc.createElement('summary');title.textContent='参考文献原条目';const body=doc.createElement('div');body.className='flow-markdown';body.innerHTML=markdownHtml(value.raw);entry.append(title,body,action('定位文末条目',-1,value.entry));host.append(entry);const heading=doc.createElement('h3');heading.textContent='文内引用 · '+value.totalOccurrences+' 处';host.append(heading);if(!value.totalOccurrences){const empty=doc.createElement('p');empty.textContent='尚未匹配到文内引用；可用 AI 处理核对。';host.append(empty);}}
  for(const [i,location]of value.occurrences.entries()){const item=doc.createElement('details'),title=doc.createElement('summary'),body=doc.createElement('div');title.textContent='引用 '+(offset+i+1)+(location.pageIndex===undefined?'':' · 第 '+(location.pageIndex+1)+' 页')+(location.match==='ambiguous'?' · 匹配待确认':location.match==='unlocated'?' · 未定位':'');body.className='flow-markdown';body.innerHTML=markdownHtml(location.context);item.append(title,body,action('定位这处引用',offset+i,location));host.append(item);}
  next=value.nextOffset;host.querySelector('[data-reference-more]')?.remove();if(next!==null){const more=doc.createElement('button');more.type='button';more.dataset.referenceMore='true';more.textContent='更多引用';more.onclick=()=>{more.disabled=true;void load(next!).catch(error=>{more.disabled=false;more.title=String(error);});};host.append(more);}
 }
 void load(0).catch(error=>{if(current()&&host.isConnected)host.textContent='参考文献读取失败：'+String(error);});
}
