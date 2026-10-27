import type {BoardView} from './whiteboard-domain.js';
import {agentRequest} from './whiteboard-client.js';
export type SplitSource={id:string;name:string;format:string;ready:boolean};
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
export function openSourceCardsDialog(root:HTMLElement,options:{sources:SplitSource[];selected?:string;submit:(args:{sourceIds:string[];mode:'semantic'|'sections';autoConnect:boolean;question:string})=>Promise<BoardView>}){
 const dialog=el('dialog','wb-template-dialog wb-split-dialog'),head=el('div','wb-template-head'),close=el('button','','关闭');close.type='button';close.onclick=()=>{dialog.close();dialog.remove();};head.append(el('strong','','将信源拆成卡片'),close);
 const form=el('form');form.append(head,el('p','wb-template-subtitle','选取资料，让 Agent 阅读并整理成可编辑、可复用的笔记。你可以随后自由组织和连线。'));
 const choices=el('fieldset','wb-split-sources');choices.append(el('legend','','选择本白板的信源'));const inputs:HTMLInputElement[]=[];
 for(const source of options.sources){const row=el('label','wb-split-source'),input=el('input');input.type='checkbox';input.value=source.id;input.disabled=!source.ready;input.checked=source.ready&&(options.selected?source.id===options.selected:options.sources.length===1);input.setAttribute('aria-label',source.name);inputs.push(input);const text=el('span');text.append(el('strong','',source.name),el('small','',source.format.toUpperCase()+' · '+(source.ready?'正文已准备':'请先在 Workspace 解析 PDF')));row.append(input,text);choices.append(row);}
 if(!options.sources.length)choices.append(el('p','','请先通过底部 ＋ 将 PDF 或 Markdown 添加到白板。'));form.append(choices);
 const modeLabel=el('label','wb-split-field','拆分方式'),mode=el('select');mode.setAttribute('aria-label','拆分方式');for(const [value,label]of [['semantic','按观点与证据分析'],['sections','按原文章节整理']]){const option=el('option','',label);option.value=value;mode.append(option);}modeLabel.append(mode);form.append(modeLabel);
 const questionLabel=el('label','wb-split-field','本次关注的问题（可选）'),question=el('textarea');question.setAttribute('aria-label','本次关注的问题');question.placeholder='例如：检索决策由什么控制？实验支持了什么，还有哪些边界？';question.maxLength=4000;questionLabel.append(question);form.append(questionLabel);
 const connectLabel=el('label','wb-split-connect'),connect=el('input');connect.type='checkbox';connect.checked=true;connect.setAttribute('aria-label','让 Agent 建议初步连接');connectLabel.append(connect,el('span','','让 Agent 建议初步连接'));form.append(connectLabel,el('p','wb-template-subtitle','关闭后只生成卡片，由你自行组织。建议连线随时可改名或移除。'));
 const message=el('p','wb-split-message');message.setAttribute('aria-live','polite');const submit=el('button','flow-primary','交给 Agent 拆分');submit.type='submit';submit.disabled=!options.sources.some(s=>s.ready);form.append(message,submit);
 form.onsubmit=async event=>{event.preventDefault();const sourceIds=inputs.filter(i=>i.checked).map(i=>i.value);if(!sourceIds.length){message.textContent='请选择至少一个正文已准备的信源。';return;}submit.disabled=true;message.textContent='正在准备任务…';
  try{const state=await options.submit({sourceIds,mode:mode.value as 'semantic'|'sections',autoConnect:connect.checked,question:question.value.trim()}),task=state.board?.tasks.filter(t=>t.kind==='source_cards'&&t.status==='queued').at(-1);
   form.replaceChildren(head,el('h3','','拆卡任务已准备'),el('p','wb-template-subtitle','Agent 读完资料后，卡片会自动出现在白板，并保存到卡片库。你已有的笔记和排列会保留。'),el('p','wb-template-subtitle','独立浏览器预览需要把任务交给接入此白板的 Codex；这里不会自行启动另一个模型。'));
   const copy=el('button','flow-primary','复制 Agent 任务');copy.type='button';copy.onclick=async()=>{const prompt=agentRequest(state,task?.id);if(prompt){try{await navigator.clipboard.writeText(prompt);copy.textContent='已复制，粘贴到 Codex 即可';}catch{copy.textContent='复制失败，请从资料面板交给 Agent';}}};form.append(copy);
  }catch(error){message.textContent=String(error).replace(/^Error: /,'');submit.disabled=false;}
 };
 dialog.append(form);root.append(dialog);dialog.showModal();return dialog;
}
