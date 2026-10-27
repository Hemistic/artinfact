import type {Camera} from './canvas-camera.js';

export function cameraRenderer(scene:HTMLElement){
 scene.style.zoom='1';
 scene.style.transformOrigin='0 0';
 return (camera:Camera,interacting:boolean)=>{
  // Keep document geometry independent of the camera. CSS zoom at gesture end
  // relaid out every Milkdown card and triggered their resize/save observers.
  const transform='translate('+camera.x+'px,'+camera.y+'px) scale('+camera.zoom+')';
  if(scene.style.transform!==transform)scene.style.transform=transform;
  const hint=interacting?'transform':'auto';
  if(scene.style.willChange!==hint)scene.style.willChange=hint;
 };
}
