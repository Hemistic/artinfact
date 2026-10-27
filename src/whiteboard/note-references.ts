import type {EditorView} from '@milkdown/prose/view';
import {Plugin,TextSelection} from '@milkdown/prose/state';
import {SlashProvider} from '@milkdown/plugin-slash';
import {$prose} from '@milkdown/utils';
import type {AIProvider} from '@milkdown/crepe/feature/ai';
export type NoteReference={id:string;label:string;kind:'pdf'|'note'|'pages'};
export type NoteEditingOptions={references?:()=>NoteReference[];backlinks?:()=>NoteReference[];onReference?:(reference:NoteReference)=>void|Promise<void>;uploadImage?:(file:File)=>Promise<string>;aiProvider?:AIProvider;menuToolbar?:boolean};
export const noteReferenceHref=(ref:NoteReference)=>'#artinfact-ref/'+ref.kind+'/'+encodeURIComponent(ref.id);
function query(view:EditorView){
 const selection=view.state.selection;if(!view.editable||view.composing||!selection.empty||selection.$from.parent.type.spec.code)return;
 const before=selection.$from.parent.textBetween(0,selection.$from.parentOffset,'\ufffc','\ufffc'),match=/(?:^|[\s(])@([^\s@]{0,80})$/.exec(before);
 if(match)return{start:selection.from-match[1].length-1,end:selection.from,text:match[1].toLocaleLowerCase()};
}
export function noteReferencePlugin(host:HTMLElement,options:NoteEditingOptions){
 let range:ReturnType<typeof query>,matches:NoteReference[]=[],selected=0,provider:SlashProvider|undefined;
 const menu=host.ownerDocument.createElement('div');menu.className='wb-note-references';menu.setAttribute('role','listbox');menu.setAttribute('aria-label','引用工作区资料');
 const close=()=>{range=undefined;provider?.hide();};
 const refresh=(view:EditorView)=>{const next=query(view);if(!next){range=undefined;return false;}const changed=next.text!==range?.text;range=next;matches=(options.references?.()??[]).filter(ref=>ref.label.toLocaleLowerCase().includes(next.text)).slice(0,20);if(changed)selected=0;selected=Math.min(selected,Math.max(0,matches.length-1));return true;};
 const insert=(view:EditorView,index:number)=>{
  const clicked=matches[index];if(!refresh(view))return false;const ref=matches.find(ref=>ref.id===clicked?.id&&ref.kind===clicked?.kind)??matches[selected];if(!range||!ref)return false;const {start,end}=range,mark=view.state.schema.marks.link.create({href:noteReferenceHref(ref)}),text=view.state.schema.text(ref.label,[mark]);
  const tr=view.state.tr.replaceWith(start,end,text);tr.insertText(' ',start+ref.label.length);tr.setSelection(TextSelection.create(tr.doc,start+ref.label.length+1));tr.setStoredMarks([]);close();view.dispatch(tr);view.focus();return true;
 };
 function render(view:EditorView){
  menu.replaceChildren();if(!matches.length){const empty=host.ownerDocument.createElement('p');empty.textContent='没有匹配的资料';menu.append(empty);return;}
  for(const [i,ref]of matches.entries()){
   const row=host.ownerDocument.createElement('button');row.type='button';row.setAttribute('role','option');row.setAttribute('aria-selected',String(i===selected));row.dataset.referenceId=ref.id;
   const label=host.ownerDocument.createElement('span'),kind=host.ownerDocument.createElement('small');label.textContent=ref.label;kind.textContent={pdf:'PDF',note:'笔记',pages:'Pages'}[ref.kind];row.append(label,kind);
   row.onpointerdown=event=>{event.preventDefault();event.stopPropagation();insert(view,i);};menu.append(row);
  }
 }
 return $prose(()=>new Plugin({
  props:{handleKeyDown(view,event){if(!range||view.composing)return false;if(!refresh(view)){close();return false;}if(event.key==='Escape'){event.preventDefault();close();return true;}if(!matches.length)return false;
   if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();selected=(selected+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length;render(view);return true;}
   if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();return insert(view,selected);}return false;
  }},
  view(view){
   provider=new SlashProvider({content:menu,root:host,debounce:25,shouldShow(current){if(!refresh(current))return false;render(current);return true;}});
   provider.update(view);return {update(next,previous){if(!previous.doc.eq(next.state.doc)||!previous.selection.eq(next.state.selection))provider?.update(next,previous);},destroy(){provider?.destroy();menu.remove();}};
  },
 }));
}
