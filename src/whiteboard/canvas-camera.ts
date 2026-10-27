export type Camera = { x:number; y:number; zoom:number };
export const worldAt = (camera:Camera, point:{x:number;y:number}) => ({x:(point.x-camera.x)/camera.zoom,y:(point.y-camera.y)/camera.zoom});
export function zoomAt(camera:Camera, requested:number, point:{x:number;y:number}):Camera {
  const world=worldAt(camera,point),zoom=Math.max(.08,Math.min(2.5,requested));
  return {zoom,x:point.x-world.x*zoom,y:point.y-world.y*zoom};
}
export function fitCamera(bounds:{x:number;y:number;width:number;height:number},view:{width:number;height:number}):Camera {
  const zoom=Math.min(1,Math.max(.001,(view.width-48)/Math.max(1,bounds.width)),Math.max(.001,(view.height-48)/Math.max(1,bounds.height)));
  return {zoom,x:(view.width-bounds.width*zoom)/2-bounds.x*zoom,y:(view.height-bounds.height*zoom)/2-bounds.y*zoom};
}
