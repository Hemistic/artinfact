import {canvasTextCache} from '../shared/canvas-text-cache.js';
import {readGraphPreferences,saveGraphPreferences,type GraphPreferences} from './graph-preferences.js';
import {canvasIcon} from './canvas-icons.js';
import {runGraphPerformanceCheck} from './graph-performance-check.js';
import {createFastGraphSimulation as createBaseGraphSimulation} from './fast-graph-simulation.js';
import {localizeInitialMarkup} from '../ui/ui-language.js';
import {createGraphCanvas,describeGraphNode} from './graph-canvas.js';
import {canvasSpace,fitInCanvasSpace,revealCanvasPoint} from './canvas-space.js';
import { createEditableFlowView } from './mcp-whiteboard-view.js';
import { createStableLabelLayout } from './stable-label-layout.js';
import { edgeEmphasis } from './edge-emphasis.js';
import { visualStyles, availableGraphStyles, graphStyleFor, styleColor, arrangeForStyle, createOrbitSimulation, paintStyleBackdrop, paintStyleNode, paintStyleLink } from './visual-styles.js';
import { colors, typeNames, lane,  graphScope, layoutGraph, layoutGraphIncremental, type GraphData, type GraphNode } from '../shared/wiki-graph-view.js';
import { iconMarkup } from '../ui/icons.js';

localizeInitialMarkup();
const graph: GraphData = JSON.parse(document.getElementById('graph-data')!.textContent!);
const pageParams = new URLSearchParams(location.search); let graphStyle = graphStyleFor(document.documentElement.dataset.graphMode ?? 'constellation');
let graphPreferences=readGraphPreferences();
function createGraphSimulation(nodes: ReturnType<typeof layoutGraph>, edges: GraphData['edges']) { return graphStyle.id === 'orbits' ? createOrbitSimulation(nodes, edges) : createBaseGraphSimulation(nodes, edges,graphPreferences); }
const workspaceId = document.documentElement.dataset.workspaceId || pageParams.get('workspaceId') || '';
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('graph'), ctx = canvas.getContext('2d')!;
const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
const adjacency = new Map<string, typeof graph.edges>();
for (const edge of graph.edges) for (const id of new Set([edge.source, edge.target])) { const bucket = adjacency.get(id) ?? []; bucket.push(edge); adjacency.set(id, bucket); }
let mode: 'layers' | 'network' = 'network', selected = '', query = '', type = '', system = false, local = false;
let scope = graphScope(graph, {}), positions: ReturnType<typeof layoutGraph> = [], positionMap = new Map<string, ReturnType<typeof layoutGraph>[number]>();
let width = 1, height = 1, scale = 1, ox = 0, oy = 0, hovered = '', theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
let drag: { id: number; x: number; y: number; ox: number; oy: number; moved: boolean; node?: string; nx?: number; ny?: number } | undefined;
let simulation: ReturnType<typeof createGraphSimulation> | undefined, lastFrame = 0;
let graphBenchmarkRunning=false;
let flowEditor: ReturnType<typeof createEditableFlowView> | undefined; let graphCanvas: ReturnType<typeof createGraphCanvas> | undefined; let pendingFrame = 0;let surfaceVisible=true; const stableLabels = createStableLabelLayout(); let labelCamera: { x: number; y: number } | undefined;
const color = (n: GraphNode) => styleColor(n, graphStyle);
const nodeNames:Record<string,string>={...typeNames,comparison:'关联分析',concept:'主张 / 机制',entity:'原文证据'};
const name = (n: GraphNode) => nodeNames[n.type] ?? '其他';
const post = (type: string, payload: object) => window.parent?.postMessage({ type, codexGraphToken: document.documentElement.dataset.graphToken, payload: { workspaceId, ...payload } }, '*');
const button = (label: string, action: () => void, className = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = className; b.onclick = action; return b; };
const text = (tag: string, value: string, className = '') => { const n = document.createElement(tag); n.textContent = value; n.className = className; return n; };
const swatch = (n: GraphNode) => { const s = text('span', '', 'swatch'); s.style.setProperty('--node-color', color(n)); return s; };
el('graph-title').textContent = graph.title || '知识图谱'; el('graph-title').title = graph.title || '知识图谱';
function schedule() { if (!pendingFrame && !document.hidden && surfaceVisible && !graphBenchmarkRunning && graphStyle.id!=='editor') pendingFrame = requestAnimationFrame(time => { pendingFrame = 0;if(document.hidden||!surfaceVisible||graphBenchmarkRunning||graphStyle.id==='editor')return; const dt = lastFrame ? Math.min(2, (time - lastFrame) / 16.67) : 1; lastFrame = time; if (mode === 'network') simulation?.step(dt); draw(); if (mode === 'network' && (simulation?.active() || stableLabels.active())) schedule();else lastFrame=0; }); }
let cachedPalette:Record<string,string>|undefined;
function palette() { if(cachedPalette)return cachedPalette;const css = getComputedStyle(document.body); return cachedPalette=Object.fromEntries(['panel', 'fg', 'muted', 'edge', 'line', 'accent'].map(n => [n, css.getPropertyValue('--' + n).trim()])); }
function setTheme() { cachedPalette=undefined;document.body.dataset.theme = theme; el('theme').innerHTML = iconMarkup(theme === 'dark' ? 'lightTheme' : 'darkTheme'); schedule(); }
function fit() {
  if (!positions.length) { schedule(); return; }
  const minX = Math.min(...positions.map(n => n.x)) - 125, maxX = Math.max(...positions.map(n => n.x)) + 125;
  const minY = Math.min(...positions.map(n => n.y)) - (mode === 'layers' ? 92 : 56), maxY = Math.max(...positions.map(n => n.y)) + 60;
  const camera=fitInCanvasSpace({x:minX,y:minY,width:maxX-minX,height:maxY-minY},graphReadingArea());scale=Math.min(1.1,camera.zoom);const area=graphReadingArea();ox=area.x+area.width/2-(minX+maxX)/2*scale;oy=area.y+area.height/2-(minY+maxY)/2*scale;schedule();
}
function readableView() {
  if (mode === 'network' || !positions.length) { fit(); return; }
  const minX = Math.min(...positions.map(n => n.x)) - 125, maxX = Math.max(...positions.map(n => n.x)) + 125;
  scale = Math.max(.65, Math.min(1, Math.max(100, width - 60) / (maxX - minX)));
  ox = width / 2 - (minX + maxX) / 2 * scale;
  oy = 104 - (Math.min(...positions.map(n => n.y)) - 44) * scale;
  schedule();
}
function zoom(factor: number, x = width / 2, y = height / 2) { const next = Math.max(.03, Math.min(2.5, scale * factor)); ox = x - (x - ox) * next / scale; oy = y - (y - oy) * next / scale; scale = next; schedule(); }
function resize() {
  const rect = canvas.getBoundingClientRect(), oldWidth = width, oldHeight = height; width = rect.width; height = rect.height; if (oldWidth !== width || oldHeight !== height) { stableLabels.reset(); labelCamera = undefined; }
  if(width<=0||height<=0)return;
  const ratio = Math.min(devicePixelRatio || 1, 2);const pixelWidth=Math.round(width*ratio),pixelHeight=Math.round(height*ratio);if(canvas.width===pixelWidth&&canvas.height===pixelHeight)return;canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (oldWidth === 1 || Math.abs(oldWidth - width) > 20 || Math.abs(oldHeight - height) > 20) readableView(); else { ox += (width - oldWidth) / 2; oy += (height - oldHeight) / 2; schedule(); }
}
let labelPriority:ReturnType<typeof layoutGraph>=[];
let edgeOrder:GraphData['edges']=[],edgeOrderScope:GraphData['edges']|undefined,edgeOrderFocus='';
const labelText=canvasTextCache(ctx);
const wrap=labelText.wrap;

function changeGraphPreferences(next:GraphPreferences){
 const previous=graphPreferences;graphPreferences=next;saveGraphPreferences(next);
 if(next.spacing!==previous.spacing){
  // Change geometry once, without rebuilding the graph or fitting the camera again.
  const ratio=next.spacing/previous.spacing;
  for(const n of positions){n.x*=ratio;n.y*=ratio;}
  simulation?.settle();
 }
 if(simulation&&'configure' in simulation&&typeof simulation.configure==='function')simulation.configure(next);
 if(next.spacing!==previous.spacing||next.labels!==previous.labels||next.fontSize!==previous.fontSize){stableLabels.reset();labelCamera=undefined;}
 schedule();
}

function draw() { if(graphStyle.id==='editor')return;graphCanvas?.syncZoom();
  const visibleWorld={left:-ox/scale-140,right:(width-ox)/scale+140,top:-oy/scale-140,bottom:(height-oy)/scale+140};
  const p = palette(); ctx.clearRect(0, 0, width, height); ctx.save(); ctx.translate(ox, oy); ctx.scale(scale, scale);
  if (mode === 'network') paintStyleBackdrop(ctx, positions, graphStyle, p.fg, scale);
  const related = new Set([selected]); for (const edge of adjacency.get(selected) ?? []) { related.add(edge.source); related.add(edge.target); }
  const edgeFocus = hovered || selected;
  if(edgeOrderScope!==scope.edges||edgeOrderFocus!==edgeFocus){edgeOrderScope=scope.edges;edgeOrderFocus=edgeFocus;edgeOrder=edgeFocus?[...scope.edges.filter(e=>e.source!==edgeFocus&&e.target!==edgeFocus),...scope.edges.filter(e=>e.source===edgeFocus||e.target===edgeFocus)]:scope.edges;}
  const orderedEdges=edgeOrder;
  for (const edge of orderedEdges) {
    const a = positionMap.get(edge.source)!, b = positionMap.get(edge.target)!; if(Math.max(a.x,b.x)<visibleWorld.left||Math.min(a.x,b.x)>visibleWorld.right||Math.max(a.y,b.y)<visibleWorld.top||Math.min(a.y,b.y)>visibleWorld.bottom)continue;const active = edge.source === selected || edge.target === selected;
    const emphasis = edgeEmphasis(edge, { hovered, selected, baseColor: p.edge, focusColor: p.muted, scale }); ctx.globalAlpha = emphasis.alpha; ctx.strokeStyle = emphasis.color; ctx.lineWidth = emphasis.width;
    ctx.beginPath(); let endX = b.x, endY = b.y;
    if (mode === 'layers') {
      if (lane(a) !== lane(b)) { const sign = b.x > a.x ? 1 : -1; const sx = a.x + sign * 112; endX = b.x - sign * 112; const cx = (sx + endX) / 2; ctx.moveTo(sx, a.y); ctx.bezierCurveTo(cx, a.y, cx, b.y, endX, b.y); }
      else { const sign = b.y > a.y ? 1 : -1; const sx = a.x + 112, curve = sx + 26 + Math.min(60, Math.abs(b.y - a.y) * .12); endX = b.x + 112; endY = b.y - sign * 12; ctx.moveTo(sx, a.y + sign * 12); ctx.bezierCurveTo(curve, a.y, curve, b.y, endX, endY); }
    } else { const angle = Math.atan2(b.y - a.y, b.x - a.x); endX = b.x - Math.cos(angle) * nodeRadius(b); endY = b.y - Math.sin(angle) * nodeRadius(b); paintStyleLink(ctx, a, b, endX, endY, graphStyle, edge.source === (hovered || selected) || edge.target === (hovered || selected)); }
    ctx.stroke();
    if (active && mode === 'network' && graphStyle.id === 'constellation') { const angle = Math.atan2(b.y - a.y, b.x - a.x), size = 5 / scale; ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.moveTo(endX, endY); ctx.lineTo(endX - Math.cos(angle - .45) * size, endY - Math.sin(angle - .45) * size); ctx.lineTo(endX - Math.cos(angle + .45) * size, endY - Math.sin(angle + .45) * size); ctx.closePath(); ctx.fill(); }
  }
  if (mode === 'layers') for (const i of [0, 1, 2]) {
    const bucket = positions.filter(n => lane(n) === i); if (!bucket.length) continue;
    ctx.globalAlpha = 1; ctx.fillStyle = p.muted; ctx.font = '500 12px "Segoe UI","Microsoft YaHei",sans-serif'; ctx.textAlign = 'left'; ctx.fillText(['研究主题 / 问题', '概念 / 实体', '文献 / 来源'][i], i * 370 - 108, Math.min(...bucket.map(n => n.y)) - 66);
  }
  for (const n of positions) {
    if(n.x<visibleWorld.left||n.x>visibleWorld.right||n.y<visibleWorld.top||n.y>visibleWorld.bottom)continue;const active = n.id === selected || n.id === hovered; ctx.globalAlpha = selected && !related.has(n.id) && n.id !== hovered ? .25 : 1;
    if (mode === 'layers') {
      ctx.shadowColor = active ? color(n) + '26' : '#203a520d'; ctx.shadowBlur = active ? 14 : 6; ctx.shadowOffsetY = 2;
      ctx.beginPath(); ctx.roundRect(n.x - 112, n.y - 44, 224, 88, 10); ctx.fillStyle = p.panel; ctx.fill(); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      
      ctx.fillStyle = color(n); ctx.beginPath(); ctx.arc(n.x - 94, n.y - 26, 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = '10px "Segoe UI","Microsoft YaHei",sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = p.muted; ctx.fillText(name(n), n.x - 84, n.y - 22); ctx.textAlign = 'right'; ctx.fillText(`${(adjacency.get(n.id) ?? []).length} 关系`, n.x + 97, n.y - 22);
      ctx.textAlign = 'left'; ctx.fillStyle = p.fg; ctx.font = '500 12px "Segoe UI","Microsoft YaHei",sans-serif'; wrap(n.label, 196).forEach((line, i) => ctx.fillText(line, n.x - 98, n.y + 1 + i * 19));
    } else {
      paintStyleNode(ctx, n, nodeRadius(n), graphStyle, active, scale, theme === 'dark');
    }
  }
  ctx.restore(); ctx.globalAlpha = 1; if (mode === 'network') drawNetworkLabels(p, related); const zoomLabel=`${Math.round(scale * 100)}%`;if(el('zoom-value').textContent!==zoomLabel)el('zoom-value').textContent=zoomLabel;
}
function nodeRadius(n: GraphNode) { const r = graphStyle.id === 'bubbles' ? n.type === 'source' ? 29 : n.type === 'entity' ? 20 : 23 : graphStyle.id === 'silk' ? n.type === 'source' ? 22 : n.type === 'entity' ? 8 : 10 : graphStyle.id === 'orbits' ? n.type === 'source' ? 26 : n.type === 'entity' ? 10 : 13 : n.type === 'source' ? 23 : n.type === 'entity' ? 10 : 13; return r / Math.sqrt(Math.max(.35, scale)); }
function drawNetworkLabels(p: Record<string, string>, related: Set<string>) {
  const caption=local ? '正在查看所选节点与直接关联的资料。' : graphStyle.description + ' · 拖动与悬停均可体验';if(el('map-caption').textContent!==caption)el('map-caption').textContent=caption;
  if(!graphPreferences.labels)return;
  const fontSize=graphPreferences.fontSize,lineHeight=Math.round(fontSize*1.45);
  ctx.font = `500 ${fontSize}px "Segoe UI","Microsoft YaHei",sans-serif`; ctx.textAlign = 'left';
  // Label packing is quadratic. Budget by readable screen area, not total graph size.
  // Always reserve the hovered/selected labels; every node remains drawn and hittable.
  const budget=Math.max(24,Math.min(80,Math.floor(width*height/18000)));
  const candidates:typeof positions=[];
  for(const id of [selected,hovered]){const n=positionMap.get(id);if(n&&!candidates.includes(n))candidates.push(n);}
  for(const n of labelPriority){if(candidates.length>=budget)break;if(n.id===selected||n.id===hovered)continue;if(n.x*scale+ox>-200&&n.x*scale+ox<width+200&&n.y*scale+oy>-100&&n.y*scale+oy<height+100)candidates.push(n);}
  const labels = candidates.map(n => {
    const lines = wrap(n.label, 166*fontSize/11);
    return { id: n.id, x: n.x * scale + ox, y: n.y * scale + oy, radius: nodeRadius(n) * scale + 8,
      width: Math.max(...lines.map(line => labelText.measure(line))) + 16, height: lines.length * lineHeight + 10,
      priority: n.degree + (n.type === 'entity' ? 1000 : 0) + (n.id === selected ? 10000 : 0),
      required: positions.length<=80&&n.type==='entity', active: n.id === selected || n.id === hovered, lines, node: n };
  });
  const shift = labelCamera ? { x: ox - labelCamera.x, y: oy - labelCamera.y } : { x: 0, y: 0 };
  labelCamera = { x: ox, y: oy };
  const boxes = stableLabels.place(labels, { width, height }, shift);
  ctx.save(); ctx.beginPath(); ctx.rect(8, 80, Math.max(0, width - 16), Math.max(0, height - 137)); ctx.clip();
  const visible = labels.filter(item => boxes.has(item.id) && (!selected || related.has(item.id) || item.active));
  // Draw the connector before the opaque label so it cannot cut through the text.
  for (const item of visible) {
    const box = boxes.get(item.id)!;
    const x = Math.max(box.x, Math.min(box.x + box.width, item.x));
    const y = Math.max(box.y, Math.min(box.y + box.height, item.y));
    const distance = Math.hypot(x - item.x, y - item.y);
    if (distance > item.radius + 12) {
      const r = item.radius / distance;
      ctx.globalAlpha = item.active ? .48 : .18; ctx.strokeStyle = item.active ? p.muted : color(item.node); ctx.lineWidth = item.active ? 1.1 : .8;
      ctx.beginPath(); ctx.moveTo(item.x + (x - item.x) * r, item.y + (y - item.y) * r); ctx.lineTo(x, y); ctx.stroke();
    }
  }
  for (const item of [...visible].sort((a, b) => Number(a.active) - Number(b.active))) {
    const box = boxes.get(item.id)!;
    ctx.globalAlpha = 1;
    ctx.fillStyle = graphStyle.id === 'bubbles' ? theme === 'dark' ? '#27272d' : '#f3f4f8' : p.panel;
    ctx.shadowColor = graphStyle.id === 'bubbles' ? color(item.node) + '14' : '#00000000'; ctx.shadowBlur = graphStyle.id === 'bubbles' ? 12 : 0;
    ctx.beginPath(); ctx.roundRect(box.x, box.y, box.width, box.height, graphStyle.id === 'constellation' ? 7 : graphStyle.id === 'bubbles' ? 12 : 18); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = item.active ? color(item.node) : p.fg;
    item.lines.forEach((line, i) => ctx.fillText(line, box.x + 8, box.y + 5 + fontSize + i * lineHeight));
  }
  ctx.restore(); ctx.globalAlpha = 1;
}

function renderTypes() {
  const container = el('types'); container.replaceChildren(); const types = [...new Set(graph.nodes.filter(n => system || n.type !== 'meta').map(n => n.type))];
  const all = button('全部', () => { type = ''; update(); }); all.setAttribute('aria-pressed', String(!type)); container.append(all);
  for (const t of types.sort((a, b) => lane({ type: a } as GraphNode) - lane({ type: b } as GraphNode))) {
    const nodes = graph.nodes.filter(n => n.type === t), b = button('', () => { type = t; update(); }); b.append(swatch(nodes[0]), text('span', typeNames[t] ?? '其他'), text('span', String(nodes.length), 'type-count')); b.setAttribute('aria-pressed', String(type === t)); container.append(b);
  }
}
function renderList() {
  const list = el('node-list'); list.replaceChildren();
  for (const n of scope.nodes) {
    const item = button('', () => select(n.id, true), 'node-item'); item.setAttribute('aria-pressed', String(n.id === selected)); item.title = n.label;
    const label = text('span', ''); label.append(text('span', n.label, 'node-label'), text('small', `${name(n)} · ${(adjacency.get(n.id) ?? []).length} 条关系`)); item.append(swatch(n), label); list.append(item);
  }
  el('list-count').textContent = String(scope.nodes.length); el('totals').textContent = `全部 ${graph.nodes.length} 个节点 · ${graph.edges.length} 条关系`;
}
let layoutEpoch=0;
function update(fitView = true) {const epoch=++layoutEpoch;void updateLayout(fitView,epoch);}
async function updateLayout(fitView:boolean,epoch:number) { stableLabels.reset(); labelCamera = undefined;
  if(graphStyle.id==='editor'){simulation=undefined;return;}
  let nextScope = graphScope(graph, { query, type, system, local, selected });
  if (selected && !nextScope.nodes.some(n => n.id === selected)) { clearSelection(false); nextScope = graphScope(graph, { query, type, system, local, selected }); }
  const nextPositions=await layoutGraphIncremental(nextScope,mode,()=>epoch!==layoutEpoch||graphStyle.id==='editor');if(!nextPositions||epoch!==layoutEpoch)return;
  scope=nextScope;positions=arrangeForStyle(nextPositions,graphStyle,mode);for(const n of positions){n.x*=graphPreferences.spacing;n.y*=graphPreferences.spacing;}positionMap=new Map(positions.map(n=>[n.id,n]));
  labelPriority=[...positions].sort((a,b)=>b.degree-a.degree||a.id.localeCompare(b.id));
  simulation = mode === 'network' ? createGraphSimulation(positions, scope.edges) : undefined; simulation?.settle(); lastFrame = 0; el('restart').hidden = mode !== 'network';
  renderTypes(); renderList(); el('empty').hidden = !!positions.length;
  el('empty-help').textContent = graph.nodes.some(n => n.type !== 'meta') ? '试试其他关键词，或切换节点类型。' : '当前仅有系统页面。开启“系统页面”查看，或生成知识图谱后探索资料。';
  el('visible-count').textContent = `${scope.nodes.length} 个节点 · ${scope.edges.length} 条关系${local ? ' · 局部图谱' : ''}`;
  el('map-caption').textContent = local ? '正在查看所选节点与直接关联的资料。' : mode === 'layers' ? '滚动浏览 · 拖动平移 · Ctrl + 滚轮缩放 · 点击卡片探索关系' : '拖动节点，感受关系牵引 · 拖动空白平移 · 滚轮缩放';
  if (fitView) readableView(); else schedule();
}
function clearSelection(refresh = true) { const wasLocal = local; selected = ''; local = false; el('detail').hidden = true; post('notebookmr:graph-context-clear', {}); if (refresh) { if (wasLocal) update(); else { renderList(); schedule(); } } }
function select(id: string, center = false) {
  const n = nodeMap.get(id); if (!n) return; selected = id; document.querySelector('.catalog')?.classList.remove('open'); el('browse').setAttribute('aria-expanded', 'false');
  if (local) update(); renderDetail(n); renderList();
  const neighbors = (adjacency.get(id) ?? []).map(e => nodeMap.get(e.source === id ? e.target : e.source)).filter((n): n is GraphNode => !!n);
  if (n.relativePath?.startsWith('wiki/') && n.type !== 'missing') post('notebookmr:graph-concept-query', { node: n, relatedNodes: [...new Map(neighbors.map(n => [n.id, n])).values()] }); else post('notebookmr:graph-context-clear', {});
  revealSelectedGraphNode(center);
  schedule();
}
function renderDetail(n: GraphNode) {
  const detail = el('detail'); detail.hidden = false; detail.replaceChildren(); const edges = adjacency.get(n.id) ?? [];
  const header = text('div', '', 'detail-top'); const category = text('span', name(n)); category.style.color = color(n);
  const close=button('',()=>{detail.hidden=true;schedule();});close.append(canvasIcon('close'));close.setAttribute('aria-label','关闭节点详情');header.append(category,close);detail.append(header, text('h2', n.label)); describeGraphNode(n);
  const neighbors = new Map<string, GraphNode>(); for (const edge of edges) { const other = nodeMap.get(edge.source === n.id ? edge.target : edge.source); if (other) neighbors.set(other.id, other); }
  if (n.status) detail.append(text('div', n.status, 'status'));
  const stats = text('div', '', 'stats'); for (const [value, label] of [[neighbors.size, '关联节点'], [edges.length, '关系']] as const) { const item = text('div', ''); item.append(text('strong', String(value)), text('small', label)); stats.append(item); } detail.append(stats);
  if (n.tags.length) { const tags = text('div', '', 'tags'); n.tags.forEach(t => tags.append(text('span', t))); detail.append(tags); }
  const actions = text('div', '', 'detail-actions'); actions.append(button('加入白板',()=>{switchView('editor');flowEditor!.addReference(n.id);},'read-page')); const focus = button(local ? '返回全图' : '只看相关节点', () => { local = !local; query = ''; type = ''; el<HTMLInputElement>('search').value = ''; update(); select(n.id); }); actions.append(focus);
  if (n.document?.originalPdf) actions.append(button('打开来源 PDF', () => post('notebookmr:open-document', { sourcePath: n.document!.originalPdf, title: n.document!.title, sourceNodeId: n.id, sourceNodePath: n.relativePath })));
  if(n.relativePath?.startsWith('wiki/')&&n.type!=='missing'&&n.type!=='meta')actions.append(button('定位 PDF 原句',()=>post('notebookmr:graph-open-evidence',{nodePath:n.relativePath})));
  detail.append(actions, text('h3', '关联资料'));
  const grouped = new Map<string, typeof edges>(); for (const edge of edges) { const id = edge.source === n.id ? edge.target : edge.source; const group = grouped.get(id) ?? []; group.push(edge); grouped.set(id, group); }
  const relations: Record<string, string> = { wikilink: '页面链接', 'raw-source': '来源引用', 'canvas-edge': '画布关系', 'canvas-contains': '画布包含', 'folder-affinity': '同类页面' };
  for (const [id, relatedEdges] of grouped) { const other = nodeMap.get(id); if (!other) continue; const b = button('', () => { if (!positionMap.has(id)) { query = ''; type = ''; system ||= other.type === 'meta'; el<HTMLInputElement>('system').checked = system; el<HTMLInputElement>('search').value = ''; if (!local) update(); } select(id, true); }, 'relation');
    const label = text('span', ''); label.append(text('span', other.label), text('small', [...new Set(relatedEdges.map(e => `${e.source === n.id ? '引用 →' : '← 被引用'} ${relations[e.relation] ?? e.relation}`))].join(' · '))); b.append(swatch(other), label); detail.append(b);
  }
  if (!grouped.size) detail.append(text('p', '这个节点暂时没有关联资料。', 'detail-hint'));
  if (n.relativePath) detail.append(text('h3', '页面路径'), text('div', n.relativePath, 'detail-path'));
  if (n.relativePath?.startsWith('wiki/') && n.type !== 'missing') detail.append(text('p', document.documentElement.dataset.graphToken ? '已将页面资料提供给聊天，可使用上方“查询所选节点”继续研究。' : '在插件中选择此节点后，可引用页面并继续研究。', 'detail-hint'));
}
function hit(x: number, y: number) {
  const wx = (x - ox) / scale, wy = (y - oy) / scale;
  for(let index=positions.length-1;index>=0;index--){const n=positions[index];if(mode==='layers'?Math.abs(wx-n.x)<112&&Math.abs(wy-n.y)<44:Math.hypot(wx-n.x,wy-n.y)<nodeRadius(n)+6/scale)return n;}return undefined;
}
canvas.addEventListener('pointerdown', e => { if (e.button !== 0) return; const n = mode === 'network' ? hit(e.offsetX, e.offsetY) : undefined; drag = { id: e.pointerId, x: e.offsetX, y: e.offsetY, ox, oy, moved: false, node: n?.id, nx: n?.x, ny: n?.y }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => { if (drag) { const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y; if (Math.hypot(dx, dy) > 4) drag.moved = true; if (drag.moved) { if (drag.node) simulation?.pin(drag.node, drag.nx! + dx / scale, drag.ny! + dy / scale); else { ox = drag.ox + dx; oy = drag.oy + dy; } schedule(); } } else { const n = hit(e.offsetX, e.offsetY); if ((n?.id ?? '') !== hovered) { hovered = n?.id ?? ''; canvas.title = n?.label ?? ''; canvas.style.cursor = n ? mode === 'network' ? 'grab' : 'pointer' : 'grab'; schedule(); } } });
canvas.addEventListener('pointerup', e => { if (!drag || e.pointerId !== drag.id) return; if (drag.node&&drag.moved) simulation?.release(drag.node); if (!drag.moved) { const n = hit(e.offsetX, e.offsetY); if (n) select(n.id); else clearSelection(); } drag = undefined; canvas.releasePointerCapture(e.pointerId); schedule(); });
canvas.addEventListener('pointercancel', () => { if (drag?.node) simulation?.release(drag.node); drag = undefined; schedule(); }); canvas.addEventListener('pointerleave', () => { hovered = ''; schedule(); });
canvas.addEventListener('wheel', e => { e.preventDefault(); if (mode === 'layers' && !e.ctrlKey && !e.metaKey) { const multiplier = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1; ox -= e.deltaX * multiplier; oy -= e.deltaY * multiplier; schedule(); } else zoom(Math.exp(-e.deltaY * .0013), e.offsetX, e.offsetY); }, { passive: false });
canvas.addEventListener('keydown', e => { if (e.key === 'Escape') clearSelection(); else if (e.key === '+' || e.key === '=') zoom(1.2); else if (e.key === '-') zoom(1 / 1.2); else if (e.key === '0') fit(); else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); ox += e.key === 'ArrowLeft' ? 40 : e.key === 'ArrowRight' ? -40 : 0; oy += e.key === 'ArrowUp' ? 40 : e.key === 'ArrowDown' ? -40 : 0; schedule(); } });
el<HTMLInputElement>('search').oninput = e => { query = (e.target as HTMLInputElement).value; local = false; update(); };
el<HTMLInputElement>('system').onchange = e => { system = (e.target as HTMLInputElement).checked; if (!system && type === 'meta') type = ''; update(); };
el('clear-filters').onclick = () => { query = ''; type = ''; local = false; system = !graph.nodes.some(n => n.type !== 'meta'); el<HTMLInputElement>('system').checked = system; el<HTMLInputElement>('search').value = ''; update(); };
for (const m of ['layers', 'network'] as const) el(m).onclick = () => { mode = m; el('layers').setAttribute('aria-pressed', String(mode === 'layers')); el('network').setAttribute('aria-pressed', String(mode === 'network')); update(); };
el('theme').onclick = () => { theme = theme === 'light' ? 'dark' : 'light'; setTheme(); }; el('zoom-in').onclick = () => zoom(1.2); el('zoom-out').onclick = () => zoom(1 / 1.2); el('fit').onclick = fit;
el('restart').innerHTML = iconMarkup('refresh'); el('restart').onclick = () => update();
document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastFrame = 0; schedule(); } });
el('browse').onclick = () => { const open = document.querySelector('.catalog')!.classList.toggle('open'); el('browse').setAttribute('aria-expanded', String(open)); if (open) el('search').focus(); };
document.fonts.ready.then(()=>{labelText.clear();schedule();});
new ResizeObserver(resize).observe(canvas); setTheme(); update(); resize();
function switchView(next:'editor'|'constellation') {
 graphStyle=graphStyleFor(next);document.body.dataset.visual=next;
 clearSelection(false);hovered='';
 graphCanvas?.setVisible(next!=='editor');
 if(next==='editor')flowEditor?.render();else flowEditor?.hide();
 post('artinfact:graph-mode',{mode:next});update();resize();
}
function renderVisualStudio(){
 flowEditor=createEditableFlowView(canvas.closest('.map') as HTMLElement,graph,{switchMode:switchView,theme:()=>el('theme').click()});
 graphCanvas=createGraphCanvas({switchMode:switchView,boardTool:tool=>flowEditor!.invokeTool(tool),zoom,scale:()=>scale,fit,clear:()=>clearSelection(),preferences:graphPreferences,changePreferences:changeGraphPreferences});
 document.body.dataset.visual=graphStyle.id;
 graphCanvas.setVisible(graphStyle.id!=='editor');
 if(graphStyle.id==='editor')flowEditor.render();
 window.addEventListener('message',event=>{
  if(event.source!==parent||event.data?.token!==document.documentElement.dataset.whiteboardToken)return;
  if(event.data.type==='artinfact:surface-visibility'){surfaceVisible=event.data.visible===true;if(!surfaceVisible){document.dispatchEvent(new Event('artinfact:graph-benchmark-stop'));if(pendingFrame)cancelAnimationFrame(pendingFrame);pendingFrame=0;flowEditor!.hide();}else{lastFrame=0;if(['editor','constellation'].includes(event.data.mode)&&event.data.mode!==graphStyle.id)switchView(event.data.mode);else if(graphStyle.id==='editor')flowEditor!.render();else schedule();document.dispatchEvent(new Event('artinfact:canvas-idle'));}return;}
  if(event.data.type==='artinfact:whiteboard-context-refresh')flowEditor!.refreshContext();
  if(event.data.type==='artinfact:whiteboard-data'){switchView('editor');void flowEditor!.invokeTool('library');}
  if(event.data.type==='artinfact:whiteboard-flush'){const {id,token}=event.data;void flowEditor!.flush().then(()=>parent.postMessage({type:'artinfact:whiteboard-flushed',token,id},'*'),error=>parent.postMessage({type:'artinfact:whiteboard-flushed',token,id,error:String(error)},'*'));}
 });
 if(document.documentElement.dataset.openData==='true')void flowEditor.invokeTool('library');
 resize();schedule();
}
function graphReadingArea(){const catalog=document.querySelector<HTMLElement>('.catalog')!,detail=el('detail');return canvasSpace({width,height},catalog.classList.contains('open')?catalog.offsetWidth:0,detail.hidden?0:detail.offsetWidth);}
function revealSelectedGraphNode(center=false){const point=positionMap.get(selected);if(!point)return;const area=graphReadingArea(),camera={x:ox,y:oy,zoom:scale},next=center?{...camera,x:area.x+area.width/2-point.x*scale,y:area.y+area.height/2-point.y*scale}:revealCanvasPoint(point,camera,area);ox=next.x;oy=next.y;}
async function checkGraphPerformance(){
 if(drag||!surfaceVisible||graphBenchmarkRunning)return;
 const saved={scope,positions,positionMap,labelPriority,simulation,scale,ox,oy,selected,hovered,mode};
 ++layoutEpoch;graphBenchmarkRunning=true;if(pendingFrame)cancelAnimationFrame(pendingFrame);pendingFrame=0;
 try{await runGraphPerformanceCheck({viewport:()=>({width,height,dpr:devicePixelRatio}),prepare(count){
  positions=Array.from({length:count},(_,i)=>{const a=i*2.399963229728653,r=Math.sqrt(i+1)*42;return{id:'benchmark-'+i,label:'Research '+i+' · Evidence and mechanism',type:i%10===0?'entity':i%7===0?'source':'concept',degree:4,tags:[],x:Math.cos(a)*r,y:Math.sin(a)*r};});
  const edges=positions.flatMap((n,i)=>[1,13].map((delta,j)=>({id:i+'-'+j,source:n.id,target:positions[(i+delta)%count].id,weight:1,relation:'related'})));
  scope={nodes:positions,edges};positionMap=new Map(positions.map(n=>[n.id,n]));labelPriority=[...positions];mode='network';selected='';hovered='';stableLabels.reset();labelCamera=undefined;
  scale=Math.min(1,Math.max(100,Math.min(width,height)-160)/(Math.sqrt(count)*84));ox=width/2;oy=height/2;simulation=createGraphSimulation(positions,edges);simulation.settle();
  return{step(dt,elapsed){simulation!.pin(positions[0].id,Math.cos(elapsed/650)*300,Math.sin(elapsed/650)*200);simulation!.step(dt);},draw};
 }});}finally{
  ({scope,positions,positionMap,labelPriority,simulation,scale,ox,oy,selected,hovered,mode}=saved);stableLabels.reset();labelCamera=undefined;graphBenchmarkRunning=false;lastFrame=0;schedule();
 }
}
renderVisualStudio();
