import test from 'node:test';import assert from 'node:assert/strict';import{mkdtemp,readFile,writeFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import {UiLanguageStore}from'../src/server/ui-language.js';
import {translateUiText,normalizeUiLanguage}from'../src/shared/ui-language.js';
test('UI language defaults to Chinese, persists English across restart and preserves unrelated settings',async()=>{
 const root=await mkdtemp(join(tmpdir(),'artinfact-language-'));try{await writeFile(join(root,'preferences.json'),'existing appearance');const first=new UiLanguageStore(root);assert.equal(await first.read(),'zh');await first.write('en');assert.equal(await new UiLanguageStore(root).read(),'en');assert.equal(await readFile(join(root,'preferences.json'),'utf8'),'existing appearance');await assert.rejects(()=>first.write('fr' as any));assert.equal(await first.read(),'en');await first.write('zh');assert.equal(await first.read(),'zh');}finally{await rm(root,{recursive:true,force:true});}
});
test('language translations cover chrome and HTML attributes without translating user data or breaking markup',()=>{
 assert.equal(normalizeUiLanguage('en-US'),'en');assert.equal(normalizeUiLanguage('zh-CN'),'zh');assert.equal(normalizeUiLanguage('fr'),'zh');
 assert.equal(translateUiText('工作区','en'),'Workspace');assert.equal(translateUiText('白板','en'),'Whiteboards');
 assert.equal(translateUiText('工作区','zh'),'工作区');assert.equal(translateUiText('我的论文标题','en'),'我的论文标题');
 const html=translateUiText('<button aria-label="关闭">关闭</button><strong>知识图谱</strong>','en');assert.equal(html,'<button aria-label="Close">Close</button><strong>Knowledge graph</strong>');
});
