import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deliverResearchMessage, researchJobBusy} from '../src/shared/research-delivery.ts';
import {aiTaskPrompt} from '../src/shared/research-prompts.ts';

test('an accepted follow-up sends once and never inserts a duplicate draft', async () => {
  let drafts=0;
  assert.deepEqual(await deliverResearchMessage('request', {send:async()=>({}),draft:async()=>{drafts++;return{};}}), {mode:'sent'});
  assert.equal(drafts,0);
});
test('rejected sending uses a visible draft, and hosts without messaging keep a manual request', async () => {
  let draft='';
  const result=await deliverResearchMessage('request',{send:async()=>{throw Error('The composer is unavailable');},draft:async text=>{draft=text;return{};}});
  assert.equal(result.mode,'draft');assert.equal(draft,'request');assert.match(result.reason!,/composer/);
  assert.equal((await deliverResearchMessage('request',{})).mode,'manual');
  assert.equal((await deliverResearchMessage('request',{send:async()=>({isError:true}),draft:async()=>({isError:true})})).mode,'manual');
});
test('waiting for user delivery never locks the reader, and prompts explicitly identify the plugin skill', () => {
  const job={status:'queued',createdAt:new Date().toISOString()};
  assert.equal(researchJobBusy({...job,delivery:'manual'}),false);
  assert.equal(researchJobBusy({...job,delivery:'draft'}),false);
  assert.equal(researchJobBusy({...job,delivery:'prepared'}),false);
  assert.equal(researchJobBusy({...job,delivery:'sent'}),true);
  assert.match(aiTaskPrompt('workspace','pdf','outline','job'),/codex-work-layout:pdfai-context/);
});
