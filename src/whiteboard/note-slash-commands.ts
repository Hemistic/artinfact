import type {Ctx} from '@milkdown/ctx';
import {editorViewCtx} from '@milkdown/core';
import {Selection,TextSelection,type Transaction} from '@milkdown/prose/state';
import type {NodeType} from '@milkdown/prose/model';
import {wrapInList} from '@milkdown/prose/schema-list';
import {createTable} from '@milkdown/preset-gfm';
import {noteSlashRange} from './note-slash.js';

export function insertedNoteNodePosition(tr:Transaction,type:NodeType){
 let position:number|undefined;
 tr.mapping.maps.at(-1)?.forEach((_from,_to,start,end)=>{tr.doc.nodesBetween(start,end,(node,pos)=>{if(node.type===type){position=pos;return false;}});});
 return position;
}

export function insertSlashTable(ctx:Ctx){
 const view=ctx.get(editorViewCtx),tr=view.state.tr,range=noteSlashRange(view);
 if(range)tr.delete(range.from,range.to);
 const table=createTable(ctx,3,3);tr.replaceSelectionWith(table,false);
 const position=insertedNoteNodePosition(tr,table.type);if(position===undefined)return;
 tr.setSelection(TextSelection.near(tr.doc.resolve(position+1),1));
 view.dispatch(tr.scrollIntoView());view.focus();
}

export function insertSlashDivider(ctx:Ctx){
 const view=ctx.get(editorViewCtx),tr=view.state.tr,range=noteSlashRange(view),schema=view.state.schema;
 if(range)tr.delete(range.from,range.to);
 const node=schema.nodes.hr.create();tr.replaceSelectionWith(node,false);
 const position=insertedNoteNodePosition(tr,node.type);if(position===undefined)return;
 const after=position+node.nodeSize;
 if(!tr.doc.nodeAt(after)?.isTextblock)tr.insert(after,schema.nodes.paragraph.create());
 tr.setSelection(TextSelection.near(tr.doc.resolve(after),1));
 view.dispatch(tr.scrollIntoView());view.focus();
}

export function insertSlashList(ctx:Ctx,kind:'bullet'|'ordered'|'task'){
 const view=ctx.get(editorViewCtx),tr=view.state.tr,range=noteSlashRange(view),schema=view.state.schema;
 if(range)tr.delete(range.from,range.to);
 const type=schema.nodes[kind==='ordered'?'ordered_list':'bullet_list'];
 let listDepth=0;for(let depth=tr.selection.$from.depth;depth>0;depth--)if(['bullet_list','ordered_list'].includes(tr.selection.$from.node(depth).type.name)){listDepth=depth;break;}
 if(listDepth){const at=tr.selection.$from.before(listDepth);tr.setNodeMarkup(at,type,kind==='ordered'?{order:1}:null);}
 else{
  // A list item starts with a paragraph, so headings must be converted first.
  if(tr.selection.$from.parent.type===schema.nodes.heading)tr.setBlockType(tr.selection.from,tr.selection.to,schema.nodes.paragraph);
  let wrapped:Transaction|undefined;
  if(!wrapInList(type)(view.state.apply(tr),next=>{wrapped=next;})||!wrapped)return;
  for(const step of wrapped.steps)tr.step(step);
  tr.setSelection(Selection.fromJSON(tr.doc,wrapped.selection.toJSON()));
 }
 for(let depth=tr.selection.$from.depth;depth>0;depth--){const item=tr.selection.$from.node(depth);if(item.type.name==='list_item'){tr.setNodeMarkup(tr.selection.$from.before(depth),null,{...item.attrs,checked:kind==='task'?false:null});break;}}
 view.dispatch(tr.scrollIntoView());view.focus();
}
