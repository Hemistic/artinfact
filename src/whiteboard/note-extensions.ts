import {strikethroughSchema} from '@milkdown/preset-gfm';
import {$mark,$node,$view,$remark,$inputRule,$prose} from '@milkdown/utils';
import {InputRule} from '@milkdown/prose/inputrules';
import {markRule} from '@milkdown/prose';
import {Plugin,TextSelection} from '@milkdown/prose/state';
import {editorViewCtx} from '@milkdown/core';
import type {Ctx} from '@milkdown/ctx';
import type {EditorView} from '@milkdown/prose/view';
import {remarkNoteExtensions,splitWiki} from './note-extension-markdown.js';
import {noteSlashRange} from './note-slash.js';
import {insertedNoteNodePosition} from './note-slash-commands.js';
import type {NoteEditingOptions} from './note-references.js';

const pending=new WeakMap<HTMLElement,Set<Promise<void>>>();
export async function settleNoteDiagrams(host:HTMLElement){await Promise.all([...(pending.get(host)??[])]);}
let mermaidLoader:Promise<typeof import('mermaid')['default']>|undefined,diagramSequence=0;
const diagramCache=new Map<string,string>();
function loadMermaid(){return mermaidLoader??=import('mermaid').then(({default:mermaid})=>{mermaid.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,maxTextSize:20000,maxEdges:250,theme:'neutral',htmlLabels:false,flowchart:{htmlLabels:false},sequence:{useMaxWidth:true}});return mermaid;});}
function rekeySvg(svg:string){const prefix='note-diagram-'+(++diagramSequence)+'-',ids=new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));return svg.replace(/\bid="([^"]+)"|#([\w:.-]+)/g,(match,id,reference)=>id?'id="'+prefix+id+'"':ids.has(reference)?'#'+prefix+reference:match);}
export function uniqueNoteDiagrams(host:HTMLElement){for(const diagram of host.querySelectorAll<HTMLElement>('.wb-note-diagram-preview'))if(diagram.querySelector('svg'))diagram.innerHTML=rekeySvg(diagram.innerHTML);}
function mark(name:string,md:string,tag:string,pattern:RegExp){
 const schema=$mark(name,()=>({excludes:name==='note_sub'||name==='note_sup'?'note_sub note_sup':name,parseDOM:[{tag}],toDOM:()=>[tag,{'data-note-format':name},0],parseMarkdown:{match:node=>node.type===md,runner:(state,node,type)=>{state.openMark(type);state.next(node.children);state.closeMark(type);}},toMarkdown:{match:value=>value.type.name===name,runner:(state,value)=>{state.withMark(value,md);}}}));
 return[schema,$inputRule(ctx=>markRule(pattern,schema.type(ctx)))];
}
const wiki=$node('note_wiki',()=>({inline:true,group:'inline',atom:true,attrs:{target:{default:''},label:{default:''}},
 toDOM:node=>['a',{'data-note-wiki':node.attrs.target,href:'#note-wiki/'+encodeURIComponent(node.attrs.target),title:'打开引用：'+node.attrs.target},node.attrs.label||node.attrs.target],
 parseDOM:[{tag:'a[data-note-wiki]',getAttrs:el=>({target:(el as HTMLElement).dataset.noteWiki,label:(el as HTMLElement).textContent})}],
 parseMarkdown:{match:node=>node.type==='noteWiki',runner:(state,node,type)=>{state.addNode(type,{target:node.target,label:node.label});}},toMarkdown:{match:node=>node.type.name==='note_wiki',runner:(state,node)=>{state.addNode('noteWiki',undefined,undefined,{target:node.attrs.target,label:node.attrs.label});}},
}));
const wikiRule=$inputRule(ctx=>new InputRule(/\[\[([^\]\n]+)\]\]$/,(state,match,start,end)=>state.tr.replaceWith(start,end,wiki.type(ctx).create(splitWiki(match[1])))));
const toc=$node('note_toc',()=>({group:'block',atom:true,toDOM:()=>['nav',{'data-note-toc':'true','aria-label':'笔记目录'}],parseDOM:[{tag:'nav[data-note-toc]'}],parseMarkdown:{match:node=>node.type==='noteToc',runner:(state,_,type)=>{state.addNode(type);}},toMarkdown:{match:node=>node.type.name==='note_toc',runner:state=>{state.addNode('noteToc');}}}));
function updateToc(host:HTMLElement,view:EditorView){
 if(!host.querySelector('[data-note-toc]'))return;
 const headings:{level:number;text:string}[]=[];view.state.doc.descendants(node=>{if(node.type.name==='heading')headings.push({level:node.attrs.level,text:node.textContent});});
 for(const nav of host.querySelectorAll<HTMLElement>('[data-note-toc]')){const signature=JSON.stringify(headings);if(nav.dataset.headings===signature)continue;nav.dataset.headings=signature;nav.replaceChildren();
  const title=document.createElement('strong');title.textContent='目录';nav.append(title);
  headings.forEach((heading,index)=>{const link=document.createElement('a');link.href='#note-heading-'+index;link.dataset.noteHeading=String(index);link.style.paddingInlineStart=(heading.level-1)*12+'px';link.textContent=heading.text||'未命名标题';nav.append(link);});
  if(!headings.length){const text=document.createElement('span');text.textContent='添加标题后自动生成目录';nav.append(text);}
 }
}
const tocView=$view(toc,()=>()=>{const dom=document.createElement('nav');dom.dataset.noteToc='true';dom.setAttribute('aria-label','笔记目录');dom.contentEditable='false';return{dom,ignoreMutation:()=>true,stopEvent:()=>true};});
const tocRule=$inputRule(ctx=>new InputRule(/^\[TOC\]\s$/i,(state,_match,start,end)=>{const from=state.doc.resolve(start).before(),tr=state.tr.replaceWith(from,end,[toc.type(ctx).create(),state.schema.nodes.paragraph.create()]);return tr.setSelection(TextSelection.create(tr.doc,from+2));}));
const diagram=$node('note_mermaid',()=>({group:'block',content:'text*',marks:'',code:true,isolating:true,
 toDOM:()=>['div',{'data-note-mermaid':'true'},['pre',{'class':'wb-note-diagram-source'},['code',{},0]]],
 parseDOM:[{tag:'div[data-note-mermaid]',contentElement:'.wb-note-diagram-source code'}],
 parseMarkdown:{match:node=>node.type==='noteMermaid',runner:(state,node,type)=>{state.openNode(type);if(node.value)state.addText(String(node.value));state.closeNode();}},
 toMarkdown:{match:node=>node.type.name==='note_mermaid',runner:(state,node)=>{state.addNode('noteMermaid',undefined,node.textContent);}},
}));
function diagramView(host:HTMLElement){return $view(diagram,()=> (node,editor,getPos)=>{
 const dom=document.createElement('div'),source=document.createElement('pre'),code=document.createElement('code'),preview=document.createElement('div'),edit=document.createElement('button');
 dom.dataset.noteMermaid='true';dom.className='wb-note-diagram';source.className='wb-note-diagram-source';preview.className='wb-note-diagram-preview';preview.contentEditable='false';edit.type='button';edit.contentEditable='false';edit.textContent='编辑图表';edit.className='wb-note-diagram-edit';source.append(code);dom.append(preview,edit,source);
 let current=node,version=0,timer:ReturnType<typeof setTimeout>|undefined,disposed=false,initial=true,cancelPending:()=>void=()=>{};
 const render=()=>{const text=current.textContent,ticket=++version;clearTimeout(timer);cancelPending();
  const run=async()=>{try{if(!text.trim()){preview.textContent='输入 Mermaid 图表代码';return;}if(text.length>20000)throw Error('图表代码过长，请拆分');
    let svg=diagramCache.get(text);if(!svg){const mermaid=await loadMermaid();if(disposed||ticket!==version)return;svg=(await mermaid.render('note-render-'+(++diagramSequence),text)).svg;diagramCache.set(text,svg);if(diagramCache.size>24)diagramCache.delete(diagramCache.keys().next().value!);}
    if(!disposed&&ticket===version){preview.innerHTML=rekeySvg(svg);preview.removeAttribute('data-error');}
   }catch{if(!disposed&&ticket===version){preview.dataset.error='true';preview.textContent='图表语法有误，请编辑下方代码。';dom.dataset.editing='true';}}
  };
  const jobs=pending.get(host)??new Set<Promise<void>>();pending.set(host,jobs);const task=new Promise<void>(resolve=>{cancelPending=resolve;});jobs.add(task);void task.finally(()=>jobs.delete(task));const finish=cancelPending;
  const start=()=>{void run().finally(finish);};
  if(initial){initial=false;start();}else timer=setTimeout(start,220);
 };
 edit.onmousedown=e=>e.preventDefault();edit.onclick=e=>{e.preventDefault();e.stopPropagation();if(!editor.editable)return;dom.dataset.editing='true';const pos=getPos();if(typeof pos==='number'){editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc,pos+1)));editor.focus();}};
 render();return{dom,contentDOM:code,stopEvent:event=>preview.contains(event.target as Node)||edit.contains(event.target as Node),ignoreMutation:mutation=>mutation.type!=='selection'&&!code.contains(mutation.target),update(next){if(next.type!==current.type)return false;if(next.textContent!==current.textContent){current=next;render();}return true;},destroy(){disposed=true;version++;clearTimeout(timer);cancelPending();}};
});}
export function insertNoteExtension(ctx:Ctx,kind:'toc'|'mermaid',slash=true){const view=ctx.get(editorViewCtx),tr=view.state.tr,range=slash?noteSlashRange(view):undefined;if(range)tr.delete(range.from,range.to);const type=view.state.schema.nodes[kind==='toc'?'note_toc':'note_mermaid'],node=type.create(null,kind==='mermaid'?view.state.schema.text('graph LR\n  A[输入] --> B[处理]\n  B --> C[输出]'):undefined);tr.replaceSelectionWith(node);const position=insertedNoteNodePosition(tr,type);if(position===undefined)throw Error("Note block insertion anchor missing");if(tr.doc.nodeAt(position+node.nodeSize)?.type!==view.state.schema.nodes.paragraph)tr.insert(position+node.nodeSize,view.state.schema.nodes.paragraph.create());tr.setSelection(TextSelection.create(tr.doc,kind==='mermaid'?position+1:position+node.nodeSize+1));view.dispatch(tr.scrollIntoView());view.focus();}
export function noteExtensionPlugins(host:HTMLElement){return[
 ...$remark('noteExtensions',()=>remarkNoteExtensions),
 ...mark('note_highlight','noteHighlight','mark',/(?<![=\\])==([^=\n]+)==$/),...mark('note_sub','noteSub','sub',/(?<![~\\])~([^~\s]+)~$/),...mark('note_sup','noteSup','sup',/(?<![\^\\])\^([^\^\s]+)\^$/),wiki,wikiRule,toc,tocView,tocRule,diagram,diagramView(host),
 $inputRule(ctx=>markRule(/(?<![~\\])~~([^~\n]+)~~$/,strikethroughSchema.type(ctx))),
 $prose(()=>new Plugin({view:view=>{updateToc(host,view);let activeDiagram:HTMLElement|undefined;return{update(next,previous){if(next.state.doc!==previous.doc)updateToc(host,next);const active=next.state.selection.$from.parent.type.name==='note_mermaid'?next.state.selection.$from.before():-1;const dom=active<0?null:next.nodeDOM(active);if(activeDiagram&&activeDiagram!==dom)activeDiagram.dataset.editing='false';activeDiagram=dom instanceof HTMLElement?dom:undefined;if(activeDiagram)activeDiagram.dataset.editing='true';}};},props:{handleKeyDown(view,event){const parent=view.state.selection.$from.parent;if(parent.type.name!=='note_mermaid'||!(event.key==='Escape'||event.key==='ArrowDown'&&view.state.selection.$from.parentOffset===parent.content.size))return false;const pos=view.state.selection.$from.after(),tr=view.state.tr;if(tr.doc.nodeAt(pos)?.type!==view.state.schema.nodes.paragraph)tr.insert(pos,view.state.schema.nodes.paragraph.create());tr.setSelection(TextSelection.create(tr.doc,pos+1));view.dispatch(tr);for(const el of host.querySelectorAll<HTMLElement>('[data-note-mermaid]'))delete el.dataset.editing;return true;}}})),
];}

const bound=new WeakMap<HTMLElement,()=>void>();
export function bindNoteExtensions(host:HTMLElement,options:NoteEditingOptions={}){
 bound.get(host)?.();
 host.querySelector('.wb-note-backlinks')?.remove();const backlinks=options.backlinks?.()??[];
 let back:HTMLDetailsElement|undefined;
 if(backlinks.length){back=document.createElement('details');back.className='wb-note-backlinks';const summary=document.createElement('summary');summary.textContent='反向链接 · '+backlinks.length;back.append(summary);for(const ref of backlinks){const button=document.createElement('button');button.type='button';button.textContent=ref.label;button.onclick=e=>{e.stopPropagation();void options.onReference?.(ref);};back.append(button);}host.append(back);}
 const click=(event:MouseEvent)=>{const target=event.target as Element,heading=target.closest<HTMLElement>('[data-note-heading]');
  if(heading){event.preventDefault();event.stopPropagation();const index=Number(heading.dataset.noteHeading),element=host.querySelectorAll<HTMLElement>('.ProseMirror h1,.ProseMirror h2,.ProseMirror h3,.ProseMirror h4,.ProseMirror h5,.ProseMirror h6')[index];element?.scrollIntoView({block:'nearest'});return;}
  const link=target.closest<HTMLElement>('[data-note-wiki]');if(!link)return;event.preventDefault();event.stopPropagation();
  const value=link.dataset.noteWiki!,matches=options.references?.().filter(ref=>ref.id===value||ref.label===value)??[];
  host.querySelector('.wb-note-wiki-status')?.remove();if(matches.length===1){void Promise.resolve(options.onReference?.(matches[0])).catch(()=>message('引用暂时无法打开'));}else message(matches.length?'存在同名笔记，请使用笔记 ID 区分':'未找到此笔记：'+value);
 };
 const message=(text:string)=>{const status=document.createElement('small');status.className='wb-note-wiki-status';status.setAttribute('role','status');status.textContent=text;host.append(status);};
 host.addEventListener('click',click,true);const cleanup=()=>{host.removeEventListener('click',click,true);back?.remove();bound.delete(host);};bound.set(host,cleanup);return cleanup;
}
