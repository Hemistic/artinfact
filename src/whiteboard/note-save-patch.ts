import type {BoardView} from './whiteboard-domain.js';
export type SavedNote={nodeId:string;title:string;markdown:string;boardRevision?:number;canUndo?:boolean;canRedo?:boolean};
export function applySavedNote(view:BoardView,boardId:string,saved:SavedNote){
 if(view.board?.id!==boardId||(saved.boardRevision!==undefined&&saved.boardRevision<view.revision))return;
 const node=view.board.board.nodes.find(n=>n.id===saved.nodeId);if(!node)return;
 Object.assign(node,{title:saved.title,note:saved.markdown,updatedBy:'user'});
 if(saved.boardRevision!==undefined)view.revision=saved.boardRevision;
 if(saved.canUndo!==undefined)view.canUndo=saved.canUndo;if(saved.canRedo!==undefined)view.canRedo=saved.canRedo;return node;
}
