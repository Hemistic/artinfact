import test from 'node:test';
import assert from 'node:assert/strict';
import {graphProcessingState} from '../src/shared/workspace-menu.js';

test('workspace progress counts completed PDFs, not partial or stale cards',()=>{
 const state=graphProcessingState({documents:[{ready:true,total:8,completed:8},{ready:true,total:6,completed:2},{ready:false,total:0,completed:0}]},false);
 assert.equal(state.status,'已预处理 1/3 篇');
 assert.equal(state.graphLabel,'生成图谱');
 assert.equal(state.running,false);
 assert.equal(graphProcessingState({documents:[]},true).graphLabel,'更新图谱');
});

test('active work takes priority over an older task and enables stopping',()=>{
 const state=graphProcessingState({documents:[],tasks:[{status:'running',completed:5,total:12},{status:'completed',completed:3,total:3}]},false);
 assert.equal(state.running,true);assert.match(state.status,/5\/12/);
 assert.equal(graphProcessingState({documents:[],tasks:[{status:'cancelled',completed:1,total:4}]},false).running,false);
});
