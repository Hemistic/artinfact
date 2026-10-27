import {$prose} from '@milkdown/utils';
import {Plugin,TextSelection} from '@milkdown/prose/state';
import type {EditorView} from '@milkdown/prose/view';
import {editorViewCtx} from '@milkdown/core';
import type {Ctx} from '@milkdown/ctx';
import type {BlockEditFeatureConfig} from '@milkdown/crepe/feature/block-edit';

export function noteSlashRange(view:EditorView){
 const {selection}=view.state,{$from}=selection;
 if(!view.editable||view.composing||!(selection instanceof TextSelection)||!selection.empty||$from.parent.type.spec.code||$from.marks().some(mark=>mark.type.spec.code))return;
 if(!['paragraph','heading'].includes($from.parent.type.name))return;
 const before=$from.parent.textBetween(0,$from.parentOffset,'\ufffc','\ufffc'),match=/\/([^\s/]{0,40})$/.exec(before);
 if(!match||/(?:https?:\/\/|www\.|file:|[A-Za-z]:[\\/])\S*$/.test(before)||before[match.index-1]==='\\')return;
 return {from:selection.from-match[0].length,to:selection.from,query:match[1]};
}
export function clearNoteSlashTrigger(ctx:Ctx){
 const view=ctx.get(editorViewCtx),range=noteSlashRange(view);if(range)view.dispatch(view.state.tr.delete(range.from,range.to));
}
export function noteSlashSupport(){
 const root=document.createElement('div');root.className='wb-note-surface milkdown wb-note-menu-layer';
 let dismissed:number|undefined,current:EditorView|undefined;
 const getQuery=(view:EditorView)=>{
  const range=noteSlashRange(view);
  if(!range){dismissed=undefined;return;}
  if(!view.hasFocus()&&!root.contains(document.activeElement)||dismissed===range.from)return;
  return range.query;
 };
 const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&current)dismissed=noteSlashRange(current)?.from;};
 const refresh=()=>queueMicrotask(()=>{if(current&&!current.isDestroyed)current.dispatch(current.state.tr.setMeta('addToHistory',false));});
 const reposition=(event:Event)=>{if((!(event.target instanceof Node)||!root.contains(event.target))&&root.querySelector('[data-show=true]'))refresh();};
 const plugin=$prose(()=>new Plugin({props:{handleDOMEvents:{focus:()=>{refresh();return false;},blur:()=>{refresh();return false;}}},view(view){
  current=view;document.body.append(root);view.dom.addEventListener('keydown',close);document.addEventListener('scroll',reposition,true);document.addEventListener('wheel',reposition,{passive:true});window.addEventListener('resize',reposition);
  return {update(next){current=next;},destroy(){view.dom.removeEventListener('keydown',close);document.removeEventListener('scroll',reposition,true);document.removeEventListener('wheel',reposition);window.removeEventListener('resize',reposition);root.remove();current=undefined;}};
 }}));
 const slashMenu:NonNullable<BlockEditFeatureConfig['slashMenu']>&{getQuery:typeof getQuery;clearTrigger:typeof clearNoteSlashTrigger}={root,getQuery,clearTrigger:clearNoteSlashTrigger,offset:6,middleware:[{name:'noteViewport',fn:({x,y,rects})=>({x:Math.max(8,Math.min(x,document.documentElement.clientWidth-rects.floating.width-8)),y:Math.max(8,Math.min(y,window.innerHeight-rects.floating.height-8))})}],floatingUIOptions:{strategy:'fixed'}};
 return {plugin,slashMenu};
}
