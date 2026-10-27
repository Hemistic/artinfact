import test from 'node:test';
import assert from 'node:assert/strict';
import {NodeSchema,cardContent} from '../src/whiteboard/whiteboard-domain.js';
import {compactCard,compactCardHtml,cardBody} from '../src/whiteboard/card-presentation.js';
import {WorkflowFinding} from '../src/whiteboard/workflow.js';
const base={id:'n',title:'Full formula metadata',note:'---\ntype: entity\nstatus: draft\n---\n\n## 原文证据\n\nOriginal evidence body.',kind:'evidence' as const,x:0,y:0};
test('agent formula presentation renders KaTeX, explanation and symbols without source metadata',()=>{
 const presentation={type:'formula' as const,latex:'E=mc^2',explanation:'Energy and mass.',symbols:[{latex:'m',meaning:'Mass.'},{latex:'c',meaning:'Light speed.'}]};
 const node=NodeSchema.parse({...base,presentation});
 assert.deepEqual(cardContent(node).presentation,presentation);
 const html=compactCardHtml(compactCard(node)!);
 assert.match(html,/katex-html/);assert.match(html,/Energy and mass/);assert.match(html,/Light speed/);
 assert.doesNotMatch(html,/type:|status:|Full formula metadata/);
 assert.equal(cardBody(node.note),'## 原文证据\n\nOriginal evidence body.');
});
test('evidence content is authored by agent and the full note is preserved',()=>{
 const node=NodeSchema.parse({...base,presentation:{type:'evidence',statement:'The evaluator needs training.',explanation:'It adds a training dependency.'}});
 const html=compactCardHtml(compactCard(node)!);assert.match(html,/evaluator needs training/);assert.match(html,/training dependency/);assert.equal(node.note,base.note);
 const legacy=compactCardHtml(compactCard(base)!);assert.match(legacy,/Original evidence body/);assert.doesNotMatch(legacy,/type: entity/);
});
test('unexplained formula sources display the source LaTeX without inventing definitions',()=>{
 const node={...base,role:'source' as const,sourceId:'formula',kind:'note' as const,note:'$$x^2$$\n\nPDF 第 5 页\n正文已准备，可供 Agent 分析。'};
 const compact=compactCard(node,{category:'formula',latex:'x^2'});
 assert.deepEqual(compact,{type:'formula',latex:'x^2',explanation:'',symbols:[]});
 assert.match(compactCardHtml(compact!),/katex/);assert.doesNotMatch(compactCardHtml(compact!),/PDF 第|正文已准备/);
 assert.equal(compactCard({...base,kind:'note',role:'source'}, {category:'document'}),undefined);
});
test('workflow findings retain the agent presentation and reject extra executable fields',()=>{
 const finding={title:'Formula',note:'Detailed derivation',category:'derivation',basis:'inference',citations:[],presentation:{type:'formula',latex:'a+b',explanation:'A sum.',symbols:[]}};
 assert.deepEqual(WorkflowFinding.parse(finding).presentation,finding.presentation);
 assert.throws(()=>NodeSchema.parse({...base,presentation:{type:'formula',latex:'a+b',explanation:'',symbols:[],html:'<script>'}}));
});
