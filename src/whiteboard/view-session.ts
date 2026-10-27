import type {BoardNode,BoardView} from './whiteboard-domain.js';

/** Navigation and local writes invalidate any background response already in flight. */
export function createViewSession(){
 let epoch=0;
 return {
  invalidate(){epoch++;},
  capture(boardId:string){return {boardId,epoch};},
  matches(snapshot:{boardId:string;epoch:number},boardId:string){return snapshot.epoch===epoch&&snapshot.boardId===boardId;}
 };
}

export function workflowDraft(node:BoardNode|undefined,prompt:string):BoardNode|undefined{
 if(!node?.workflow||node.workflow.prompt===prompt)return;
 return {...node,workflow:{...node.workflow,prompt}};
}

export function boardViewChanged(previous:BoardView,next:BoardView){
 return JSON.stringify([previous.board,previous.canUndo,previous.canRedo])!==JSON.stringify([next.board,next.canUndo,next.canRedo]);
}
