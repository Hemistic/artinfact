import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installLocalMineruSettings} from '../src/ui/mineru-local-settings.ts';
test('closing an active deployment dialog keeps monitoring and automatically starts the requested PDF when ready',async t=>{
 const oldDocument=globalThis.document,oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;
 const timers=new Map<object,()=>void>();
 const nodes=new Map<string,any>();let dialog:any;
 const documentStub:any={addEventListener(){},defaultView:{innerWidth:800,innerHeight:600,addEventListener(){}},createElement:()=>({ownerDocument:documentStub,style:{},textContent:'',value:'',classList:{add(){}},setAttribute(){},getAttribute(){return '';},append(){},querySelector(selector:string){if(!nodes.has(selector))nodes.set(selector,documentStub.createElement());return nodes.get(selector);},show(){this.open=true;},onclose:undefined as (()=>void)|undefined,close(){this.open=false;this.onclose?.();},open:false})};
 globalThis.document=documentStub;globalThis.setTimeout=((fn:()=>void)=>{const id={unref(){}};timers.set(id,fn);return id;}) as any;globalThis.clearTimeout=((id:object)=>timers.delete(id)) as any;
 t.after(()=>{globalThis.document=oldDocument;globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;});
 let reads=0,started=0;const progress:any[]=[];
 const settings=installLocalMineruSettings({append(value:any){dialog=value;}} as any,{call:async()=>({_meta:{processor:reads++?{root:'D:/work',installed:true,environmentOverride:false,progress:{phase:'completed',label:'完成'}}:{root:'D:/work',installed:false,environmentOverride:false,progress:{phase:'downloading',label:'下载中',percent:42}}}}),progress:value=>progress.push(value)});
 assert.equal(await settings.ready(async()=>{started++;}),false);assert.equal(dialog.open,true);dialog.close();
 assert.equal(timers.size,1);for(const fn of [...timers.values()])fn();await Promise.resolve();await Promise.resolve();
 assert.equal(reads,2);assert.equal(started,1);assert.equal(progress.at(-1).installed,true);assert.equal(dialog.open,false);assert.equal(timers.size,0);
});

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function settingsHarness(t: any, call: (name: string, args: Record<string, unknown>) => Promise<any>) {
 const oldDocument=globalThis.document,oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;
 const timers=new Map<object,()=>void>();const nodes=new Map<string,any>();let dialog:any;
 const doc:any={addEventListener(){},defaultView:{innerWidth:800,innerHeight:600,addEventListener(){}},createElement:()=>({ownerDocument:doc,style:{},textContent:'',value:'',disabled:false,classList:{add(){}},setAttribute(){},getAttribute(){return '';},append(){},querySelector(selector:string){if(!nodes.has(selector))nodes.set(selector,doc.createElement());return nodes.get(selector);},show(){this.open=true;},onclose:undefined as (()=>void)|undefined,close(){this.open=false;this.onclose?.();},open:false})};
 globalThis.document=doc;globalThis.setTimeout=((fn:()=>void)=>{const token={unref(){}};timers.set(token,fn);return token;}) as any;globalThis.clearTimeout=((token:object)=>timers.delete(token)) as any;
 t.after(()=>{globalThis.document=oldDocument;globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;});
 const progress:any[]=[];const settings=installLocalMineruSettings({append(value:any){dialog=value;}} as any,{call,progress:value=>progress.push(value)});
 return {settings,progress,node:(selector:string)=>dialog.querySelector(selector),dialog:()=>dialog,timers};
}
const processor = (phase?:string,percent?:number) => ({root:'D:/test/processors/mineru',installed:false,environmentOverride:false,...(phase?{progress:{phase,label:phase,percent}}:{})});

test('an earlier status read cannot unlock controls or submit again while installation is being started',async t=>{
 const stale=deferred<any>(),install=deferred<any>();let reads=0,installs=0;
 const h=settingsHarness(t,async name=>name==='pdf_processor_install'?(installs++,install.promise):++reads===1?{_meta:{processor:processor()}}:stale.promise);
 await h.settings.ready();const source=h.node('select'),button=h.node('[data-action="install"]');source.value='modelscope';source.onchange();
 const earlier=h.settings.refresh();button.onclick();
 stale.resolve({_meta:{processor:processor()}});await earlier;
 assert.equal(button.disabled,true);assert.equal(source.disabled,true);assert.equal(h.node('input').disabled,true);assert.equal(h.node('button[type=submit]').disabled,true);
 button.onclick();assert.equal(installs,1);
 install.resolve({_meta:{processor:processor('downloading',28)}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.progress.at(-1).progress.percent,28);assert.equal(button.disabled,true);h.dialog().close();
});

test('an older refresh response cannot replace a newer deployment progress snapshot',async t=>{
 const first=deferred<any>(),second=deferred<any>();let reads=0;
 const h=settingsHarness(t,async()=>++reads===1?first.promise:second.promise);
 const earlier=h.settings.refresh(),later=h.settings.refresh();
 second.resolve({_meta:{processor:processor('downloading',62)}});await later;
 first.resolve({_meta:{processor:processor()}});await earlier;
 assert.equal(h.progress.at(-1).progress?.percent,62);assert.equal(h.node('[data-action="install"]').disabled,true);
});

