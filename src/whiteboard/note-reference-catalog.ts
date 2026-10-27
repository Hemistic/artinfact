import type {BoardNode} from './whiteboard-domain.js';
import {isEditableNote} from './note-editability.js';
import type {NoteReference} from './note-references.js';
type ReferenceSource={id:string;name:string;format:string;category?:string;documentId?:string};
export function noteReferenceCatalog(sources:ReferenceSource[],nodes:BoardNode[],currentId:string,pages:{id:string;label:string}[]=[]){
 const result=new Map<string,NoteReference>(),add=(ref:NoteReference)=>{if(ref.kind!=='note'||ref.id!==currentId)result.set(ref.kind+':'+ref.id,ref);};
 for(const source of sources){if(source.format==='pdf'&&(!source.category||source.category==='document'))add({id:source.documentId??source.id,label:source.name,kind:'pdf'});else if(source.category==='pages')add({id:source.id,label:source.name,kind:'pages'});}
 for(const node of nodes)if(isEditableNote(node))add({id:node.id,label:node.title,kind:'note'});
 for(const page of pages)add({...page,kind:'pages'});
 return [...result.values()];
}
