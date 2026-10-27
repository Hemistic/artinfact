import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createWorkspaceViewSwitch} from '../src/shared/workspace-view-switch.js';
import {tooltipPosition,bindControlTooltip} from '../src/shared/control-tooltip.js';

test('two icon controls switch directly and keep the selected mode without a data menu',async()=>{
 const dom=new JSDOM('<main></main>'),prior=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{value:dom.window.document,configurable:true});
 try{const calls:string[]=[],view=createWorkspaceViewSwitch({select:async mode=>{calls.push(mode);},onError:()=>{}});dom.window.document.body.append(view);
 const buttons=view.querySelectorAll('button');assert.equal(buttons.length,2);assert.equal(view.querySelector('details,summary,nav'),null);assert.ok(buttons[0].querySelector('svg'));assert.ok(buttons[1].querySelector('svg'));
 buttons[1].click();await new Promise(r=>setTimeout(r,0));assert.deepEqual(calls,['editor']);assert.equal(buttons[1].getAttribute('aria-pressed'),'true');assert.equal(buttons[0].getAttribute('aria-pressed'),'false');
 buttons[0].click();await new Promise(r=>setTimeout(r,0));assert.deepEqual(calls,['editor','constellation']);assert.equal(buttons[0].getAttribute('aria-pressed'),'true');
 }finally{if(prior)Object.defineProperty(globalThis,'document',prior);else Reflect.deleteProperty(globalThis,'document');dom.window.close();}
});

test('tooltips stay inside narrow viewports and flip below top-edge controls',()=>{
 assert.deepEqual(tooltipPosition({left:14,right:44,top:14,bottom:44},{width:130,height:34},{width:350,height:250}),{left:8,top:54});
 assert.deepEqual(tooltipPosition({left:306,right:336,top:200,bottom:230},{width:190,height:34},{width:350,height:250}),{left:152,top:156});
});

test('long English tooltip uses a separate overlay and hides on scroll without losing existing accessibility description',()=>{
 const dom=new JSDOM('<button aria-label="Knowledge graph / Whiteboards" aria-describedby="help"></button>'),doc=dom.window.document,button=doc.querySelector('button')!;
 try{bindControlTooltip(button);button.dispatchEvent(new dom.window.Event('pointerenter'));const tip=doc.querySelector<HTMLElement>('[role=tooltip]')!;assert.equal(tip.parentElement,doc.body);assert.equal(tip.hidden,false);assert.equal(tip.textContent,'Knowledge graph / Whiteboards');assert.equal(button.getAttribute('aria-describedby'),'help artinfact-control-tooltip');
 doc.dispatchEvent(new dom.window.Event('scroll'));assert.equal(tip.hidden,true);assert.equal(button.getAttribute('aria-describedby'),'help');
 button.focus();assert.equal(tip.hidden,false);button.blur();assert.equal(tip.hidden,true);assert.equal(doc.querySelectorAll('[role=tooltip]').length,1);
 }finally{dom.window.close();}
});
