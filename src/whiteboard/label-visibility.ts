type Frame = { now: number; dragging: boolean; nodes: Array<{ id: string; x: number; y: number }> };

export function createLabelVisibility() {
  let previous = new Map<string, { x: number; y: number }>();
  let previousTime: number | null = null, quietSince: number | null = null, revealedAt: number | null = null;
  let opacity = 0, immediate = true;
  return {
    reset(showImmediately = false) { previous.clear(); previousTime = quietSince = revealedAt = null; opacity = 0; immediate ||= showImmediately; },
    needsFrame() { return opacity < 1; },
    update(frame: Frame) {
      const dt = previousTime === null ? 0 : Math.max(1, frame.now - previousTime);
      let moving = frame.dragging;
      for (const n of frame.nodes) {
        const old = previous.get(n.id);
        if (old && dt && Math.hypot(n.x - old.x, n.y - old.y) * 1000 / dt > 6) moving = true;
        if (previousTime !== null && !old) moving = true;
      }
      previous = new Map(frame.nodes.map(n => [n.id, { x: n.x, y: n.y }])); previousTime = frame.now;
      if (!frame.nodes.length) { opacity = 1; return { opacity, repack: false }; }
      if (frame.dragging) immediate = false;
      if (immediate) { immediate = false; revealedAt = frame.now - 100; quietSince = frame.now - 120; opacity = 1; return { opacity, repack: true }; }
      if (moving) { quietSince = revealedAt = null; opacity = 0; return { opacity, repack: false }; }
      quietSince ??= frame.now;
      if (frame.now - quietSince < 120) { opacity = 0; return { opacity, repack: false }; }
      const repack = revealedAt === null;
      revealedAt ??= frame.now;
      opacity = Math.min(1, (frame.now - revealedAt) / 100);
      return { opacity, repack };
    },
  };
}
