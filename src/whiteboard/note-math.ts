import {$node,$view,$remark,$inputRule,$prose} from '@milkdown/utils';
import {InputRule} from '@milkdown/prose/inputrules';
import {Plugin,TextSelection} from '@milkdown/prose/state';
import {Decoration,DecorationSet} from '@milkdown/prose/view';
import remarkMath from 'remark-math';
import katex from 'katex';
import type {EditorView} from '@milkdown/prose/view';

function mathNode(block:boolean){
 const id=block?'note_math_block':'note_math_inline',mdType=block?'math':'inlineMath',tag=block?'div':'span';
 const schema=$node(id,()=>({
  group:block?'block':'inline',inline:!block,content:'text*',marks:'',code:true,isolating:true,
  toDOM:()=>[tag,{'data-note-math':id},['span',{class:'wb-note-math-source'},0]],
  parseDOM:[{tag:tag+'[data-note-math="'+id+'"]',contentElement:'.wb-note-math-source'}],
  parseMarkdown:{match:node=>node.type===mdType,runner:(state,node,type)=>{state.openNode(type);if(node.value)state.addText(node.value as string);state.closeNode();}},
  toMarkdown:{match:node=>node.type.name===id,runner:(state,node)=>{state.addNode(mdType,undefined,node.textContent);}},
 }));
 const view=$view(schema,()=> (node,editor,getPos)=>{
  const dom=document.createElement(tag),source=document.createElement('span'),preview=document.createElement('span');
  dom.className='wb-note-math'+(block?' wb-note-math-block':'');dom.dataset.noteMath=id;
  source.className='wb-note-math-source';preview.className='wb-note-math-preview';preview.contentEditable='false';dom.append(source,preview);
  let current=node,latex:string|undefined;
  const render=()=>{if(latex===current.textContent)return;latex=current.textContent;dom.dataset.mathEmpty=String(!latex.trim());if(latex.trim())preview.innerHTML=katex.renderToString(latex,{displayMode:block,throwOnError:false,trust:false,maxExpand:300,maxSize:10});else preview.textContent='输入公式';};
  dom.onmousedown=event=>{if(editor.editable&&!source.contains(event.target as Node))event.preventDefault();};
  dom.onclick=event=>{if(!editor.editable||source.contains(event.target as Node))return;event.preventDefault();const pos=getPos();if(typeof pos==='number'){editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc,pos+1+current.content.size)));editor.focus();}};
  render();return {dom,contentDOM:source,stopEvent:event=>preview.contains(event.target as Node),ignoreMutation:mutation=>mutation.type!=='selection'&&!source.contains(mutation.target),update(next){if(next.type!==current.type)return false;current=next;render();return true;}};
 });
 const rule=$inputRule(ctx=>new InputRule(block?/^\$\$([^$]+)\$\$$/:/(?<!\$)\$([^$\n]+)\$$/,(state,match,start,end)=>state.tr.replaceWith(start,end,schema.type(ctx).create(null,state.schema.text(match[1])))));
 return [schema,view,rule];
}

// Only the current math node exposes its native text content. Preview is updated by
// the same document transaction, keeping undo, selection and autosave in one editor.
function finishMath(view:EditorView,event:KeyboardEvent){
 if(!view.editable||event.isComposing)return false;
 const {$from,empty}=view.state.selection,node=$from.parent;
 if(empty&&event.key==='Enter'&&!event.shiftKey&&node.type.name==='paragraph'&&node.textContent==='$$'){
  const schema=view.state.schema,from=$from.before(),to=$from.after(),tr=view.state.tr;
  tr.replaceWith(from,to,[schema.nodes.note_math_block.create(),schema.nodes.paragraph.create()]);
  tr.setSelection(TextSelection.create(tr.doc,from+1));event.preventDefault();event.stopPropagation();view.dispatch(tr.scrollIntoView());return true;
 }
 if(!/^note_math_(inline|block)$/.test(node.type.name))return false;
 const left=event.key==='ArrowLeft'&&empty&&$from.parentOffset===0||event.key==='ArrowUp'&&node.isBlock&&$from.parentOffset===0||event.key==='Tab'&&event.shiftKey;
 const right=event.key==='ArrowRight'&&empty&&$from.parentOffset===node.content.size||event.key==='ArrowDown'&&node.isBlock&&$from.parentOffset===node.content.size;
 if(!(left||right||event.key==='Escape'||event.key==='Tab'||event.key==='Enter'&&!event.shiftKey))return false;
 let tr=view.state.tr,pos=left?$from.before():$from.after();
 if(node.isBlock){const paragraph=view.state.schema.nodes.paragraph;
  if(left){const before=tr.doc.resolve(pos).nodeBefore;if(before?.type===paragraph)pos-=1;else{tr.insert(pos,paragraph.create());pos+=1;}}
  else{if(tr.doc.nodeAt(pos)?.type!==paragraph)tr.insert(pos,paragraph.create());pos+=1;}
  tr.setSelection(TextSelection.create(tr.doc,pos));
 }else{tr.setSelection(TextSelection.create(tr.doc,pos));if(event.key==='Enter'){tr.split(pos);tr.setSelection(TextSelection.near(tr.doc.resolve(pos+1),1));}}
 event.preventDefault();event.stopPropagation();view.dispatch(tr.scrollIntoView());return true;
}
const mathSelection=$prose(()=>new Plugin({props:{decorations(state){
 const position=state.selection.$from;
 for(let depth=position.depth;depth>0;depth--)if(/^note_math_(inline|block)$/.test(position.node(depth).type.name))return DecorationSet.create(state.doc,[Decoration.node(position.before(depth),position.after(depth),{'data-math-active':'true'})]);
 return DecorationSet.empty;
},handleDOMEvents:{keydown:finishMath}}}));
export const noteMathPlugins=[...$remark('noteMath',()=>remarkMath),...mathNode(false),...mathNode(true),mathSelection];
