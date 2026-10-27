import {$node,$view,$remark,$prose} from '@milkdown/utils';
import {Plugin,TextSelection} from '@milkdown/prose/state';
import DOMPurify from 'dompurify';
import {marked} from 'marked';

// Keep original HTML in the document, with a sanitized view instead of executing it.
export function safeNoteHtml(html:string){return DOMPurify.sanitize(html,{USE_PROFILES:{html:true},FORBID_TAGS:['style','form','input','button','textarea','select','iframe','object','embed','video','audio'],FORBID_ATTR:['style','id','name','class','srcset']});}
function remarkNoteHtml(){return(tree:any,file:any)=>{
 const source=String(file.value),visit=(parent:any)=>{if(!parent.children)return;const result:any[]=[];
  for(let i=0;i<parent.children.length;i++){const node=parent.children[i];
   // Commonmark's HTML transformer has already wrapped block HTML in a
   // paragraph; unwrap that wrapper before the Milkdown schema sees it.
   if(node.type==='paragraph'&&node.children?.length===1&&node.children[0].type==='html'&&/^<(?:div|section|article|aside|details|summary|table|p|h[1-6]|blockquote|ul|ol|pre|figure|hr)\b/i.test(node.children[0].value)){result.push({type:'noteHtmlBlock',value:node.children[0].value});continue;}
   if(node.type!=='html'){visit(node);result.push(node);continue;}
   const block=parent.type==='root'||parent.type==='blockquote'||parent.type==='listItem';
   if(block){result.push({type:'noteHtmlBlock',value:node.value});continue;}
   const opening=/^<(mark|kbd|sub|sup|u|small|abbr|span|del|strong|em|s|code)(?:\s[^>]*)?>$/i.exec(node.value);
   let end=i;
   if(opening){let depth=1;const tag=opening[1].toLowerCase();for(let j=i+1;j<parent.children.length;j++){const candidate=parent.children[j];if(candidate.type!=='html')continue;if(new RegExp('^<'+tag+'(?:\\s[^>]*)?>$','i').test(candidate.value))depth++;if(new RegExp('^</'+tag+'\\s*>$','i').test(candidate.value)&&!--depth){end=j;break;}}}
   if(end>i){result.push({type:'noteHtmlInline',value:source.slice(node.position.start.offset,parent.children[end].position.end.offset)});i=end;}
   else if(/^<(br|hr|img)\b[^>]*\/?>$/i.test(node.value))result.push({type:'noteHtmlInline',value:node.value});
   else result.push(node);
  }parent.children=result;
 };visit(tree);
};}
function htmlNode(block:boolean){const id=block?'note_html_block':'note_html_inline',md=block?'noteHtmlBlock':'noteHtmlInline',tag=block?'div':'span';
 const schema=$node(id,()=>({group:block?'block':'inline',inline:!block,content:'text*',marks:'',code:true,isolating:true,
  toDOM:()=>[tag,{'data-note-html':id},['code',{class:'wb-note-html-source'},0]],parseDOM:[{tag:tag+'[data-note-html="'+id+'"]',contentElement:'.wb-note-html-source'}],
  parseMarkdown:{match:node=>node.type===md,runner:(state,node,type)=>{state.openNode(type);if(node.value)state.addText(String(node.value));state.closeNode();}},
  toMarkdown:{match:node=>node.type.name===id,runner:(state,node)=>{state.addNode('html',undefined,node.textContent);}},
 }));
 const view=$view(schema,()=> (node,editor,getPos)=>{const dom=document.createElement(tag),source=document.createElement('code'),preview=document.createElement(tag);dom.dataset.noteHtml=id;dom.className='wb-note-html';source.className='wb-note-html-source';preview.className='wb-note-html-preview';preview.contentEditable='false';preview.title='点击编辑 HTML';dom.append(preview,source);let current=node;
  const render=()=>{const html=block?marked.parse(current.textContent,{async:false}):marked.parseInline(current.textContent,{async:false});preview.innerHTML=safeNoteHtml(html);if(!preview.textContent&&!preview.children.length)preview.textContent='HTML（无可显示内容）';};
  preview.onmousedown=e=>{if(editor.editable)e.preventDefault();};preview.onclick=e=>{e.preventDefault();e.stopPropagation();if(!editor.editable)return;const pos=getPos();if(typeof pos==='number'){dom.dataset.active='true';editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc,pos+1)));editor.focus();}};
  render();return{dom,contentDOM:source,stopEvent:e=>preview.contains(e.target as Node),ignoreMutation:mutation=>mutation.type!=='selection'&&!source.contains(mutation.target),update(next){if(next.type!==current.type)return false;if(next.textContent!==current.textContent){current=next;render();}return true;}};
 });return[schema,view];
}
export const noteHtmlPlugins=[...$remark('noteHtml',()=>remarkNoteHtml),...htmlNode(false),...htmlNode(true),$prose(()=>new Plugin({view:()=>{let active:HTMLElement|undefined;return{update(view){const pos=view.state.selection.$from,dom=/^note_html_/.test(pos.parent.type.name)?view.nodeDOM(pos.before()):null;if(active&&active!==dom)active.dataset.active='false';active=dom instanceof HTMLElement?dom:undefined;if(active)active.dataset.active='true';}};},props:{handleKeyDown(view,event){const pos=view.state.selection.$from;if(!/^note_html_/.test(pos.parent.type.name)||!['Escape','Tab'].includes(event.key))return false;const tr=view.state.tr;let after=pos.after();if(pos.parent.isBlock){if(tr.doc.nodeAt(after)?.type!==view.state.schema.nodes.paragraph)tr.insert(after,view.state.schema.nodes.paragraph.create());after++;}tr.setSelection(TextSelection.create(tr.doc,after));view.dispatch(tr);return true;}}}))];
