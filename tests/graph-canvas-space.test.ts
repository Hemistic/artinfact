import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasSpace,paperCanvasSpace,fitInCanvasSpace,revealCanvasPoint} from '../src/whiteboard/canvas-space.js';

test('a narrow viewport with an overlay inspector still fits a usable canvas',()=>{
 for(const height of [540,900]){
  const view={width:480,height},area=paperCanvasSpace(view,0,380);
  assert.deepEqual(area,paperCanvasSpace(view));
  assert.ok(fitInCanvasSpace({x:0,y:0,width:1000,height:600},area).zoom>.1);
 }
 assert.deepEqual(canvasSpace({width:480,height:900},320,380),canvasSpace({width:480,height:900}));
});

test('the side tool rail and reading sheet reserve their actual footprint while fit keeps every card visible',()=>{
 const view={width:1440,height:900},closed=paperCanvasSpace(view),open=paperCanvasSpace(view,280,420);
 assert.deepEqual(closed,{x:78,y:64,width:1338,height:772});
 assert.deepEqual(open,{x:368,y:64,width:620,height:772});
 const bounds={x:-300,y:-40,width:1700,height:900},camera=fitInCanvasSpace(bounds,open);
 assert.ok(bounds.x*camera.zoom+camera.x>=open.x);assert.ok((bounds.x+bounds.width)*camera.zoom+camera.x<=open.x+open.width);
 assert.deepEqual(paperCanvasSpace({width:900,height:500}),canvasSpace({width:900,height:500}));
});
test('floating drawers leave a reading area without changing the canvas dimensions',()=>{
 const canvas={width:1440,height:900};const open=canvasSpace(canvas,300,360),closed=canvasSpace(canvas);
 assert.equal(closed.width,1376);assert.equal(open.x,348);assert.equal(open.width,684);assert.equal(open.y,84);assert.equal(open.height,704);assert.deepEqual(canvas,{width:1440,height:900});
});
test('opening graph details reveals a covered selected node without changing scale or an already visible node',()=>{
 const camera={x:20,y:40,zoom:.8},area=canvasSpace({width:1200,height:900},0,360);
 assert.deepEqual(revealCanvasPoint({x:200,y:200},camera,area),camera);
 const point={x:1400,y:600},next=revealCanvasPoint(point,camera,area);
 assert.equal(next.zoom,camera.zoom);assert.equal(point.x*next.zoom+next.x,area.x+area.width/2);assert.equal(point.y*next.zoom+next.y,area.y+area.height/2);
});
test('fit uses the visible area between drawers and above the fixed toolbar',()=>{
 const area=canvasSpace({width:1200,height:800},300),bounds={x:-400,y:100,width:1700,height:900},camera=fitInCanvasSpace(bounds,area);
 assert.ok(bounds.x*camera.zoom+camera.x>=area.x);assert.ok(bounds.y*camera.zoom+camera.y>=area.y);
 assert.ok((bounds.x+bounds.width)*camera.zoom+camera.x<=area.x+area.width);
 assert.ok((bounds.y+bounds.height)*camera.zoom+camera.y<=area.y+area.height);
});
