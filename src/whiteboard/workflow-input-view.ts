import type {Board,BoardNode} from './whiteboard-domain.js';
import {WorkflowTemplates} from './workflow.js';

export function workflowInputView(board:Board,node:BoardNode,open:(id:string)=>void){
 const section=document.createElement('section');section.className='wb-workflow-inputs';
 const inputs=board.edges.filter(e=>e.target===node.id&&e.kind!=='context'),heading=document.createElement('strong');
 heading.textContent='本次组合 · '+inputs.length+' 个直接输入';section.append(heading);
 const hint=document.createElement('p');hint.textContent=node.workflow?.type==='pages'||node.workflow?.type==='image'?'只组合直接连接到这里的卡片。分析节点连接整个结果，条目卡片连接选中的发现；来源联系只用于回查。':'连接资料后运行此模板。连线文字可以指定问题、比较条件或用途；归属和引用联系不触发分析。';
 for(const edge of inputs){const source=board.nodes.find(n=>n.id===edge.source);if(!source)continue;const item=document.createElement('button');item.type='button';item.textContent=source.title+' · '+edge.label;item.onclick=()=>open(source.id);section.append(item);}
 const details=document.createElement('details'),summary=document.createElement('summary'),prompt=document.createElement('p');summary.textContent='模板说明';prompt.textContent=WorkflowTemplates.find(t=>t.id===node.workflow?.type)?.instructions??'';details.append(summary,hint,prompt);section.append(details);return section;
}
