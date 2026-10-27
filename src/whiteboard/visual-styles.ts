import type { GraphNode } from '../shared/wiki-graph-view.js';
type Node = GraphNode & { x: number; y: number };
type Edge = { source: string; target: string; weight: number; relation: string };
export const visualStyles = [
  { id: 'constellation', name: '轻盈星图', english: 'CONSTELLATION', description: '小颗粒 · 柔和留白 · 轻量标签', colors: ['#a58bea', '#38bfb0', '#f589a2', '#edb269', '#78a3eb'] },
  { id: 'bubbles', name: '玻璃气泡', english: 'SOFT GLASS', description: '半透明气泡 · 柔光色层 · 轻盈空间感', colors: ['#a993e7', '#55c8b1', '#ef96af', '#ecbb78', '#85b6ed'] },
  { id: 'silk', name: '柔弧织网', english: 'SILK NETWORK', description: '渐变曲线 · 紧凑节点 · 丝线连接', colors: ['#ad8bdd', '#42bba6', '#f494a6', '#e2b779', '#88a5e4'] },
  { id: 'orbits', name: '轨道星系', english: 'ORBITAL ATLAS', description: '同心轨道 · 径向层次 · 弹性牵引', colors: ['#a78de0', '#51c9b4', '#ed8daa', '#edb168', '#89a6e7'] },
  { id: 'cards', name: '卡片星群', english: 'CARD ATLAS', description: '自由卡片 · 空间整理 · 页面关系', colors: ['#a78de0', '#51c9b4', '#ed8daa', '#edb168', '#89a6e7'] },
  { id: 'flow', name: '横向流式', english: 'FLOW MAP', description: '横向分列 · 柔和曲线 · 路径追踪', colors: ['#a78de0', '#51c9b4', '#ed8daa', '#edb168', '#89a6e7'] },
  { id: 'swimlanes', name: '证据泳道', english: 'EVIDENCE LANES', description: '主张与原文并排 · 按论文分组 · 阅读优先', colors: ['#a78de0', '#51c9b4', '#ed8daa', '#edb168', '#89a6e7'] },
  { id: 'editor', name: '自主流图', english: 'READING FLOW', description: '插入节点 · 自由连线 · 引用论文证据', colors: ['#a78de0', '#51c9b4', '#ed8daa', '#edb168', '#89a6e7'] },
] as const;
export type VisualStyle = typeof visualStyles[number];
export const availableGraphStyles = [visualStyles[0],visualStyles[7]] as const;
export function graphStyleFor(id:string|null):VisualStyle {return ['editor','flow','cards','swimlanes'].includes(id??'')?visualStyles[7]:visualStyles[0];}
export function styleColor(node: GraphNode, style: VisualStyle) {
  return style.colors[node.type === 'source' || node.type === 'raw' ? 3 : node.type === 'entity' ? 2 : node.type === 'concept' ? 1 : node.type === 'question' ? 4 : 0];
}
export function arrangeForStyle(nodes: Node[], style: VisualStyle, mode: string): Node[] {
  if (mode !== 'network') return nodes;
  if (style.id !== 'orbits') return nodes.map(n => ({ ...n,
    x: n.x * (style.id === 'silk' ? 1.14 : 1), y: n.y * (style.id === 'silk' ? .86 : 1) }));
  const groups = new Map<string, Node[]>();
  for (const n of nodes) { const bucket = groups.get(n.type) ?? []; bucket.push(n); groups.set(n.type, bucket); }
  const result = new Map<string, Node>();
  for (const [type, bucket] of groups) {
    const radius = type === 'source' ? 86 : type === 'entity' ? 640 : type === 'concept' ? 430 : type === 'question' ? 320 : 230;
    [...bucket].sort((a, b) => a.id.localeCompare(b.id)).forEach((n, i) => {
      const angle = -Math.PI / 2 + i * Math.PI * 2 / bucket.length + (type === 'concept' ? .08 : 0);
      result.set(n.id, { ...n, x: Math.cos(angle) * radius * .95, y: Math.sin(angle) * radius * .91 });
    });
  }
  return nodes.map(n => result.get(n.id)!);
}
export function createOrbitSimulation(nodes: Node[], edges: Edge[]) {
  const lookup = new Map(nodes.map(n => [n.id, n]));
  const anchors = new Map(nodes.map(n => [n.id, { x: n.x, y: n.y }]));
  const velocity = new Map(nodes.map(n => [n.id, { x: 0, y: 0 }]));
  const links = edges.flatMap(e => { const a = lookup.get(e.source), b = lookup.get(e.target); return a && b ? [{ a, b, rest: Math.hypot(a.x - b.x, a.y - b.y) }] : []; });
  const pinned = new Set<string>(); let alpha = 0;
  const reheat = () => { alpha = 1; };
  return {
    active: () => alpha > .004, reheat,
    settle() { alpha = 0; for (const v of velocity.values()) { v.x = 0; v.y = 0; } },
    pin(id: string, x: number, y: number) { const n = lookup.get(id); if (!n) return; n.x = x; n.y = y; pinned.add(id); reheat(); },
    release(id: string) { pinned.delete(id); reheat(); },
    step(dt = 1) {
      if (alpha <= .004) return;
      const h = Math.max(.2, Math.min(2, dt));
      for (const n of nodes) {
        const v = velocity.get(n.id)!, anchor = anchors.get(n.id)!;
        v.x += (anchor.x - n.x) * .12 * h; v.y += (anchor.y - n.y) * .12 * h;
      }
      for (const { a, b, rest } of links) {
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(1, Math.hypot(dx, dy)), f = (d - rest) * .006 * h;
        velocity.get(a.id)!.x += dx / d * f; velocity.get(a.id)!.y += dy / d * f;
        velocity.get(b.id)!.x -= dx / d * f; velocity.get(b.id)!.y -= dy / d * f;
      }
      for (const n of nodes) {
        const v = velocity.get(n.id)!;
        if (pinned.has(n.id)) { v.x = 0; v.y = 0; continue; }
        v.x *= Math.pow(.68, h); v.y *= Math.pow(.68, h);
        n.x += Math.max(-18, Math.min(18, v.x)) * h; n.y += Math.max(-18, Math.min(18, v.y)) * h;
      }
      alpha *= Math.pow(.90, h);
    },
  };
}
export function paintStyleBackdrop(ctx: CanvasRenderingContext2D, nodes: Node[], style: VisualStyle, fg: string, scale: number) {
  ctx.save();
  if (style.id === 'orbits') {
    ctx.strokeStyle = fg; ctx.globalAlpha = .07; ctx.lineWidth = .8 / scale;
    for (const radius of [86, 230, 320, 430, 640]) { ctx.beginPath(); ctx.ellipse(0, 0, radius * .95, radius * .91, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
  if (style.id === 'bubbles') {
    for (const type of ['entity', 'concept', 'comparison']) {
      const group = nodes.filter(n => n.type === type); if (!group.length) continue;
      const x = group.reduce((s, n) => s + n.x, 0) / group.length, y = group.reduce((s, n) => s + n.y, 0) / group.length;
      const fill = ctx.createRadialGradient(x, y, 0, x, y, 560);
      fill.addColorStop(0, styleColor(group[0], style) + '16'); fill.addColorStop(1, styleColor(group[0], style) + '00');
      ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, 560, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}
export function paintStyleNode(ctx: CanvasRenderingContext2D, n: Node, radius: number, style: VisualStyle, active: boolean, scale: number, dark: boolean) {
  const c = styleColor(n, style);
  ctx.save();
  if (style.id === 'bubbles') {
    ctx.shadowColor = c + '38'; ctx.shadowBlur = (active ? 20 : 12) / scale; ctx.shadowOffsetY = 4 / scale;
    const gradient = ctx.createRadialGradient(n.x - radius * .35, n.y - radius * .45, 0, n.x, n.y, radius * 1.15);
    gradient.addColorStop(0, dark ? c + 'dd' : '#ffffff'); gradient.addColorStop(.3, c + '85'); gradient.addColorStop(1, c + 'dc');
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(n.x, n.y, radius, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#ffffff80'; ctx.beginPath(); ctx.ellipse(n.x - radius * .32, n.y - radius * .4, radius * .22, radius * .12, -.6, 0, Math.PI * 2); ctx.fill();
  } else if (style.id === 'silk' && n.type === 'source') {
    ctx.fillStyle = c; ctx.beginPath(); ctx.roundRect(n.x - radius * 1.25, n.y - radius * .78, radius * 2.5, radius * 1.56, radius * .7); ctx.fill();
  } else {
    if (active || n.type === 'source') { ctx.fillStyle = c + (active ? '24' : '12'); ctx.beginPath(); ctx.arc(n.x, n.y, radius + (active ? 7 : 5) / scale, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(n.x, n.y, radius, 0, Math.PI * 2); ctx.fill();
  }
  if (n.type === 'source') {
    ctx.fillStyle = dark ? '#24242b' : '#fff'; ctx.font = '600 ' + Math.max(10 / scale, radius * .62) + 'px "Segoe UI",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(n.label.startsWith('Self') ? 'S' : n.label.startsWith('Adaptive') ? 'A' : 'C', n.x, n.y + .5 / scale);
  }
  ctx.restore();
}
export function paintStyleLink(ctx: CanvasRenderingContext2D, a: Node, b: Node, endX: number, endY: number, style: VisualStyle, active: boolean) {
  ctx.moveTo(a.x, a.y);
  if (style.id === 'silk') {
    if (!active) { const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y); g.addColorStop(0, styleColor(a, style)); g.addColorStop(1, styleColor(b, style)); ctx.strokeStyle = g; }
    ctx.bezierCurveTo(a.x * .45, a.y * .45, endX * .45, endY * .45, endX, endY);
  } else if (style.id === 'bubbles') {
    const bend = .10; ctx.quadraticCurveTo((a.x + endX) / 2 - (endY - a.y) * bend, (a.y + endY) / 2 + (endX - a.x) * bend, endX, endY);
  } else if (style.id === 'orbits') {
    ctx.quadraticCurveTo((a.x + endX) * .32, (a.y + endY) * .32, endX, endY);
  } else ctx.lineTo(endX, endY);
}
