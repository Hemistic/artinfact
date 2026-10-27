import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callWithTransportRetry,isTransportClosed} from '../src/shared/mcp-connection.ts';
import {PdfSaveOutbox} from '../src/shared/pdf-save-outbox.ts';
const storage=()=>{const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};};
test('annotation writes recover from one closed transport without duplicating message delivery',async()=>{
 let attempts=0;const waits:number[]=[];
 const value=await callWithTransportRetry('pdf_state_update',async()=>{if(++attempts===1)throw Error('MCP error -32603: Transport closed');return 'saved';},async ms=>{waits.push(ms);});
 assert.equal(value,'saved');assert.equal(attempts,2);assert.equal(waits.length,1);
 attempts=0;await assert.rejects(callWithTransportRetry('pdf_ai_task_begin',async()=>{attempts++;throw Error('Transport closed');},async()=>{}));assert.equal(attempts,1);
});
test('permanent disconnects and application errors do not retry indefinitely',async()=>{
 let calls=0;await assert.rejects(callWithTransportRetry('pdf_ai_read',async()=>{calls++;throw Error('Transport closed');},async()=>{}));assert.equal(calls,2);
 calls=0;await assert.rejects(callWithTransportRetry('pdf_state_update',async()=>{calls++;throw Error('存档损坏');},async()=>{}));assert.equal(calls,1);
 assert.equal(isTransportClosed(Error('解析任务失败')),false);
});
test('failed annotation and deletion intents survive reloading and keep their original document scope',()=>{
 const disk=storage(),a=new PdfSaveOutbox(disk,'C:/Users/test/Documents/Artinfact');
 const first=a.push({id:'a'.repeat(64),workspaceId:'default',patch:{annotations:[{id:'A',comment:'draft'}]}});
 a.push({id:'b'.repeat(64),workspaceId:'ws-1234567890abcdef',patch:{deletedIds:['B']}});
 const b=new PdfSaveOutbox(disk,'C:/Users/test/Documents/Artinfact');assert.equal(b.pending.length,2);assert.equal(b.pending[0].patch.annotations![0].comment,'draft');
 assert.equal(b.pending[1].workspaceId,'ws-1234567890abcdef');b.ack(first.key);
 assert.equal(new PdfSaveOutbox(disk,'C:/Users/test/Documents/Artinfact').pending.length,1);
 assert.equal(new PdfSaveOutbox(disk,'D:/another-root').pending.length,0);
});
test('outbox acknowledgements cannot discard another window’s queued annotations',()=>{
 const disk=storage(),a=new PdfSaveOutbox(disk,'root'),b=new PdfSaveOutbox(disk,'root');
 const entry=a.push({id:'a'.repeat(64),patch:{deletedIds:['A']}});b.push({id:'b'.repeat(64),patch:{deletedIds:['B']}});a.ack(entry.key);
 const remaining=new PdfSaveOutbox(disk,'root').pending;assert.equal(remaining.length,1);assert.equal(remaining[0].id,'b'.repeat(64));
});
test('storage rejection retains an in-memory draft and never claims durable caching',()=>{
 const disk=storage();disk.setItem=()=>{throw Error('QuotaExceeded');};const outbox=new PdfSaveOutbox(disk,'root');outbox.push({id:'a'.repeat(64),patch:{deletedIds:['A']}});
 assert.equal(outbox.pending.length,1);assert.equal(outbox.durable,false);
});
