import type {BoardNode} from './whiteboard-domain.js';import {markdownHtml} from './flow-notes.js';
export function pendingReadingCard(doc:Document,card:BoardNode,add:()=>void|Promise<void>,onError:(error:unknown)=>void=()=>{}){
 const item=doc.createElement('details');item.className='flow-materials flow-pending-reading';const title=doc.createElement('summary');title.textContent=card.title;item.append(title);
 const hint=doc.createElement('small');hint.textContent='全文研读 · 尚未加入白板';const preview=doc.createElement('div');preview.className='flow-note flow-reading-preview';Object.assign(preview.style,{maxHeight:'360px',overflowY:'auto',padding:'10px 0'});const button=doc.createElement('button');button.type='button';button.className='flow-primary';button.dataset.addReading=card.id;button.textContent='添加到当前白板';button.onclick=()=>{if(button.disabled)return;button.disabled=true;void Promise.resolve().then(add).catch(onError).finally(()=>{button.disabled=false;});};item.append(hint,preview,button);
 let rendered=false;item.ontoggle=()=>{if(item.open&&!rendered){preview.innerHTML=markdownHtml(card.note);rendered=true;}};return item;
}
