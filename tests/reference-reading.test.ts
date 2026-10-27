import test from 'node:test';import assert from 'node:assert/strict';import {extendReading,readingProgress} from '../src/shared/reference-reading.js';
test('full reading merges out-of-order and overlapping reads but never counts gaps or another paper revision as read',()=>{
 let state=extendReading(undefined,'one',100,60,100);state=extendReading(state,'one',100,0,30);assert.equal(readingProgress(state).complete,false);assert.equal(readingProgress(state).readCharacters,70);state=extendReading(state,'one',100,20,65);assert.deepEqual(state.ranges,[[0,100]]);assert.equal(readingProgress(state).complete,true);state=extendReading(state,'new',100,40,100);assert.equal(readingProgress(state).complete,false);assert.equal(readingProgress(state).readCharacters,60);
});
