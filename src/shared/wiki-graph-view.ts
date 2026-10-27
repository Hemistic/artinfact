export type GraphNode = { id: string; label: string; type: string; tags: string[]; degree: number; relativePath?: string; status?: string; title?: string; document?: { originalPdf: string; title: string } };
export type GraphEdge = { id: string; source: string; target: string; relation: string; weight: number };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; title?: string; rootDir?: string; generatedAt?: string };
export const typeNames: Record<string, string> = { domain: '研究主题', overview: '总览', comparison: '比较', concept: '概念', entity: '实体', source: '文献', raw: '原始资料', question: '问题', reference: '参考', decision: '结论', session: '研究记录', fold: '归纳', canvas: '画布', meta: '系统页面', missing: '待补页面', unknown: '其他' };
export const colors: Record<string, string> = { domain: '#8059c8', overview: '#8059c8', comparison: '#8059c8', concept: '#218f83', entity: '#218f83', source: '#c58a3b', raw: '#c58a3b', question: '#547dc1', missing: '#ce6874', meta: '#84919b' };
export function lane(node: GraphNode) { return ['source', 'raw', 'reference'].includes(node.type) ? 2 : ['concept', 'entity'].includes(node.type) ? 1 : 0; }
export function graphScope(graph: GraphData, options: { query?: string; type?: string; system?: boolean; selected?: string; local?: boolean }) {
  const query = (options.query ?? '').trim().toLocaleLowerCase(); const neighbors = new Set([options.selected]);
  if (options.local && options.selected) for (const edge of graph.edges) { if (edge.source === options.selected) neighbors.add(edge.target); if (edge.target === options.selected) neighbors.add(edge.source); }
  const nodes = graph.nodes.filter(n => (options.system || n.type !== 'meta') && (!options.type || n.type === options.type) && (!query || [n.label, n.relativePath, ...n.tags].join(' ').toLocaleLowerCase().includes(query)) && (!options.local || !options.selected || neighbors.has(n.id)));
  const ids = new Set(nodes.map(n => n.id)); return { nodes, edges: graph.edges.filter(e => ids.has(e.source) && ids.has(e.target)) };
}
function* layoutGraphSteps(graph: GraphData, mode: 'layers' | 'network'): Generator<void, Array<GraphNode & { x: number; y: number }>> {
  const buckets = [0, 1, 2].map(i => graph.nodes.filter(n => lane(n) === i).sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id)));
  if (mode === 'layers') {
    // Order neighbors together without moving cards out of their non-overlapping slots.
    const rank = new Map(buckets[1].map((n, i) => [n.id, i])); const links = new Map<string, number[]>();
    for (const edge of graph.edges) for (const [a, b] of [[edge.source, edge.target], [edge.target, edge.source]]) if (rank.has(b)) { const items = links.get(a) ?? []; items.push(rank.get(b)!); links.set(a, items); }
    for (const i of [0, 2]) buckets[i].sort((a, b) => { const mean = (id: string) => { const values = links.get(id); return values ? values.reduce((sum, n) => sum + n, 0) / values.length : Number.MAX_SAFE_INTEGER; }; return mean(a.id) - mean(b.id) || b.degree - a.degree || a.id.localeCompare(b.id); });
    return buckets.flatMap((bucket, i) => bucket.map((n, j) => ({ ...n, x: i * 370, y: j * 112 })));
  }
  const nodes = buckets.flat().map((n, i, all) => { const angle = i * Math.PI * 2 / Math.max(all.length, 1); const radius = Math.max(170, all.length * 15); return { ...n, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }; });
  if (nodes.length > 400) return nodes;
  const indices = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = graph.edges.filter(e => indices.has(e.source) && indices.has(e.target));
  for (let step = 0; step < 180; step++) {
    const force = nodes.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x || .01, dy = nodes[i].y - nodes[j].y || .01, distance = Math.max(1, Math.hypot(dx, dy)); const push = Math.min(20, 26000 / (distance * distance)) + Math.max(0, 245 - distance) * .08;
      const x = dx / distance * push, y = dy / distance * push; force[i].x += x; force[i].y += y; force[j].x -= x; force[j].y -= y;
    }
    for (const edge of edges) { const i = indices.get(edge.source)!, j = indices.get(edge.target)!, dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y; const distance = Math.max(1, Math.hypot(dx, dy)); const pull = (distance - 280) * .012; force[i].x += dx / distance * pull; force[i].y += dy / distance * pull; force[j].x -= dx / distance * pull; force[j].y -= dy / distance * pull; }
    const cooling = 1 - step / 220;
    nodes.forEach((n, i) => { n.x += Math.max(-12, Math.min(12, force[i].x - n.x * .002)) * cooling; n.y += Math.max(-12, Math.min(12, force[i].y - n.y * .002)) * cooling; });
    yield;
  }
  return nodes;
}

// Keep identical layout math, but let desktop input run between bounded chunks.
export function layoutGraph(graph:GraphData,mode:'layers'|'network'){
 const steps=layoutGraphSteps(graph,mode);let next=steps.next();while(!next.done)next=steps.next();return next.value;
}
export async function layoutGraphIncremental(graph:GraphData,mode:'layers'|'network',cancelled:()=>boolean=()=>false){
 const steps=layoutGraphSteps(graph,mode);let deadline=performance.now()+6;
 while(!cancelled()){const next=steps.next();if(next.done)return next.value;if(performance.now()>=deadline){await new Promise<void>(resolve=>setTimeout(resolve,0));deadline=performance.now()+6;}}
 return undefined;
}

export function createGraphSimulation(nodes: Array<GraphNode & { x: number; y: number }>, edges: GraphEdge[]) {
  const lookup = new Map(nodes.map(n => [n.id, n]));
  const velocity = new Map(nodes.map(n => [n.id, { x: 0, y: 0 }])); const pinned = new Set<string>(); let alpha = .65;
  const reheat = () => { alpha = .65; };
  return {
    active: () => alpha > .004,
    reheat,
    pin(id: string, x: number, y: number) { const node = lookup.get(id); if (!node) return; node.x = x; node.y = y; pinned.add(id); velocity.set(id, { x: 0, y: 0 }); reheat(); },
    release(id: string) { pinned.delete(id); reheat(); },
    step(dt = 1) {
      if (alpha <= .004) return; const temperature = alpha * Math.max(.2, Math.min(2, dt));
      // Preserve the original renderer's spring, inverse-square repulsion, gravity and damping model.
      for (const edge of edges) {
        const a = lookup.get(edge.source), b = lookup.get(edge.target); if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
        const desired = 230 * (edge.relation === 'raw-source' ? 1.28 : 1), force = (distance - desired) * .01 * temperature * Math.min(2.2, Math.max(.45, edge.weight || 1));
        const av = velocity.get(a.id)!, bv = velocity.get(b.id)!; if (!pinned.has(a.id)) { av.x += dx / distance * force; av.y += dy / distance * force; } if (!pinned.has(b.id)) { bv.x -= dx / distance * force; bv.y -= dy / distance * force; }
      }
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j], dx = b.x - a.x || .01, dy = b.y - a.y || .01;
        const distance2 = Math.max(36, dx * dx + dy * dy), distance = Math.sqrt(distance2);
        const force = (4800 / distance2 + Math.max(0, 155 - distance) * .16) * temperature;
        const av = velocity.get(a.id)!, bv = velocity.get(b.id)!; if (!pinned.has(a.id)) { av.x -= dx / distance * force; av.y -= dy / distance * force; } if (!pinned.has(b.id)) { bv.x += dx / distance * force; bv.y += dy / distance * force; }
      }
      for (const n of nodes) if (!pinned.has(n.id)) { const v = velocity.get(n.id)!; const gravity = n.type === 'overview' || n.type === 'meta' ? .00318 : .0012; v.x = (v.x - n.x * gravity * temperature) * .84; v.y = (v.y - n.y * gravity * temperature) * .84; n.x += Math.max(-20, Math.min(20, v.x)); n.y += Math.max(-20, Math.min(20, v.y)); }
      alpha *= Math.pow(.985, Math.max(.2, Math.min(2, dt)));
    },
  };
}
