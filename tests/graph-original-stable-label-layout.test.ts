import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { graphScope, layoutGraph } from '../src/shared/wiki-graph-view.js';
import { createFastGraphSimulation } from '../src/whiteboard/fast-graph-simulation.js';
import { createStableLabelLayout, type LabelBox } from '../src/whiteboard/stable-label-layout.js';

const viewport = { width: 900, height: 900 };
const nodes = Array.from({ length: 18 }, (_, i) => ({ id: String(i), x: 240 + (i % 3) * 150,
  y: 230 + Math.floor(i / 3) * 90, radius: 22, width: 166, height: 42, priority: 18 - i, required: true }));
function separated(boxes: Map<string, LabelBox>) {
  const values = [...boxes.values()];
  for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
    const a = values[i], b = values[j];
    assert.ok(!(a.x < b.x + b.width + 3 && a.x + a.width + 3 > b.x && a.y < b.y + b.height + 3 && a.y + a.height + 3 > b.y), 'evidence boxes overlap');
  }
}
test('all evidence boxes remain visible and separated throughout a dense drag and release', () => {
  const layout = createStableLabelLayout();
  let previous = layout.place(nodes, viewport);
  assert.equal(previous.size, 18); separated(previous);
  for (let frame = 0; frame < 180; frame++) {
    const moving = nodes.map((n, i) => ({ ...n, x: i === 0 ? 620 : n.x + Math.sin(frame / 15 + i) * 70,
      y: i === 0 ? 500 : n.y + Math.cos(frame / 16 + i) * 50 }));
    const next = layout.place(moving, viewport);
    assert.equal(next.size, 18); separated(next);
    for (const [id, b] of next) {
      const a = previous.get(id)!;
      assert.ok(Math.hypot(b.x - a.x, b.y - a.y) <= 10.01, 'label jumped to another slot');
    }
    previous = next;
  }
});
test('hover and input order do not rearrange existing labels', () => {
  const layout = createStableLabelLayout();
  const initial = layout.place(nodes, viewport);
  const next = layout.place([...nodes].reverse().map(n => ({ ...n, active: true, priority: 999 })), viewport);
  assert.deepEqual(next, initial);
});
test('panning translates labels together without triggering a repack', () => {
  const layout = createStableLabelLayout();
  const initial = layout.place(nodes, viewport);
  const next = layout.place(nodes.map(n => ({ ...n, x: n.x + 80, y: n.y - 40 })), viewport);
  for (const [id, box] of next) {
    assert.equal(box.x, initial.get(id)!.x + 80);
    assert.equal(box.y, initial.get(id)!.y - 40);
  }
  separated(next);
});
test('a single evidence box follows its node smoothly and finishes without a perpetual animation', () => {
  const layout = createStableLabelLayout();
  const n = nodes[0]; const initial = layout.place([n], viewport).get(n.id)!;
  let result = initial;
  for (let i = 0; i < 100; i++) result = layout.place([{ ...n, x: n.x + 120 }], viewport).get(n.id)!;
  assert.ok(Math.abs(result.x - initial.x - 120) < .6);
  assert.equal(layout.active(), false);
});
test('node motion cannot push an evidence box outside the readable viewport', () => {
  const layout = createStableLabelLayout();
  const n = nodes[0]; layout.place([n], viewport);
  for (let i = 0; i < 100; i++) {
    const box = layout.place([{ ...n, x: -200, y: -300 }], viewport, { x: 0, y: 0 }).get(n.id)!;
    assert.ok(box.x >= 12 && box.y >= 80);
    assert.ok(box.x + box.width <= viewport.width - 12 && box.y + box.height <= viewport.height - 57);
  }
});
test('the actual 54-node demo keeps every evidence label visible and separated during force relaxation', () => {
  const graph = JSON.parse(readFileSync(new URL('./fixtures/original-graph.json', import.meta.url), 'utf8'));
  const scope = graphScope(graph, {}), positions = layoutGraph(scope, 'network');
  const view = { width: 900, height: 1080 };
  const minX = Math.min(...positions.map(n => n.x)) - 125, maxX = Math.max(...positions.map(n => n.x)) + 125;
  const minY = Math.min(...positions.map(n => n.y)) - 56, maxY = Math.max(...positions.map(n => n.y)) + 60;
  const scale = Math.min(1.1, (view.width - 70) / (maxX - minX), (view.height - 154) / (maxY - minY));
  const ox = view.width / 2 - (minX + maxX) / 2 * scale, oy = (view.height + 28) / 2 - (minY + maxY) / 2 * scale;
  const layout = createStableLabelLayout(), simulation = createFastGraphSimulation(positions, scope.edges);
  const project = () => positions.map(n => ({ id: n.id, x: n.x * scale + ox, y: n.y * scale + oy,
    radius: 24, width: 180, height: 42, priority: n.degree + (n.type === 'entity' ? 1000 : 0), required: n.type === 'entity' }));
  layout.place(project(), view, { x: 0, y: 0 });
  const dragged = positions.find(n => n.type === 'entity')!;
  simulation.pin(dragged.id, dragged.x - 300, dragged.y + 370); simulation.release(dragged.id);
  for (let i = 0; i < 120; i++) {
    simulation.step();
    const boxes = layout.place(project(), view, { x: 0, y: 0 });
    for (const n of positions.filter(n => n.type === 'entity')) {
      const box = boxes.get(n.id); assert.ok(box, 'missing evidence label');
      assert.ok(box.x >= 12 && box.y >= 80 && box.x + box.width <= view.width - 12 && box.y + box.height <= view.height - 57);
    }
    separated(boxes);
  }
});
