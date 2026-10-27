import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installReaderToolbar} from '../src/ui/reader-toolbar.ts';
import {dropdownPosition,MENU_WIDTH} from '../src/shared/dropdown-layout.ts';
import {installReaderWorkspace} from '../src/ui/reader-workspace.ts';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
const react:any={createElement:(type:any,props:any,...children:any[])=>({type,props,children}),useState:(v:any)=>[v,()=>{}],useRef:(v:any)=>({current:v}),useEffect:()=>{},useMemo:(f:()=>unknown)=>f()};
test('Home and Settings use official icons and send distinct actions with the button anchor',()=>{
 const win:any={},calls:any[]=[];installReaderToolbar(win,(type,payload)=>calls.push({type,payload}));
 const home=win.__codexHomeButton(react),settings=win.__codexSettingsButton(react);
 assert.equal(home.props.id,'codexHome');assert.equal(home.children[0].props['data-icon'],'home');
 assert.equal(settings.props.id,'appearance');assert.equal(settings.children[0].props['data-icon'],'settings');
 home.props.onClick();settings.props.onClick({currentTarget:{getBoundingClientRect:()=>({left:900,right:928,bottom:38})}});
 assert.deepEqual(calls,[{type:'codex-reader:workspace-action',payload:{action:'home'}},{type:'codex-reader:settings',payload:{anchor:{left:900,right:928,bottom:38}}}]);
});
test('dropdowns share a compact width and stay below their anchor without overflowing narrow windows',()=>{
 assert.equal(MENU_WIDTH,248);
 const right=dropdownPosition({left:900,right:928,bottom:38},{width:940,height:600},'right');
 assert.equal(right.width,248);assert.equal(right.left,680);assert.equal(right.top,44);
 const narrow=dropdownPosition({left:0,right:30,bottom:38},{width:220,height:120});
 assert.equal(narrow.left,8);assert.equal(narrow.width,204);assert.ok(narrow.top+narrow.maxHeight<=112);
});
test('PDF sidebar keeps the document list without a duplicated Home, files, notes or settings toolbar',()=>{
 const win:any={};installReaderWorkspace(win,()=>{});
 const panel=win.__codexPdfPanel(react,{view:'pdfs'}),tree=panel.type(panel.props);
 assert.equal(tree.props.id,'pdfDocumentsView');
 assert.ok(!JSON.stringify(tree).includes('codex-pdf-menu'));
});
test('workspace heading opens the current workspace file chooser and disables opening while busy',()=>{
 const win:any={},calls:any[]=[];const workspace=installReaderWorkspace(win,(type,payload)=>calls.push({type,payload}));
 for(const busy of [false,true]){
  workspace.update({name:'默认工作区',active:'',openIds:[],documents:[],busy});
  const panel=win.__codexPdfPanel(react,{view:'pdfs'}),tree=panel.type(panel.props),heading=tree.children[0].children[0],button=heading.children.at(-1);
  assert.equal(button.type,'button');assert.equal(button.props['aria-label'],'打开 PDF');assert.equal(button.props.disabled,busy);
  assert.equal(button.children[0].props['data-icon'],'folder');
  if(!busy)button.props.onClick();
 }
 assert.deepEqual(calls,[{type:'codex-reader:workspace-action',payload:{action:'choose',id:undefined}}]);
});
test('PDF sidebar opens whiteboard notes directly in a live editor without an Edit or Save mode switch',()=>{
 const win:any={},calls:any[]=[];const workspace=installReaderWorkspace(win,(type,payload)=>calls.push({type,payload}));
 workspace.update({name:'Research',active:'pdf',openIds:['pdf'],documents:[],busy:false,notes:[{nodeId:'n',title:'Note',boards:[{title:'Board'}]}],activeNote:{nodeId:'n',title:'Note',markdown:'**Reading**\n\n$$x^2$$',revision:'r'}});
 const panel=win.__codexPdfPanel(react,{view:'pdfs'}),tree=panel.type(panel.props),note=tree.children[0];
 assert.equal(note.props.className,'codex-board-note');assert.ok(note.children[0].children.find((n:any)=>n?.type==='div'&&n.props?.ref));assert.ok(!JSON.stringify(note).includes('保存到白板'));assert.ok(!note.children[0].children.some((n:any)=>n?.type==='article'));
 assert.equal(note.children[1].type,'footer');note.children[1].children[0].props.onClick();assert.equal(calls[0].payload.action,'note-close');
});
test('packaged Zotero toolbar puts Home first and Settings last, with appearance moved out of the left tools',async()=>{
 const html=await readFile('vendor/zotero-reader/runtime/reader-local.html','utf8');
 const start=html.indexOf('function Toolbar(props) {'),end=html.indexOf('function ReadingProgress(props)',start),code=html.slice(start,end);
 const ctx:any={props:{type:'pdf',tool:{type:'pointer'},pageIndex:0,pagesCount:1},window:{},ReadingProgress:()=>null};
 const nativeReact={...react,useRef:()=>({current:{}}),useContext:()=>({platform:'web'})};
 for(const name of new Set(code.match(/[a-zA-Z0-9_]+__WEBPACK_IMPORTED_MODULE_\d+__(?:_default)?/g)??[]))ctx[name]=name.endsWith('_default')?()=>()=> 'toolbar-button':new Proxy({},{get:(_,key)=>String(key)});
 ctx.react__WEBPACK_IMPORTED_MODULE_0__=nativeReact;ctx.react__WEBPACK_IMPORTED_MODULE_0___default=()=>nativeReact;
 ctx._fluent_react__WEBPACK_IMPORTED_MODULE_1__={useLocalization:()=>({l10n:{getString:(id:string)=>id}})};
 installReaderToolbar(ctx.window,()=>{});ctx.window.__codexAnalysisButton=()=>({type:'button',props:{id:'codexAnalysis'}});
 const tree=new Script(code+'\nToolbar(props)').runInNewContext(ctx),left=tree.children[0],right=tree.children[2];
 assert.equal(left.children[0].props.id,'codexHome');assert.equal(left.children[1].props.id,'codexAnalysis');
 assert.equal(right.children.at(-1).props.id,'appearance');assert.equal(right.children.at(-1).props['aria-label'],'设置');
 assert.ok(!left.children.some((node:any)=>node?.props?.id==='appearance'||node?.props?.id==='codexFileMenu'));
});
