import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkspaceLibrary} from '../src/server/workspaces.js';
import {WorkspaceRuntime} from '../src/server/workspace-runtime.js';
import {PdfStateStore} from '../src/server/pdf-store.js';
import {ResearchWiki} from '../src/server/research-wiki.js';
import {WorkspaceWhiteboards} from '../src/server/whiteboard-service.js';
import {workspaceKnowledgeEntries} from '../src/shared/workspace-graph-views.js';
import {workspaceGraphView} from '../src/server/workspace-graph-view.js';

test('homepage has only direct graph and whiteboard entrances',()=>{
 assert.deepEqual(workspaceKnowledgeEntries.map(e=>[e.title,e.mode,e.openData]),[
  ['图谱','constellation',false],['白板','editor',false],
 ]);
});

test('original network view receives real Wiki relations and excerpts without replacing saved whiteboards',async t=>{
 const root=await mkdtemp(join(tmpdir(),'graph-views-')),library=new WorkspaceLibrary(()=>root),runtime=new WorkspaceRuntime(library,new PdfStateStore(join(root,'legacy')));
 t.after(async()=>{await runtime.close();await rm(root,{recursive:true,force:true});});await library.list();
 const wiki=new ResearchWiki(library,runtime);
 await wiki.write('default','wiki/concepts/a.md','---\ntitle: Alpha\ntype: concept\n---\n# Alpha\n\nExact statement </script>.\n\n[[wiki/concepts/b]]',null);
 await wiki.write('default','wiki/concepts/b.md','---\ntitle: Beta\ntype: concept\n---\n# Beta\n\nSecond statement.',null);
 const service=new WorkspaceWhiteboards(runtime),store=await service.store('default');
 const board=await store.importBoard({title:'Original board',legacyKey:'old',board:{version:1,nodes:[{id:'old',title:'Original',note:'Keep me',kind:'note',x:22,y:33}],edges:[]},expectedRevision:0,requestId:'old'});
 const before=await readFile(join((await library.get('default')).rootDir,'knowledge-map','whiteboards.json'),'utf8');
 const template='<title><!--GRAPH_TITLE--></title><script id="graph-data" type="application/json"><!--GRAPH_DATA--></script><script id="graph-pages" type="application/json"><!--GRAPH_PAGES--></script>';
 const view=await workspaceGraphView(runtime,'default',template);
 const data=JSON.parse(view.html.match(/id="graph-data"[^>]*>(.*?)<\/script>/s)![1]);
 assert.ok(data.nodes.some((n:any)=>n.label==='Alpha'));
 assert.ok(data.edges.some((e:any)=>e.source==='wiki/concepts/a.md'&&e.target==='wiki/concepts/b.md'));
 const pages=JSON.parse(view.html.match(/id="graph-pages"[^>]*>(.*?)<\/script>/s)![1]);
 assert.match(pages['wiki/concepts/a.md'],/Exact statement <\/script>/);
 assert.equal(view.html.includes('Exact statement </script>'),false);
 assert.equal(await readFile(join((await library.get('default')).rootDir,'knowledge-map','whiteboards.json'),'utf8'),before);
 assert.equal((await store.read(board.board!.id)).board!.board.nodes[0].note,'Keep me');
 const other=await library.create('Other'),otherView=await workspaceGraphView(runtime,other.id,template);
 assert.equal(otherView.html.includes('Exact statement'),false);
});
