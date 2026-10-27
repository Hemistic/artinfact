import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';

async function renderer(){
 const html=await readFile('vendor/zotero-reader/runtime/reader-local.html','utf8');
 const start=html.indexOf('function isMineruNavigationOutline('),end=html.indexOf('/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (OutlineView);',start);
 const script=new Script(html.slice(start,end)+'\nOutlineView(props)');
 const react={createElement:(type:any,props:any,...children:any[])=>({type,props,children}),useRef:(current:any)=>({current}),useState:(value:any)=>[value,()=>{}],useEffect:()=>{}};
 return (props:any)=>script.runInNewContext({props,AIOutlineNotesHeader:()=>null,AIInsights:()=>null,window:{},normalizeLanguage:()=> 'zh',getAIInsightAnnotations:()=>[],react__WEBPACK_IMPORTED_MODULE_0__:react,react__WEBPACK_IMPORTED_MODULE_0___default:()=>react,classnames__WEBPACK_IMPORTED_MODULE_1___default:()=> (name:any,states:any)=>({name,states})});
}
function displayedItems(node:any):any[]{if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(displayedItems);return [...(node.type?.name==='Item'?[node.props.item]:[]),...(node.children||[]).flatMap(displayedItems)];}
const native=()=>[{title:'原目录：Introduction',expanded:true,location:{pageIndex:0},items:[{title:'原目录：Methods',location:{pageIndex:1},items:[]}]}];
const candidate=(status:string,annotation='章节说明')=>({status,outlineSource:'mineru-json',generationMode:'mineru-navigation-v1',items:[{id:'ai-intro',originalTitle:'AI 导航章节',pageIndex:0,annotation}]});

test('before AI generation and on pending, failed, cleared or empty results the native outline remains navigable',async()=>{
 const render=await renderer();
 for(const aiOutline of [null,candidate('queued'),candidate('generating'),candidate('failed'),candidate('cleared'),candidate('navigation-ready'),candidate('ready',''),{status:'ready',items:[]}]){
  const outline=native(),calls:any[]=[];
  const tree=render({outline,aiOutline,annotations:[],onNavigate:(...args:any[])=>calls.push(args)});
  assert.deepEqual(displayedItems(tree).map(item=>item.title),['原目录：Introduction','原目录：Methods'],JSON.stringify(aiOutline));
  assert.equal(displayedItems(tree)[0],outline[0]);
  const item=tree.children[1].children[0][0];item.props.onSelect(outline[0]);
  assert.equal(calls[0][0],outline[0].location);
 }
});

test('only a successful nonempty AI result is rendered; clearing it restores the unchanged original hierarchy',async()=>{
 const render=await renderer(),outline=native(),before=JSON.stringify(outline);
 assert.deepEqual(displayedItems(render({outline,aiOutline:candidate('ready'),annotations:[]})).map(item=>item.title),['AI 导航章节']);
 assert.equal(JSON.stringify(outline),before);
 assert.deepEqual(displayedItems(render({outline,aiOutline:candidate('cleared'),annotations:[]})).map(item=>item.title),['原目录：Introduction','原目录：Methods']);
 const notes={status:'ready',outlineSource:'pdf-native',items:[{nativeOutlineOrder:1,annotation:'原章节的 AI 说明'}]};
 assert.deepEqual(displayedItems(render({outline,aiOutline:notes,annotations:[]})).map(item=>item.title),['原目录：Introduction','原目录：Methods']);
 assert.equal(JSON.stringify(outline),before);
});
