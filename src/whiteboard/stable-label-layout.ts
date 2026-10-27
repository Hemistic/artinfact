export type LabelNode = { id: string; x: number; y: number; radius: number; width: number; height: number; priority: number; active?: boolean; required?: boolean };
export type LabelBox = { x: number; y: number; width: number; height: number };
type State = { box: LabelBox; x: number; y: number; dx: number; dy: number };
const gap = 5;
function overlaps(a: LabelBox, b: LabelBox) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}
function candidates(n: LabelNode): LabelBox[] {
  const { x, y, radius: r, width: w, height: h } = n;
  return [
    { x: x - w / 2, y: y + r }, { x: x + r, y: y - h / 2 },
    { x: x - w / 2, y: y - r - h }, { x: x - r - w, y: y - h / 2 },
    { x: x + r + 16, y: y - r - h - 12 }, { x: x - r - w - 16, y: y - r - h - 12 },
    { x: x + r + 16, y: y + r + 12 }, { x: x - r - w - 16, y: y + r + 12 },
  ].map(p => ({ ...p, width: w, height: h }));
}
// Stop at the first contact, rather than correcting an overlap after painting it.
function travel(box: LabelBox, dx: number, dy: number, obstacles: LabelBox[], viewport: { width: number; height: number }) {
  let fraction = 1;
  if (dx > 0) fraction = Math.min(fraction, Math.max(0, (viewport.width - 12 - box.width - box.x) / dx));
  if (dx < 0) fraction = Math.min(fraction, Math.max(0, (12 - box.x) / dx));
  if (dy > 0) fraction = Math.min(fraction, Math.max(0, (viewport.height - 57 - box.height - box.y) / dy));
  if (dy < 0) fraction = Math.min(fraction, Math.max(0, (80 - box.y) / dy));
  for (const other of obstacles) {
    const left = other.x - box.width - gap, right = other.x + other.width + gap;
    const top = other.y - box.height - gap, bottom = other.y + other.height + gap;
    const tx = dx ? [(left - box.x) / dx, (right - box.x) / dx].sort((a, b) => a - b) : box.x > left && box.x < right ? [-Infinity, Infinity] : [Infinity, -Infinity];
    const ty = dy ? [(top - box.y) / dy, (bottom - box.y) / dy].sort((a, b) => a - b) : box.y > top && box.y < bottom ? [-Infinity, Infinity] : [Infinity, -Infinity];
    const entry = Math.max(tx[0], ty[0]), exit = Math.min(tx[1], ty[1]);
    if (entry <= exit && exit > 0 && entry >= -1e-7) fraction = Math.min(fraction, Math.max(0, entry - .0001));
  }
  return { x: box.x + dx * fraction, y: box.y + dy * fraction, width: box.width, height: box.height };
}
export function createStableLabelLayout() {
  const states = new Map<string, State>();
  const attempted = new Set<string>();
  let moving = false;
  return {
    reset() { states.clear(); attempted.clear(); moving = false; },
    active() { return moving; },
    place(nodes: LabelNode[], viewport: { width: number; height: number }, cameraShift?: { x: number; y: number }) {
      moving = false;
      const current = new Map(nodes.map(n => [n.id, n]));
      for(const id of attempted)if(!current.has(id))attempted.delete(id);
      for (const id of states.keys()) if (!current.has(id)) states.delete(id);
      const entries = [...states.entries()].sort(([a], [b]) => a.localeCompare(b));
      // A camera pan moves the entire packing rigidly, preserving every separation.
      const deltas = entries.map(([id, s]) => ({ x: current.get(id)!.x - s.x, y: current.get(id)!.y - s.y }));
      const common = cameraShift ?? (deltas.length > 1 && deltas.every(d => Math.abs(d.x - deltas[0].x) < .001 && Math.abs(d.y - deltas[0].y) < .001) ? deltas[0] : { x: 0, y: 0 });
      for (const [, s] of entries) s.box = { ...s.box, x: s.box.x + common.x, y: s.box.y + common.y };
      for (const [id, s] of entries) {
        const n = current.get(id)!;
        const target = { x: n.x + s.dx, y: n.y + s.dy };
        const dx = target.x - s.box.x, dy = target.y - s.box.y;
        const distance = Math.hypot(dx, dy), step = Math.min(10, distance * .22);
        const obstacles = [...states].filter(([other]) => other !== id).map(([, other]) => other.box);
        if (distance > .25) {
          const vx = dx / distance * step, vy = dy / distance * step;
          const choices = [travel(s.box, vx, vy, obstacles, viewport), travel(s.box, vx, 0, obstacles, viewport), travel(s.box, 0, vy, obstacles, viewport)];
          const next = choices.sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))[0];
          if (Math.hypot(next.x - s.box.x, next.y - s.box.y) > .05) { s.box = next; moving = true; }
        }
        s.x = n.x; s.y = n.y;
      }
      const occupied = [...states.values()].map(s => s.box);
      const nodeBoxes = nodes.map(n => { const r = Math.max(0, n.radius - 4); return { x: n.x - r, y: n.y - r, width: r * 2, height: r * 2 }; });
      const inView = (b: LabelBox) => b.x >= 12 && b.x + b.width <= viewport.width - 12 && b.y >= 80 && b.y + b.height <= viewport.height - 57;
      const free = (b: LabelBox) => inView(b) && !occupied.some(o => overlaps(b, o)) && !nodeBoxes.some(o => overlaps(b, o));
      for (const n of [...nodes].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
        if (states.has(n.id) || attempted.has(n.id) && !n.active) continue;
        attempted.add(n.id);
        let box = candidates(n).find(free);
        // Evidence is always allocated space, even when all nearby slots are occupied.
        if (!box && (n.required || n.active)) {
          let best = Infinity;
          for (let y = 80; y + n.height <= viewport.height - 57; y += 12) for (let x = 12; x + n.width <= viewport.width - 12; x += 12) {
            const candidate = { x, y, width: n.width, height: n.height };
            const cost = Math.hypot(x + n.width / 2 - n.x, y + n.height / 2 - n.y);
            if (cost < best && free(candidate)) { box = candidate; best = cost; }
          }
        }
        if (box) { states.set(n.id, { box, x: n.x, y: n.y, dx: box.x - n.x, dy: box.y - n.y }); occupied.push(box); }
      }
      return new Map([...states].map(([id, s]) => [id, { ...s.box }]));
    },
  };
}
