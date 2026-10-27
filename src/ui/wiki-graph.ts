import {canvasTextCache} from '../shared/canvas-text-cache.js';
import { colors, typeNames, lane, createGraphSimulation, graphScope, layoutGraph, layoutGraphIncremental, type GraphData, type GraphNode } from '../shared/wiki-graph-view.js';
import { iconMarkup } from './icons.js';
import {localizeInitialMarkup} from './ui-language.js';

localizeInitialMarkup();
const graph: GraphData = JSON.parse(document.getElementById('graph-data')!.textContent!);
const pageParams = new URLSearchParams(location.search);
const workspaceId = document.documentElement.dataset.workspaceId || pageParams.get('workspaceId') || '';
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('graph'), ctx = canvas.getContext('2d')!;
const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
const adjacency = new Map<string, typeof graph.edges>();
for (const edge of graph.edges) for (const id of new Set([edge.source, edge.target])) { const bucket = adjacency.get(id) ?? []; bucket.push(edge); adjacency.set(id, bucket); }
let mode: 'layers' | 'network' = 'network', selected = '', query = '', type = '', system = false, local = false;
let scope = graphScope(graph, {}), positions: ReturnType<typeof layoutGraph> = [], positionMap = new Map<string, ReturnType<typeof layoutGraph>[number]>();
let width = 1, height = 1, scale = 1, ox = 0, oy = 0, hovered = '', theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
let drag: { id: number; x: number; y: number; ox: number; oy: number; moved: boolean; node?: string; nx?: number; ny?: number } | undefined;
let simulation: ReturnType<typeof createGraphSimulation> | undefined, lastFrame = 0;
let pendingFrame = 0;
const color = (n: GraphNode) => colors[n.type] ?? '#547dc1';
const name = (n: GraphNode) => typeNames[n.type] ?? '其他';
const post = (type: string, payload: object) => window.parent?.postMessage({ type, codexGraphToken: document.documentElement.dataset.graphToken, payload: { workspaceId, ...payload } }, '*');
const button = (label: string, action: () => void, className = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = className; b.onclick = action; return b; };
const text = (tag: string, value: string, className = '') => { const n = document.createElement(tag); n.textContent = value; n.className = className; return n; };
const swatch = (n: GraphNode) => { const s = text('span', '', 'swatch'); s.style.setProperty('--node-color', color(n)); return s; };
el('graph-title').textContent = graph.title || '知识图谱'; el('graph-title').title = graph.title || '知识图谱';
function schedule() { if (!pendingFrame && !document.hidden) pendingFrame = requestAnimationFrame(time => { pendingFrame = 0; const dt = lastFrame ? Math.min(2, (time - lastFrame) / 16.67) : 1; lastFrame = time; if (mode === 'network') simulation?.step(dt); draw(); if (mode === 'network' && simulation?.active()) schedule(); }); }
let cachedPalette:Record<string,string>|undefined;
function palette() { if(cachedPalette)return cachedPalette;const css = getComputedStyle(document.body); return cachedPalette=Object.fromEntries(['panel', 'fg', 'muted', 'edge', 'line', 'accent'].map(n => [n, css.getPropertyValue('--' + n).trim()])); }
function setTheme() { cachedPalette=undefined;document.body.dataset.theme = theme; el('theme').innerHTML = iconMarkup(theme === 'dark' ? 'lightTheme' : 'darkTheme'); schedule(); }
function fit() {
  if (!positions.length) { schedule(); return; }
  const minX = Math.min(...positions.map(n => n.x)) - 125, maxX = Math.max(...positions.map(n => n.x)) + 125;
  const minY = Math.min(...positions.map(n => n.y)) - (mode === 'layers' ? 92 : 56), maxY = Math.max(...positions.map(n => n.y)) + 60;
  scale = Math.max(.03, Math.min(1.1, Math.max(80, width - 70) / (maxX - minX), Math.max(80, height - 154) / (maxY - minY)));
  ox = width / 2 - (minX + maxX) / 2 * scale; oy = (height + 28) / 2 - (minY + maxY) / 2 * scale; schedule();
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
  const rect = canvas.getBoundingClientRect(), oldWidth = width, oldHeight = height; width = rect.width; height = rect.height;
  if(width<=0||height<=0)return;
  const ratio = Math.min(devicePixelRatio || 1, 2);const pixelWidth=Math.round(width*ratio),pixelHeight=Math.round(height*ratio);if(canvas.width===pixelWidth&&canvas.height===pixelHeight)return;canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (oldWidth === 1 || Math.abs(oldWidth - width) > 20) readableView(); else { ox += (width - oldWidth) / 2; oy += (height - oldHeight) / 2; schedule(); }
}
const labelText=canvasTextCache(ctx);
const wrap=labelText.wrap;

function draw() {
  const p = palette(); ctx.clearRect(0, 0, width, height); ctx.save(); ctx.translate(ox, oy); ctx.scale(scale, scale);
  const related = new Set([selected]); for (const edge of adjacency.get(selected) ?? []) { related.add(edge.source); related.add(edge.target); }
  const orderedEdges = [...scope.edges].sort((a, b) => Number(a.source === selected || a.target === selected) - Number(b.source === selected || b.target === selected));
  for (const edge of orderedEdges) {
    const a = positionMap.get(edge.source)!, b = positionMap.get(edge.target)!; const active = edge.source === selected || edge.target === selected;
    ctx.globalAlpha = selected ? active ? .85 : .06 : .22; ctx.strokeStyle = active ? color(nodeMap.get(selected)!) : p.edge; ctx.lineWidth = active ? 1.7 / scale : 1 / scale;
    ctx.beginPath(); let endX = b.x, endY = b.y;
    if (mode === 'layers') {
      if (lane(a) !== lane(b)) { const sign = b.x > a.x ? 1 : -1; const sx = a.x + sign * 112; endX = b.x - sign * 112; const cx = (sx + endX) / 2; ctx.moveTo(sx, a.y); ctx.bezierCurveTo(cx, a.y, cx, b.y, endX, b.y); }
      else { const sign = b.y > a.y ? 1 : -1; const sx = a.x + 112, curve = sx + 26 + Math.min(60, Math.abs(b.y - a.y) * .12); endX = b.x + 112; endY = b.y - sign * 12; ctx.moveTo(sx, a.y + sign * 12); ctx.bezierCurveTo(curve, a.y, curve, b.y, endX, endY); }
    } else { const angle = Math.atan2(b.y - a.y, b.x - a.x); endX = b.x - Math.cos(angle) * nodeRadius(b); endY = b.y - Math.sin(angle) * nodeRadius(b); ctx.moveTo(a.x, a.y); ctx.lineTo(endX, endY); }
    ctx.stroke();
    if (active && mode === 'network') { const angle = Math.atan2(b.y - a.y, b.x - a.x), size = 5 / scale; ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.moveTo(endX, endY); ctx.lineTo(endX - Math.cos(angle - .45) * size, endY - Math.sin(angle - .45) * size); ctx.lineTo(endX - Math.cos(angle + .45) * size, endY - Math.sin(angle + .45) * size); ctx.closePath(); ctx.fill(); }
  }
  if (mode === 'layers') for (const i of [0, 1, 2]) {
    const bucket = positions.filter(n => lane(n) === i); if (!bucket.length) continue;
    ctx.globalAlpha = 1; ctx.fillStyle = p.muted; ctx.font = '500 12px "Segoe UI","Microsoft YaHei",sans-serif'; ctx.textAlign = 'left'; ctx.fillText(['研究主题 / 问题', '概念 / 实体', '文献 / 来源'][i], i * 370 - 108, Math.min(...bucket.map(n => n.y)) - 66);
  }
  for (const n of positions) {
    const active = n.id === selected || n.id === hovered; ctx.globalAlpha = selected && !related.has(n.id) && n.id !== hovered ? .25 : 1;
    if (mode === 'layers') {
      ctx.shadowColor = active ? color(n) + '26' : '#203a520d'; ctx.shadowBlur = active ? 14 : 6; ctx.shadowOffsetY = 2;
      ctx.beginPath(); ctx.roundRect(n.x - 112, n.y - 44, 224, 88, 10); ctx.fillStyle = p.panel; ctx.fill(); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.strokeStyle = active ? color(n) : p.line; ctx.lineWidth = active ? 1.8 : 1; ctx.stroke();
      ctx.fillStyle = color(n); ctx.beginPath(); ctx.arc(n.x - 94, n.y - 26, 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = '10px "Segoe UI","Microsoft YaHei",sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = p.muted; ctx.fillText(name(n), n.x - 84, n.y - 22); ctx.textAlign = 'right'; ctx.fillText(`${(adjacency.get(n.id) ?? []).length} 关系`, n.x + 97, n.y - 22);
      ctx.textAlign = 'left'; ctx.fillStyle = p.fg; ctx.font = '500 12px "Segoe UI","Microsoft YaHei",sans-serif'; wrap(n.label, 196).forEach((line, i) => ctx.fillText(line, n.x - 98, n.y + 1 + i * 19));
    } else {
      const radius = nodeRadius(n); ctx.beginPath(); ctx.arc(n.x, n.y, radius + (active ? 8 : 4) / scale, 0, Math.PI * 2); ctx.fillStyle = color(n) + (active ? '25' : '12'); ctx.fill();
      ctx.shadowBlur = active ? 16 : 6; ctx.shadowColor = color(n) + '40'; ctx.beginPath(); ctx.arc(n.x, n.y, radius, 0, Math.PI * 2); ctx.fillStyle = color(n); ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = p.panel; ctx.lineWidth = 2 / scale; ctx.stroke();
      if (active) { ctx.strokeStyle = color(n); ctx.lineWidth = 1 / scale; ctx.beginPath(); ctx.arc(n.x, n.y, radius + 5 / scale, 0, Math.PI * 2); ctx.stroke(); }
    }
  }
  ctx.restore(); ctx.globalAlpha = 1; if (mode === 'network') drawNetworkLabels(p, related); const zoomLabel=`${Math.round(scale * 100)}%`;if(el('zoom-value').textContent!==zoomLabel)el('zoom-value').textContent=zoomLabel;
}
function nodeRadius(n: GraphNode) { return (11 + Math.min(9, Math.sqrt(n.degree) * 1.7)) / Math.sqrt(Math.max(.35, scale)); }
function drawNetworkLabels(p: Record<string, string>, related: Set<string>) {
  const occupied: Array<{ x: number; y: number; w: number; h: number }> = positions.map(n => ({ x: n.x * scale + ox - nodeRadius(n) * scale - 4, y: n.y * scale + oy - nodeRadius(n) * scale - 4, w: nodeRadius(n) * scale * 2 + 8, h: nodeRadius(n) * scale * 2 + 8 }));
  const sorted = [...positions].sort((a, b) => Number(b.id === selected || b.id === hovered) - Number(a.id === selected || a.id === hovered) || Number(related.has(b.id)) - Number(related.has(a.id)) || b.degree - a.degree);
  ctx.font = '500 11px "Segoe UI","Microsoft YaHei",sans-serif'; ctx.textAlign = 'left';
  for (const n of sorted) {
    const active = n.id === selected || n.id === hovered; if (selected && !related.has(n.id) && !active) continue;
    const lines = wrap(n.label, 166); const w = Math.max(...lines.map(line => labelText.measure(line))) + 16, h = lines.length * 16 + 10;
    const x = n.x * scale + ox, y = n.y * scale + oy, r = nodeRadius(n) * scale + 8;
    const candidates = [{ x: x - w / 2, y: y + r }, { x: x + r, y: y - h / 2 }, { x: x - w / 2, y: y - r - h }, { x: x - r - w, y: y - h / 2 }, { x: x + r + 16, y: y - r - h - 12 }, { x: x - r - w - 16, y: y - r - h - 12 }, { x: x + r + 16, y: y + r + 12 }, { x: x - r - w - 16, y: y + r + 12 }].map(point => ({ ...point, w, h }));
    const box = candidates.find(b => b.x > 8 && b.x + w < width - 8 && b.y > 80 && b.y + h < height - 57 && !occupied.some(o => b.x < o.x + o.w + 4 && b.x + w + 4 > o.x && b.y < o.y + o.h + 3 && b.y + h + 3 > o.y));
    if (!box) continue; occupied.push(box); ctx.globalAlpha = active ? 1 : selected ? .92 : .88; ctx.fillStyle = p.panel; ctx.beginPath(); ctx.roundRect(box.x, box.y, w, h, 6); ctx.fill(); ctx.strokeStyle = active ? color(n) + '50' : p.line; ctx.lineWidth = 1; ctx.stroke(); ctx.fillStyle = active ? color(n) : p.fg; lines.forEach((line, i) => ctx.fillText(line, box.x + 8, box.y + 17 + i * 16));
  }
  ctx.globalAlpha = 1;
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
async function updateLayout(fitView:boolean,epoch:number) {
  let nextScope = graphScope(graph, { query, type, system, local, selected });
  if (selected && !nextScope.nodes.some(n => n.id === selected)) { clearSelection(false); nextScope = graphScope(graph, { query, type, system, local, selected }); }
  const nextPositions=await layoutGraphIncremental(nextScope,mode,()=>epoch!==layoutEpoch);if(!nextPositions||epoch!==layoutEpoch)return;
  scope=nextScope;positions=nextPositions;positionMap=new Map(positions.map(n=>[n.id,n]));
  simulation = mode === 'network' ? createGraphSimulation(positions, scope.edges) : undefined; lastFrame = 0; el('restart').hidden = mode !== 'network';
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
  if (center && positionMap.has(id)) { const p = positionMap.get(id)!; scale = Math.max(scale, .85); ox = width / 2 - p.x * scale; oy = height / 2 - p.y * scale; }
  schedule();
}
function renderDetail(n: GraphNode) {
  const detail = el('detail'); detail.hidden = false; detail.replaceChildren(); const edges = adjacency.get(n.id) ?? [];
  const header = text('div', '', 'detail-top'); const category = text('span', name(n)); category.style.color = color(n); header.append(category, button('×', () => clearSelection())); header.lastElementChild!.setAttribute('aria-label', '关闭节点详情'); detail.append(header, text('h2', n.label));
  const neighbors = new Map<string, GraphNode>(); for (const edge of edges) { const other = nodeMap.get(edge.source === n.id ? edge.target : edge.source); if (other) neighbors.set(other.id, other); }
  if (n.status) detail.append(text('div', n.status, 'status'));
  const stats = text('div', '', 'stats'); for (const [value, label] of [[neighbors.size, '关联节点'], [edges.length, '关系']] as const) { const item = text('div', ''); item.append(text('strong', String(value)), text('small', label)); stats.append(item); } detail.append(stats);
  if (n.tags.length) { const tags = text('div', '', 'tags'); n.tags.forEach(t => tags.append(text('span', t))); detail.append(tags); }
  const actions = text('div', '', 'detail-actions'); const focus = button(local ? '返回全图' : '只看相关节点', () => { local = !local; query = ''; type = ''; el<HTMLInputElement>('search').value = ''; update(); renderDetail(n); }); actions.append(focus);
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
  return [...positions].reverse().find(n => mode === 'layers' ? Math.abs(wx - n.x) < 112 && Math.abs(wy - n.y) < 44 : Math.hypot(wx - n.x, wy - n.y) < nodeRadius(n) + 6 / scale);
}
canvas.addEventListener('pointerdown', e => { if (e.button !== 0) return; const n = mode === 'network' ? hit(e.offsetX, e.offsetY) : undefined; drag = { id: e.pointerId, x: e.offsetX, y: e.offsetY, ox, oy, moved: false, node: n?.id, nx: n?.x, ny: n?.y }; if (n) simulation?.pin(n.id, n.x, n.y); canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => { if (drag) { const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y; if (Math.hypot(dx, dy) > 4) drag.moved = true; if (drag.moved) { if (drag.node) simulation?.pin(drag.node, drag.nx! + dx / scale, drag.ny! + dy / scale); else { ox = drag.ox + dx; oy = drag.oy + dy; } schedule(); } } else { const n = hit(e.offsetX, e.offsetY); if ((n?.id ?? '') !== hovered) { hovered = n?.id ?? ''; canvas.title = n?.label ?? ''; canvas.style.cursor = n ? mode === 'network' ? 'grab' : 'pointer' : 'grab'; schedule(); } } });
canvas.addEventListener('pointerup', e => { if (!drag || e.pointerId !== drag.id) return; if (drag.node) simulation?.release(drag.node); if (!drag.moved) { const n = hit(e.offsetX, e.offsetY); if (n) select(n.id); else clearSelection(); } drag = undefined; canvas.releasePointerCapture(e.pointerId); schedule(); });
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
