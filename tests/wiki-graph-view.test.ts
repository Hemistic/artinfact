import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraphSimulation, graphScope, layoutGraph, type GraphData } from '../src/shared/wiki-graph-view.ts';
import { renderGraphDocument } from '../src/server/wiki-graph-render.ts';

const graph: GraphData = { nodes: [
  { id: 'a', label: '主题', type: 'domain', tags: [], degree: 2 },
  { id: 'b', label: '概念', type: 'concept', tags: ['retrieval'], degree: 2 },
  { id: 'c', label: '文献', type: 'source', tags: [], degree: 1 },
  { id: 'm', label: 'Wiki Index', type: 'meta', tags: [], degree: 1 },
], edges: [
  { id: 'ab', source: 'a', target: 'b', relation: 'wikilink', weight: 1 },
  { id: 'cb', source: 'c', target: 'b', relation: 'raw-source', weight: 1 },
  { id: 'ma', source: 'm', target: 'a', relation: 'wikilink', weight: 1 },
] };
test('graph filters retain only valid edges and explore incoming and outgoing neighbors', () => {
  assert.deepEqual(graphScope(graph, { selected: 'b', local: true }).nodes.map(n => n.id), ['a', 'b', 'c']);
  assert.deepEqual(graphScope(graph, { query: 'RETRIEVAL' }).nodes.map(n => n.id), ['b']);
  assert.equal(graphScope(graph, { type: 'source' }).edges.length, 0);
  assert.equal(graphScope(graph, {}).nodes.length, 3);
  assert.equal(graphScope(graph, { system: true }).nodes.length, 4);
});
test('layered cards never overlap, remain deterministic and leave graph data untouched', () => {
  const dense = { nodes: Array.from({ length: 120 }, (_, i) => ({ id: String(i), label: '长标题'.repeat(10), type: i % 2 ? 'source' : 'concept', tags: [], degree: i })), edges: [] };
  const original = JSON.stringify(dense); const positions = layoutGraph(dense, 'layers');
  assert.deepEqual(positions, layoutGraph(dense, 'layers')); assert.equal(JSON.stringify(dense), original);
  for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
    assert.ok(Math.abs(positions[i].x - positions[j].x) >= 224 || Math.abs(positions[i].y - positions[j].y) >= 94);
  }
  assert.ok(layoutGraph(graph, 'network').every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
});
test('standalone graph safely embeds untrusted titles and graph data', () => {
  const html = renderGraphDocument('<title><!--GRAPH_TITLE--></title><script type="application/json" id="graph-data"><!--GRAPH_DATA--></script>', { ...graph, title: '</script><script>alert(1)</script>' }, '<b>研究</b>');
  assert.ok(!html.includes('<b>')); assert.ok(!html.includes('</script><script>alert')); assert.match(html, /\\u003c/);
});

test('live force graph moves linked nodes, honors dragging pins, and settles without corrupting data', () => {
  const original = JSON.stringify(graph), nodes = layoutGraph(graph, 'network');
  const simulation = createGraphSimulation(nodes, graph.edges); const first = nodes.map(n => [n.x, n.y]);
  simulation.step(); assert.notDeepEqual(nodes.map(n => [n.x, n.y]), first);
  const pinned = nodes[0]; simulation.pin(pinned.id, 550, 180); const before = nodes.slice(1).map(n => [n.x, n.y]);
  for (let i = 0; i < 25; i++) simulation.step();
  assert.equal(pinned.x, 550); assert.equal(pinned.y, 180); assert.notDeepEqual(nodes.slice(1).map(n => [n.x, n.y]), before);
  simulation.release(pinned.id); for (let i = 0; i < 500; i++) simulation.step();
  assert.ok(nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y))); assert.equal(JSON.stringify(graph), original);
  assert.equal(simulation.active(), false); simulation.reheat(); assert.equal(simulation.active(), true);
});
