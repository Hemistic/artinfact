import type { GraphNode, GraphData } from '../shared/wiki-graph-view.js';
export type FlowKind = 'question' | 'method' | 'evidence' | 'note' | 'conclusion' | 'image' | 'innovation' | 'inference' | 'validation';
export type FlowNode = { id: string; title: string; note: string; kind: FlowKind; x: number; y: number; sourceId?: string; sourcePath?: string; width?:number; height?:number; imageHeight?:number; autoHeight?:boolean; groupId?:string; basis?:'reported'|'inference'|'hypothesis'; sourceRefs?:string[] };
export type FlowEdge = { id: string; source: string; target: string; label: string };
export type FlowGroup = {id:string;title:string;color:string;description?:string};
export type FlowBoard = { version: 1; nodes: FlowNode[]; edges: FlowEdge[]; groups?:FlowGroup[] };
export const flowSize = { width: 248, height: 152 };
const id = () => crypto.randomUUID();
export function flowNodeSize(n:FlowNode){
  const hasImage=/!\[[^\]]*\]\([^)]+\)/.test(n.note);
  const fallback=n.sourceId?{width:340,height:270}:n.kind==='image'?{width:420,height:430}:hasImage?{width:440,height:500}:['innovation','inference','validation'].includes(n.kind)?{width:680,height:340}:n.kind==='note'?{width:360,height:260}:flowSize;
  return {width:n.width??fallback.width,height:n.height??fallback.height};
}
export function flowNodesOverlap(a:FlowNode,b:FlowNode,gap=16){const x=flowNodeSize(a),y=flowNodeSize(b);return a.x<b.x+y.width+gap&&a.x+x.width+gap>b.x&&a.y<b.y+y.height+gap&&a.y+x.height+gap>b.y;}
export function freeFlowPosition(board: FlowBoard, desired: { x: number; y: number }, ignore = '', size=flowSize) {
  const start = { x: Math.max(-200000,Math.min(200000,desired.x)), y: Math.max(-200000,Math.min(200000,desired.y)) };
  let y=start.y;
  for(let i=0;i<=board.nodes.length;i++){
    const collisions=board.nodes.filter(n=>{const s=flowNodeSize(n);return n.id!==ignore&&start.x<n.x+s.width+16&&start.x+size.width+16>n.x&&y<n.y+s.height+16&&y+size.height+16>n.y;});
    if(!collisions.length)return{x:start.x,y};y=Math.max(...collisions.map(n=>n.y+flowNodeSize(n).height+16));
  }
  return{x:start.x,y};
}
export function resizeFlowNode(board:FlowBoard,nodeId:string,width:number,height:number){const n=board.nodes.find(n=>n.id===nodeId);if(!n)return;n.width=Math.max(220,Math.min(900,width));n.height=Math.max(152,Math.min(1200,height));n.autoHeight=false;Object.assign(n,freeFlowPosition(board,n,n.id,flowNodeSize(n)));}
export function normalizeFlowNotes(board:FlowBoard){for(const n of board.nodes){if(!n.sourceId&&['note','image','innovation','inference','validation'].includes(n.kind))Object.assign(n,freeFlowPosition(board,n,n.id,flowNodeSize(n)));}return board;}
export function researchTemplate(kind:FlowKind):string{
  if(kind==='innovation')return '## 候选创新点\n\n### 现有方法的边界\n\n### 拟改变的机制\n\n### 与已有工作的差异\n\n### 预期贡献\n\n### 支持证据与反例\n\n### 待验证条件\n';
  if(kind==='inference')return '## 理论推断 · 待检验\n\n### 前提与来源\n\n- \n\n### 推理步骤\n\n1. \n\n### 适用条件\n\n### 可能的反例\n\n### 待验证命题\n';
  if(kind==='validation')return '## 验证计划\n\n### 待验证命题\n\n### 对照与消融\n\n### 观察指标\n\n### 支持或否定的判据\n\n### 实验结果与修订\n';
  return '';
}
export function addFlowNode(board: FlowBoard, title = '新的阅读节点', kind: FlowKind = 'note', position = { x: 48, y: 96 }) {
  const n: FlowNode = { id: id(), title: title.trim().slice(0, 160) || '新的阅读节点', note: '', kind, ...position };Object.assign(n,freeFlowPosition(board,position,'',flowNodeSize(n)));
  board.nodes.push(n); return n;
}
export function addReference(board: FlowBoard, source: GraphNode, position = { x: 388, y: 96 }) {
  const previous = board.nodes.find(n => n.sourceId === source.id); if (previous) return previous;
  const n = addFlowNode(board, source.label, source.type === 'entity' ? 'evidence' : source.type === 'question' ? 'question' : 'method', position);
  n.sourceId = source.id; n.sourcePath = source.relativePath;Object.assign(n,freeFlowPosition(board,n,n.id,flowNodeSize(n))); return n;
}
export function connectFlowNodes(board: FlowBoard, source: string, target: string, label = '关联') {
  if (source === target || !board.nodes.some(n => n.id === source) || !board.nodes.some(n => n.id === target)) return;
  const previous = board.edges.find(e => e.source === source && e.target === target); if (previous) return previous;
  const edge = { id: id(), source, target, label: label.trim().slice(0, 80) || '关联' }; board.edges.push(edge); return edge;
}
export function insertOnEdge(board: FlowBoard, edgeId: string, title = '补充阅读步骤') {
  const edge = board.edges.find(e => e.id === edgeId); if (!edge) return;
  const a = board.nodes.find(n => n.id === edge.source)!, b = board.nodes.find(n => n.id === edge.target)!;
  const n = addFlowNode(board, title, 'note', { x: (a.x+b.x)/2, y: (a.y+b.y)/2 });
  board.edges = board.edges.filter(e => e.id !== edgeId); connectFlowNodes(board, a.id, n.id, edge.label); connectFlowNodes(board, n.id, b.id); return n;
}
export function removeFlowNode(board: FlowBoard, nodeId: string) {
  board.nodes = board.nodes.filter(n => n.id !== nodeId); board.edges = board.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
}
export function parseFlowBoard(raw: string | null): FlowBoard | undefined {
  try {
    const b = JSON.parse(raw ?? 'null') as FlowBoard;
    if (!b || b.version !== 1 || !Array.isArray(b.nodes) || !Array.isArray(b.edges) || b.nodes.length > 1000 || b.edges.length > 4000) return;
    if (b.nodes.some(n => !n || typeof n.id !== 'string' || typeof n.title !== 'string' || typeof n.note !== 'string' || !['question','method','evidence','note','conclusion','image','innovation','inference','validation'].includes(n.kind) || !Number.isFinite(n.x) || !Number.isFinite(n.y) || Math.abs(n.x) > 200000 || Math.abs(n.y) > 200000 || n.sourceId !== undefined && typeof n.sourceId !== 'string' || n.sourcePath !== undefined && typeof n.sourcePath !== 'string' || n.width!==undefined&&(!Number.isFinite(n.width)||n.width<220||n.width>1400)||n.autoHeight!==undefined&&typeof n.autoHeight!=='boolean'||n.height!==undefined&&(!Number.isFinite(n.height)||n.height<152||n.height>4000))) return;
    if(b.nodes.some(n=>n.imageHeight!==undefined&&(!Number.isFinite(n.imageHeight)||n.imageHeight<120||n.imageHeight>1600)))return;
    const ids = new Set(b.nodes.map(n => n.id)); if (ids.size !== b.nodes.length) return;
    if(b.groups!==undefined&&(!Array.isArray(b.groups)||b.groups.length>100||b.groups.some(g=>!g||typeof g.id!=='string'||typeof g.title!=='string'||!/^#[a-f0-9]{6}$/i.test(g.color)||g.description!==undefined&&typeof g.description!=='string')||new Set(b.groups.map(g=>g.id)).size!==b.groups.length))return;
    if(b.nodes.some(n=>n.groupId!==undefined&&(!b.groups?.some(g=>g.id===n.groupId))||n.basis!==undefined&&!['reported','inference','hypothesis'].includes(n.basis)))return;
    if(b.nodes.some(n=>n.sourceRefs!==undefined&&(!Array.isArray(n.sourceRefs)||n.sourceRefs.length>30||n.sourceRefs.some(p=>typeof p!=='string'||p.length>300))))return;
    if (b.edges.some(e => !e || typeof e.id !== 'string' || typeof e.label !== 'string' || !ids.has(e.source) || !ids.has(e.target) || e.source === e.target)) return;
    if (new Set(b.edges.map(e => e.id)).size !== b.edges.length) return;
    return structuredClone(b);
  } catch { return; }
}
export function createFlowHistory(initial: FlowBoard) {
  let board = structuredClone(initial); const past: FlowBoard[] = [], future: FlowBoard[] = [];
  return {
    get board() { return board; }, get canUndo() { return past.length > 0; }, get canRedo() { return future.length > 0; },
    commit(edit: (b: FlowBoard) => void) {
      const next = structuredClone(board); edit(next); if (JSON.stringify(board) === JSON.stringify(next)) return;
      past.push(board); if (past.length > 80) past.shift(); future.length = 0; board = next;
    },
    refineGeometry(measured:Pick<FlowNode,'id'|'x'|'y'|'height'>[]) {
      const next=structuredClone(board);for(const n of next.nodes){const layout=measured.find(item=>item.id===n.id);if(layout){n.x=layout.x;n.y=layout.y;n.height=layout.height;}}board=next;
    },
    undo() { const previous = past.pop(); if (previous) { future.push(board); board = previous; } },
    redo() { const next = future.pop(); if (next) { past.push(board); board = next; } },
  };
}
export function seedFlowBoard(graph: GraphData): FlowBoard {
  const board: FlowBoard = { version: 1, nodes: [], edges: [] };
  const q = addFlowNode(board, '检索材料不可靠时，如何改善回答？', 'question', { x: 48, y: 96 }); q.note = '我的阅读问题 · 从论文机制追到原文证据。';
  const find = (path: string) => graph.nodes.find(n => n.relativePath === path);
  const c1 = find('wiki/concepts/claim-c1.md'), c3 = find('wiki/concepts/claim-c3.md'), e3 = find('wiki/entities/evidence-c3.md');
  const a = c1 && addReference(board, c1, { x: 388, y: 96 }), b = c3 && addReference(board, c3, { x: 728, y: 96 });
  const e = e3 && addReference(board, e3, { x: 728, y: 356 });
  const note = addFlowNode(board, '材料相关，还需要验证回答支持度', 'note', { x: 388, y: 356 }); note.note = '我的阅读推断 · 继续核对 Self-RAG 的 IsSup 定义。';
  if (a) connectFlowNodes(board, q.id, a.id, '方法回应问题'); if (a && b) connectFlowNodes(board, a.id, b.id, '阅读顺序');
  if (b && e) connectFlowNodes(board, b.id, e.id, '原文依据'); if (b) connectFlowNodes(board, b.id, note.id, '我的分析'); return board;
}
