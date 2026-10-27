import test from 'node:test';
import assert from 'node:assert/strict';
import { addFlowNode, addReference, connectFlowNodes, insertOnEdge, removeFlowNode, parseFlowBoard, createFlowHistory } from '../src/whiteboard/editable-flow-model.js';
import type { FlowBoard } from '../src/whiteboard/editable-flow-model.js';
const empty = (): FlowBoard => ({ version: 1, nodes: [], edges: [] });
const source = { id: 'claim-c1', relativePath: 'wiki/concepts/claim-c1.md', label: 'Original claim', type: 'concept', tags: [], degree: 2 };

test('inserting into a connection preserves its direction and label and leaves no bypass', () => {
  const b = empty(), a = addFlowNode(b, '问题'), z = addFlowNode(b, '回答');
  const edge = connectFlowNodes(b, a.id, z.id, '推导')!;
  const middle = insertOnEdge(b, edge.id, '补充证据')!;
  assert.equal(b.edges.length, 2);
  assert.ok(b.edges.some(e => e.source === a.id && e.target === middle.id && e.label === '推导'));
  assert.ok(b.edges.some(e => e.source === middle.id && e.target === z.id));
  assert.ok(!b.edges.some(e => e.source === a.id && e.target === z.id));
  const before = JSON.stringify(b); assert.equal(insertOnEdge(b, 'missing', 'x'), undefined); assert.equal(JSON.stringify(b), before);
});
test('a graph reference is deduplicated without changing the original node or user notes', () => {
  const b = empty(), before = JSON.stringify(source), ref = addReference(b, source);
  ref.note = 'My reasoning'; assert.equal(addReference(b, source).id, ref.id);
  assert.equal(b.nodes.length, 1); assert.equal(b.nodes[0].note, 'My reasoning');
  assert.equal(b.nodes[0].sourceId, source.id); assert.equal(JSON.stringify(source), before);
});
test('removing a node cleans its connections; undo restores node, edges and source association', () => {
  const b = empty(), a = addFlowNode(b, 'a'), ref = addReference(b, source); connectFlowNodes(b, a.id, ref.id);
  const h = createFlowHistory(b); h.commit(board => removeFlowNode(board, ref.id));
  assert.equal(h.board.edges.length, 0); assert.equal(h.board.nodes.length, 1);
  h.undo(); assert.deepEqual(h.board, b); h.redo(); assert.equal(h.board.nodes.length, 1);
});
test('references and custom nodes survive serialization; malformed coordinates and dangling edges are rejected', () => {
  const b = empty(), n = addFlowNode(b, '自定义'), ref = addReference(b, source); connectFlowNodes(b, n.id, ref.id);
  assert.deepEqual(parseFlowBoard(JSON.stringify(b)), b);
  assert.equal(parseFlowBoard('{broken'), undefined);
  assert.equal(parseFlowBoard(JSON.stringify({ ...b, nodes: [{ ...n, x: null }] })), undefined);
  assert.equal(parseFlowBoard(JSON.stringify({ ...b, edges: [{ id: 'bad', source: n.id, target: 'missing', label: '' }] })), undefined);
});
test('adding densely requested nodes finds separate positions; invalid connections have no effect', () => {
  const b = empty(); for (let i = 0; i < 25; i++) addFlowNode(b, 'n', 'note', { x: 100, y: 100 });
  for (const a of b.nodes) for (const z of b.nodes) if (a !== z) assert.ok(Math.abs(a.x-z.x) >= 264 || Math.abs(a.y-z.y) >= 168);
  assert.equal(connectFlowNodes(b, b.nodes[0].id, b.nodes[0].id), undefined);
  assert.equal(connectFlowNodes(b, b.nodes[0].id, 'missing'), undefined);
  const edge = connectFlowNodes(b, b.nodes[0].id, b.nodes[1].id)!;
  assert.equal(connectFlowNodes(b, edge.source, edge.target), edge); assert.equal(b.edges.length, 1);
});
test('a panned canvas accepts and preserves nodes on either side of the origin',()=>{
  const b=empty(),n=addFlowNode(b,'画布左侧分析','note',{x:-680,y:-420});
  assert.equal(n.x,-680);assert.equal(n.y,-420);assert.deepEqual(parseFlowBoard(JSON.stringify(b)),b);
});
