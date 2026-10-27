import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftSaver} from '../src/whiteboard/draft-saver.js';
test('typing during an in-flight save is committed before all waiting flushes complete',async()=>{
 let current:{key:string;version:number;payload:string}|undefined={key:'n',version:1,payload:'Title only'};const committed:string[]=[];let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 const saver=createDraftSaver(()=>current,async s=>{if(s.version===1)await gate;committed.push(s.payload);},s=>{if(current?.version===s.version)current=undefined;});
 const first=saver.flush();current={key:'n',version:2,payload:'Title and new Markdown'};const second=saver.flush();release();await Promise.all([first,second]);assert.deepEqual(committed,['Title only','Title and new Markdown']);assert.equal(current,undefined);
});
test('failed saves leave the latest draft available for an explicit retry',async()=>{
 let current:{key:string;version:number;payload:string}|undefined={key:'n',version:1,payload:'Keep me'},fail=true;const saver=createDraftSaver(()=>current,async()=>{if(fail)throw Error('Offline');},s=>{if(current?.version===s.version)current=undefined;});
 await assert.rejects(saver.flush(),/Offline/);assert.equal(current?.payload,'Keep me');fail=false;await saver.flush();assert.equal(current,undefined);
});
