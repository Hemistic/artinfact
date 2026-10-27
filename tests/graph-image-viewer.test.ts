import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imageFit,imageZoomAt} from '../src/whiteboard/image-viewer.js';
test('image fit preserves natural aspect ratio and wheel zoom keeps its cursor anchor',()=>{
  const camera=imageFit({width:1200,height:800},{width:700,height:500});
  assert.equal(1200*camera.zoom/(800*camera.zoom),1.5);
  const point={x:321,y:176},world={x:(point.x-camera.x)/camera.zoom,y:(point.y-camera.y)/camera.zoom};
  const next=imageZoomAt(camera,camera.zoom*2,point);assert.ok(Math.abs(world.x*next.zoom+next.x-point.x)<1e-8);assert.ok(Math.abs(world.y*next.zoom+next.y-point.y)<1e-8);
});
