import test from 'node:test';
import assert from 'node:assert/strict';
import {visualCard,visualCardHtml,visualResize,sourceImageNote} from '../src/whiteboard/visual-card.js';

test('cached source cards attach missing media without erasing notes or duplicating user images',()=>{
 assert.equal(sourceImageNote('User note','crop','table'),'![区域图片](flow-asset:crop)\n\nUser note');
 assert.equal(sourceImageNote('$$x$$','crop','formula'),'$$x$$\n\n![区域图片](flow-asset:crop)');
 const existing='![My image](flow-asset:custom)\nMy notes';
 assert.equal(sourceImageNote(existing,'crop','figure'),existing);
 assert.equal(sourceImageNote('User note','crop','annotation'),'User note');
});
import {resizeWorkbenchCard} from '../src/whiteboard/workbench.js';
import type {FlowBoard} from '../src/whiteboard/editable-flow-model.js';
test('figure and table cards place their summary and complete caption above complete images',()=>{
 const caption='Table II. '+('A full table caption with experimental conditions. '.repeat(12));
 const note='![region](flow-asset:first)\n\n'+caption+'\n\nMy interpretation\n\n![detail](flow-asset:second)';
 const card=visualCard({kind:'evidence',title:'truncated title',note},{category:'table',caption})!;
 assert.equal(card.caption,caption.trim());assert.equal(card.title,'Table II');
 assert.deepEqual(card.images,['![region](flow-asset:first)','![detail](flow-asset:second)']);
 assert.equal(card.notes,'My interpretation');assert.equal(note.includes('My interpretation'),true);
 const html=visualCardHtml(card);assert.ok(html.indexOf('<figcaption')<html.indexOf('data-asset="first"'));
 assert.match(html,/data-asset="second"/);assert.match(html,/experimental conditions/);
 assert.match(html,/My interpretation/);assert.doesNotMatch(html,/<details|<summary|<button/);
});
test('image outputs use the same visual layout while formulas keep their math layout',()=>{
 assert.equal(visualCard({kind:'evidence',title:'Equation',note:'$$x$$\n![region](flow-asset:eq)'},{category:'formula'}),null);
 const output=visualCard({kind:'note',title:'Generated diagram',note:'',workflow:{result:{imageAssetId:'diagram',markdown:'Explanation'}}})!;
 assert.equal(output.caption,'Generated diagram');assert.match(visualCardHtml(output),/data-asset="diagram"/);
 const empty=visualCard({kind:'image',title:'Image',note:'Notes'})!;
 assert.match(visualCardHtml(empty),/图片尚未加载/);
 assert.doesNotMatch(visualCardHtml(visualCard({kind:'image',title:'<script>bad</script>',note:''})!),/<script>/);
 assert.equal(visualCard({kind:'evidence',title:'Paper.pdf · MLinternal-id',note:'![region](flow-asset:table)'},{category:'table'})!.caption,'表题尚未提取');
});

test('source table bodies and parser status never appear as a summary above the table image',()=>{
 const caption='Table 2: Experiment results.',table='<table><tr><td>53.4</td></tr></table>',note='![region](flow-asset:table)\n\n'+table+table+'\n\nPDF 第 8 页\n正文已准备，可供 Agent 分析。\n\n'+caption+'\n\nUser interpretation';
 const card=visualCard({kind:'evidence',title:'Table',note},{category:'table',caption})!;
 assert.equal(card.notes,'User interpretation');const html=visualCardHtml(card);assert.doesNotMatch(html,/&lt;table|53\.4|正文已准备|PDF 第/);assert.match(html,/User interpretation/);assert.match(html,/data-asset="table"/);assert.ok(note.includes(table),'the original structured table must remain in the stored note');
});
test('resizing visual evidence preserves notes, source references and relationships and moves collisions',()=>{
 const board:FlowBoard={version:1,nodes:[{id:'figure',title:'Fig 1',kind:'image',note:'![original](flow-asset:original)\nMy interpretation',sourceId:'pdf-source',x:0,y:0,width:420,height:640},{id:'neighbor',title:'Research',kind:'note',note:'User content',x:440,y:0,width:420,height:200}],edges:[{id:'link',source:'figure',target:'neighbor',label:'Evidence'}]};
 const note=board.nodes[0].note,edges=JSON.stringify(board.edges);
 resizeWorkbenchCard(board,'figure',1000,820,640);
 assert.equal(board.nodes[0].x,0);assert.equal(board.nodes[0].y,0);
 assert.equal(board.nodes[0].note,note);assert.equal(board.nodes[0].sourceId,'pdf-source');
 assert.equal(board.nodes[0].width,1000);assert.equal(board.nodes[0].imageHeight,640);
 assert.ok(board.nodes[1].y>=836);assert.equal(board.nodes[1].note,'User content');assert.equal(JSON.stringify(board.edges),edges);
});
test('resize dimensions account for canvas zoom and stay within supported bounds',()=>{
 assert.deepEqual(visualResize({width:420,imageHeight:300},{x:150,y:90},.75),{width:620,imageHeight:420});
 assert.deepEqual(visualResize({width:420},{x:-10000,y:0},1),{width:220,imageHeight:360});
 assert.deepEqual(visualResize({width:420},{x:0,y:100},1),{width:420,imageHeight:460});
});
test('a vertical picture resize changes the actual picture scale with its original aspect ratio',()=>{
 const result=visualResize({width:420,imageHeight:190,aspectRatio:2,inset:40},{x:0,y:75},.75);
 assert.deepEqual(result,{width:620,imageHeight:290});
 assert.deepEqual(visualResize({width:420,imageHeight:190,aspectRatio:2,inset:40},{x:150,y:10},.75),{width:620,imageHeight:290});
});
