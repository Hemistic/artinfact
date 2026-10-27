import test from 'node:test';import assert from 'node:assert/strict';import {referenceNoteRect} from '../src/shared/reference-note-position.js';
test('reference notes sit in an empty paper gutter instead of covering citation text or another note',()=>{
 const chars=[{rect:[60,400,260,414]},{rect:[300,400,500,414]}],marker={rects:[[340,400,460,414]],sourceRect:[300,350,500,460]},note=referenceNoteRect(chars,[0,0,600,800],marker)!;assert.ok(note);assert.ok(note[0]>=502);assert.equal(note[2]-note[0],22);assert.equal(note[3]-note[1],22);const second=referenceNoteRect(chars,[0,0,600,800],marker,[note])!;assert.ok(second);assert.ok(second[3]<=note[1]||second[1]>=note[3]||second[2]<=note[0]||second[0]>=note[2]);
});
test('when both column gutters contain text the note uses a clear paper margin, and never invents an out-of-page position',()=>{
 const chars=[{rect:[50,350,550,470]}],marker={rects:[[100,400,200,414]],sourceRect:[50,350,550,470]},note=referenceNoteRect(chars,[0,0,600,800],marker)!;assert.ok(note);assert.ok(note[0]>=552||note[2]<=48);assert.equal(referenceNoteRect([{rect:[0,0,20,20]}],[0,0,20,20],{rects:[[0,0,20,20]]}),undefined);
});
