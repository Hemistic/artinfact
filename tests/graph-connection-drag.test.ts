import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionCurve,connectionIntent,portPoint} from '../src/whiteboard/connection-drag.js';
test('dragging ports connects distinct cards once and leaves the board untouched on cancellation or invalid targets',()=>{
 const b={nodes:[{id:'a'},{id:'b'}],edges:[] as {source:string;target:string}[]};const before=structuredClone(b);
 assert.deepEqual(connectionIntent(b,'a','b','right','top'),{source:'a',target:'b',label:'关联',sourceSide:'right',targetSide:'top'});
 assert.equal(connectionIntent(b,'a',undefined,'right'),undefined);assert.equal(connectionIntent(b,'a','a','left'),undefined);assert.equal(connectionIntent(b,'a','missing','left'),undefined);
 assert.equal(connectionIntent({...b,edges:[{source:'a',target:'b'}]},'a','b','right'),undefined);
 assert.equal(connectionIntent({...b,edges:[{source:'b',target:'a'}]},'a','b','right'),undefined);assert.deepEqual(b,before);
});
test('curves attach to requested card sides even after zoom projection and reverse direction',()=>{
 const a={x:100,y:80,width:420,height:220},b={x:-400,y:600,width:500,height:330};
 assert.deepEqual(portPoint(a,'top'),{x:310,y:80});assert.deepEqual(portPoint(a,'left'),{x:100,y:190});
 const curve=connectionCurve(a,b,'bottom','right');assert.match(curve,/^M 310 300 C 310 /);assert.match(curve,/, 100 765$/);
 const scaled=(box:typeof a)=>({x:box.x*.75+30,y:box.y*.75-20,width:box.width*.75,height:box.height*.75});
 assert.deepEqual(portPoint(scaled(a),'right'),{x:420,y:122.5});assert.match(connectionCurve(scaled(a),scaled(b),'right','left'),/^M 420 122.5 C /);
});
