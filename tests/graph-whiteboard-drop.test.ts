import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasDropIntent,canvasInternalDragType,sourceDragType} from '../src/whiteboard/whiteboard-drop.js';

test('a dragged canvas image cannot be reimported even when the browser exposes it as a file',()=>{
 assert.equal(canvasDropIntent([canvasInternalDragType,'Files','text/uri-list']),undefined);
 assert.equal(canvasDropIntent([canvasInternalDragType,sourceDragType,'Files']),undefined);
 assert.equal(canvasDropIntent(['text/uri-list','text/html']),undefined);
 assert.equal(canvasDropIntent(['text/plain']),undefined);
});
test('workspace drags and external files remain distinct import actions',()=>{
 assert.equal(canvasDropIntent([sourceDragType,'Files']),'source');
 assert.equal(canvasDropIntent(['Files']),'files');
 assert.equal(canvasDropIntent([]),undefined);
});
