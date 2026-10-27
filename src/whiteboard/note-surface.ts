import {noteTableKeyboard} from './note-table.js';
import {noteHtmlPlugins} from './note-html.js';
import {rootCtx,defaultValueCtx,serializerCtx,parserCtx,editorViewCtx,editorViewOptionsCtx,remarkStringifyOptionsCtx} from '@milkdown/core';
import {$prose} from '@milkdown/utils';
import {Plugin} from '@milkdown/prose/state';
import {Decoration,DecorationSet} from '@milkdown/prose/view';
import type {Node as ProseNode} from '@milkdown/prose/model';
import {noteMathPlugins} from './note-math.js';
import {noteExtensionPlugins,bindNoteExtensions} from './note-extensions.js';
import {remarkGFMPlugin,strikethroughInputRule} from '@milkdown/preset-gfm';
import {editableNoteEditor,bindNoteUi} from './note-ui.js';
import type {NoteEditingOptions} from './note-references.js';
import {streamingPluginKey} from '@milkdown/plugin-streaming';
import {diffPluginKey} from '@milkdown/plugin-diff';
import {abortAICmd} from '@milkdown/crepe/feature/ai';
import {commandsCtx} from '@milkdown/core';

export type NoteSurfaceOptions=NoteEditingOptions&{readOnly?:boolean;label?:string;highlights?:string[];onTitleChange?:(title:string)=>void;variant?:'document'|'excerpt'};
function highlightDecorations(doc:ProseNode,highlights:string[]){
 const positions:number[]=[];let text='';
 const add=(character:string,position:number)=>{if(/\s/.test(character)){if(text.endsWith(' '))return;character=' ';}text+=character;positions.push(position);};
 doc.descendants((node,position)=>{if(node.isBlock&&text)add(' ',-1);if(node.isText)for(let i=0;i<node.text!.length;i++)add(node.text![i],position+i);});
 const decorations:Decoration[]=[];
 for(const value of [...new Set(highlights)]){
  const query=value.replace(/\s+/g,' ').trim();if(!query)continue;
  let offset=0;
  while(offset<text.length){const start=text.indexOf(query,offset);if(start<0)break;const end=start+query.length,range=positions.slice(start,end),from=range.find(p=>p>=0),to=range.reverse().find(p=>p>=0);if(from!==undefined&&to!==undefined)decorations.push(Decoration.inline(from,to+1,{nodeName:'mark',class:'wb-evidence-highlight'}));offset=end;}
 }
 return DecorationSet.create(doc,decorations);
}
export async function createNoteSurface(host:HTMLElement,markdown:string,onChange:(readMarkdown:()=>string)=>void,assets:Record<string,string>={},options:NoteSurfaceOptions={}){
 host.classList.add('wb-note-surface','flow-markdown');
 host.classList.toggle('wb-note-document',options.variant!=='excerpt');
 if(!host.ownerDocument.getElementById('wb-note-surface-style')){const style=host.ownerDocument.createElement('style');style.id='wb-note-surface-style';style.textContent=`
 .wb-note-surface{color:inherit;line-height:1.75;overflow-wrap:anywhere}
 .wb-note-surface .ProseMirror{position:relative;min-height:280px;outline:none;white-space:pre-wrap;word-wrap:break-word;font-size:15px;line-height:1.75;padding:8px 2px}
 .wb-note-surface .ProseMirror p{margin:8px 0}.wb-note-surface h1{font-size:1.6em}.wb-note-surface h2{font-size:1.35em}.wb-note-surface h3{font-size:1.15em}
 .wb-note-surface ul,.wb-note-surface ol{padding-left:24px}.wb-note-surface li{position:relative}.wb-note-surface li>p{margin:2px 0}
 .wb-note-surface blockquote{margin:10px 0;padding-left:12px;border-left:2px solid currentColor;opacity:.85}
 .wb-note-surface pre{white-space:pre-wrap;padding:10px;background:var(--panel,var(--fill-quinary,#8881));border-radius:6px}.wb-note-surface code{font-family:ui-monospace,monospace}
 .wb-note-surface table{border-collapse:collapse;display:table;max-width:100%}.wb-note-surface td,.wb-note-surface th{border:1px solid #8884;padding:6px}
 .wb-note-surface img{max-width:100%;height:auto}.wb-note-surface .wb-note-math{cursor:text}.wb-note-surface .wb-note-math-block{display:block;overflow:auto}
 .wb-note-surface .wb-note-math-source{display:none;font:inherit;font-family:ui-monospace,monospace;white-space:pre-wrap;color:var(--crepe-color-primary,currentColor)}
 .wb-note-surface .wb-note-math[data-math-empty=true]{min-height:1.75em;min-width:2ch}
 .wb-note-surface .wb-note-math[data-math-empty=true]>.wb-note-math-preview{font:inherit;font-size:12px;opacity:.55}
 .wb-note-surface:not([data-readonly=true]) .wb-note-math[data-math-active=true][data-math-empty=true]>.wb-note-math-source{display:inline-block;min-width:2ch;min-height:1.75em;vertical-align:baseline}
 .wb-note-surface:not([data-readonly=true]) .wb-note-math[data-math-active=true]>.wb-note-math-source{display:inline;min-width:1ch}
 .wb-note-surface .wb-note-math[data-math-active=true]>.wb-note-math-preview{margin-left:.5em;opacity:.8}
 .wb-note-surface:not([data-readonly=true]) .wb-note-math-block[data-math-active=true]>.wb-note-math-source{display:block}
 .wb-note-surface .ProseMirror-selectednode{outline:1px solid #8886}.wb-note-surface .ProseMirror-hideselection *::selection{background:transparent}.wb-note-surface .ProseMirror-hideselection{caret-color:transparent}
 .wb-note-surface mark.wb-evidence-highlight{background:#fff176;color:#202014;padding:0;border-radius:2px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
 .wb-note-surface[data-readonly=true] .wb-note-math{cursor:default}
 `;host.ownerDocument.head.append(style);}
 // Rendering is immediate; only a save or navigation needs the complete serialized document.
 let readMarkdown=()=>markdown;
 host.dataset.readonly=String(!!options.readOnly);
 const busy=(state:import('@milkdown/prose/state').EditorState)=>!!(streamingPluginKey.getState(state)?.active||diffPluginKey.getState(state)?.active);
 let lastTitle:string|undefined;
 const titleChanged=(doc:ProseNode)=>{if(!options.onTitleChange)return;let title:string|undefined;doc.forEach(node=>{if(title===undefined&&node.type.name==='heading'&&node.attrs.level===1)title=node.textContent.replace(/\s+/g,' ').trim();});if(title!==undefined&&title!==lastTitle){lastTitle=title;options.onTitleChange(title);}};
 const notify=(doc:ProseNode)=>{titleChanged(doc);onChange(()=>readMarkdown());};
 const changes=$prose(()=>new Plugin({view:()=>({update:(view,previous)=>{if(options.readOnly||busy(view.state)||previous.doc.eq(view.state.doc)&&!busy(previous))return;if(busy(previous))queueMicrotask(()=>{if(!view.isDestroyed&&!busy(view.state))notify(view.state.doc);});else notify(view.state.doc);}})}));
 const evidence=$prose(()=>new Plugin({state:{init:(_,state)=>highlightDecorations(state.doc,options.highlights??[]),apply:(transaction,set)=>set.map(transaction.mapping,transaction.doc)},props:{decorations(state){return this.getState(state);}}}));
 const editor=editableNoteEditor(host,markdown,assets,options.readOnly?{...options,aiProvider:undefined,references:undefined}:options).config(ctx=>{
  ctx.set(rootCtx,host);ctx.set(defaultValueCtx,markdown);ctx.update(remarkGFMPlugin.options.key,previous=>({...previous,singleTilde:false}));
  // Milkdown's trailing-space shortcut bypasses escaping for our delimiters.
  ctx.update(remarkStringifyOptionsCtx,previous=>({...previous,handlers:{...previous.handlers,text:(node,_,state,info)=>state.safe(node.value,{...info,encode:[]}).replace(/&#x20;$/," ")}}));
  ctx.update(editorViewOptionsCtx,previous=>({...previous,editable:()=>!options.readOnly,attributes:{'aria-label':options.label??'笔记正文','role':options.readOnly?'document':'textbox',...(options.readOnly?{'aria-readonly':'true'}:{'aria-multiline':'true'})}}));
 }).use(changes).use(noteMathPlugins).use(noteExtensionPlugins(host)).use(noteHtmlPlugins).use(noteTableKeyboard);
 if(options.highlights?.length)editor.use(evidence);
 await editor.remove(strikethroughInputRule);
 await editor.create();
 editor.action(ctx=>titleChanged(ctx.get(editorViewCtx).state.doc));
 const uiCleanup=options.readOnly?()=>{}:bindNoteUi(host,options),extensionCleanup=bindNoteExtensions(host,options);const cleanup=()=>{uiCleanup();extensionCleanup();};
 let cachedDoc:unknown,cachedText='';
 readMarkdown=()=>editor.action(ctx=>{const state=ctx.get(editorViewCtx).state,streaming=streamingPluginKey.getState(state),doc=streaming?.active?streaming.originalDoc:state.doc;if(doc!==cachedDoc){cachedText=ctx.get(serializerCtx)(doc);cachedDoc=doc;}return cachedText;});
 return {editor,setMarkdown:(value:string)=>{if(!options.readOnly)throw Error('Use the live editor for editable notes');if(markdown===value)return;editor.action(ctx=>{const view=ctx.get(editorViewCtx),doc=ctx.get(parserCtx)(value);if(!doc)throw Error('NOTE_PARSE_FAILED');view.dispatch(view.state.tr.replaceWith(0,view.state.doc.content.size,doc.content).setMeta('addToHistory',false));});markdown=value;},setReadOnly:(value:boolean)=>{if(host.dataset.readonly===String(value))return;host.dataset.readonly=String(value);editor.action(ctx=>{const view=ctx.get(editorViewCtx);view.setProps({editable:()=>!value});});},markdown:()=>options.readOnly?markdown:readMarkdown(),destroy:()=>{if(options.aiProvider)editor.action(ctx=>ctx.get(commandsCtx).call(abortAICmd.key,{keep:false}));cleanup();/* Stop DOM observers before Milkdown removes feature contexts. */editor.action(ctx=>ctx.get(editorViewCtx).destroy());return editor.destroy();}};
}
