import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collapseDocumentRepresentations} from '../src/server/wiki-document-links.ts';
import {ResearchWiki} from '../src/server/research-wiki.ts';
import {WorkspaceLibrary} from '../src/server/workspaces.ts';
import {simplePdf} from './fixtures/simple-pdf.ts';
import {WorkspaceRuntime} from '../src/server/workspace-runtime.ts';
import {PdfStateStore} from '../src/server/pdf-store.ts';

test('new graph ingestion rejects lightweight Markdown and uses one paper identity after standard JSON conversion', async()=>{
 const root=await mkdtemp(join(tmpdir(),'light-md-wiki-')),library=new WorkspaceLibrary(()=>root);await library.list();
 const path=join(root,'input.pdf');await writeFile(path,simplePdf());const doc=await library.importBytes('default','input.pdf',Buffer.from(simplePdf()),path);
 const runtime=new WorkspaceRuntime(library,new PdfStateStore(join(root,'legacy')));
 const folder=join(doc.projectDir,'mineru','runs','light-test','output');await mkdir(folder,{recursive:true});
 await writeFile(join(folder,'document-mineru.md'),'# Evidence\n\nLightweight Markdown supplies graph evidence.');
 await writeFile(join(doc.projectDir,'mineru','result.json'),JSON.stringify({directory:folder,name:doc.name,pages:[{width:612,height:792}],format:'markdown-only',engine:'lightweight'}));
 const wiki=new ResearchWiki(library,runtime);await assert.rejects(wiki.importSources('default',[doc.id]),/标准版.*JSON/);
 await writeFile(join(folder,'document-mineru.json'),JSON.stringify([{type:'text',text:'Lightweight Markdown supplies graph evidence.',page_idx:0,bbox:[0,0,100,100]}]));
 await writeFile(join(doc.projectDir,'mineru','result.json'),JSON.stringify({directory:folder,name:doc.name,pages:[{width:612,height:792}],format:'structured',engine:'local'}));
 const imported=await wiki.importSources('default',[doc.id]);
 assert.equal(imported.sources.length,1);assert.ok(imported.sources[0].jsonPath?.endsWith('/source.json'));
 const page=`wiki/sources/${doc.id}.md`;
 await wiki.write('default',page,`---\ntitle: Paper\ntype: source\nsources:\n  - ${imported.sources[0].markdownPath}\n---\n# Paper\n[[wiki/concepts/evidence]]`,null);
 await wiki.write('default','wiki/concepts/evidence.md',`---\ntitle: Evidence\ntype: concept\n---\n# Evidence\n[[${page}]]`,null);
 const graph=await wiki.graph('default');assert.equal(graph.summary.documentCount,1);assert.equal(graph.sourceStatus.markdownImported,1);
 assert.equal(graph.nodes.filter((n:any)=>n.document?.documentId===doc.id).length,1);
 assert.ok(graph.nodes.some((n:any)=>n.document?.originalPdf===doc.sourcePath));
 assert.ok(!graph.nodes.some((n:any)=>n.type==='raw'&&/\.pdf$/.test(n.id)));
 await runtime.close();
});

test('one Markdown-backed paper represents its PDF and Markdown without duplicate evidence edges',()=>{
 const id='a'.repeat(64),page=`wiki/sources/${id}.md`,md=`.raw/imports/${id}/source.md`,pdf=`.raw/imports/${id}/source.pdf`;
 const binding={workspaceId:'default',documentId:id,title:'Paper',markdownPath:md,pdfPath:pdf,jsonPath:`.raw/imports/${id}/source.json`,originalPdf:'C:/owned/source.pdf',markdownSha256:'b'.repeat(64),kind:'mineru-markdown' as const};
 const graph:any={nodes:[{id:page,type:'source',relativePath:page,degree:0},{id:md,type:'raw',relativePath:md,degree:0},{id:pdf,type:'raw',relativePath:pdf,degree:0},{id:'concept',type:'concept',degree:0}],edges:[{id:'1',source:page,target:md,relation:'raw-source',weight:2},{id:'2',source:page,target:pdf,relation:'raw-source',weight:2},{id:'3',source:'concept',target:md,relation:'raw-source',weight:2},{id:'4',source:'concept',target:pdf,relation:'raw-source',weight:2}],pages:[{id:page}],rawSources:[{id:md},{id:pdf}],summary:{pageCount:1,rawSourceCount:2,nodeCount:4,edgeCount:4,missingTargetCount:0}};
 collapseDocumentRepresentations(graph,[binding]);
 assert.equal(graph.nodes.length,2);assert.equal(graph.edges.length,1);assert.equal(graph.edges[0].target,page);assert.equal(graph.edges[0].weight,2);
 assert.equal(graph.nodes.find((n:any)=>n.id===page).document.originalPdf,binding.originalPdf);
 assert.equal(graph.nodes.find((n:any)=>n.id===page).document.markdownPath,md);
 assert.equal(graph.summary.documentCount,1);assert.equal(graph.summary.rawSourceCount,0);
});

test('PDF-only extraction cannot be saved as a converted literature source',async()=>{
 const root=await mkdtemp(join(tmpdir(),'md-only-wiki-')),library=new WorkspaceLibrary(()=>root);await library.list();
 const path=join(root,'input.pdf');await writeFile(path,simplePdf());const doc=await library.importBytes('default','input.pdf',Buffer.from(simplePdf()),path);const wiki=new ResearchWiki(library);
 await assert.rejects(wiki.write('default',`wiki/sources/${doc.id}.md`,`---\ntype: source\nsources:\n  - .raw/native-pdf/${doc.id}/source.md\n---\n# Native extraction`,null),/MinerU|Markdown/);
 const vault=(await wiki.initialize('default')).rootDir;await mkdir(join(vault,'.raw/imports',doc.id),{recursive:true});
 await writeFile(join(vault,'.raw/imports',doc.id,'manifest.json'),JSON.stringify({workspaceId:'default',documentId:doc.id,originalPdf:doc.sourcePath,kind:'mineru-markdown'}));
 await assert.rejects(wiki.write('default',`wiki/sources/${doc.id}.md`,'# Pretend converted',null),/MinerU|Markdown|ENOENT/);
});
