import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphReadyDocuments } from '../src/shared/wiki-request.ts';
test('graph request requires local standard JSON and excludes obsolete lightweight conversions', async () => {
 const seen:string[]=[]; const call=async(name:string,args:any)=>{seen.push(name);assert.equal(args.workspaceId,'ws-test'); if(name==='pdf_workspace_inventory')return{structuredContent:{workspace:{id:'ws-test',documents:[{id:'local'},{id:'light'},{id:'legacy'},{id:'waiting'},{id:'failed'}]}}}; if(name==='pdf_workspace_mineru_status')return{_meta:{mineruWorkspaceStatus:{workspaceId:'ws-test',statuses:[{documentId:'local',phase:'completed',engine:'local'},{documentId:'light',phase:'completed',engine:'lightweight'},{documentId:'legacy',phase:'completed',engine:'precision'},{documentId:'waiting',phase:'parsing'},{documentId:'failed',phase:'failed'},{documentId:'foreign',phase:'completed'}]}}};throw Error('Unsupported preview tool');};
 assert.deepEqual(await graphReadyDocuments(call,'ws-test'),['local']);
 assert.deepEqual(seen,['pdf_workspace_inventory','pdf_workspace_mineru_status']);
});
test('graph preflight preserves service errors and rejects a mismatched workspace',async()=>{
 await assert.rejects(()=>graphReadyDocuments(async()=>{throw Error('MCP disconnected');},'ws-test'),/MCP disconnected/);
 await assert.rejects(()=>graphReadyDocuments(async()=>({structuredContent:{workspace:{id:'another',documents:[]}}}),'ws-test'),/工作区/);
});

