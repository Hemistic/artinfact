import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {createViewSession} from '../src/whiteboard/view-session.js';
import {JSDOM} from 'jsdom';
import {inspectorLayout,loadInspectorPage} from '../src/whiteboard/inspector-layout.js';
import {markdownHtml} from '../src/whiteboard/flow-notes.js';
import {isEditableNote} from '../src/whiteboard/note-editability.js';

const source=await readFile('src/whiteboard/mcp-whiteboard-view.ts','utf8');
const extract=(start:string,end:string)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const choose=extract('async function choose(','\n function readPromptDraft');
const mutate=extract('async function mutate(','\n async function patch(');
const rename=extract('async function renameBoard(','\n async function archiveBoard(');
const open=extract('async function open(','\n function renderLibrary(');
const recovery=extract('if(next.archived){','if(next.revision!==');
const evaluate=(code:string,scope:Record<string,any>)=>{if(!('inlineStudy' in scope))scope.inlineStudy='';if(!('geometryPending' in scope))scope.geometryPending=0;if(!('geometryQueue' in scope))scope.geometryQueue=Promise.resolve();if(!('studyEditing' in scope))scope.studyEditing=undefined;if(!('studyCards' in scope))scope.studyCards=new Map();if(!('noteEditingOptions' in scope))scope.noteEditingOptions=()=>({});if(!('cardShortcuts' in scope))scope.cardShortcuts=()=>{};return runInNewContext(ts.transpileModule(extract(' function keepInspectorEditor(','\n async function runCardAction(')+'\n'+code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);};
test('picture geometry saves do not wait for unrelated clean note editors to finish loading',async()=>{
 const calls:string[]=[],clean={isConnected:true,isDirty:()=>false,flush:()=>{throw Error('clean editor is still loading');}},dirty={isConnected:true,isDirty:()=>true,flush:async()=>{calls.push('dirty');}};
 await evaluate(extract(' async function flushEditedDrafts()','\n async function flushDraft()')+'\nflushEditedDrafts();',{noteEditing:clean,studyEditing:clean,studyCards:new Map([['clean',clean],['dirty',dirty]]),promptSaver:{flush:async()=>{calls.push('prompt');}}});
 assert.deepEqual(calls,['dirty','prompt']);
});
test('completed note rendering refreshes connection endpoints even when its saved height already matches',()=>{
 let scheduled:(()=>void)|undefined,painted=0,writes=0;
 const saved={nodes:[{id:'note',height:720}],edges:[]};
 const context:any={measureTimer:undefined,pending:0,geometryPending:0,dragging:false,hidden:false,state:{board:saved},board:()=>saved,structuredClone,elementMap:new Map([['note',{offsetHeight:720}]]),setTimeout:(fn:()=>void)=>{scheduled=fn;return 1;},clearTimeout(){},drawEdges:()=>{painted++;},mutate:()=>{writes++;return Promise.resolve();}};
 evaluate(extract(' function scheduleMeasure()','\n async function resizeCard(')+'\nscheduleMeasure();',context);
 assert.ok(scheduled);scheduled();assert.equal(painted,1);assert.equal(writes,0);
 context.geometryPending=1;scheduled();assert.equal(painted,1);
});
test('the actual Pages inspector loads full text and keeps operations in the bottom toolbar',async()=>{
 const dom=new JSDOM('<aside></aside>'),doc=dom.window.document,inspector=doc.querySelector('aside')!,node={id:'page-node',kind:'note',role:'source',sourceId:'pages-card:demo',note:'Summary',title:'Page',x:0,y:0};let requested:any;
 const el=(tag:string,cls='',text='')=>{const element=doc.createElement(tag);element.className=cls;element.textContent=text;return element;};
 const context:any={selected:node.id,selectedEdge:'',linkingMode:false,noteEditing:undefined,noteOpening:undefined,isEditableNote,inspector,inspectorLayout,loadInspectorPage,el,button:(text:string)=>el('button','',text),board:()=>({nodes:[node],edges:[]}),state:{board:{tasks:[]}},sources:[],pagesEntries:new Map([[node.id,{card:{title:'Page',excerpt:'Summary'}}]]),cardUiState:()=>({}),visualCard:()=>undefined,compactCard:()=>undefined,cardBody:(text:string)=>text,markdownHtml,inspectorHeadingHtml:(n:any)=>n.title,hydrate:async()=>{},active:'board',viewSession:createViewSession(),call:async(_name:string,args:any)=>{requested=args;return {markdown:'First paragraph\n\nLast paragraph $E=mc^2$'};},noteAssetIds:()=>[],inspectorRelations:()=>[]};
 evaluate(extract(' function showInspector()','\n async function readSource')+'\nshowInspector();',context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requested.includeContent,true);assert.match(inspector.querySelector('.flow-note-preview')!.textContent!,/Last paragraph/);assert.ok(inspector.querySelector('.flow-note-preview .katex'));
 assert.deepEqual([...inspector.querySelectorAll('.wb-inspector-actions>button')].map(b=>b.textContent),['打开 Pages']);assert.equal(inspector.querySelector('.wb-inspector-content>button'),null);assert.ok(inspector.querySelector('.wb-note-menu'));assert.ok(!inspector.textContent!.includes('查看信源正文'));dom.window.close();
});
test('whiteboard Markdown notes enter the live editor on selection while source and analysis cards keep their previews',async()=>{
 const dom=new JSDOM('<aside></aside>'),doc=dom.window.document,node:any={id:'note',kind:'note',role:'note',note:'Draft',title:'My note',x:0,y:0};let opened='';
 const el=(tag:string,cls='',text='')=>{const element=doc.createElement(tag);element.className=cls;element.textContent=text;return element;};
 const context:any={selected:node.id,selectedEdge:'',linkingMode:false,noteEditing:undefined,noteOpening:undefined,isEditableNote,inspector:doc.querySelector('aside'),inspectorLayout,loadInspectorPage,el,button:(text:string)=>el('button','',text),board:()=>({nodes:[node],edges:[]}),state:{board:{tasks:[]}},sources:[],pagesEntries:new Map(),cardUiState:()=>({}),visualCard:()=>undefined,compactCard:()=>undefined,cardBody:(text:string)=>text,markdownHtml,inspectorHeadingHtml:(n:any)=>n.title,hydrate:async()=>{},active:'board',viewSession:createViewSession(),noteAssetIds:()=>[],inspectorRelations:()=>[],editNote:async(id:string)=>{opened=id;},notice(){}};
 evaluate(extract(' function showInspector()','\n async function readSource')+'\nshowInspector();',context);await new Promise(resolve=>setImmediate(resolve));assert.equal(opened,'note');assert.ok(!context.inspector.textContent.includes('编辑笔记'));
 assert.equal(isEditableNote({...node,sourceId:'pdf'}),false);assert.equal(isEditableNote({...node,workflow:{type:'similarity',prompt:''}}),false);assert.equal(isEditableNote({...node,presentation:{type:'formula',latex:'x',explanation:'',symbols:[]}}),false);dom.window.close();
});
test('loading a whiteboard editor keeps Pages and relationship controls and ignores a stale selection',async()=>{
 const dom=new JSDOM('<aside><div class="wb-inspector-content"><div class="flow-inspector-head"></div><h2 class="wb-reading-title">Old title</h2><div class="flow-note-preview"></div><div class="wb-page-body">Full Pages reference</div></div><footer class="wb-inspector-actions"><button>打开 Pages</button><details class="wb-note-utilities">更多</details></footer></aside>'),doc=dom.window.document;
 let release!:(value:any)=>void;const context:any={active:'board',selected:'note',selectedEdge:'',linkingMode:false,noteEditing:undefined,noteOpening:undefined,viewSession:createViewSession(),flushDraft:async()=>{},inspector:doc.querySelector('aside'),noteAssetIds:()=>[],call:async()=>new Promise(resolve=>release=resolve),notice(){},showInspector(){},renderCanvas(){},el:(tag:string,cls='',text='')=>{const e=doc.createElement(tag);e.className=cls;e.textContent=text;return e;},button:(text:string)=>{const e=doc.createElement('button');e.textContent=text;return e;},noteEditor:()=>{const editor=doc.createElement('section') as any;editor.actions=doc.createElement('footer');editor.actions.append(doc.createElement('button'));editor.append(editor.actions);return editor;}};
 const api=evaluate(extract(' async function editNote(','\n async function exportMarkdown')+'\n({editNote});',context);
 const first=api.editNote('note');await new Promise(resolve=>setImmediate(resolve));release({title:'Note',markdown:'Body',revision:'r'});await first;
 assert.equal(context.inspector.querySelector('.wb-reading-title'),null);assert.ok(context.noteEditing.isConnected);assert.match(context.inspector.querySelector('.wb-page-body').textContent,/Full Pages/);assert.match(context.inspector.querySelector('.wb-inspector-actions').textContent,/打开 Pages/);assert.equal(context.inspector.dataset.noteMode,'edit');
 context.noteEditing=undefined;context.selected='other';const stale=api.editNote('other');await new Promise(resolve=>setImmediate(resolve));context.selected='third';release({title:'Other',markdown:'Body',revision:'r'});await stale;assert.equal(context.noteEditing,undefined);dom.window.close();
});
test('opening board management or more closes competing panels, and a save failure keeps the current view',async()=>{
 const context:any={...scope(),more:{hidden:false},moreButton:{setAttribute(){}},insert:{panel:{hidden:false},hide(){this.panel.hidden=true;},toggle(){}},library:{hidden:true},toolbar:{},noteEditing:{},analysis(){},showTemplates(){},addNote(){},showInspector(){},syncChrome(){},mutate:async()=>{},createCanvasToolbar:(_toolbar:any,actions:any)=>actions};
 const actions=evaluate(extract('const controls=createCanvasToolbar(','\n const {library:libraryButton')+'\ncontrols;',context);
 await actions.library();assert.equal(context.library.hidden,false);assert.equal(context.more.hidden,true);assert.equal(context.insert.panel.hidden,true);
 await actions.more();assert.equal(context.library.hidden,true);assert.equal(context.more.hidden,false);
 await actions.undo();assert.equal(context.noteEditing,undefined);
 context.flushDraft=async()=>{throw Error('save failed');};await assert.rejects(actions.library(),/save failed/);assert.equal(context.more.hidden,false);assert.equal(context.library.hidden,true);
});
test('a connected note editor protects its local draft from background repaint even after losing focus',()=>{
 const context:any={readPromptDraft:()=>undefined,noteEditing:{isConnected:true,isDirty:()=>true}};
 const guard=evaluate(extract('const hasPromptDraft=','\n const promptSaver')+'\nhasPromptDraft;',context);
 assert.equal(guard(),true);context.noteEditing.isConnected=false;assert.equal(guard(),false);
 context.studyEditing={isConnected:true,isDirty:()=>true};assert.equal(guard(),true);context.studyEditing.isConnected=false;
 context.noteEditing={isConnected:true,isDirty:()=>false};assert.equal(guard(),false,'a clean open editor permits genuine Agent results to refresh');context.noteEditing.isConnected=false;
 context.studyCards.set('study',{isConnected:true,isDirty:()=>true});assert.equal(guard(),true);context.studyCards.clear();assert.equal(guard(),false);
});
function deferred<T>(){let resolve!:(value:T|PromiseLike<T>)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
const view=(id:string,revision=1)=>({revision,board:{id,title:id},canUndo:false,canRedo:false});
function scope(){
 const state=view('a');return {
  state,active:'a',queue:Promise.resolve(),pending:0,navigation:0,navigating:false,hidden:false,dragging:false,hasPromptDraft:()=>false,
  viewSession:createViewSession(),selected:'',selectedEdge:'',connecting:'',linkingMode:false,
  selection:new Set<string>(),pagesEntries:new Map(),pagesSignature:'',boards:[{id:'b'},{id:'c'}],
  structuredClone,rid:()=>crypto.randomUUID(),flushDraft:async()=>{},catalogs:async()=>{},
  refreshPages:async()=>false,restoreSourceImages:async()=>{},restoreCamera(){},remember(){},
  renderBoard(){},renderLibrary(){},notice(){},library:{hidden:true},
 };
}

test('clicking the connection origin again restores its selected card details',async()=>{
 const calls:string[]=[],context={...scope(),root:{focus(){},clientWidth:1280},connecting:'a',selected:'a',linkingMode:true,
  renderCanvas:()=>calls.push('canvas'),showInspector:()=>calls.push('inspector'),syncChrome:()=>calls.push('chrome')};
 await evaluate(choose+'\nchoose("a");',context);
 assert.equal(context.linkingMode,false);assert.equal(context.connecting,'');
 assert.deepEqual(calls,['canvas','inspector','chrome']);assert.equal(context.selected,'a');
});

test('renaming shares the mutation queue so the following save reads the new revision',async()=>{
 const renameRead=deferred<any>(),started=deferred<void>(),events:string[]=[];let revision=1;
 const context:Record<string,any>={...scope(),call:async(name:string,args:any)=>{
  if(name==='whiteboard_read'){
   events.push('read:'+args.boardId);const current=view(args.boardId,revision);
   if(args.boardId==='b'){started.resolve();return renameRead.promise;}return current;
  }
  if(name==='whiteboard_patch'||name==='whiteboard_create'){
   events.push(name+':'+args.expectedRevision+':'+revision);
   if(args.expectedRevision!==revision)throw Error('REVISION_CONFLICT');
   return view(name==='whiteboard_create'?'new':args.boardId,++revision);
  }
 }};
 const api=evaluate(mutate+'\n'+rename+'\n({mutate,renameBoard});',context);
 const renaming=api.renameBoard('b','Renamed');await started.promise;
 const creating=api.mutate('whiteboard_create',{title:'New'});
 await new Promise<void>(resolve=>setImmediate(resolve));
 const beforeRelease=[...events];renameRead.resolve(view('b',1));
 const results=await Promise.allSettled([renaming,creating]);
 assert.deepEqual(beforeRelease,['read:b']);
 assert.equal(results.every(result=>result.status==='fulfilled'),true);
 assert.ok(events.includes('whiteboard_patch:1:1'));assert.ok(events.includes('whiteboard_create:2:2'));
});

test('a late rename refresh cannot replace the board selected during its request',async()=>{
 const activeRead=deferred<any>(),started=deferred<void>();
 const context:Record<string,any>={...scope(),call:async(name:string,args:any)=>{
  if(name==='whiteboard_patch')return view('b',2);
  if(args.boardId==='a'){started.resolve();return activeRead.promise;}return view('b');
 }};
 const api=evaluate(rename+'\n({renameBoard});',context),renaming=api.renameBoard('b','Renamed');
 await started.promise;context.navigation++;context.viewSession.invalidate();context.active='c';context.state=view('c',2);
 activeRead.resolve(view('a',2));await renaming;
 assert.equal(context.active,'c');assert.equal(context.state.board.id,'c');
});

test('renaming the visible board publishes its refreshed title and undo controls',async()=>{
 let rendered=0;const context:Record<string,any>={...scope(),renderBoard:()=>rendered++,call:async(name:string,args:any)=>
  name==='whiteboard_patch'?{...view('a',2),board:{id:'a',title:'Renamed'},canUndo:true}:view(args.boardId,name==='whiteboard_read'?1:2)};
 const api=evaluate(rename+'\n({renameBoard});',context);await api.renameBoard('a','Renamed');
 assert.equal(context.state.board.title,'Renamed');assert.equal(context.state.canUndo,true);assert.equal(rendered,1);
});

test('archived-board polling cannot override a navigation completed while catalogs load',async()=>{
 const catalog=deferred<void>(),started=deferred<void>();let recovered=0;
 const context:Record<string,any>={...scope(),next:{revision:2,archived:true},catalogs:async()=>{started.resolve();await catalog.promise;},call:async(_name:string,args:any)=>view(args.boardId,2),open:async()=>{recovered++;}};
 context.snapshot=context.viewSession.capture(context.active);context.baseline=context.state;
 const polling=evaluate('(async()=>{'+recovery+'})();',context);await started.promise;
 context.navigation++;context.viewSession.invalidate();context.active='c';context.state=view('c',2);
 catalog.resolve();await polling;
 assert.equal(context.active,'c');assert.equal(context.state.board.id,'c');assert.equal(recovered,0);
});

test('archived-board recovery discards its replacement read when a newer navigation wins',async()=>{
 const replacement=deferred<any>(),started=deferred<void>();const context:Record<string,any>={...scope(),next:{revision:2,archived:true},call:async(_name:string,args:any)=>{
  if(args.boardId==='b'){started.resolve();return replacement.promise;}return view(args.boardId,2);
 }};
 context.snapshot=context.viewSession.capture(context.active);context.baseline=context.state;
 const api=evaluate(open+'\n({open,recover:async()=>{'+recovery+'}});',context),polling=api.recover();
 await started.promise;await api.open('c');replacement.resolve(view('b',2));await polling;
 assert.equal(context.active,'c');assert.equal(context.state.board.id,'c');
});

test('archived-board recovery clears the view when no surviving board exists',async()=>{
 const context:Record<string,any>={...scope(),boards:[],next:{revision:2,archived:true},selected:'old-card',selectedEdge:'old-edge',connecting:'old-card',linkingMode:true};
 context.selection.add('old-card');context.pagesEntries.set('old-card',{});
 context.snapshot=context.viewSession.capture(context.active);context.baseline=context.state;
 await evaluate('(async()=>{'+recovery+'})();',context);
 assert.equal(context.active,'');assert.equal(context.state.board,null);assert.equal(context.selected,'');assert.equal(context.selectedEdge,'');
 assert.equal(context.connecting,'');assert.equal(context.linkingMode,false);assert.equal(context.pagesEntries.size,0);assert.equal(context.selection.size,0);
});
