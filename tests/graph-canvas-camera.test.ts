import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomAt, worldAt, fitCamera } from '../src/whiteboard/canvas-camera.js';
test('wheel zoom preserves the world point under the cursor, including limits', () => {
  const camera = { x: -450, y: 72, zoom: .7 }, cursor = { x: 341, y: 219 };
  for (const requested of [.01, 1.2, 100]) {
    const before = worldAt(camera, cursor), after = worldAt(zoomAt(camera, requested, cursor), cursor);
    assert.ok(Math.abs(before.x-after.x)<1e-8 && Math.abs(before.y-after.y)<1e-8);
  }
});
test('fit places every card inside the usable viewport even far from origin', () => {
  const bounds = { x: 9400, y: 12000, width: 500, height: 800 };
  const camera = fitCamera(bounds, { width: 800, height: 600 });
  assert.ok(bounds.x*camera.zoom+camera.x>=20);
  assert.ok((bounds.y+bounds.height)*camera.zoom+camera.y<=580);
});
