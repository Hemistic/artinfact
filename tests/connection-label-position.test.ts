import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionLabelPosition} from '../src/whiteboard/connection-label-position.js';
test('labels stay at the curve midpoint even when it crosses a card',()=>{
 const cards=[{x:100,y:0,width:420,height:240},{x:100,y:300,width:420,height:240}];
 assert.deepEqual(connectionLabelPosition({x:300,y:360},cards),{x:300,y:360});
 assert.deepEqual(connectionLabelPosition({x:-850,y:360},cards),{x:-850,y:360});
 assert.deepEqual(connectionLabelPosition({x:800,y:360},cards),{x:800,y:360});
});
