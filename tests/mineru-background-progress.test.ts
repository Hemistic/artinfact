import {test} from 'node:test';
import assert from 'node:assert/strict';
import {combinedMineruProgress} from '../src/shared/mineru-progress.ts';
import {parseLocalProgress} from '../src/shared/local-progress.ts';
test('ring displays installation/download independently of PDF jobs, and cached layouts do not hide active work',()=>{
 const installer={root:'D:/work/processors/mineru',installed:false,environmentOverride:false,progress:{phase:'downloading',label:'模型下载',percent:37,step:'当前文件'}};
 const active=combinedMineruProgress({documentId:'a',phase:'completed'},{phase:'completed',figures:0,tables:0,equations:0,totalPages:1,completedPages:1,modelVersion:'MinerU'},installer);
 assert.equal(active.percent,37);assert.equal(active.busy,true);assert.match(active.label,/当前文件/);
 const unknown=combinedMineruProgress(undefined,undefined,{...installer,progress:{phase:'installing',label:'基础环境'}});
 assert.equal(unknown.percent,null);assert.equal(unknown.indeterminate,true);assert.equal(unknown.shortLabel,'装');
 const parsing=combinedMineruProgress({documentId:'a',phase:'parsing',progress:{percent:58,step:'VLM Predict'}},undefined);
 assert.equal(parsing.percent,58);assert.match(parsing.label,/VLM Predict/);
});
test('progress uses actual native progress lines, without interpreting block counts as PDF pages',()=>{
 assert.deepEqual(parseLocalProgress('VLM Predict:  42%|xx| 21/50 [00:03]'),{percent:42,step:'VLM Predict',completed:21,total:50});
 assert.equal(parseLocalProgress('please wait'),undefined);
 assert.equal(parseLocalProgress('Layout Predict: 101%| 1/1'),undefined);
});

test('a failed reconversion is visible even when the previous layout JSON remains available', () => {
 const cached = {phase:'completed' as const,figures:2,tables:1,equations:1,totalPages:10,completedPages:10,modelVersion:'MinerU 本机'};
 const result = combinedMineruProgress({documentId:'a',phase:'failed',error:'解析进程退出'},cached);
 assert.equal(result.state,'failed');assert.equal(result.busy,false);assert.match(result.label,/解析进程退出/);assert.match(result.label,/已有.*JSON.*可用/);
 const failedLayout = combinedMineruProgress(undefined,{...cached,phase:'failed',error:'布局 JSON 损坏'});
 assert.equal(failedLayout.state,'failed');assert.match(failedLayout.label,/布局 JSON 损坏/);
});
