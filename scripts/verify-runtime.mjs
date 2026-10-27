import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const root=process.env.ARTINFACT_VERIFY_ROOT?path.resolve(process.env.ARTINFACT_VERIFY_ROOT):path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'artinfact-runtime-'));
await fs.mkdir(path.join(scratch,'workspace'),{recursive:true});
const client=new Client({name:'artinfact-runtime-verification',version:'1'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'dist/server/index.js')],stderr:'pipe',env:{...process.env,CODEX_LAYOUT_WORKSPACE:path.join(scratch,'workspace'),CODEX_WORKSPACE_SETTINGS_DIR:path.join(scratch,'settings'),CODEX_PDF_DATA_DIR:path.join(scratch,'pdf')}});
let stderr='';transport.stderr?.on('data',chunk=>stderr+=chunk.toString());
const timeout=setTimeout(()=>{process.stderr.write('Runtime verification timed out.\n');void client.close();process.exitCode=1;},60000);
try{
 await client.connect(transport);
 const tools=[];let cursor;
 do{const page=await client.listTools(cursor?{cursor}:{});tools.push(...page.tools);cursor=page.nextCursor;}while(cursor);
 for(const name of ['pdf_open','whiteboard_read','whiteboard_card_action_complete','pdf_reference_action_complete'])assert(tools.some(t=>t.name===name),'Missing tool: '+name);
 const resources=await client.listResources();assert(resources.resources.length>0,'No app resources');
 const result=await client.callTool({name:'pdf_open',arguments:{path:path.join(root,'review-fixtures/artinfact-review-sample.pdf')}},undefined,{timeout:30000});
 assert(!result.isError,'pdf_open failed');
 const reader=result._meta?.pdfReader;assert(reader?.baseUrl,'No reader endpoint');
 assert(reader.document?.url,'Synthetic PDF was not opened');
 const pdf=await fetch(reader.document.url);assert.equal(pdf.status,200);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
 const appResource=await client.readResource({uri:resources.resources[0].uri});assert(appResource.contents.length>0,'Empty app resource');
 console.log(JSON.stringify({ok:true,tools:tools.length,resources:resources.resources.length,pdfEndpoint:true,isolatedState:true}));
}catch(error){if(stderr)process.stderr.write(stderr.split('\n').filter(line=>line.length<500).slice(-8).join('\n')+'\n');throw error;}
finally{clearTimeout(timeout);await client.close();await fs.rm(scratch,{recursive:true,force:true});}
