export const sourceDragType='application/x-artinfact-source';
export const canvasInternalDragType='application/x-artinfact-canvas';
export function canvasDropIntent(types:readonly string[]):'source'|'files'|undefined{
 if(types.includes(canvasInternalDragType))return;
 if(types.includes(sourceDragType))return 'source';
 if(types.includes('Files'))return 'files';
}
