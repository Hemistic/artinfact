import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PanelWidth} from '../src/whiteboard/panel-width.js';

test('right sidebar grows when its left boundary is dragged left, and commits once',()=>{
 const panel=new PanelWidth(420,1200);panel.begin(9,600);panel.move(8,200);assert.equal(panel.width,420);
 panel.move(9,450);assert.equal(panel.width,570);assert.equal(panel.preferred,420);
 assert.equal(panel.end(9),570);assert.equal(panel.preferred,570);assert.equal(panel.end(9),undefined);
});
test('sidebar respects available width and restores its preference after window resizing',()=>{
 const panel=new PanelWidth(620,1200);panel.resize(400);assert.equal(panel.width,368);assert.equal(panel.preferred,620);
 panel.resize(1200);assert.equal(panel.width,620);panel.begin(1,500);panel.move(1,-900);assert.equal(panel.width,760);
 panel.cancel();assert.equal(panel.width,620);panel.begin(2,500);panel.move(2,1400);assert.equal(panel.width,280);
 panel.cancel();panel.resize(220);assert.equal(panel.width,188);
});
test('cancelled drags preserve preference, and keyboard/reset updates are bounded',()=>{
 const panel=new PanelWidth(420,1200);panel.begin(3,500);panel.move(3,200);panel.cancel();assert.equal(panel.width,420);assert.equal(panel.preferred,420);
 panel.set(1000);assert.equal(panel.preferred,760);panel.set(420);assert.equal(panel.width,420);
});
test('invalid stored widths use the view default instead of breaking geometry',()=>{
 for(const value of [NaN,Infinity,0,-50])assert.equal(new PanelWidth(value,1200,360).width,360);
});
