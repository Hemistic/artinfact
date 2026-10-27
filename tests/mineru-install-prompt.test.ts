import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalMineruSettings } from '../src/ui/mineru-local-settings.ts';

class Element {
  innerHTML=''; textContent=''; value=''; disabled=false; open=false; title=''; children:Element[]=[];
  attributes=new Map<string,string>(); nodes=new Map<string,Element>(); classList={add:()=>{}};
  onclick?:()=>void; onchange?:()=>void; onclose?:()=>void;
  style={};ownerDocument={createElement:()=>new Element(),addEventListener(){},defaultView:{innerWidth:800,innerHeight:600,addEventListener(){}}};
  setAttribute(k:string,v:string){this.attributes.set(k,v);} getAttribute(k:string){return this.attributes.get(k);}
  append(child:Element){this.children.push(child);} show(){this.open=true;} close(){this.open=false;this.onclose?.();}
  querySelector(selector:string){if(!this.nodes.has(selector))this.nodes.set(selector,new Element());return this.nodes.get(selector)!;}
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('first layout click opens a download prompt; nothing installs until a source is chosen and installation is clicked',async()=>{
  const previous=globalThis.document,root=new Element(),calls:{name:string;args:any}[]=[];
  (globalThis as any).document={createElement:()=>new Element()};
  const state={root:'C:/Users/test/AppData/Local/Artinfact/processors/mineru',installed:false,environmentOverride:false};
  try{
    const settings=installLocalMineruSettings(root as any,{call:async(name,args)=>{calls.push({name,args});return {_meta:{processor:name==='pdf_processor_install'?{...state,progress:{phase:'installing',label:'installing'}}:state}};}});
    assert.equal(await settings.ready(),false);await tick();
    const dialog=root.children[0],install=dialog.querySelector('[data-action="install"]'),source=dialog.querySelector('select');
    assert.equal(dialog.open,true);assert.match(dialog.innerHTML,/中国源（ModelScope）/);assert.match(dialog.innerHTML,/美国.*Hugging Face/);
    assert.match(dialog.querySelector('strong').textContent,/需要下载 MinerU/);
    assert.equal(install.disabled,true);install.onclick?.();await tick();assert.deepEqual(calls.map(c=>c.name),['pdf_processor_read']);
    source.value='modelscope';source.onchange?.();assert.equal(install.disabled,false);install.onclick?.();await tick();
    assert.equal(calls[1].name,'pdf_processor_install');assert.equal(calls[1].args.modelSource,'modelscope');assert.equal(source.disabled,true);
    install.onclick?.();await tick();assert.equal(calls.filter(c=>c.name==='pdf_processor_install').length,1);dialog.close();
  }finally{(globalThis as any).document=previous;root.children[0]?.close();}
});
test('international choice reaches the installer, while a ready processor bypasses the prompt',async()=>{
  const previous=globalThis.document,root=new Element(),calls:{name:string;args:any}[]=[];let installed=false;
  (globalThis as any).document={createElement:()=>new Element()};
  try{
    const settings=installLocalMineruSettings(root as any,{call:async(name,args)=>{calls.push({name,args});return {_meta:{processor:{root:'D:/Processor',installed,environmentOverride:false}}};}});
    await settings.ready();const dialog=root.children[0],source=dialog.querySelector('select');source.value='huggingface';source.onchange?.();dialog.querySelector('[data-action="install"]').onclick?.();await tick();
    assert.equal(calls.find(c=>c.name==='pdf_processor_install')?.args.modelSource,'huggingface');dialog.close();installed=true;
    assert.equal(await settings.ready(),true);assert.equal(dialog.open,false);
  }finally{(globalThis as any).document=previous;root.children[0]?.close();}
});
