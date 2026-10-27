import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
function polling(hooks:any){
 const source=readFileSync(new URL('../src/ui/research-panel.ts',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('  async function poll() {'),source.indexOf("  async function generate(scope:"));
 const code=transformSync(`(function(){let timer,polling=false,fingerprint='',pollFailure='';const research=r=>r._meta?.research??r.structuredContent?.research;${body};return poll;})()`,{loader:'ts'}).code;
 return runInNewContext(code,{hooks,setTimeout:()=>1,clearTimeout(){},researchJobBusy:(job:any)=>job?.status==='queued'});
}
test('AI status and outline update are not blocked by an annotation flush failure; recovery retries syncing',async()=>{
 const doc={id:'pdf',workspaceId:'workspace'},posts:any[]=[],notices:string[]=[];let failing=true,refreshes=0;
 const value={aiOutline:{status:'ready',items:[{id:'chapter',annotation:'generated'}]},aiInsights:[],jobs:{outline:{status:'completed'}}};
 const poll=polling({current:()=>({document:doc,ready:true}),call:async()=>({_meta:{research:value}}),post:(type:string,payload:any)=>posts.push({type,payload}),refresh:async()=>{refreshes++;if(failing)throw Error('Transport closed');},notice:(text:string)=>notices.push(text)});
 await poll();assert.ok(posts.some(p=>p.type==='electron-reader:apply-ai-analysis-state'&&p.payload.outlineLabel==='已完成'));assert.ok(posts.some(p=>p.type==='electron-reader:apply-ai-outline'));
 await poll();assert.equal(notices.length,1);failing=false;await poll();assert.equal(refreshes,3);await poll();assert.equal(refreshes,3);
});
test('failed MCP polling reports the connection issue without clearing original or saved analysis',async()=>{
 const notices:string[]=[],posts:any[]=[];const doc={workspaceId:'workspace'};
 const poll=polling({current:()=>({document:doc,ready:true}),call:async()=>{throw Error('Transport closed');},post:(...a:any[])=>posts.push(a),notice:(text:string)=>notices.push(text)});
 await poll();await poll();assert.equal(notices.length,1);assert.match(notices[0],/Transport closed/);assert.equal(posts.length,0);
});
