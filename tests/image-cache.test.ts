import test from 'node:test';import assert from 'node:assert/strict';import {createImageCache} from '../src/whiteboard/image-cache.js';
test('image requests are shared and bounded so a board render cannot flood MCP',async()=>{
 let running=0,peak=0,reads=0;const release:(()=>void)[]=[];
 const cache=createImageCache(async id=>{reads++;running++;peak=Math.max(peak,running);await new Promise<void>(resolve=>release.push(resolve));running--;return 'data:'+id;},2);
 const requests=['a','a','b','c','d'].map(id=>cache.read(id));await new Promise(r=>setImmediate(r));assert.equal(reads,2);assert.equal(peak,2);
 while(release.length||running){release.shift()?.();await new Promise(r=>setImmediate(r));}
 assert.deepEqual(await Promise.all(requests),['data:a','data:a','data:b','data:c','data:d']);assert.equal(reads,4);assert.equal(await cache.read('a'),'data:a');assert.equal(reads,4);
});
test('failed image requests can retry and decoded URL storage has a fixed bound',async()=>{
 let reads=0;const cache=createImageCache(async id=>{reads++;if(reads===1)throw Error('transient');return id.repeat(4);},2,8);
 await assert.rejects(cache.read('a'),/transient/);assert.equal(await cache.read('a'),'aaaa');await cache.read('b');await cache.read('c');await cache.read('a');assert.equal(reads,5);cache.clear();await cache.read('a');assert.equal(reads,6);
});
