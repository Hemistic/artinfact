import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {installNoteDom} from './fixtures/note-dom.js';

test('real whiteboard handlers save overlapping image moves and resizing without rebuilding cards; zoom keeps geometry stable',async()=>{
 const dom=new JSDOM('<!doctype html><html data-workspace-id="w" data-whiteboard-token="test"><body><div id="map"></div></body></html>',{url:'https://test.invalid',pretendToBeVisual:true});installNoteDom(dom);
 Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});
 Object.defineProperty(globalThis,'ResizeObserver',{value:class{observe(){}disconnect(){}},configurable:true});
 Object.defineProperty(globalThis,'IntersectionObserver',{value:class{observe(){}unobserve(){}disconnect(){}},configurable:true});
 for(const [key,value]of [['clientWidth',1000],['clientHeight',700]]as const)Object.defineProperty(dom.window.HTMLElement.prototype,key,{get:()=>value,configurable:true});
 Object.defineProperty(dom.window.HTMLElement.prototype,'offsetWidth',{get(){return parseFloat((this as HTMLElement).style.width)||420;},configurable:true});Object.defineProperty(dom.window.HTMLElement.prototype,'offsetHeight',{get:()=>600,configurable:true});
 for(const name of ['setPointerCapture','releasePointerCapture'])Object.defineProperty(dom.window.Element.prototype,name,{value:()=>{},configurable:true});Object.defineProperty(dom.window.Element.prototype,'hasPointerCapture',{value:()=>false,configurable:true});
 const note='![figure](flow-asset:image)\n\nFigure 1. Complete caption\n\n**Summary** of the mechanism.';
 let snapshot:any={revision:1,canUndo:false,canRedo:false,board:{id:'b',title:'Research',templateId:'free',sourceIds:[],tasks:[],board:{version:1,nodes:[{id:'image',kind:'image',title:'Figure',note,x:0,y:0,width:420,height:600,imageHeight:360,autoHeight:true},{id:'neighbor',kind:'note',title:'Neighbor',note:'Existing note',x:450,y:0,width:420,height:600,autoHeight:true}],edges:[]}}};
 const calls:string[]=[],writes:any[]=[];const win=dom.window;
 snapshot.board.board.nodes.push({id:'study',kind:'note',role:'note',title:'Study',note:'## Stable study\n\nSummary',studyNote:{label:'研读',highlights:[]},citations:[{sourceId:'paper',start:0,end:15,quote:'Original quote.'}],x:0,y:700,width:420,height:600,autoHeight:true});
 const contexts:any[]=[];
 win.postMessage=(message:any)=>{void(async()=>{if(message.type==='artinfact:whiteboard-context'){contexts.push(message.payload);win.dispatchEvent(new win.MessageEvent('message',{source:win as any,data:{type:'artinfact:whiteboard-response',token:'test',id:message.id,result:{mode:'updated'}}}));return;}if(message.type!=='artinfact:whiteboard-tool')return;const {name,args}=message.payload;calls.push(name);let value:any;
  if(name==='whiteboard_list')value={revision:snapshot.revision,initialized:true,boards:[{id:'b',title:'Research',templateId:'free',nodeCount:2}],archivedBoards:[]};
  else if(name==='whiteboard_sources')value={sources:[]};else if(name==='whiteboard_cards')value={cards:[]};else if(name==='whiteboard_pages_list')value={entries:[]};else if(name==='whiteboard_read')value=structuredClone(snapshot);
  else if(name==='whiteboard_note_read'){const n=snapshot.board.board.nodes.find((n:any)=>n.id===args.nodeId);value={title:n.title,markdown:n.note,revision:'note-1'};}
  else if(name==='whiteboard_patch'){assert.equal(args.expectedRevision,snapshot.revision);writes.push(args);await new Promise(r=>setTimeout(r,20));for(const op of args.operations)if(op.op==='put_node')snapshot.board.board.nodes[snapshot.board.board.nodes.findIndex((n:any)=>n.id===op.node.id)]=op.node;snapshot={...snapshot,revision:snapshot.revision+1,canUndo:true};value=structuredClone(snapshot);}
  else if(name==='whiteboard_asset_read'){win.dispatchEvent(new win.MessageEvent('message',{source:win as any,data:{type:'artinfact:whiteboard-response',token:'test',id:message.id,result:{content:[{type:'image',mimeType:'image/png',data:'AA=='}]}}}));return;}
  else throw Error('Unexpected tool '+name);
  win.dispatchEvent(new win.MessageEvent('message',{source:win as any,data:{type:'artinfact:whiteboard-response',token:'test',id:message.id,result:{structuredContent:value}}}));
 })();};
 const {createEditableFlowView}=await import('../src/whiteboard/mcp-whiteboard-view.js');const view=createEditableFlowView(document.getElementById('map')!,{nodes:[],edges:[]} as any);view.render();
 const wait=async(check:()=>boolean)=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('Canvas timed out: '+document.querySelector('[aria-live]')?.textContent+'; '+calls.join(','));};
 const pointer=(target:Element,type:string,x:number,y:number)=>{const e=new win.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0});Object.defineProperty(e,'pointerId',{value:1});target.dispatchEvent(e);};
 try{
  await wait(()=>!!document.querySelector('.wb-visual-card img'));await new Promise(r=>setTimeout(r,30));
  const card=document.querySelector<HTMLElement>('.wb-visual-card')!,image=card.querySelector('img')!,viewport=document.querySelector<HTMLElement>('.flow-editor-viewport')!,scene=document.querySelector<HTMLElement>('.flow-editor-scene')!;
  assert.match(card.querySelector('figcaption')!.textContent!,/Summary/);assert.ok(card.querySelector('figcaption')!.compareDocumentPosition(image)&win.Node.DOCUMENT_POSITION_FOLLOWING);
  await wait(()=>!!document.querySelector('.wb-study-note'));const study=document.querySelector('.wb-study-note') as any;await study.ready;const studyEditor=study.querySelector('.milkdown');assert.ok(studyEditor,'the neighbor uses the real Milkdown editor');
  const studyCard=document.querySelector<HTMLElement>('[data-id=study]')!,label=study.querySelector('.wb-study-label')!;
  pointer(label,'pointerdown',100,100);pointer(studyCard,'pointermove',175,175);pointer(studyCard,'pointerup',175,175);await wait(()=>snapshot.board.board.nodes[2].x===100);
  assert.equal(snapshot.board.board.nodes[2].y,800);assert.equal(study.querySelector('.milkdown'),studyEditor,'moving a study card must retain the live editor');
  pointer(label,'pointerdown',100,100);pointer(studyCard,'pointermove',175,100);pointer(studyCard,'pointerup',175,100);pointer(label,'pointerdown',100,100);pointer(studyCard,'pointermove',175,100);pointer(studyCard,'pointerup',175,100);await wait(()=>snapshot.board.board.nodes[2].x===300);assert.equal(parseFloat(studyCard.style.left),300,'back-to-back study moves must not snap back while the first save is pending');
  const cancelled=studyCard.style.cssText;pointer(label,'pointerdown',100,100);pointer(studyCard,'pointermove',200,200);pointer(studyCard,'pointercancel',200,200);assert.equal(studyCard.style.cssText,cancelled,'cancel restores the persisted study position');
  const beforeTextDrag=studyCard.style.cssText,body=study.querySelector('.wb-study-upper .ProseMirror')!;
  pointer(body,'pointerdown',100,100);pointer(studyCard,'pointermove',175,175);pointer(studyCard,'pointerup',175,175);assert.equal(studyCard.style.cssText,beforeTextDrag,'editing or selecting note text must not drag the card');
  const sourceBody=study.querySelector('.wb-study-source-body .ProseMirror')!;
  pointer(sourceBody,'pointerdown',100,100);pointer(studyCard,'pointermove',175,175);pointer(studyCard,'pointerup',175,175);assert.equal(studyCard.style.cssText,beforeTextDrag,'source evidence remains selectable');
  const catalogs=calls.filter(n=>n==='whiteboard_sources').length,neighbor=document.querySelector<HTMLElement>('[data-id="neighbor"]')!;
  pointer(image,'pointerdown',100,100);pointer(card,'pointermove',475,100);pointer(card,'pointerup',475,100);await wait(()=>snapshot.board.board.nodes[0].x===500);
  assert.equal(document.querySelector('.wb-visual-card'),card);assert.equal(parseFloat(card.style.left),500);assert.equal(snapshot.board.board.nodes[1].x,450);assert.equal(calls.filter(n=>n==='whiteboard_sources').length,catalogs,'geometry writes must not reload the material catalog');
  pointer(image,'pointerdown',100,100);pointer(card,'pointermove',175,175);pointer(card,'pointerup',175,175);await wait(()=>snapshot.board.board.nodes[0].x===600);assert.equal(snapshot.board.board.nodes[0].y,100);assert.equal(snapshot.board.board.nodes[0].note,note);
  pointer(image,'pointerdown',100,100);pointer(card,'pointermove',250,100);pointer(card,'pointerup',250,100);pointer(image,'pointerdown',100,100);pointer(card,'pointermove',250,100);pointer(card,'pointerup',250,100);await wait(()=>snapshot.board.board.nodes[0].x===1000);assert.equal(parseFloat(card.style.left),1000,'successive drags must retain the latest visible position while the first save is pending');
  const handle=card.querySelector('.wb-visual-resize')!;pointer(handle,'pointerdown',100,100);pointer(handle,'pointermove',205,190);pointer(handle,'pointerup',205,190);await wait(()=>snapshot.board.board.nodes[0].width===560);assert.equal(snapshot.board.board.nodes[0].imageHeight,480);assert.equal(snapshot.board.board.nodes[1].x,450);assert.equal(document.querySelector('.wb-visual-card'),card);
  await new Promise(r=>setTimeout(r,30));const before=card.style.cssText,revision=snapshot.revision;for(let i=0;i<100;i++)viewport.dispatchEvent(new win.WheelEvent('wheel',{deltaY:2,clientX:400,clientY:300,bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,30));assert.equal(card.style.cssText,before);assert.equal(snapshot.revision,revision);assert.match(scene.style.transform,/scale/);assert.equal(scene.style.zoom,'1');assert.ok(writes.length>=3);
  await new Promise(r=>setTimeout(r,150));card.querySelector('figcaption')!.dispatchEvent(new win.MouseEvent('click',{bubbles:true}));
  await wait(()=>document.querySelector('[data-id="image"]')?.getAttribute('data-selected')==='true');
  assert.equal(contexts.at(-1)?.nodeId,'image');assert.equal(contexts.at(-1)?.boardId,'b');
  assert.equal(document.querySelector<HTMLDetailsElement>('.wb-card-agent-actions')!.open,false,'AI actions stay collapsed');assert.equal(document.querySelectorAll('[data-card-action]').length,4);
  assert.equal(document.querySelector('[data-id="neighbor"]'),neighbor,'selecting the picture must not replace another card');
  assert.equal(document.querySelector('[data-id="image"]'),card,'selecting the picture must retain its decoded image');
  snapshot=structuredClone(snapshot);snapshot.revision++;snapshot.board.board.nodes[1].note='Remote note update';
  await wait(()=>document.querySelector('[data-id="neighbor"]')?.textContent?.includes('Remote note update')===true);
  assert.equal(document.querySelector('[data-id="image"]'),card,'a background update to another card must not reload this image');
  assert.equal(document.querySelector('.wb-study-note'),study);assert.equal(study.querySelector('.milkdown'),studyEditor,'the unrelated Milkdown editor must remain mounted throughout picture actions and polling');
  assert.equal(card.querySelector('img'),image);assert.equal(calls.filter(n=>n==='whiteboard_asset_read').length,1);
  Object.defineProperty(image,'naturalWidth',{value:200,configurable:true});Object.defineProperty(image,'naturalHeight',{value:100,configurable:true});
  const scale=Number(/scale\(([^)]+)/.exec(scene.style.transform)![1]),priorWidth=snapshot.board.board.nodes[0].width;
  pointer(handle,'pointerdown',100,100);pointer(handle,'pointermove',100,100+75*scale);pointer(handle,'pointerup',100,100+75*scale);
  await wait(()=>snapshot.board.board.nodes[0].width===priorWidth+150);
  assert.equal(snapshot.board.board.nodes[0].imageHeight,Math.round((priorWidth+150-40)/2));assert.equal(card.querySelector('img'),image);
  const persisted=card.style.cssText;pointer(handle,'pointerdown',100,100);pointer(handle,'pointermove',300,300);pointer(handle,'pointercancel',300,300);assert.equal(card.style.cssText,persisted,'cancelled resize restores the saved picture geometry');
 }finally{view.hide();win.dispatchEvent(new win.Event('beforeunload'));dom.window.close();}
});
