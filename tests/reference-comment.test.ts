import test from 'node:test';import assert from 'node:assert/strict';
import {referenceNativeComment} from '../src/shared/reference-comment.js';
test('PDF contribution comments use the reader supported rich text and line breaks without HTML layout tags',()=>{
 const value=referenceNativeComment('论文贡献','## 方法\n\n1. **联合检索**与*评估*。\n2. 保留原文。\n\n> 两段真实证据\n\n[阅读全文](https://example.com/paper)','https://example.com/paper');
 assert.match(value,/^<b>论文贡献<\/b>\n\n<b>方法<\/b>/);assert.match(value,/1\. <b>联合检索<\/b>与<i>评估<\/i>。/);assert.match(value,/2\. 保留原文。/);assert.match(value,/两段真实证据/);assert.match(value,/阅读全文/);assert.match(value,/来源：https:\/\/example.com\/paper$/);assert.doesNotMatch(value,/<\/?(?:h\d|p|strong|em|ul|ol|li|a|blockquote)(?:>|\s)/);
});
test('literal tags in Markdown and code cannot activate the native reader rich text parser',()=>{
 const value=referenceNativeComment('原文 <b>标题</b>','`<b>代码</b>`\n\n<script>untrusted</script>\n\n| 符号 | 意义 |\n| --- | --- |\n| x | 数值 |','https://example.com/paper');assert.match(value,/＜b＞代码＜\/b＞/);assert.match(value,/＜script＞/);assert.match(value,/符号 \| 意义/);assert.match(value,/x \| 数值/);assert.doesNotMatch(value,/<script>/);
});
