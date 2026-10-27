import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionLabel} from '../src/whiteboard/connection-label.js';
class Element {
 children:Element[]=[];dataset:Record<string,string>={};attributes:Record<string,string>={};classList={add:()=>{}};value='';textContent='';title='';type='';maxLength=0;focused=false;
 onclick?:()=>void;ondblclick?:(e:any)=>void;onkeydown?:(e:any)=>void;onblur?:()=>void;
 setAttribute(k:string,v:string){this.attributes[k]=v;}append(...e:Element[]){this.children.push(...e);}replaceChildren(...e:Element[]){this.children=e;}focus(){this.focused=true;}select(){}
}
test('single click edits on the line; Enter saves once and Escape leaves the prior label',async t=>{
 const old=globalThis.document;t.after(()=>{globalThis.document=old;});
 globalThis.document={createElement:()=>new Element(),createElementNS:()=>new Element()} as any;
 let saves=0,selected=0;const edge={id:'e',label:'关联'};
 const label=connectionLabel(edge,{x:300,y:200},{select:()=>{selected++;},save:async text=>{saves++;assert.equal(text,'对比');},notice:()=>{}}) as unknown as Element;
 const event={stopPropagation(){},preventDefault(){},key:'Enter'};
 await (label.children[0].onclick as any)(event);
 const input=label.children[0];assert.equal(input.value,'关联');assert.equal(input.focused,true);assert.equal(selected,1);
 input.value='对比';input.onkeydown!(event);input.onblur?.();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(saves,1);assert.equal(label.children[0].textContent,'对比');assert.equal(label.attributes.x,'210');
 await (label.children[0].onclick as any)(event);label.children[0].value='Discard';label.children[0].onkeydown!({...event,key:'Escape'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(saves,1);assert.equal(label.children[0].textContent,'对比');
});

test('IME confirmation does not save an unfinished label and double-click stays on the label',async t=>{
 const old=globalThis.document;t.after(()=>{globalThis.document=old;});
 globalThis.document={createElement:()=>new Element(),createElementNS:()=>new Element()} as any;
 let saves=0,stopped=false;
 const label=connectionLabel({id:'e',label:'关联'},{x:0,y:0},{select:()=>{},save:async()=>{saves++;},notice:()=>{}}) as unknown as Element;
 await (label.children[0].onclick as any)({stopPropagation(){}});
 const input=label.children[0];input.value='对比';
 input.onkeydown!({key:'Enter',isComposing:true,stopPropagation(){},preventDefault(){}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(saves,0);assert.equal(label.children[0],input);
 label.ondblclick?.({stopPropagation(){stopped=true;}});assert.equal(stopped,true);
 input.onkeydown!({key:'Enter',isComposing:false,stopPropagation(){},preventDefault(){}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(saves,1);
});
