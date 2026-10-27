import type {Operation} from './whiteboard-domain.js';
export function canvasDeletion(intent:{key:string;editing:boolean;modal:boolean;composing:boolean;repeat:boolean;selected:string;selectedEdge:string;selection:string[];cardFocus?:boolean}):Operation[]{
 // Backspace belongs to text. A click that selects a card never arms structural deletion.
 if(intent.key!=='Delete'||intent.editing||intent.modal||intent.composing||intent.repeat)return [];
 if(intent.selectedEdge)return [{op:'remove_edge',id:intent.selectedEdge}];
 if(!intent.cardFocus&&!intent.selection.length)return [];
 const ids=intent.selection.length?intent.selection:intent.selected?[intent.selected]:[];
 return [...new Set(ids)].map(id=>({op:'remove_node',id}));
}
