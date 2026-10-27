import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resizePanel} from '../src/whiteboard/resizable-panel.js';

test('a saved width overrides the old narrow-screen CSS cap and the grip follows actual panel geometry',()=>{
 const originals=Object.getOwnPropertyDescriptors(globalThis),attributes=new Map<string,string>();
 const grip={style:{} as Record<string,string>,hidden:false,setAttribute:(key:string,value:string)=>attributes.set(key,value),remove(){}};
 const observer=class{observe(){}disconnect(){}};
 Object.defineProperties(globalThis,{document:{configurable:true,value:{createElement:()=>grip,body:{append(){}}}},localStorage:{configurable:true,value:{getItem:()=> '580'}},ResizeObserver:{configurable:true,value:observer},MutationObserver:{configurable:true,value:observer}});
 try{
  const panel={style:{width:'',maxWidth:''},hidden:false,getBoundingClientRect(){const width=Math.min(parseFloat(this.style.width),parseFloat(this.style.maxWidth)||420);return{left:650-14-width,top:60,height:500,width};}};
  const handle=resizePanel(panel as unknown as HTMLElement,{host:{isConnected:true,hidden:false} as HTMLElement,container:{clientWidth:650} as HTMLElement,key:'width',defaultWidth:420,label:'宽度'});
  assert.equal(panel.getBoundingClientRect().width,580);assert.equal(attributes.get('aria-valuenow'),'580');assert.equal(grip.style.left,'51px');handle.dispose();
 }finally{for(const key of ['document','localStorage','ResizeObserver','MutationObserver']){if(originals[key])Object.defineProperty(globalThis,key,originals[key]);else Reflect.deleteProperty(globalThis,key);}}
});
