import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {anchoredMenuPosition} from '../src/shared/anchored-menu.js';import {trackAnchoredMenu} from '../src/ui/anchored-menu.js';
const rectangle=(left:number,top:number,width:number,height:number)=>({left,top,right:left+width,bottom:top+height,width,height,x:left,y:top,toJSON:()=>({left,top,width,height})});
test('anchored menus choose below, above, right and left without covering their reference',()=>{
 const viewport=rectangle(0,0,800,600),size={width:248,height:180};
 const below=anchoredMenuPosition(rectangle(300,100,50,12),viewport,size)!;assert.equal(below.placement,'bottom');assert.equal(below.left,300);assert.equal(below.top,118);
 const above=anchoredMenuPosition(rectangle(300,560,50,12),viewport,size)!;assert.equal(above.placement,'top');assert.equal(above.top,374);
 const narrow=rectangle(0,0,800,230),right=anchoredMenuPosition(rectangle(100,110,30,12),narrow,size)!;assert.equal(right.placement,'right');assert.equal(right.left,136);assert.ok(right.top>=8&&right.top+180<=222);
 const left=anchoredMenuPosition(rectangle(690,110,30,12),narrow,size)!;assert.equal(left.placement,'left');assert.equal(left.left,436);assert.ok(left.top>=8&&left.top+180<=222);
});
test('small or offset reader viewports constrain the menu, and offscreen anchors dismiss it',()=>{
 const small=anchoredMenuPosition(rectangle(20,40,10,12),rectangle(0,0,150,100),{width:248,height:200})!;assert.equal(small.placement,'bottom');assert.equal(small.left,8);assert.equal(small.top,58);assert.equal(small.width,134);assert.equal(small.maxHeight,34);
 const offset=anchoredMenuPosition(rectangle(770,470,30,10),rectangle(300,70,600,430),{width:248,height:170})!;assert.equal(offset.placement,'top');assert.equal(offset.left,644);assert.equal(offset.top,294);
 assert.equal(anchoredMenuPosition(rectangle(50,610,40,10),rectangle(0,0,800,600),{width:248,height:180}),undefined);
});
test('an iframe menu follows scrolling, repositions for growing task status and cleans up observers and queued frames',()=>{
 const outer=new JSDOM('<body><iframe></iframe><section class="menu"></section></body>',{pretendToBeVisual:true}),win=outer.window as unknown as Window,frame=outer.window.document.querySelector('iframe')!,inner=frame.contentWindow!,menu=outer.window.document.querySelector<HTMLElement>('.menu')!,anchor=inner.document.createElement('button');inner.document.body.append(anchor);
 Object.defineProperty(win,'innerWidth',{value:800,configurable:true});Object.defineProperty(win,'innerHeight',{value:600,configurable:true});frame.getBoundingClientRect=()=>rectangle(100,50,650,530);let y=440,height=180;anchor.getBoundingClientRect=()=>rectangle(50,y,40,15);menu.getBoundingClientRect=()=>rectangle(0,0,248,height);Object.defineProperty(menu,'scrollHeight',{get:()=>height});
 let next=0,scheduled=0,dismissed=0,disconnects=0;const callbacks=new Map<number,FrameRequestCallback>(),observers:{callback:ResizeObserverCallback;targets:Element[]}[]=[];
 win.requestAnimationFrame=callback=>{scheduled++;callbacks.set(++next,callback);return next;};win.cancelAnimationFrame=id=>{callbacks.delete(id);};(win as any).ResizeObserver=class{record:{callback:ResizeObserverCallback;targets:Element[]};constructor(callback:ResizeObserverCallback){this.record={callback,targets:[]};observers.push(this.record);}observe(target:Element){this.record.targets.push(target);}disconnect(){disconnects++;}};
 const flush=()=>{const pending=[...callbacks.values()];callbacks.clear();for(const callback of pending)callback(0);};const tracker=trackAnchoredMenu(win,menu,anchor,()=>{dismissed++;});
 try{assert.equal(menu.dataset.placement,'top');assert.equal(menu.style.top,'304px');assert.equal(menu.style.left,'150px');assert.ok(observers[0].targets.includes(menu));y=120;inner.dispatchEvent(new outer.window.Event('scroll'));inner.dispatchEvent(new outer.window.Event('scroll'));assert.equal(scheduled,1);flush();assert.equal(menu.dataset.placement,'bottom');assert.equal(menu.style.top,'191px');height=420;observers[0].callback([],{} as ResizeObserver);flush();assert.equal(menu.dataset.placement,'right');assert.ok(parseFloat(menu.style.top)>=58);assert.ok(parseFloat(menu.style.top)+Math.min(height,parseFloat(menu.style.maxHeight))<=572);y=600;inner.dispatchEvent(new outer.window.Event('scroll'));flush();assert.equal(dismissed,1);tracker.dispose();assert.equal(disconnects,1);const before=scheduled;inner.dispatchEvent(new outer.window.Event('scroll'));assert.equal(scheduled,before);assert.equal(callbacks.size,0);
 }finally{tracker.dispose();outer.window.close();}
});
