import {fitCamera,type Camera} from './canvas-camera.js';
export type CanvasSpace={x:number;y:number;width:number;height:number};
export function paperCanvasSpace(view:{width:number;height:number},left=0,right=0):CanvasSpace{
 // At narrow widths drawers overlay the canvas; reserving their footprint
 // would shrink fit-to-content to nearly zero and leave an empty board.
 if((left||right)&&view.width-left-right-144<240)return paperCanvasSpace(view);
 if(view.height<=560)return canvasSpace(view,left,right);
 const x=left?left+88:78;
 return{x,y:64,width:Math.max(1,view.width-x-(right?right+32:24)),height:Math.max(1,view.height-128)};
}
/** Floating panels reserve reading space without resizing the underlying canvas. */
export function canvasSpace(view:{width:number;height:number},left=0,right=0):CanvasSpace{
 if((left||right)&&view.width-left-right-96<240)return canvasSpace(view);
 const x=32+(left?left+16:0),y=84;
 return{x,y,width:Math.max(1,view.width-x-32-(right?right+16:0)),height:Math.max(1,view.height-y-112)};
}
export function fitInCanvasSpace(bounds:CanvasSpace,space:CanvasSpace):Camera{
 const camera=fitCamera(bounds,space);return{...camera,x:camera.x+space.x,y:camera.y+space.y};
}
export function revealCanvasPoint(point:{x:number;y:number},camera:Camera,space:CanvasSpace):Camera{
 const x=point.x*camera.zoom+camera.x,y=point.y*camera.zoom+camera.y;
 if(x>=space.x+24&&x<=space.x+space.width-24&&y>=space.y+24&&y<=space.y+space.height-24)return camera;
 return {...camera,x:space.x+space.width/2-point.x*camera.zoom,y:space.y+space.height/2-point.y*camera.zoom};
}
