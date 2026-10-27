import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { graphScope, layoutGraph } from '../src/shared/wiki-graph-view.js';
import { createFastGraphSimulation } from '../src/whiteboard/fast-graph-simulation.js';

const graph = JSON.parse(readFileSync(new URL('./fixtures/original-graph.json', import.meta.url), 'utf8'));

test('actual demo graph returns toward its structure and settles within one second after release', () => {
  const scope = graphScope(graph, {}), nodes = layoutGraph(scope, 'network');
  const simulation = createFastGraphSimulation(nodes, scope.edges);
  const node = nodes.find(n => n.type === 'source')!;
  const original = { x: node.x, y: node.y };
  simulation.pin(node.id, node.x + 400, node.y - 200); simulation.release(node.id);
  let frames = 0;
  while (simulation.active() && frames < 60) { simulation.step(); frames++; }
  assert.equal(simulation.active(), false);
  assert.ok(Math.hypot(node.x - original.x, node.y - original.y) < Math.hypot(400, 200));
  assert.ok(nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
});

test('a node remains under the pointer while held; settled graphs can be dragged again', () => {
  const scope = graphScope(graph, {}), nodes = layoutGraph(scope, 'network');
  const simulation = createFastGraphSimulation(nodes, scope.edges);
  simulation.settle(); const node = nodes[0];
  simulation.pin(node.id, 800, 200);
  for (let i = 0; i < 10; i++) simulation.step();
  assert.equal(node.x, 800); assert.equal(node.y, 200);
  simulation.release(node.id); assert.equal(simulation.active(), true);
  simulation.step(); assert.notEqual(node.x, 800);
});
