import test from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';
import{translateUiText}from'../src/shared/ui-language.js';
const require=createRequire(import.meta.url);
test('localized build preserves user values, identifiers, object keys and typed protocol literals',async()=>{
 const{localizedUiSource}=await import('../scripts/ui-language.mjs' as string);
 const source='type Kind="公式";const labels={"公式":"公式"};const user={title:"我的论文标题"};const title=user.title;const text=`第 ${count} 页 · ${user.title}`;const hint="关闭";';
 const result=localizedUiSource(source,'example.ts');const ts=require('typescript');const js=ts.transpile(result.body,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext});
 const values=new Function('__artinfactUiText','count',js+';return {labels,user,title,text,hint};')((text:string)=>translateUiText(text,'en'),3);
 assert.equal(values.hint,'Close');assert.equal(values.title,'我的论文标题');assert.equal(values.labels['公式'],'Formula');assert.match(result.body,/type Kind="公式"/);assert.match(values.text,/3/);assert.ok(values.text.endsWith('我的论文标题'));
 const prompt='function referenceActionPrompt(){return "请调用 pdf_reference_action_read 读取原文";}';assert.equal(localizedUiSource(prompt,'prompt.ts').body,prompt);
});
