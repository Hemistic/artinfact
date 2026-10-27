import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ClaudeWikiService } from "../services/claude-wiki";
import type { ClaudeWikiGraph } from "../../shared/contracts";

const DEFAULT_TITLE = "NotebookMR LLM Wiki Graph";

interface BuildOptions {
  vaultDir: string;
  outDir: string;
  title: string;
  includeJson: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  source: "来源",
  entity: "实体",
  concept: "概念",
  domain: "领域",
  comparison: "对比",
  question: "问题",
  session: "会话",
  fold: "折叠",
  reference: "参考",
  decision: "决策",
  overview: "总览",
  meta: "索引",
  raw: "原文",
  missing: "缺失",
  unknown: "其他",
  tag: "标签",
};

const TYPE_COLORS: Record<string, string> = {
  source: "#d88948",
  entity: "#6f68b8",
  concept: "#3e9c86",
  domain: "#4c7fa8",
  comparison: "#bf6a63",
  question: "#7e9f55",
  session: "#8f8375",
  fold: "#8f8375",
  reference: "#4f8c9a",
  decision: "#b78045",
  overview: "#213b36",
  meta: "#73817f",
  raw: "#b8ac98",
  missing: "#b46a62",
  unknown: "#8b8b7f",
  tag: "#9a7bdc",
};

function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseArgs(argv: string[]): BuildOptions {
  const args = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      index += 1;
    } else {
      args.set(key, true);
    }
  }

  const vaultDir = String(args.get("vault-dir") ?? args.get("vault") ?? path.resolve(process.cwd(), "data", "electron", "llm-wiki-vault"));
  const outDir = String(args.get("out-dir") ?? args.get("out") ?? path.resolve(process.cwd(), "data", "reports", "claude-wiki-webview"));
  const title = String(args.get("title") ?? DEFAULT_TITLE);
  return {
    vaultDir: path.resolve(process.cwd(), vaultDir),
    outDir: path.resolve(process.cwd(), outDir),
    title,
    includeJson: args.has("include-json"),
  };
}

function buildObsidianGraphHtml(graph: ClaudeWikiGraph, title: string, graphJson: string, typeLabelsJson: string, typeColorsJson: string): string {
  return String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #111418;
      --graph-bg: #101318;
      --bg-soft: #171b21;
      --panel: rgba(31, 35, 43, 0.94);
      --panel-2: rgba(24, 28, 34, 0.94);
      --border: rgba(255,255,255,0.10);
      --ink: #dcddde;
      --muted: #9ca3af;
      --faint: #6b7280;
      --accent: #8b6cef;
      --link: rgba(166, 173, 186, 0.28);
      --link-hot: rgba(213, 215, 222, 0.78);
      --shadow: 0 18px 48px rgba(0,0,0,0.36);
      --glow: 0 0 0 1px rgba(139,108,239,0.10), 0 24px 80px rgba(0,0,0,0.42);
      --font-ui: "Styrene B", "Styrene A", "Helvetica Neue", Arial, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif, "Microsoft YaHei UI";
      --font-title: "Styrene B", "Styrene A", "Helvetica Neue", Arial, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif, "Microsoft YaHei UI";
    }
    body[data-theme="light"] {
      color-scheme: light;
      --bg: #f5f0e7;
      --graph-bg: #f7f2ea;
      --bg-soft: #fffaf2;
      --panel: rgba(255, 252, 246, 0.88);
      --panel-2: rgba(250, 245, 237, 0.94);
      --border: rgba(67, 57, 45, 0.14);
      --ink: #25211d;
      --muted: #6f665c;
      --faint: #9b9187;
      --accent: #6d5bd0;
      --link: rgba(82, 80, 76, 0.22);
      --link-hot: rgba(45, 42, 38, 0.72);
      --shadow: 0 18px 48px rgba(80, 68, 53, 0.13);
      --glow: 0 0 0 1px rgba(109,91,208,0.12), 0 24px 70px rgba(88,73,52,0.16);
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at 22% 18%, rgba(139,108,239,0.10), transparent 28%),
        radial-gradient(circle at 76% 16%, rgba(62,156,134,0.08), transparent 24%),
        var(--bg);
      color: var(--ink);
      font-family: var(--font-ui);
      font-synthesis-weight: none;
      text-rendering: geometricPrecision;
    }
    body[data-theme="light"] {
      background:
        radial-gradient(circle at 18% 16%, rgba(109,91,208,0.12), transparent 28%),
        radial-gradient(circle at 76% 18%, rgba(217,137,72,0.10), transparent 25%),
        linear-gradient(180deg, #fbf7ef, #efe8dc);
    }
    .app { position: fixed; inset: 0; display: grid; grid-template-columns: minmax(340px, 380px) minmax(0, 1fr); }
    .graph-area { position: relative; grid-column: 2; min-width: 0; overflow: hidden; background: var(--graph-bg); }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: grab; }
    canvas.dragging { cursor: grabbing; }
    .topbar {
      position: absolute;
      top: 18px;
      right: 18px;
      display: flex;
      justify-content: flex-end;
      align-items: flex-start;
      gap: 16px;
      pointer-events: none;
      z-index: 4;
    }
    .title-card, .floating-controls, .tooltip, .panel {
      border: 1px solid var(--border);
      background: var(--panel);
      backdrop-filter: blur(16px);
      box-shadow: var(--glow);
    }
    .title-card {
      position: relative;
      width: 100%;
      overflow: hidden;
      border-radius: 16px;
      padding: 15px 17px 16px;
    }
    .title-card::after {
      content: "";
      position: absolute;
      inset: -1px;
      pointer-events: none;
      background:
        linear-gradient(90deg, rgba(139,108,239,0.22), transparent 44%),
        radial-gradient(circle at 16px 16px, rgba(255,255,255,0.10), transparent 34px);
      opacity: 0.7;
    }
    .title-card > * { position: relative; z-index: 1; }
    .title-kicker {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      color: #a89cff;
      font-size: 9.5px;
      font-weight: 500;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .title-kicker::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #8b6cef;
      box-shadow: 0 0 18px rgba(139,108,239,0.7);
    }
    h1 { margin: 0; font-family: var(--font-title); font-size: 22px; font-weight: 400; letter-spacing: -0.025em; }
    .subtitle { margin-top: 6px; color: var(--muted); font-size: 11.5px; line-height: 1.45; }
    .title-metrics {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 11px;
    }
    .title-metrics span {
      border: 1px solid var(--border);
      border-radius: 999px;
      background: rgba(255,255,255,0.055);
      color: var(--ink);
      padding: 5px 8px;
      font-size: 10.5px;
      font-weight: 450;
      font-variant-numeric: tabular-nums;
    }
    .floating-controls {
      position: relative;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      max-width: min(720px, calc(100vw - 430px));
      border-radius: 18px;
      padding: 8px;
      pointer-events: auto;
    }
    .floating-controls .pill {
      box-shadow: none;
      backdrop-filter: none;
      background: rgba(255,255,255,0.055);
      white-space: nowrap;
    }
    .control-hint {
      max-width: 360px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .display-popover {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      display: none;
      width: min(340px, calc(100vw - 32px));
      max-height: calc(100vh - 110px);
      overflow: auto;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--panel);
      box-shadow: var(--glow);
      backdrop-filter: blur(16px);
      padding: 14px;
    }
    .floating-controls.adjusting .display-popover {
      display: block;
    }
    .icon-button {
      width: 34px;
      height: 34px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: rgba(255,255,255,0.06);
      color: var(--ink);
      font-weight: 500;
      cursor: pointer;
    }
    .icon-button:hover { background: rgba(255,255,255,0.12); }
    body[data-theme="light"] .icon-button,
    body[data-theme="light"] .text-button {
      background: rgba(255,255,255,0.52);
    }
    .pill {
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--panel);
      color: var(--muted);
      backdrop-filter: blur(14px);
      padding: 8px 11px;
      font-size: 12px;
      box-shadow: var(--shadow);
    }
    .tooltip {
      position: absolute;
      display: none;
      z-index: 6;
      max-width: 360px;
      border-radius: 14px;
      padding: 11px 12px;
      pointer-events: none;
    }
    .tooltip b { display: block; margin-bottom: 5px; font-size: 12.5px; font-weight: 450; line-height: 1.35; }
    .tooltip span { display: block; color: var(--muted); font-size: 11px; line-height: 1.5; }
    .side {
      grid-column: 1;
      grid-row: 1;
      min-width: 0;
      border-right: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(24,28,34,0.98), rgba(18,21,26,0.98));
      overflow: auto;
      overflow-x: hidden;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      z-index: 5;
    }
    .side > .title-card,
    .side > .panel {
      flex: 0 0 auto;
    }
    body[data-theme="light"] .side {
      background: linear-gradient(180deg, rgba(255,252,246,0.96), rgba(246,240,231,0.96));
    }
    .panel { border-radius: 16px; padding: 14px; }
    .eyebrow {
      margin-bottom: 9px;
      color: #b6a6ff;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    body[data-theme="light"] .eyebrow,
    body[data-theme="light"] .section-title,
    body[data-theme="light"] .title-kicker {
      color: #6d5bd0;
    }
    .search {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: rgba(0,0,0,0.18);
      color: var(--ink);
      outline: none;
      padding: 10px 11px;
      font-size: 13px;
    }
    body[data-theme="light"] .search,
    body[data-theme="light"] code {
      background: rgba(255,255,255,0.60);
    }
    .search:focus { border-color: rgba(139,108,239,0.72); }
    .toggles { display: grid; gap: 8px; }
    .control-stack { display: grid; gap: 10px; }
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: var(--ink);
      font-size: 13px;
    }
    .toggle-row span { display: inline-flex; align-items: center; gap: 8px; }
    .dot { width: 9px; height: 9px; border-radius: 99px; display: inline-block; }
    input[type="checkbox"] { accent-color: var(--accent); }
    .slider-row { display: grid; gap: 6px; color: var(--muted); font-size: 12px; }
    .slider-row span { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .slider-row output {
      color: var(--ink);
      font-size: 11px;
      font-weight: 450;
      font-variant-numeric: tabular-nums;
    }
    input[type="range"] { width: 100%; accent-color: var(--accent); }
    .button-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .text-button {
      border: 1px solid var(--border);
      border-radius: 10px;
      background: rgba(255,255,255,0.055);
      color: var(--ink);
      cursor: pointer;
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 450;
    }
    .text-button:hover { background: rgba(255,255,255,0.11); }
    .stats { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 9px; }
    .stat { border-radius: 12px; background: rgba(255,255,255,0.05); padding: 10px; }
    body[data-theme="light"] .stat,
    body[data-theme="light"] .property,
    body[data-theme="light"] .neighbor,
    body[data-theme="light"] .meta-row span,
    body[data-theme="light"] .detail-type {
      background: rgba(255,255,255,0.50);
    }
    .stat b { display: block; font-size: 18px; font-weight: 450; }
    .stat span { color: var(--muted); font-size: 12px; }
    .detail { display: grid; min-width: 0; gap: 14px; }
    .detail h2 { margin: 0; font-family: var(--font-title); font-size: 22px; font-weight: 400; line-height: 1.16; letter-spacing: -0.025em; }
    .detail-title-row {
      display: grid;
      min-width: 0;
      gap: 8px;
    }
    .detail-type {
      display: inline-flex;
      width: fit-content;
      align-items: center;
      gap: 7px;
      border: 1px solid rgba(255,255,255,0.09);
      border-radius: 999px;
      background: rgba(255,255,255,0.055);
      color: var(--muted);
      padding: 5px 8px;
      font-size: 11px;
      font-weight: 450;
    }
    .meta-row { display: flex; flex-wrap: wrap; gap: 7px; }
    .meta-row span {
      min-width: 0;
      border-radius: 999px;
      background: rgba(255,255,255,0.07);
      color: var(--muted);
      padding: 5px 8px;
      font-size: 11px;
      font-weight: 450;
    }
    .detail-section {
      display: grid;
      min-width: 0;
      gap: 8px;
    }
    .detail-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .detail-file-link {
      display: block;
      overflow: hidden;
      text-decoration: none;
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .detail-open-pdf-button {
      border-color: rgba(139,108,239,0.55);
      background: linear-gradient(135deg, rgba(139,108,239,0.34), rgba(62,156,134,0.22));
      color: #f4f1ff;
      font-weight: 600;
      box-shadow: 0 10px 28px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.12);
    }
    .detail-open-pdf-button:hover {
      background: linear-gradient(135deg, rgba(139,108,239,0.48), rgba(62,156,134,0.30));
    }
    body[data-theme="light"] .detail-open-pdf-button {
      color: #282134;
      background: linear-gradient(135deg, rgba(109,91,208,0.22), rgba(62,156,134,0.16));
      border-color: rgba(109,91,208,0.38);
    }
    .section-title {
      color: #b6a6ff;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .tag-list {
      display: flex;
      flex-wrap: wrap;
      min-width: 0;
      gap: 6px;
    }
    .tag {
      max-width: 100%;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(139,108,239,0.13);
      color: #d4ccff;
      padding: 5px 8px;
      font-size: 11px;
      font-weight: 450;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    body[data-theme="light"] .tag {
      background: rgba(109,91,208,0.14);
      color: #5142a7;
    }
    .property-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0,1fr));
      gap: 8px;
    }
    .property {
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 12px;
      background: rgba(255,255,255,0.045);
      padding: 9px 10px;
    }
    .property b {
      display: block;
      margin-bottom: 3px;
      color: var(--ink);
      font-size: 13px;
      font-weight: 450;
    }
    .property span {
      color: var(--muted);
      font-size: 11px;
    }
    code {
      display: block;
      overflow-wrap: anywhere;
      border-radius: 10px;
      background: rgba(0,0,0,0.20);
      color: #b6beca;
      padding: 9px;
      font-size: 11px;
      line-height: 1.45;
    }
    body[data-theme="light"] code {
      color: #3c352f;
    }
    .path-box {
      display: grid;
      gap: 8px;
    }
    .copy-state {
      color: var(--faint);
      font-size: 11px;
      min-height: 14px;
    }
    .neighbors { display: grid; gap: 8px; }
    .neighbor {
      width: 100%;
      min-width: 0;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      background: rgba(255,255,255,0.045);
      color: var(--ink);
      text-align: left;
      padding: 9px 10px;
      cursor: pointer;
    }
    .neighbor:hover { background: rgba(255,255,255,0.08); }
    .neighbor b { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; font-weight: 450; line-height: 1.35; }
    .neighbor small {
      display: -webkit-box;
      margin-top: 4px;
      overflow: hidden;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .neighbor-section {
      display: grid;
      gap: 8px;
    }
    .neighbor-section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 450;
    }
    .neighbor-section-head b {
      color: var(--ink);
      font-size: 11.5px;
      font-weight: 450;
    }
    @media (max-width: 980px) {
      .app { grid-template-columns: 1fr; grid-template-rows: minmax(520px, 1fr) auto; }
      .graph-area { grid-column: 1; grid-row: 1; }
      .side { grid-row: 2; max-height: 44vh; border-right: 0; border-top: 1px solid var(--border); }
      .floating-controls { max-width: calc(100vw - 36px); }
      .control-hint { display: none; }
    }
  </style>
</head>
<body>
  <div class="app">
    <main class="graph-area">
      <canvas id="graphCanvas"></canvas>
      <div class="topbar">
        <div class="floating-controls">
          <div class="pill" id="viewState">Scale 100%</div>
          <div class="pill control-hint">拖拽平移 · 滚轮缩放 · 点击节点查看局部图谱 · 双击复位</div>
          <button class="icon-button" id="displayToggle" title="显示调节">☷</button>
          <button class="icon-button" id="themeToggle" title="Toggle theme">☼</button>
          <button class="icon-button" id="zoomIn" title="Zoom in">+</button>
          <button class="icon-button" id="zoomOut" title="Zoom out">−</button>
          <button class="icon-button" id="resetView" title="Reset view">⌂</button>
          <button class="icon-button" id="restart" title="Restart simulation">↻</button>
          <div class="display-popover" id="displayPopover">
            <div class="eyebrow">Display</div>
            <div class="control-stack">
              <label class="toggle-row"><span>Show labels</span><input id="showLabels" type="checkbox" checked /></label>
              <label class="toggle-row"><span>Show links</span><input id="showLinks" type="checkbox" checked /></label>
              <label class="toggle-row"><span>Show arrows</span><input id="showArrows" type="checkbox" /></label>
              <label class="toggle-row"><span>Show tags</span><input id="showTags" type="checkbox" /></label>
              <label class="toggle-row"><span>Local graph</span><input id="localOnly" type="checkbox" /></label>
              <label class="toggle-row"><span>Hide unresolved</span><input id="hideMissing" type="checkbox" /></label>
              <div class="button-row">
                <button class="text-button" id="clearSelection">Global graph</button>
                <button class="text-button" id="fitSelection">Fit view</button>
              </div>
              <div class="slider-row"><span>Depth <output id="localDepthValue">1</output></span><input id="localDepth" type="range" min="1" max="4" step="1" value="1" /></div>
              <div class="slider-row"><span>Node size <output id="nodeSizeValue">1.00</output></span><input id="nodeSize" type="range" min="0.6" max="1.8" step="0.05" value="1" /></div>
              <div class="slider-row"><span>Label threshold <output id="labelThresholdValue">1.00</output></span><input id="labelThreshold" type="range" min="0.6" max="2.6" step="0.05" value="1" /></div>
              <div class="slider-row"><span>Link distance <output id="linkDistanceValue">122</output></span><input id="linkDistance" type="range" min="60" max="220" step="5" value="122" /></div>
              <div class="slider-row"><span>Repel force <output id="repelForceValue">1150</output></span><input id="repelForce" type="range" min="300" max="2600" step="50" value="1150" /></div>
              <div class="slider-row"><span>Center force <output id="centerForceValue">45</output></span><input id="centerForce" type="range" min="0" max="120" step="5" value="45" /></div>
              <div class="slider-row"><span>Link thickness <output id="lineThicknessValue">1.00</output></span><input id="lineThickness" type="range" min="0.4" max="2.4" step="0.05" value="1" /></div>
            </div>
          </div>
        </div>
      </div>
      <div class="tooltip" id="tooltip"></div>
    </main>
    <aside class="side">
      <section class="title-card">
        <div class="title-kicker">Obsidian Graph View</div>
        <h1>${escapeHtml(title)}</h1>
        <div class="subtitle">Drag to pan · wheel to zoom · click for backlinks and outgoing links · filter into a local graph.</div>
        <div class="title-metrics">
          <span>${graph.summary.pageCount} files</span>
          <span>${graph.summary.nodeCount} nodes</span>
          <span>${graph.summary.edgeCount} links</span>
          <span>${graph.summary.missingTargetCount} unresolved</span>
        </div>
      </section>
      <section class="panel">
        <div class="eyebrow">Search</div>
        <input id="search" class="search" placeholder="搜索文件名、概念、路径..." />
      </section>
      <section class="panel detail" id="detail">
        <div class="eyebrow">Graph</div>
        <h2>全局图谱</h2>
        <div class="meta-row"><span>点击节点查看邻居</span><span>hover 显示文件名</span></div>
      </section>
      <section class="panel stats">
        <div class="stat"><b>${graph.summary.pageCount}</b><span>files</span></div>
        <div class="stat"><b>${graph.summary.edgeCount}</b><span>links</span></div>
        <div class="stat"><b>${graph.summary.nodeCount}</b><span>nodes</span></div>
        <div class="stat"><b>${graph.summary.missingTargetCount}</b><span>unresolved</span></div>
      </section>
      <section class="panel">
        <div class="eyebrow">Filters</div>
        <div class="toggles" id="typeToggles"></div>
      </section>
    </aside>
  </div>
  <script id="graph-data" type="application/json">${graphJson}</script>
  <script>
    const graph = JSON.parse(document.getElementById('graph-data').textContent);
    const typeLabels = ${typeLabelsJson};
    const typeColors = ${typeColorsJson};
    const canvas = document.getElementById('graphCanvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    const tooltip = document.getElementById('tooltip');
    const detail = document.getElementById('detail');
    const viewState = document.getElementById('viewState');
    const state = {
      dpr: Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
      width: 1,
      height: 1,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      pointer: null,
      downPoint: null,
      dragMoved: false,
      selected: null,
      hovered: null,
      draggingNode: null,
      panning: false,
      panMoved: false,
      query: '',
      hiddenTypes: new Set(),
      showLabels: true,
      showLinks: true,
      showArrows: false,
      showTags: false,
      localOnly: false,
      localDepth: 1,
      hideMissing: false,
      nodeSize: 1,
      labelThreshold: 1,
      linkDistance: 122,
      repelForce: 1150,
      centerForce: 45,
      lineThickness: 1,
      localScope: null,
      localScopeKey: '',
      theme: readTheme(),
      alpha: 1,
      running: true,
      lastFrame: 0,
      userMoved: false,
      autoFitPending: true,
      hasAutoFitted: false,
      lastFitWidth: 0,
      lastFitHeight: 0
    };
    const palettes = {
      dark: {
        backgroundInner: '#171b21',
        backgroundOuter: '#101318',
        grid: '#313844',
        link: '#79808d',
        linkHot: '#d7d9df',
        labelBg: 'rgba(17,20,26,0.76)',
        labelStroke: 'rgba(255,255,255,0.08)',
        labelText: '#e3e5e8',
        labelHalo: 'rgba(10,12,16,0.84)',
        sourceLabelText: '#f2d0ad',
        nodeStroke: 'rgba(255,255,255,0.28)',
        nodeHotStroke: 'rgba(255,255,255,0.82)',
        nodeSelectedStroke: '#ffffff'
      },
      light: {
        backgroundInner: '#f8f3eb',
        backgroundOuter: '#efe7da',
        grid: '#d9d0c4',
        link: '#766f68',
        linkHot: '#2d2924',
        labelBg: 'rgba(255,252,246,0.88)',
        labelStroke: 'rgba(67,57,45,0.13)',
        labelText: '#27231f',
        labelHalo: 'rgba(255,250,242,0.88)',
        sourceLabelText: '#7d4d20',
        nodeStroke: 'rgba(55,48,42,0.30)',
        nodeHotStroke: 'rgba(31,27,24,0.78)',
        nodeSelectedStroke: '#1f1b18'
      }
    };
    const rawNodes = graph.nodes || [];
    const pageParams = new URLSearchParams(window.location.search);
    const workspaceId = pageParams.get('workspaceId') || '';
    const graphOutDir = pageParams.get('outDir') || '';
    const tagCounts = new Map();
    rawNodes.forEach(node => (node.tags || []).forEach(tag => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)));
    const tagNodes = Array.from(tagCounts.entries()).map(([tag, count]) => ({
      id: 'tag:' + tag,
      label: '#' + tag,
      type: 'tag',
      relativePath: '',
      title: '#' + tag,
      status: 'tag',
      tags: [],
      degree: count,
      lineCount: 0
    }));
    const nodes = rawNodes.concat(tagNodes).map((node, index) => {
      const seed = hash(node.id);
      const angle = (seed % 6283) / 1000;
      const radius = (node.type === 'tag' ? 170 : 80) + (seed % 900) / 900 * (node.type === 'tag' ? 430 : 320);
      return {
        ...node,
        index,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        pinned: false,
        baseRadius: nodeRadius(node)
      };
    });
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const tagEdges = rawNodes.flatMap(node => (node.tags || []).map(tag => ({
      id: 'tag:' + tag + '->' + node.id,
      source: 'tag:' + tag,
      target: node.id,
      relation: 'tag',
      weight: 0.65,
      label: '#' + tag
    })));
    const edges = (graph.edges || []).concat(tagEdges)
      .map(edge => ({ ...edge, sourceNode: nodeById.get(edge.source), targetNode: nodeById.get(edge.target) }))
      .filter(edge => edge.sourceNode && edge.targetNode);
    const adjacency = new Map(nodes.map(node => [node.id, new Set([node.id])]));
    edges.forEach(edge => {
      adjacency.get(edge.source).add(edge.target);
      adjacency.get(edge.target).add(edge.source);
    });
    const rawSourceById = new Map((graph.rawSources || []).map(source => [source.id, source]));
    applyTheme(state.theme);
    warmStartLayout();
    initControls();
    resize();
    const requestedSelection = new URLSearchParams(window.location.search).get('select') || decodeURIComponent(window.location.hash.replace(/^#node=/, ''));
    const initialSelection = requestedSelection ? nodeById.get(requestedSelection) : null;
    if (initialSelection) selectNode(initialSelection, { notifySidebar: false });
    else updateDetail(nodes.find(node => node.type === 'overview') || nodes[0] || null);
    scheduleAutoFit();
    requestAnimationFrame(frame);
    window.addEventListener('resize', resize);
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => resize()).observe(canvas);
    }

    function initControls() {
      const typeOrder = ['source', 'concept', 'entity', 'question', 'tag', 'reference', 'meta', 'raw', 'missing', 'session', 'fold', 'decision', 'overview', 'domain', 'comparison', 'unknown'];
      document.getElementById('typeToggles').innerHTML = typeOrder
        .filter(type => nodes.some(node => node.type === type))
        .map(type => '<label class="toggle-row"><span><i class="dot" style="background:' + colorOf(type) + '"></i>' + labelOf(type) + '</span><input type="checkbox" data-type="' + type + '" checked /></label>')
        .join('');
      document.getElementById('typeToggles').addEventListener('change', event => {
        const input = event.target.closest('[data-type]');
        if (!input) return;
        if (input.checked) state.hiddenTypes.delete(input.dataset.type);
        else state.hiddenTypes.add(input.dataset.type);
        invalidateLocalScope();
        render();
      });
      document.getElementById('search').addEventListener('input', event => {
        state.query = event.target.value.trim().toLowerCase();
        render();
      });
      document.getElementById('showLabels').addEventListener('change', event => { state.showLabels = event.target.checked; render(); });
      document.getElementById('showLinks').addEventListener('change', event => { state.showLinks = event.target.checked; render(); });
      document.getElementById('showArrows').addEventListener('change', event => { state.showArrows = event.target.checked; render(); });
      document.getElementById('showTags').addEventListener('change', event => { state.showTags = event.target.checked; invalidateLocalScope(); updateDetail(state.selected || nodes.find(node => node.type === 'overview') || nodes[0] || null); resetView(); });
      document.getElementById('localOnly').addEventListener('change', event => { state.localOnly = event.target.checked; invalidateLocalScope(); resetView(); });
      document.getElementById('hideMissing').addEventListener('change', event => { state.hideMissing = event.target.checked; invalidateLocalScope(); resetView(); });
      bindRange('localDepth', 'localDepthValue', value => { state.localDepth = Number(value); invalidateLocalScope(); resetView(); }, value => String(value));
      bindRange('nodeSize', 'nodeSizeValue', value => { state.nodeSize = Number(value); render(); }, value => Number(value).toFixed(2));
      bindRange('labelThreshold', 'labelThresholdValue', value => { state.labelThreshold = Number(value); render(); }, value => Number(value).toFixed(2));
      bindRange('linkDistance', 'linkDistanceValue', value => { state.linkDistance = Number(value); heat(); }, value => String(value));
      bindRange('repelForce', 'repelForceValue', value => { state.repelForce = Number(value); heat(); }, value => String(value));
      bindRange('centerForce', 'centerForceValue', value => { state.centerForce = Number(value); heat(); }, value => String(value));
      bindRange('lineThickness', 'lineThicknessValue', value => { state.lineThickness = Number(value); render(); }, value => Number(value).toFixed(2));
      document.getElementById('zoomIn').addEventListener('click', () => zoomAt(state.width / 2, state.height / 2, 1.18));
      document.getElementById('zoomOut').addEventListener('click', () => zoomAt(state.width / 2, state.height / 2, 1 / 1.18));
      document.getElementById('resetView').addEventListener('click', resetView);
      document.getElementById('restart').addEventListener('click', () => { state.alpha = 1; state.running = true; });
      document.getElementById('themeToggle').addEventListener('click', toggleTheme);
      const floatingControls = document.querySelector('.floating-controls');
      document.getElementById('displayToggle').addEventListener('click', event => {
        event.stopPropagation();
        floatingControls.classList.toggle('adjusting');
      });
      document.getElementById('displayPopover').addEventListener('pointerdown', event => event.stopPropagation());
      document.addEventListener('pointerdown', event => {
        if (!floatingControls.contains(event.target)) floatingControls.classList.remove('adjusting');
      });
      document.getElementById('clearSelection').addEventListener('click', () => selectNode(null));
      document.getElementById('fitSelection').addEventListener('click', resetView);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointerleave', onPointerLeave);
      canvas.addEventListener('dblclick', resetView);
    }

    function bindRange(inputId, outputId, onValue, formatter) {
      const input = document.getElementById(inputId);
      const output = document.getElementById(outputId);
      const update = () => {
        output.textContent = formatter(input.value);
        onValue(input.value);
      };
      input.addEventListener('input', update);
      output.textContent = formatter(input.value);
    }

    function readTheme() {
      const requested = new URLSearchParams(window.location.search).get('theme');
      if (requested === 'light' || requested === 'dark') return requested;
      try {
        const saved = localStorage.getItem('notebookmr.graph.theme');
        if (saved === 'light' || saved === 'dark') return saved;
      } catch {
        // Local files can deny storage in some embedded webviews.
      }
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }

    function applyTheme(theme) {
      state.theme = theme === 'light' ? 'light' : 'dark';
      document.body.dataset.theme = state.theme;
      const button = document.getElementById('themeToggle');
      if (button) {
        button.textContent = state.theme === 'light' ? '☾' : '☼';
        button.title = state.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
      }
      try {
        localStorage.setItem('notebookmr.graph.theme', state.theme);
      } catch {
        // Ignore storage failures; the theme still applies for this session.
      }
      render();
    }

    function toggleTheme() {
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    }

    function themePalette() {
      return palettes[state.theme] || palettes.dark;
    }

    function warmStartLayout() {
      const savedAlpha = state.alpha;
      for (let index = 0; index < 150; index += 1) {
        state.alpha = Math.max(0.12, 1 - index / 150);
        tick(1);
      }
      state.alpha = Math.max(0.28, savedAlpha * 0.45);
      state.running = true;
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const previousWidth = state.width;
      const previousHeight = state.height;
      state.width = Math.max(1, rect.width);
      state.height = Math.max(1, rect.height);
      canvas.width = Math.floor(state.width * state.dpr);
      canvas.height = Math.floor(state.height * state.dpr);
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      const becameValid = (previousWidth < 64 || previousHeight < 64) && state.width >= 320 && state.height >= 260;
      const changedMeaningfully = Math.abs(state.width - state.lastFitWidth) > 80 || Math.abs(state.height - state.lastFitHeight) > 80;
      if (!state.userMoved && (state.autoFitPending || becameValid || (!state.hasAutoFitted && state.width >= 320 && state.height >= 260) || (state.hasAutoFitted && changedMeaningfully))) {
        scheduleAutoFit();
      } else {
        render();
      }
    }

    function scheduleAutoFit() {
      state.autoFitPending = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (state.userMoved) return;
          if (state.width < 320 || state.height < 260) return;
          resetView({ auto: true });
        });
      });
    }

    function frame(time) {
      const dt = Math.min(32, time - state.lastFrame || 16) / 16;
      state.lastFrame = time;
      if (state.running && state.alpha > 0.004) {
        tick(dt);
        render();
        state.alpha *= 0.985;
      }
      requestAnimationFrame(frame);
    }

    function tick(dt) {
      const alpha = state.alpha * dt;
      const visible = nodes.filter(isVisible);
      for (const edge of edges) {
        if (!isVisible(edge.sourceNode) || !isVisible(edge.targetNode)) continue;
        const source = edge.sourceNode;
        const target = edge.targetNode;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const desired = state.linkDistance * (edge.relation === 'raw-source' ? 1.28 : edge.relation === 'tag' ? 1.12 : 1);
        const force = (distance - desired) * 0.010 * alpha * Math.min(2.2, Math.max(0.45, edge.weight || 1));
        const ux = dx / distance;
        const uy = dy / distance;
        if (!source.pinned) { source.vx += ux * force; source.vy += uy * force; }
        if (!target.pinned) { target.vx -= ux * force; target.vy -= uy * force; }
      }
      for (let i = 0; i < visible.length; i += 1) {
        const a = visible[i];
        for (let j = i + 1; j < visible.length; j += 1) {
          const b = visible[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance2 = Math.max(36, dx * dx + dy * dy);
          const force = state.repelForce / distance2 * alpha;
          const distance = Math.sqrt(distance2);
          const ux = dx / distance;
          const uy = dy / distance;
          if (!a.pinned) { a.vx -= ux * force; a.vy -= uy * force; }
          if (!b.pinned) { b.vx += ux * force; b.vy += uy * force; }
        }
      }
      for (const node of visible) {
        const centerBase = Math.max(0, state.centerForce) / 10000;
        const centerForce = node.type === 'overview' || node.type === 'meta' ? centerBase * 2.65 : centerBase;
        if (!node.pinned) {
          node.vx += (0 - node.x) * centerForce * alpha;
          node.vy += (0 - node.y) * centerForce * alpha;
          node.vx *= 0.84;
          node.vy *= 0.84;
          node.x += node.vx;
          node.y += node.vy;
        }
      }
    }

    function render() {
      ctx.save();
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      ctx.clearRect(0, 0, state.width, state.height);
      drawBackground();
      ctx.translate(state.offsetX, state.offsetY);
      ctx.scale(state.scale, state.scale);
      drawLinks();
      drawNodes();
      ctx.restore();
      viewState.textContent = 'Scale ' + Math.round(state.scale * 100) + '%';
    }

    function drawBackground() {
      const colors = themePalette();
      const gradient = ctx.createRadialGradient(state.width * 0.5, state.height * 0.44, 0, state.width * 0.5, state.height * 0.44, Math.max(state.width, state.height) * 0.72);
      gradient.addColorStop(0, colors.backgroundInner);
      gradient.addColorStop(1, colors.backgroundOuter);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, state.width, state.height);
      ctx.globalAlpha = state.theme === 'light' ? 0.34 : 0.16;
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      const grid = 72 * state.scale;
      if (grid > 24) {
        const startX = state.offsetX % grid;
        const startY = state.offsetY % grid;
        for (let x = startX; x < state.width; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, state.height); ctx.stroke(); }
        for (let y = startY; y < state.height; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(state.width, y); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
    }

    function drawLinks() {
      if (!state.showLinks) return;
      const colors = themePalette();
      const related = state.selected ? adjacency.get(state.selected.id) : null;
      for (const edge of edges) {
        const source = edge.sourceNode;
        const target = edge.targetNode;
        if (!isVisible(source) || !isVisible(target)) continue;
        const hot = state.selected && (source.id === state.selected.id || target.id === state.selected.id);
        ctx.globalAlpha = related && !hot ? 0.06 : hot ? 0.95 : 0.28;
        ctx.strokeStyle = hot ? colors.linkHot : colors.link;
        ctx.lineWidth = ((hot ? 1.45 : 0.62) * state.lineThickness) / state.scale * Math.min(2.4, Math.max(0.8, edge.weight || 1));
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
        if (state.showArrows && (hot || state.scale > 0.72)) {
          drawArrowhead(source, target, hot);
        }
      }
      ctx.globalAlpha = 1;
    }

    function drawArrowhead(source, target, hot) {
      const colors = themePalette();
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const ux = dx / distance;
      const uy = dy / distance;
      const radius = target.baseRadius * state.nodeSize + 2 / state.scale;
      const tipX = target.x - ux * radius;
      const tipY = target.y - uy * radius;
      const size = (hot ? 6.8 : 5.2) / state.scale;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - ux * size - uy * size * 0.55, tipY - uy * size + ux * size * 0.55);
      ctx.lineTo(tipX - ux * size + uy * size * 0.55, tipY - uy * size - ux * size * 0.55);
      ctx.closePath();
      ctx.fillStyle = hot ? colors.linkHot : colors.link;
      ctx.fill();
    }

    function drawNodes() {
      const colors = themePalette();
      const related = state.selected ? adjacency.get(state.selected.id) : null;
      const hoveredRelated = state.hovered ? adjacency.get(state.hovered.id) : null;
      const visibleNodes = nodes.filter(isVisible).sort((a, b) => (a === state.selected ? 1 : 0) - (b === state.selected ? 1 : 0));
      const labelPlans = [];
      for (const node of visibleNodes) {
        const radius = node.baseRadius * state.nodeSize;
        const hot = (related && related.has(node.id)) || (hoveredRelated && hoveredRelated.has(node.id));
        const selected = state.selected && state.selected.id === node.id;
        const dim = (related && !hot) || !matchesQuery(node);
        ctx.globalAlpha = dim ? 0.16 : 1;
        ctx.fillStyle = colorOf(node.type);
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + (selected ? 8 : hot ? 5 : 0), 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(colorOf(node.type), selected ? 0.26 : hot ? 0.18 : 0.08);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = colorOf(node.type);
        ctx.fill();
        ctx.lineWidth = (selected ? 3 : hot ? 1.8 : 0.9) / state.scale;
        ctx.strokeStyle = selected ? colors.nodeSelectedStroke : hot ? colors.nodeHotStroke : colors.nodeStroke;
        ctx.stroke();
        if (state.showLabels && shouldShowLabel(node, selected, hot)) {
          labelPlans.push(createLabelPlan(node, radius, selected, hot));
        }
      }
      if (labelPlans.length) {
        drawLabelPlans(labelPlans);
      }
      ctx.globalAlpha = 1;
    }

    function createLabelPlan(node, radius, selected, hot) {
      const colors = themePalette();
      const text = node.label || node.title || node.id;
      const fontSize = Math.max(8.8, Math.min(11.2, 9.8 / Math.sqrt(Math.max(0.72, state.scale))));
      ctx.font = '400 ' + fontSize + 'px "Styrene B", "Styrene A", "Helvetica Neue", Arial, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
      const maxChars = state.scale > 1.25 ? 42 : state.scale > 0.85 ? 32 : 24;
      const label = shortenTitle(text, maxChars);
      const width = Math.ceil(ctx.measureText(label).width);
      const height = Math.ceil(fontSize * 1.35);
      return {
        node,
        label,
        fontSize,
        width,
        height,
        radius,
        selected,
        hot,
        colors,
        priority: labelPriority(node, selected, hot)
      };
    }

    function drawLabelPlans(plans) {
      const occupied = nodeObstacleRects();
      const sorted = plans
        .filter(Boolean)
        .sort((a, b) => b.priority - a.priority)
        .slice(0, Math.max(24, Math.min(72, Math.round(state.width / 16))));
      for (const plan of sorted) {
        const placement = findLabelPlacement(plan, occupied);
        if (!placement) continue;
        occupied.push(placement.rect);
        drawLabel(plan, placement);
      }
    }

    function nodeObstacleRects() {
      return nodes
        .filter(node => isVisible(node) && (node === state.selected || node === state.hovered || node.baseRadius * state.nodeSize >= 13))
        .map(node => {
          const radius = (node.baseRadius * state.nodeSize + 2 / state.scale) * state.scale;
          const x = node.x * state.scale + state.offsetX;
          const y = node.y * state.scale + state.offsetY;
          return {
            x: x - radius,
            y: y - radius,
            width: radius * 2,
            height: radius * 2
          };
        });
    }

    function findLabelPlacement(plan, occupied) {
      const gap = 8 / state.scale;
      const node = plan.node;
      const midX = node.x * state.scale + state.offsetX;
      const preferLeft = midX > state.width * 0.62;
      const primary = preferLeft ? 'left' : 'right';
      const secondary = preferLeft ? 'right' : 'left';
      const candidates = [
        primary,
        primary + '-top',
        primary + '-bottom',
        'top',
        'bottom',
        secondary,
        secondary + '-top',
        secondary + '-bottom',
      ];
      for (const side of candidates) {
        const placement = labelPlacementForSide(plan, side, gap);
        if (!placement) continue;
        if (placement.rect.x < 6 || placement.rect.y < 6 || placement.rect.x + placement.rect.width > state.width - 6 || placement.rect.y + placement.rect.height > state.height - 6) {
          continue;
        }
        if (!occupied.some(rect => rectsIntersect(rect, placement.rect))) {
          return placement;
        }
      }
      if (plan.selected || state.hovered === plan.node) {
        return labelPlacementForSide(plan, preferLeft ? 'left' : 'right', gap);
      }
      return null;
    }

    function labelPlacementForSide(plan, side, gap) {
      const node = plan.node;
      const pad = 3 / state.scale;
      let x = node.x + plan.radius + gap;
      let y = node.y + plan.fontSize * 0.34 / state.scale;
      if (side.startsWith('left')) {
        x = node.x - plan.radius - gap - plan.width;
      }
      if (side === 'top') {
        x = node.x - plan.width / 2;
        y = node.y - plan.radius - gap;
      } else if (side === 'bottom') {
        x = node.x - plan.width / 2;
        y = node.y + plan.radius + gap + plan.height;
      } else if (side.endsWith('-top')) {
        y = node.y - plan.radius - gap;
      } else if (side.endsWith('-bottom')) {
        y = node.y + plan.radius + gap + plan.height;
      }
      return {
        x,
        y,
        rect: {
          x: (x - pad) * state.scale + state.offsetX,
          y: (y - plan.height - pad) * state.scale + state.offsetY,
          width: (plan.width + pad * 2) * state.scale,
          height: (plan.height + pad * 2) * state.scale
        }
      };
    }

    function rectsIntersect(a, b) {
      return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    }

    function labelPriority(node, selected, hot) {
      if (selected) return 10000;
      if (state.hovered === node) return 9500;
      if (hot) return 8600 + (node.degree || 0);
      if (node.type === 'overview') return 8000;
      const typeBoost = { source: 900, concept: 720, entity: 680, question: 540, comparison: 480, reference: 360, meta: 300 };
      return (typeBoost[node.type] || 0) + (node.degree || 0) * 12 + Math.min(80, node.lineCount || 0);
    }

    function drawLabel(plan, placement) {
      const colors = plan.colors || themePalette();
      const node = plan.node;
      const label = plan.label;
      const x = placement.x;
      const y = placement.y;
      ctx.save();
      ctx.font = '400 ' + plan.fontSize + 'px "Styrene B", "Styrene A", "Helvetica Neue", Arial, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.2 / state.scale;
      ctx.strokeStyle = colors.labelHalo;
      ctx.strokeText(label, x, y);
      ctx.fillStyle = node.type === 'source' ? colors.sourceLabelText : colors.labelText;
      ctx.fillText(label, x, y);
      ctx.restore();
    }

    function shouldShowLabel(node, selected, hot) {
      if (selected || hot || state.hovered === node) return true;
      if (state.selected) return false;
      if (state.scale < 0.82) return false;
      if (node.type === 'missing' || node.type === 'raw') return false;
      const threshold = state.labelThreshold;
      if (node.type === 'source') return (node.degree || 0) >= 2 * threshold || state.scale >= 1.15 * threshold;
      if (node.type === 'overview') return true;
      if (node.type === 'concept' || node.type === 'entity') return (node.degree || 0) >= 8 * threshold || state.scale >= 1.25 * threshold;
      return (node.degree || 0) >= 14 * threshold || state.scale >= 1.55 * threshold;
    }

    function roundRect(x, y, width, height, radius) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + width, y, x + width, y + height, radius);
      ctx.arcTo(x + width, y + height, x, y + height, radius);
      ctx.arcTo(x, y + height, x, y, radius);
      ctx.arcTo(x, y, x + width, y, radius);
      ctx.closePath();
    }

    function onWheel(event) {
      event.preventDefault();
      state.userMoved = true;
      zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0011));
    }

    function zoomAt(clientX, clientY, factor) {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const before = screenToWorld(x, y);
      state.scale = Math.max(0.18, Math.min(4.5, state.scale * factor));
      state.offsetX = x - before.x * state.scale;
      state.offsetY = y - before.y * state.scale;
      render();
    }

    function resetView(options = {}) {
      const visible = nodes.filter(isVisible);
      if (visible.length === 0) {
        state.scale = 1;
        state.offsetX = state.width / 2;
        state.offsetY = state.height / 2;
        if (options.auto) markAutoFitted();
        render();
        return;
      }
      const bounds = visible.reduce((acc, node) => ({
        minX: Math.min(acc.minX, node.x),
        maxX: Math.max(acc.maxX, node.x),
        minY: Math.min(acc.minY, node.y),
        maxY: Math.max(acc.maxY, node.y)
      }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
      const core = visible.filter(node =>
        (node.degree || 0) >= 2 &&
        node.type !== 'missing' &&
        node.type !== 'raw' &&
        node.type !== 'tag'
      );
      const centerNodes = core.length >= 6 ? core : visible;
      const weighted = centerNodes.reduce((acc, node) => {
        const weight = 1 + Math.sqrt(Math.max(1, node.degree || 1));
        return {
          x: acc.x + node.x * weight,
          y: acc.y + node.y * weight,
          weight: acc.weight + weight
        };
      }, { x: 0, y: 0, weight: 0 });
      const centerX = weighted.weight ? weighted.x / weighted.weight : (bounds.minX + bounds.maxX) / 2;
      const centerY = weighted.weight ? weighted.y / weighted.weight : (bounds.minY + bounds.maxY) / 2;
      const graphWidth = Math.max(200, bounds.maxX - bounds.minX);
      const graphHeight = Math.max(200, bounds.maxY - bounds.minY);
      state.scale = Math.max(0.35, Math.min(1.8, Math.min(state.width / graphWidth, state.height / graphHeight) * 0.74));
      state.offsetX = state.width / 2 - centerX * state.scale;
      state.offsetY = state.height / 2 - centerY * state.scale;
      if (options.auto) markAutoFitted();
      render();
    }

    function markAutoFitted() {
      state.autoFitPending = false;
      state.hasAutoFitted = true;
      state.lastFitWidth = state.width;
      state.lastFitHeight = state.height;
    }

    function onPointerDown(event) {
      if (event.button !== undefined && event.button !== 0) return;
      canvas.setPointerCapture(event.pointerId);
      const point = eventPoint(event);
      const node = findNode(point.x, point.y);
      if (node) {
        state.userMoved = true;
        state.draggingNode = node;
        state.downPoint = point;
        state.dragMoved = false;
        node.pinned = true;
        const world = screenToWorld(point.x, point.y);
        node.x = world.x;
        node.y = world.y;
        state.alpha = Math.max(state.alpha, 0.35);
        state.running = true;
      } else {
        state.userMoved = true;
        state.panning = true;
        state.downPoint = point;
        state.panMoved = false;
        state.pointer = point;
        canvas.classList.add('dragging');
      }
    }

    function onPointerMove(event) {
      const point = eventPoint(event);
      if (state.draggingNode) {
        if (state.downPoint && Math.hypot(point.x - state.downPoint.x, point.y - state.downPoint.y) > 4) {
          state.dragMoved = true;
        }
        const world = screenToWorld(point.x, point.y);
        state.draggingNode.x = world.x;
        state.draggingNode.y = world.y;
        render();
        return;
      }
      if (state.panning && state.pointer) {
        if (state.downPoint && Math.hypot(point.x - state.downPoint.x, point.y - state.downPoint.y) > 4) {
          state.panMoved = true;
        }
        state.offsetX += point.x - state.pointer.x;
        state.offsetY += point.y - state.pointer.y;
        state.pointer = point;
        render();
        return;
      }
      const node = findNode(point.x, point.y);
      if (node !== state.hovered) {
        state.hovered = node;
        render();
      }
      if (node) showTooltip(event, node);
      else hideTooltip();
    }

    function onPointerUp(event) {
      if (event.button !== undefined && event.button !== 0) return;
      if (state.draggingNode) {
        const clickedNode = state.draggingNode;
        if (!state.dragMoved) {
          selectNode(clickedNode);
        }
        state.draggingNode.pinned = false;
        state.draggingNode = null;
      } else if (!state.panning) {
        selectNode(findNode(eventPoint(event).x, eventPoint(event).y));
      } else {
        const node = findNode(eventPoint(event).x, eventPoint(event).y);
        if (!state.panMoved) {
          selectNode(node || null);
        } else if (node && state.pointer) {
          selectNode(node);
        }
      }
      state.panning = false;
      state.pointer = null;
      state.downPoint = null;
      state.dragMoved = false;
      state.panMoved = false;
      canvas.classList.remove('dragging');
    }

    function onPointerLeave() {
      state.hovered = null;
      hideTooltip();
      if (!state.draggingNode) render();
    }

    function eventPoint(event) {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function screenToWorld(x, y) {
      return { x: (x - state.offsetX) / state.scale, y: (y - state.offsetY) / state.scale };
    }

    function findNode(screenX, screenY) {
      const world = screenToWorld(screenX, screenY);
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const node = nodes[i];
        if (!isVisible(node) || !matchesQuery(node)) continue;
        const radius = node.baseRadius * state.nodeSize + 5 / state.scale;
        if (Math.hypot(world.x - node.x, world.y - node.y) <= radius) return node;
      }
      return null;
    }

    function selectNode(node, options = {}) {
      state.selected = node || null;
      invalidateLocalScope();
      updateDetail(node);
      render();
      if (node && options.notifySidebar !== false) {
        postGraphNodeContextToSidebar(node);
      } else if (!node && options.notifySidebar !== false) {
        postGraphNodeContextClearToSidebar();
      }
    }

    function updateDetail(node) {
      if (!node) {
        detail.innerHTML =
          '<div class="eyebrow">Global Graph</div>' +
          '<h2>全局图谱</h2>' +
          '<div class="meta-row"><span>点击节点查看详情</span><span>hover 显示完整标题</span><span>可切换 Local graph</span></div>';
        return;
      }
      const linkedEdges = edges
        .filter(edge => edge.source === node.id || edge.target === node.id)
        .filter(edge => state.showTags || edge.relation !== 'tag')
        .sort((a, b) => (b.weight || 0) - (a.weight || 0));
      const outgoingEdges = linkedEdges
        .filter(edge => edge.source === node.id)
        .sort((a, b) => relationRank(a.targetNode.type) - relationRank(b.targetNode.type) || (b.targetNode.degree || 0) - (a.targetNode.degree || 0));
      const incomingEdges = linkedEdges
        .filter(edge => edge.target === node.id)
        .sort((a, b) => relationRank(a.sourceNode.type) - relationRank(b.sourceNode.type) || (b.sourceNode.degree || 0) - (a.sourceNode.degree || 0));
      const neighbors = uniqueNodes(linkedEdges.map(edge => edge.source === node.id ? edge.targetNode : edge.sourceNode))
        .sort((a, b) => relationRank(a.type) - relationRank(b.type) || (b.degree || 0) - (a.degree || 0));
      const tags = (node.tags || []).slice(0, 10);
      const pathValue = node.relativePath || node.id;
      const title = node.label || node.title || node.id;
      const pdfSource = findOriginalPdfForNode(node);
      detail.innerHTML =
        '<div class="detail-title-row">' +
          '<div class="detail-type"><i class="dot" style="background:' + colorOf(node.type) + '"></i>' + escapeHtml(labelOf(node.type)) + '</div>' +
          '<h2>' + escapeHtml(title) + '</h2>' +
          '<div class="meta-row"><span>' + escapeHtml(node.status || 'no status') + '</span><span>' + escapeHtml(String(node.degree || 0)) + ' graph links</span><span>' + escapeHtml(String(outgoingEdges.length)) + ' outgoing</span><span>' + escapeHtml(String(incomingEdges.length)) + ' backlinks</span><span>' + escapeHtml(String(node.lineCount || 0)) + ' lines</span></div>' +
        '</div>' +
        '<div class="detail-actions">' +
          '<button class="text-button" data-action="copy-path">Copy path</button>' +
          '<button class="text-button" data-action="local-graph">Local graph</button>' +
        '</div>' +
        '<div class="detail-section path-box"><div class="section-title">Path</div><code>' + escapeHtml(pathValue) + '</code><div class="copy-state" id="copyState"></div></div>' +
        (pdfSource?.path ? '<div class="detail-section path-box"><div class="section-title">Original PDF</div><a class="text-button detail-file-link detail-open-pdf-button" href="#" data-action="open-pdf" title="' + escapeHtml(pdfSource.path) + '">打开工作区 PDF · ' + escapeHtml(pdfSource.label || pdfSource.path) + '</a></div>' : '') +
        '<div class="detail-section"><div class="section-title">Properties</div><div class="property-grid">' +
          '<div class="property"><b>' + escapeHtml(labelOf(node.type)) + '</b><span>type</span></div>' +
          '<div class="property"><b>' + escapeHtml(String(neighbors.length)) + '</b><span>unique neighbors</span></div>' +
          '<div class="property"><b>' + escapeHtml(String(outgoingEdges.length)) + '</b><span>outgoing links</span></div>' +
          '<div class="property"><b>' + escapeHtml(String(incomingEdges.length)) + '</b><span>backlinks</span></div>' +
          '<div class="property"><b>' + escapeHtml(String(tags.length)) + '</b><span>tags</span></div>' +
        '</div></div>' +
        (tags.length ? '<div class="detail-section"><div class="section-title">Tags</div><div class="tag-list">' + tags.map(tag => '<span class="tag">' + escapeHtml(tag) + '</span>').join('') + '</div></div>' : '') +
        renderNeighborGroup('Outgoing links', outgoingEdges.map(edge => edge.targetNode), 'This file mentions') +
        renderNeighborGroup('Backlinks', incomingEdges.map(edge => edge.sourceNode), 'Files mentioning this');
      detail.querySelectorAll('[data-id]').forEach(button => button.addEventListener('click', () => selectNode(nodeById.get(button.getAttribute('data-id')))));
      detail.querySelector('[data-action="copy-path"]')?.addEventListener('click', async () => {
        const copyState = document.getElementById('copyState');
        try {
          await navigator.clipboard.writeText(pathValue);
          if (copyState) copyState.textContent = 'Path copied.';
        } catch {
          if (copyState) copyState.textContent = 'Clipboard unavailable. Select the path manually.';
        }
      });
      detail.querySelector('[data-action="local-graph"]')?.addEventListener('click', () => {
        state.localOnly = true;
        document.getElementById('localOnly').checked = true;
        invalidateLocalScope();
        resetView();
      });
      detail.querySelector('[data-action="open-pdf"]')?.addEventListener('click', event => {
        event.preventDefault();
        const source = findOriginalPdfForNode(node);
        if (!source?.path) return;
        window.parent?.postMessage({
          type: 'notebookmr:open-document',
          payload: {
            workspaceId,
            sourcePath: source.path,
            title: source.label || title,
            sourceTitle: source.label || '',
            sourceNodeTitle: title,
            sourceNodeId: node.id,
            sourceNodePath: node.relativePath || node.id
          }
        }, '*');
      });
    }

    function postGraphNodeContextToSidebar(node) {
      if (!shouldPostGraphNodeContext(node)) return;
      const relatedNodes = relatedNodesForGraphNode(node);
      const sourceNodes = [
        ...(node.type === 'source' ? [node] : []),
        ...relatedNodes.filter(item => item.type === 'source'),
      ];
      window.parent?.postMessage({
        type: 'notebookmr:graph-concept-query',
        payload: {
          workspaceId,
          outDir: graphOutDir,
          vaultDir: graph.rootDir || '',
          node: serializeGraphNode(node),
          concept: serializeGraphNode(node),
          relatedNodes: relatedNodes.map(serializeGraphNode),
          sourceNodes: uniqueNodes(sourceNodes).map(serializeGraphNode)
        }
      }, '*');
    }

    function postGraphNodeContextClearToSidebar() {
      window.parent?.postMessage({
        type: 'notebookmr:graph-context-clear',
        payload: {
          workspaceId,
          outDir: graphOutDir,
          vaultDir: graph.rootDir || ''
        }
      }, '*');
    }

    function shouldPostGraphNodeContext(node) {
      if (!node) return false;
      return ['source', 'concept', 'entity', 'comparison', 'domain', 'question', 'reference', 'overview', 'meta'].includes(node.type);
    }

    function relatedNodesForGraphNode(node) {
      const ids = Array.from(adjacency.get(node.id) || []).filter(id => id !== node.id);
      const allowedTypes = new Set(['concept', 'entity', 'source', 'comparison', 'domain', 'question', 'reference', 'overview', 'meta']);
      return ids
        .map(id => nodeById.get(id))
        .filter(item => item && allowedTypes.has(item.type))
        .sort((left, right) => relationRank(left.type) - relationRank(right.type) || (right.degree || 0) - (left.degree || 0) || String(left.label || left.id).localeCompare(String(right.label || right.id)))
        .slice(0, 60);
    }

    function serializeGraphNode(node) {
      return {
        id: node.id,
        label: node.label || node.title || node.id,
        title: node.title || node.label || node.id,
        type: node.type,
        relativePath: node.relativePath || '',
        status: node.status || '',
        degree: node.degree || 0,
        lineCount: node.lineCount || 0,
        tags: Array.isArray(node.tags) ? node.tags.slice(0, 12) : []
      };
    }

    function findOriginalPdfForNode(node) {
      if (!node) return null;
      if (node.type === 'raw' && /\.pdf$/i.test(node.relativePath || node.id)) {
        const rawSource = rawSourceById.get(node.id);
        return {
          path: rawSource?.absolutePath || resolveVaultPath(node.relativePath || node.id),
          label: rawSource?.fileName || node.label || node.title || node.id
        };
      }
      const linkedPdf = edges
        .filter(edge => edge.relation === 'raw-source' && (edge.source === node.id || edge.target === node.id))
        .map(edge => edge.source === node.id ? edge.targetNode : edge.sourceNode)
        .find(item => item && /\.pdf$/i.test(item.relativePath || item.id));
      if (!linkedPdf) return null;
      const rawSource = rawSourceById.get(linkedPdf.id);
      return {
        path: rawSource?.absolutePath || resolveVaultPath(linkedPdf.relativePath || linkedPdf.id),
        label: rawSource?.fileName || linkedPdf.label || linkedPdf.title || linkedPdf.id
      };
    }

    function resolveVaultPath(relativePath) {
      const root = String(graph.rootDir || '').replace(/[\\/]+$/g, '');
      if (!root || !relativePath) return relativePath || '';
      const separator = root.includes('\\') ? '\\' : '/';
      return root + separator + String(relativePath).replace(/[\\/]+/g, separator);
    }

    function uniqueNodes(inputNodes) {
      const seen = new Set();
      const output = [];
      for (const node of inputNodes) {
        if (!node || seen.has(node.id)) continue;
        seen.add(node.id);
        output.push(node);
      }
      return output;
    }

    function renderNeighborGroup(title, inputNodes, caption) {
      const list = uniqueNodes(inputNodes).slice(0, 9);
      return '<div class="detail-section neighbor-section">' +
        '<div class="neighbor-section-head"><b>' + escapeHtml(title) + '</b><span>' + escapeHtml(String(inputNodes.length)) + ' total</span></div>' +
        (list.length
          ? '<div class="neighbors">' + list.map(neighbor => '<button class="neighbor" data-id="' + escapeHtml(neighbor.id) + '"><b>' + escapeHtml(neighbor.label || neighbor.title || neighbor.id) + '</b><small>' + escapeHtml(caption) + ' · ' + escapeHtml(labelOf(neighbor.type)) + ' · ' + escapeHtml(String(neighbor.degree || 0)) + ' links · ' + escapeHtml(neighbor.relativePath || neighbor.id) + '</small></button>').join('') + '</div>'
          : '<div class="meta-row"><span>没有连接</span></div>') +
      '</div>';
    }

    function showTooltip(event, node) {
      tooltip.style.display = 'block';
      tooltip.innerHTML = '<b>' + escapeHtml(node.label || node.title || node.id) + '</b><span>' + escapeHtml(labelOf(node.type)) + ' · ' + escapeHtml(String(node.degree || 0)) + ' links · ' + escapeHtml(node.status || 'no status') + '</span><span>' + escapeHtml(node.relativePath || node.id) + '</span>';
      const rect = canvas.getBoundingClientRect();
      tooltip.style.left = Math.min(rect.width - 390, event.clientX - rect.left + 16) + 'px';
      tooltip.style.top = Math.max(18, event.clientY - rect.top + 16) + 'px';
    }

    function hideTooltip() {
      tooltip.style.display = 'none';
    }

    function isVisible(node) {
      if (node.type === 'tag' && !state.showTags) return false;
      if (state.hideMissing && node.type === 'missing') return false;
      const scope = currentLocalScope();
      if (scope && !scope.has(node.id)) return false;
      return !state.hiddenTypes.has(node.type);
    }

    function currentLocalScope() {
      if (!state.localOnly || !state.selected) return null;
      const key = state.selected.id + ':' + state.localDepth;
      if (state.localScope && state.localScopeKey === key) return state.localScope;
      const scope = new Set([state.selected.id]);
      let frontier = new Set([state.selected.id]);
      for (let depth = 0; depth < state.localDepth; depth += 1) {
        const next = new Set();
        for (const id of frontier) {
          const linked = adjacency.get(id);
          if (!linked) continue;
          for (const target of linked) {
            if (scope.has(target)) continue;
            scope.add(target);
            next.add(target);
          }
        }
        frontier = next;
      }
      state.localScope = scope;
      state.localScopeKey = key;
      return scope;
    }

    function invalidateLocalScope() {
      state.localScope = null;
      state.localScopeKey = '';
    }

    function matchesQuery(node) {
      return !state.query || searchableText(node).includes(state.query);
    }

    function searchableText(node) {
      return [node.id, node.label, node.title, node.relativePath, node.type, ...(node.tags || [])].join(' ').toLowerCase();
    }

    function heat() {
      state.alpha = Math.max(state.alpha, 0.45);
      state.running = true;
    }

    function shortenTitle(value, maxChars) {
      const normalized = String(value || '').replace(/\s+/g, ' ').trim();
      if (normalized.length <= maxChars) return normalized;
      const separators = [' — ', ': ', ' - ', ' | '];
      for (const separator of separators) {
        const index = normalized.indexOf(separator);
        if (index > 8 && index < maxChars) return normalized.slice(0, index) + '…';
      }
      return normalized.slice(0, Math.max(4, maxChars - 1)) + '…';
    }

    function relationRank(type) {
      const ranks = { source: 1, concept: 2, entity: 3, tag: 4, overview: 5, meta: 6, question: 7, comparison: 8, reference: 9, decision: 10, session: 11, fold: 12, raw: 13, missing: 14 };
      return ranks[type] || 99;
    }

    function nodeRadius(node) {
      const degree = Math.max(1, node.degree || 1);
      const typeBoost = node.type === 'overview' ? 2.6 : node.type === 'source' ? 1.35 : node.type === 'tag' ? 0.9 : node.type === 'missing' || node.type === 'raw' ? 0.72 : 1;
      return Math.max(3.5, Math.min(14, (3.6 + Math.sqrt(degree) * 1.7) * typeBoost));
    }

    function hash(value) {
      let h = 2166136261;
      for (let i = 0; i < value.length; i += 1) {
        h ^= value.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    }

    function colorOf(type) {
      return typeColors[type] || typeColors.unknown || '#8b8b7f';
    }

    function labelOf(type) {
      return typeLabels[type] || typeLabels.unknown || type;
    }

    function hexToRgba(hex, alpha) {
      const clean = hex.replace('#', '');
      const value = parseInt(clean.length === 3 ? clean.split('').map(char => char + char).join('') : clean, 16);
      const r = (value >> 16) & 255;
      const g = (value >> 8) & 255;
      const b = value & 255;
      return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
    }
  </script>
</body>
</html>`;
}

export function renderClaudeWikiGraphHtml(graph: ClaudeWikiGraph, title: string): string {
  const typeLabelsJson = safeJsonForScript(TYPE_LABELS);
  const typeColorsJson = safeJsonForScript(TYPE_COLORS);
  const graphJson = safeJsonForScript(graph);
  return buildObsidianGraphHtml(graph, title, graphJson, typeLabelsJson, typeColorsJson);
  return String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --ink: #17322d;
      --muted: #6b7773;
      --paper: #fffaf0;
      --paper-2: #f1eadc;
      --line: rgba(36, 55, 51, 0.13);
      --panel: rgba(255, 252, 244, 0.82);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 12% 10%, rgba(62, 156, 134, 0.10), transparent 28%),
        radial-gradient(circle at 90% 12%, rgba(216, 137, 72, 0.10), transparent 22%),
        linear-gradient(135deg, #f5efe3, #edf4ee);
      color: var(--ink);
      font-family: Georgia, "Times New Roman", "Noto Serif SC", serif;
    }
    .app {
      display: grid;
      grid-template-columns: 1fr 340px;
      gap: 16px;
      height: 100vh;
      padding: 16px;
    }
    .map-shell,
    .side {
      border: 1px solid rgba(43, 62, 58, 0.12);
      border-radius: 28px;
      background: var(--panel);
      box-shadow: 0 22px 54px rgba(45, 57, 54, 0.14);
      overflow: hidden;
    }
    .map-shell {
      display: grid;
      grid-template-rows: auto 1fr;
      min-width: 0;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 20px 12px;
      border-bottom: 1px solid rgba(31, 55, 50, 0.10);
    }
    h1, h2, h3 { margin: 0; letter-spacing: -0.025em; }
    h1 { font-size: 28px; }
    .subtitle { margin-top: 6px; color: var(--muted); font-size: 14px; }
    .legend { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; max-width: 470px; }
    .legend button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid rgba(31, 55, 50, 0.08);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.66);
      color: #394c48;
      padding: 7px 10px;
      font: 700 12px system-ui, sans-serif;
      cursor: pointer;
    }
    .legend button.off { opacity: 0.38; }
    .legend i { width: 10px; height: 10px; border-radius: 999px; }
    .stage { position: relative; min-height: 0; padding: 14px; }
    svg { width: 100%; height: 100%; min-height: 620px; display: block; border-radius: 24px; }
    .bg { fill: url(#paper); stroke: rgba(31, 55, 50, 0.08); }
    .zone ellipse {
      fill: rgba(255, 255, 255, 0.24);
      stroke: currentColor;
      stroke-dasharray: 8 9;
      stroke-width: 1;
      opacity: 0.25;
    }
    .zone text {
      fill: currentColor;
      font: 800 10px system-ui, sans-serif;
      letter-spacing: 0.14em;
      opacity: 0.64;
      text-transform: uppercase;
    }
    .edge {
      fill: none;
      stroke: rgba(62, 78, 74, 0.115);
      stroke-linecap: round;
      transition: opacity 160ms ease, stroke 160ms ease, stroke-width 160ms ease;
    }
    .edge.dim { opacity: 0.08; }
    .edge.hot { opacity: 1; stroke: rgba(31, 55, 50, 0.48); }
    .node { cursor: pointer; transition: opacity 160ms ease, transform 160ms ease; }
    .node.dim { opacity: 0.14; }
    .node:hover, .node.selected { transform: scale(1.06); }
    .node .halo { opacity: 0.10; }
    .node.hot .halo { opacity: 0.22; }
    .node.selected .halo { opacity: 0.30; }
    .node .core {
      stroke: rgba(255, 250, 240, 0.72);
      stroke-width: 1.5px;
      filter: drop-shadow(0 7px 7px rgba(38, 63, 70, 0.14));
    }
    .node.raw .core,
    .node.missing .core { opacity: 0.68; }
    .node.selected .core { stroke: #fff8ed; stroke-width: 4px; }
    .label-card { pointer-events: none; }
    .label-card rect {
      fill: rgba(255, 252, 244, 0.94);
      stroke: rgba(31, 55, 50, 0.13);
      filter: drop-shadow(0 10px 12px rgba(38, 63, 70, 0.08));
    }
    .label-card text {
      fill: #263531;
      font: 760 11px Georgia, "Noto Serif SC", serif;
      letter-spacing: -0.01em;
    }
    .tooltip {
      position: absolute;
      display: none;
      max-width: 360px;
      border: 1px solid rgba(31, 55, 50, 0.12);
      border-radius: 16px;
      background: rgba(255, 252, 244, 0.96);
      box-shadow: 0 18px 36px rgba(45, 57, 54, 0.18);
      padding: 12px 14px;
      pointer-events: none;
      z-index: 5;
    }
    .tooltip b { display: block; margin-bottom: 5px; }
    .tooltip span { display: block; color: var(--muted); font: 700 12px system-ui, sans-serif; }
    .side {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 16px;
      overflow: auto;
    }
    .card {
      border: 1px solid rgba(31, 55, 50, 0.10);
      border-radius: 22px;
      background: rgba(255, 255, 255, 0.60);
      padding: 16px;
    }
    .eyebrow {
      margin-bottom: 8px;
      color: #8a6b3c;
      font: 800 11px system-ui, sans-serif;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .stat {
      display: grid;
      gap: 4px;
      border-radius: 16px;
      background: rgba(31, 55, 50, 0.06);
      padding: 12px;
    }
    .stat b { font-size: 20px; }
    .stat span, .meta-row, .neighbor small, code { color: var(--muted); }
    code {
      display: block;
      overflow-wrap: anywhere;
      border-radius: 14px;
      background: rgba(31, 55, 50, 0.08);
      padding: 10px;
    }
    .detail { display: grid; gap: 12px; }
    .meta-row { display: flex; flex-wrap: wrap; gap: 7px; font: 700 12px system-ui, sans-serif; }
    .meta-row span {
      border-radius: 999px;
      background: rgba(31, 55, 50, 0.08);
      padding: 6px 9px;
    }
    .neighbors { display: grid; gap: 8px; }
    .neighbor {
      width: 100%;
      border: 1px solid rgba(31, 55, 50, 0.08);
      border-radius: 15px;
      background: rgba(255, 255, 255, 0.58);
      color: var(--ink);
      padding: 10px;
      text-align: left;
      cursor: pointer;
    }
    .neighbor b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .search {
      width: 100%;
      border: 1px solid rgba(31, 55, 50, 0.12);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.82);
      color: var(--ink);
      padding: 12px 14px;
      font: 700 13px system-ui, sans-serif;
      outline: none;
    }
    @media (max-width: 1100px) {
      .app { grid-template-columns: 1fr; height: auto; }
      .side { max-height: none; }
      svg { height: 680px; }
    }
  </style>
</head>
<body>
  <div class="app">
    <main class="map-shell">
      <header>
        <div>
          <h1>${escapeHtml(title)}</h1>
          <div class="subtitle">${graph.summary.pageCount} pages · ${graph.summary.nodeCount} nodes · ${graph.summary.edgeCount} links · standalone wiki webview</div>
        </div>
        <div class="legend" id="legend"></div>
      </header>
      <div class="stage">
        <svg id="graph" viewBox="0 0 1400 900" role="img" aria-label="NotebookMR standalone LLM wiki graph">
          <defs>
            <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#fffaf0"></stop>
              <stop offset="1" stop-color="#f0eadc"></stop>
            </linearGradient>
          </defs>
        </svg>
        <div class="tooltip" id="tooltip"></div>
      </div>
    </main>
    <aside class="side">
      <section class="card">
        <div class="eyebrow">Search</div>
        <input class="search" id="search" placeholder="搜索文章、概念、实体..." />
      </section>
      <section class="card stats">
        <div class="stat"><b>${graph.summary.pageCount}</b><span>wiki pages</span></div>
        <div class="stat"><b>${graph.summary.rawSourceCount}</b><span>raw files</span></div>
        <div class="stat"><b>${graph.summary.edgeCount}</b><span>wikilinks</span></div>
        <div class="stat"><b>${graph.summary.missingTargetCount}</b><span>missing</span></div>
      </section>
      <section class="card detail" id="detail">
        <div class="eyebrow">Selected Node</div>
        <h2>点击一个节点</h2>
        <p class="meta-row">文章名默认不塞进圆点；hover 看完整标题，点击看详情。</p>
      </section>
    </aside>
  </div>
  <script id="graph-data" type="application/json">${graphJson}</script>
  <script>
    const graph = JSON.parse(document.getElementById('graph-data').textContent);
    const typeLabels = ${typeLabelsJson};
    const typeColors = ${typeColorsJson};
    const svg = document.getElementById('graph');
    const tooltip = document.getElementById('tooltip');
    const detail = document.getElementById('detail');
    const search = document.getElementById('search');
    const state = { selected: null, query: '', hiddenTypes: new Set() };
    const anchors = {
      overview: { x: 690, y: 438, label: 'Wiki Core' },
      meta: { x: 690, y: 438, label: 'Wiki Core' },
      concept: { x: 455, y: 318, label: 'Concepts' },
      source: { x: 920, y: 520, label: 'Sources' },
      entity: { x: 930, y: 305, label: 'Entities' },
      question: { x: 455, y: 610, label: 'Questions' },
      comparison: { x: 455, y: 610, label: 'Questions' },
      session: { x: 680, y: 685, label: 'Sessions' },
      fold: { x: 680, y: 685, label: 'Sessions' },
      reference: { x: 260, y: 205, label: 'References' },
      decision: { x: 260, y: 205, label: 'References' },
      domain: { x: 275, y: 440, label: 'Domains' },
      raw: { x: 1170, y: 640, label: 'Raw' },
      missing: { x: 1160, y: 210, label: 'Unresolved' },
      unknown: { x: 225, y: 190, label: 'Other' }
    };
    const zoneDefs = [
      ['reference', 138, 96],
      ['concept', 160, 128],
      ['entity', 165, 122],
      ['source', 190, 135],
      ['question', 158, 112],
      ['missing', 160, 98]
    ];
    const shownLegendTypes = ['source', 'concept', 'entity', 'question', 'reference', 'raw', 'meta', 'missing'];
    const nodeById = new Map();
    const nodes = layoutNodes(graph.nodes || []);
    nodes.forEach(node => nodeById.set(node.id, node));
    const edges = (graph.edges || []).map(edge => ({ ...edge, sourceNode: nodeById.get(edge.source), targetNode: nodeById.get(edge.target) })).filter(edge => edge.sourceNode && edge.targetNode);
    const adjacency = new Map(nodes.map(node => [node.id, new Set([node.id])]));
    edges.forEach(edge => {
      adjacency.get(edge.source).add(edge.target);
      adjacency.get(edge.target).add(edge.source);
    });
    renderLegend();
    renderGraph();
    updateDetail(nodes.find(node => node.type === 'overview') || nodes[0] || null);

    search.addEventListener('input', () => {
      state.query = search.value.trim().toLowerCase();
      updateFocus();
    });

    function hash(value) {
      let h = 2166136261;
      for (let i = 0; i < value.length; i += 1) {
        h ^= value.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    }

    function importance(node) {
      const boost = { overview: 80, meta: 28, source: 18, concept: 24, entity: 20, question: 16, comparison: 16, reference: 14, decision: 14, session: 8, fold: 8 };
      return (node.degree || 0) * 8 + (boost[node.type] || 0) + Math.min(18, node.lineCount || 0) / 4;
    }

    function layoutNodes(inputNodes) {
      const ranked = new Set(inputNodes.slice().sort((a, b) => importance(b) - importance(a)).slice(0, 8).map(node => node.id));
      const positioned = inputNodes.map(node => {
        const anchor = anchors[node.type] || anchors.unknown;
        const seed = hash(node.id);
        const angle = ((seed % 6283) / 1000) + (node.type === 'missing' ? Math.PI / 5 : 0);
        const spread = node.type === 'overview' ? 24 : node.type === 'meta' ? 76 : node.type === 'missing' ? 168 : 132;
        const jitter = 0.58 + (((seed >>> 8) % 1000) / 1000);
        const degreeBoost = Math.min(16, Math.sqrt(Math.max(1, node.degree || 1)) * 3);
        const base = node.type === 'raw' || node.type === 'missing' ? 10 : node.type === 'meta' ? 12 : 16;
        return {
          ...node,
          x: anchor.x + Math.cos(angle) * spread * jitter,
          y: anchor.y + Math.sin(angle) * spread * jitter * 0.72,
          r: Math.max(8, Math.min(34, base + degreeBoost + (node.type === 'source' ? 4 : 0))),
          labelVisible: ranked.has(node.id) && ['overview', 'source', 'concept', 'entity', 'question', 'comparison', 'reference', 'decision'].includes(node.type)
        };
      });
      const lookup = new Map(positioned.map(node => [node.id, node]));
      const edgePairs = (graph.edges || []).map(edge => [edge.source, edge.target]);
      for (let iter = 0; iter < 220; iter += 1) {
        const alpha = 1 - iter / 220;
        for (const node of positioned) {
          const anchor = anchors[node.type] || anchors.unknown;
          node.x += (anchor.x - node.x) * 0.028 * alpha;
          node.y += (anchor.y - node.y) * 0.028 * alpha;
        }
        for (const [sourceId, targetId] of edgePairs) {
          const source = lookup.get(sourceId);
          const target = lookup.get(targetId);
          if (!source || !target) continue;
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const targetDistance = source.type === target.type ? 98 : 160;
          const move = Math.max(-0.62, Math.min(0.62, (distance - targetDistance) * 0.006 * alpha));
          const ux = dx / distance;
          const uy = dy / distance;
          source.x += ux * move;
          source.y += uy * move;
          target.x -= ux * move;
          target.y -= uy * move;
        }
        for (let i = 0; i < positioned.length; i += 1) {
          const left = positioned[i];
          for (let j = i + 1; j < positioned.length; j += 1) {
            const right = positioned[j];
            const dx = right.x - left.x;
            const dy = right.y - left.y;
            const distance = Math.max(0.1, Math.hypot(dx, dy));
            const minDistance = left.r + right.r + (left.type === right.type ? 18 : 28);
            if (distance >= minDistance) continue;
            const push = Math.min(1.8, ((minDistance - distance) / distance) * 0.24 * alpha);
            left.x -= dx * push;
            left.y -= dy * push;
            right.x += dx * push;
            right.y += dy * push;
          }
        }
      }
      for (const node of positioned) {
        node.x = Math.max(96, Math.min(1304, node.x));
        node.y = Math.max(92, Math.min(808, node.y));
        const side = node.x < 720 ? 1 : -1;
        node.labelX = side * (node.r + 14);
        node.labelY = -node.r - 5;
      }
      return positioned;
    }

    function renderLegend() {
      const legend = document.getElementById('legend');
      legend.innerHTML = shownLegendTypes.map(type => '<button data-type="' + type + '"><i style="background:' + colorOf(type) + '"></i>' + labelOf(type) + '</button>').join('');
      legend.addEventListener('click', event => {
        const button = event.target.closest('[data-type]');
        if (!button) return;
        const type = button.getAttribute('data-type');
        if (state.hiddenTypes.has(type)) state.hiddenTypes.delete(type);
        else state.hiddenTypes.add(type);
        button.classList.toggle('off', state.hiddenTypes.has(type));
        updateFocus();
      });
    }

    function renderGraph() {
      svg.innerHTML = '<defs><linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffaf0"></stop><stop offset="1" stop-color="#f0eadc"></stop></linearGradient></defs><rect class="bg" width="1400" height="900" rx="36"></rect>';
      for (const [type, rx, ry] of zoneDefs) {
        const anchor = anchors[type];
        if (!anchor) continue;
        svg.insertAdjacentHTML('beforeend', '<g class="zone zone-' + type + '" style="color:' + colorOf(type) + '"><ellipse cx="' + anchor.x + '" cy="' + anchor.y + '" rx="' + rx + '" ry="' + ry + '"></ellipse><text x="' + anchor.x + '" y="' + (anchor.y - ry + 16) + '" text-anchor="middle">' + escapeHtml(anchor.label) + '</text></g>');
      }
      for (const edge of edges) {
        const source = edge.sourceNode;
        const target = edge.targetNode;
        const mx = (source.x + target.x) / 2;
        const my = (source.y + target.y) / 2 - Math.min(52, Math.abs(source.x - target.x) * 0.08);
        svg.insertAdjacentHTML('beforeend', '<path class="edge" data-source="' + escapeHtml(edge.source) + '" data-target="' + escapeHtml(edge.target) + '" d="M ' + source.x.toFixed(1) + ' ' + source.y.toFixed(1) + ' Q ' + mx.toFixed(1) + ' ' + my.toFixed(1) + ' ' + target.x.toFixed(1) + ' ' + target.y.toFixed(1) + '" stroke-width="' + Math.min(4, 0.7 + edge.weight * 0.75).toFixed(1) + '"></path>');
      }
      for (const node of nodes) {
        const labelHtml = node.labelVisible ? labelCardHtml(node) : '';
        svg.insertAdjacentHTML('beforeend', '<g class="node ' + node.type + '" data-id="' + escapeHtml(node.id) + '" transform="translate(' + node.x.toFixed(1) + ' ' + node.y.toFixed(1) + ')"><circle class="halo" r="' + (node.r + 9).toFixed(1) + '" fill="' + colorOf(node.type) + '"></circle><circle class="core" r="' + node.r.toFixed(1) + '" fill="' + colorOf(node.type) + '"></circle></g>' + labelHtml);
      }
      svg.querySelectorAll('.node').forEach(element => {
        element.addEventListener('mouseenter', event => showTooltip(event, nodeById.get(element.getAttribute('data-id'))));
        element.addEventListener('mousemove', event => moveTooltip(event));
        element.addEventListener('mouseleave', hideTooltip);
        element.addEventListener('click', () => selectNode(nodeById.get(element.getAttribute('data-id'))));
      });
      updateFocus();
    }

    function labelCardHtml(node) {
      const lines = splitLabel(node.label || node.title || node.id, 18);
      const left = node.labelX < 0;
      const x = node.x + node.labelX;
      const y = node.y + node.labelY;
      return '<g class="label-card" data-label-for="' + escapeHtml(node.id) + '" transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')"><rect x="' + (left ? -138 : 0) + '" y="-10" width="138" height="' + (lines.length * 15 + 20) + '" rx="11"></rect>' + lines.map((line, index) => '<text x="' + (left ? -126 : 12) + '" y="' + (8 + index * 15) + '">' + escapeHtml(line) + '</text>').join('') + '</g>';
    }

    function splitLabel(label, max) {
      const normalized = String(label || '').replace(/\s+/g, ' ').trim();
      if (normalized.length <= max) return [normalized];
      const lines = [];
      for (let index = 0; index < normalized.length && lines.length < 3; index += max) {
        lines.push(normalized.slice(index, index + max));
      }
      if (lines.join('').length < normalized.length) lines[lines.length - 1] = lines[lines.length - 1].slice(0, max - 1) + '…';
      return lines;
    }

    function selectNode(node) {
      state.selected = node || null;
      updateDetail(node);
      updateFocus();
    }

    function updateFocus() {
      const related = state.selected ? adjacency.get(state.selected.id) : null;
      const query = state.query;
      const matches = query ? new Set(nodes.filter(node => searchableText(node).includes(query)).map(node => node.id)) : null;
      svg.querySelectorAll('.node').forEach(element => {
        const node = nodeById.get(element.getAttribute('data-id'));
        const hidden = state.hiddenTypes.has(node.type);
        const hot = related ? related.has(node.id) : false;
        const match = matches ? matches.has(node.id) : true;
        element.classList.toggle('selected', state.selected && node.id === state.selected.id);
        element.classList.toggle('hot', hot);
        element.classList.toggle('dim', hidden || (related && !hot) || !match);
      });
      svg.querySelectorAll('.edge').forEach(element => {
        const source = element.getAttribute('data-source');
        const target = element.getAttribute('data-target');
        const hot = state.selected && (source === state.selected.id || target === state.selected.id);
        element.classList.toggle('hot', hot);
        element.classList.toggle('dim', Boolean(state.selected && !hot));
      });
    }

    function updateDetail(inputNode) {
      const node = inputNode || state.selected;
      if (!node) return;
      const neighbors = edges
        .filter(edge => edge.source === node.id || edge.target === node.id)
        .map(edge => edge.source === node.id ? edge.targetNode : edge.sourceNode)
        .sort((a, b) => (b.degree || 0) - (a.degree || 0))
        .slice(0, 10);
      detail.innerHTML =
        '<div class="eyebrow">' + escapeHtml(labelOf(node.type)) + '</div>' +
        '<h2>' + escapeHtml(node.label || node.title || node.id) + '</h2>' +
        '<div class="meta-row"><span>degree ' + escapeHtml(String(node.degree || 0)) + '</span><span>' + escapeHtml(String(node.lineCount || 0)) + ' lines</span><span>' + escapeHtml(node.status || 'no status') + '</span></div>' +
        (node.relativePath ? '<code>' + escapeHtml(node.relativePath) + '</code>' : '') +
        '<div class="eyebrow">Direct Links</div>' +
        '<div class="neighbors">' + (neighbors.length ? neighbors.map(neighbor => '<button class="neighbor" data-id="' + escapeHtml(neighbor.id) + '"><b>' + escapeHtml(neighbor.label || neighbor.title || neighbor.id) + '</b><small>' + escapeHtml(labelOf(neighbor.type)) + ' · degree ' + escapeHtml(String(neighbor.degree || 0)) + '</small></button>').join('') : '<p class="meta-row">没有直接连接。</p>') + '</div>';
      detail.querySelectorAll('[data-id]').forEach(button => button.addEventListener('click', () => selectNode(nodeById.get(button.getAttribute('data-id')))));
    }

    function showTooltip(event, node) {
      if (!node) return;
      tooltip.style.display = 'block';
      tooltip.innerHTML = '<b>' + escapeHtml(node.label || node.title || node.id) + '</b><span>' + escapeHtml(labelOf(node.type)) + ' · degree ' + escapeHtml(String(node.degree || 0)) + '</span><span>' + escapeHtml(node.relativePath || node.id) + '</span>';
      moveTooltip(event);
    }

    function moveTooltip(event) {
      const rect = document.querySelector('.stage').getBoundingClientRect();
      tooltip.style.left = Math.min(rect.width - 380, event.clientX - rect.left + 16) + 'px';
      tooltip.style.top = Math.max(16, event.clientY - rect.top + 16) + 'px';
    }

    function hideTooltip() {
      tooltip.style.display = 'none';
    }

    function searchableText(node) {
      return [node.id, node.label, node.title, node.relativePath, node.type, ...(node.tags || [])].join(' ').toLowerCase();
    }

    function colorOf(type) {
      return typeColors[type] || typeColors.unknown;
    }

    function labelOf(type) {
      return typeLabels[type] || typeLabels.unknown;
    }

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
    }
  </script>
</body>
</html>`;
}

export async function buildClaudeWikiWebview(options: BuildOptions): Promise<{
  outDir: string;
  htmlPath: string;
  manifestPath: string;
  graphJsonPath?: string;
  summary: ClaudeWikiGraph["summary"];
}> {
  const service = new ClaudeWikiService({
    rootDir: options.vaultDir,
    referenceDir: path.resolve(process.cwd(), "claude-obsidian-main"),
  });
  const graph = await service.buildGraph();
  await fs.mkdir(options.outDir, { recursive: true });

  const htmlPath = path.join(options.outDir, "index.html");
  const manifestPath = path.join(options.outDir, "manifest.json");
  const graphJsonPath = options.includeJson ? path.join(options.outDir, "graph.json") : undefined;
  await fs.writeFile(htmlPath, renderClaudeWikiGraphHtml(graph, options.title), "utf8");
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify({
      kind: "notebookmr.claude-wiki-webview",
      title: options.title,
      generatedAt: new Date().toISOString(),
      vaultDir: options.vaultDir,
      graphJson: graphJsonPath ? "graph.json" : undefined,
      summary: graph.summary,
    }, null, 2)}\n`,
    "utf8",
  );
  if (graphJsonPath) {
    await fs.writeFile(graphJsonPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
  }

  return {
    outDir: options.outDir,
    htmlPath,
    manifestPath,
    graphJsonPath,
    summary: graph.summary,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await buildClaudeWikiWebview(options);
  console.log(`Claude wiki webview: ${result.summary.pageCount} pages, ${result.summary.nodeCount} nodes, ${result.summary.edgeCount} links.`);
  console.log(`Wrote: ${result.htmlPath}`);
  console.log(`Manifest: ${result.manifestPath}`);
  if (result.graphJsonPath) {
    console.log(`Graph JSON: ${result.graphJsonPath}`);
  }
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
