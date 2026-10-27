import type {ReaderWorkspace} from './reader-workspace.js';
import type {NoteReference} from '../whiteboard/note-references.js';
export function readerNoteReferences(data:ReaderWorkspace):NoteReference[]{
 const refs:NoteReference[]=data.documents.filter(doc=>!doc.id.startsWith('md:')).map(doc=>({id:doc.id,label:doc.name,kind:'pdf'}));
 for(const note of data.notes??[])if(note.nodeId!==data.activeNote?.nodeId)refs.push({id:note.nodeId,label:note.title,kind:'note'});
 if(data.activeNote?.page)refs.push({id:data.activeNote.page.pageId,label:data.activeNote.page.title,kind:'pages'});return refs;
}
