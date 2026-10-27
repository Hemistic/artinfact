import type {BoardNode} from './whiteboard-domain.js';
export function isEditableNote(node:BoardNode){
 return node.kind==='note'&&(!node.role||node.role==='note')&&(!node.sourceId||!!node.referenceCard)&&!node.workflow&&!node.presentation&&!node.sourcePath&&!node.sourceCard&&!node.workflowOrigin;
}
