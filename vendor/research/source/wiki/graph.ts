import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { canvasFileNodeTarget, readCanvasFiles } from "./canvas";
import {
  extractWikiLinks,
  fieldList,
  fieldString,
  normalizePageType,
  normalizePath,
  normalizeWikiTarget,
  parseFrontmatter,
  stripMarkdownExtension,
  titleFromPath,
} from "./markdown";
import type { WikiGraph, WikiGraphEdge, WikiGraphNode, WikiGraphRelation, WikiPageSummary, WikiSourceFile } from "./types";
import { ensureClaudeObsidianVault } from "./vault";

const SOURCE_EXTENSIONS = new Set([".pdf", ".md", ".markdown", ".txt"]);

export interface BuildWikiGraphOptions {
  rootDir: string;
  ensureVault?: boolean;
  includeFolderAffinity?: boolean;
}

export async function buildWikiGraph(options: BuildWikiGraphOptions): Promise<WikiGraph> {
  const rootDir = path.resolve(options.rootDir);
  if (options.ensureVault ?? true) {
    await ensureClaudeObsidianVault(rootDir);
  }

  const pages = await readWikiPages(rootDir);
  const rawSources = await readRawSources(rootDir);
  const canvases = await readCanvasFiles(rootDir);
  const pageLookup = buildPageLookup(pages);
  const rawLookup = new Map(rawSources.map((source) => [source.relativePath.toLowerCase(), source]));

  const nodes = new Map<string, WikiGraphNode>();
  const edges = new Map<string, WikiGraphEdge>();
  let missingTargetCount = 0;

  for (const page of pages) {
    nodes.set(page.id, {
      id: page.id,
      label: page.title,
      type: page.type,
      relativePath: page.relativePath,
      title: page.title,
      status: page.status,
      tags: page.tags,
      degree: 0,
      lineCount: page.lineCount,
    });
  }

  for (const source of rawSources) {
    nodes.set(source.id, {
      id: source.id,
      label: source.fileName,
      type: "raw",
      relativePath: source.relativePath,
      tags: [],
      degree: 0,
      sizeBytes: source.sizeBytes,
    });
  }

  for (const canvas of canvases) {
    nodes.set(canvas.relativePath, {
      id: canvas.relativePath,
      label: canvas.title,
      type: "canvas",
      relativePath: canvas.relativePath,
      tags: [],
      degree: 0,
    });
  }

  for (const page of pages) {
    for (const link of page.links) {
      const target = resolveWikiTarget(link, pageLookup);
      const targetId = target?.id ?? `missing:${link}`;
      if (!target && !nodes.has(targetId)) {
        missingTargetCount += 1;
        nodes.set(targetId, {
          id: targetId,
          label: link,
          type: "missing",
          tags: [],
          degree: 0,
        });
      }
      incrementEdge(edges, page.id, targetId, "wikilink", 1);
    }

    for (const sourceRef of page.sources) {
      const normalizedSourceRef = normalizeSourceReference(sourceRef);
      const rawTarget = rawLookup.get(normalizedSourceRef.toLowerCase());
      const pageTarget = resolveWikiTarget(normalizedSourceRef, pageLookup);
      if (rawTarget) {
        incrementEdge(edges, page.id, rawTarget.id, "raw-source", 2);
      } else if (pageTarget) {
        incrementEdge(edges, page.id, pageTarget.id, "raw-source", 1.5);
      }
    }
  }

  for (const canvas of canvases) {
    const canvasNodeLookup = new Map<string, string>();
    for (const canvasNode of canvas.nodes) {
      const fileTarget = canvasFileNodeTarget(canvasNode);
      if (!fileTarget) {
        continue;
      }
      const graphTarget = resolveFileTarget(fileTarget, pageLookup, rawLookup);
      if (!graphTarget) {
        continue;
      }
      canvasNodeLookup.set(canvasNode.id, graphTarget);
      incrementEdge(edges, canvas.relativePath, graphTarget, "canvas-contains", 1.4);
    }

    for (const canvasEdge of canvas.edges) {
      if (!canvasEdge.fromNode || !canvasEdge.toNode) {
        continue;
      }
      const source = canvasNodeLookup.get(canvasEdge.fromNode);
      const target = canvasNodeLookup.get(canvasEdge.toNode);
      if (source && target) {
        incrementEdge(edges, source, target, "canvas-edge", 2.2, canvas.relativePath);
      }
    }
  }

  if (options.includeFolderAffinity) {
    addFolderAffinityEdges(pages, edges);
  }

  for (const edge of edges.values()) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (source) source.degree += edge.weight;
    if (target) target.degree += edge.weight;
  }

  return {
    generatedAt: new Date().toISOString(),
    rootDir,
    summary: {
      pageCount: pages.length,
      rawSourceCount: rawSources.length,
      canvasCount: canvases.length,
      nodeCount: nodes.size,
      edgeCount: edges.size,
      missingTargetCount,
    },
    nodes: [...nodes.values()].sort((left, right) => right.degree - left.degree || left.label.localeCompare(right.label)),
    edges: [...edges.values()].sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id)),
    pages,
    rawSources,
  };
}

async function readWikiPages(rootDir: string): Promise<WikiPageSummary[]> {
  const wikiDir = path.join(rootDir, "wiki");
  if (!fsSync.existsSync(wikiDir)) {
    return [];
  }

  const files = (await listFilesRecursive(wikiDir)).filter((filePath) => /\.(md|markdown)$/i.test(filePath));
  const pages: WikiPageSummary[] = [];
  for (const filePath of files) {
    const content = await fs.readFile(filePath, "utf8");
    const relativePath = normalizePath(path.relative(rootDir, filePath));
    const parsed = parseFrontmatter(content);
    const stat = await fs.stat(filePath);
    const title = fieldString(parsed.fields, "title") ?? titleFromPath(filePath);
    pages.push({
      id: relativePath,
      relativePath,
      absolutePath: filePath,
      title,
      type: normalizePageType(fieldString(parsed.fields, "type"), relativePath),
      status: fieldString(parsed.fields, "status"),
      tags: fieldList(parsed.fields, "tags"),
      aliases: fieldList(parsed.fields, "aliases"),
      sources: fieldList(parsed.fields, "sources"),
      links: extractWikiLinks(parsed.body),
      lineCount: content.split(/\r?\n/).length,
      updatedAt: stat.mtime.toISOString(),
    });
  }
  return pages.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function readRawSources(rootDir: string): Promise<WikiSourceFile[]> {
  const rawDir = path.join(rootDir, ".raw");
  if (!fsSync.existsSync(rawDir)) {
    return [];
  }

  const files = (await listFilesRecursive(rawDir)).filter((filePath) => SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
  const sources: WikiSourceFile[] = [];
  for (const filePath of files) {
    const stat = await fs.stat(filePath);
    const relativePath = normalizePath(path.relative(rootDir, filePath));
    sources.push({
      id: relativePath,
      relativePath,
      absolutePath: filePath,
      fileName: path.basename(filePath),
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
    });
  }
  return sources.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function buildPageLookup(pages: WikiPageSummary[]): Map<string, WikiPageSummary> {
  const lookup = new Map<string, WikiPageSummary>();
  for (const page of pages) {
    const keys = [
      page.title,
      stripMarkdownExtension(path.basename(page.relativePath)),
      stripMarkdownExtension(page.relativePath),
      ...page.aliases,
    ];
    for (const key of keys) {
      if (key) {
        lookup.set(key.toLowerCase(), page);
      }
    }
  }
  return lookup;
}

function resolveWikiTarget(value: string, pageLookup: Map<string, WikiPageSummary>): WikiPageSummary | undefined {
  const target = normalizeWikiTarget(value);
  return pageLookup.get(target.toLowerCase()) ?? pageLookup.get(stripMarkdownExtension(target).toLowerCase());
}

function resolveFileTarget(
  value: string,
  pageLookup: Map<string, WikiPageSummary>,
  rawLookup: Map<string, WikiSourceFile>,
): string | undefined {
  const normalized = normalizePath(value);
  const page = pageLookup.get(stripMarkdownExtension(normalized).toLowerCase()) ?? pageLookup.get(normalized.toLowerCase());
  if (page) return page.id;
  const raw = rawLookup.get(normalized.toLowerCase());
  return raw?.id;
}

function normalizeSourceReference(value: string): string {
  return normalizeWikiTarget(value.replace(/^\[\[/, "").replace(/\]\]$/, ""));
}

function addFolderAffinityEdges(pages: WikiPageSummary[], edges: Map<string, WikiGraphEdge>): void {
  const byType = new Map<string, WikiPageSummary[]>();
  for (const page of pages) {
    if (page.type === "meta") {
      continue;
    }
    const bucket = byType.get(page.type) ?? [];
    bucket.push(page);
    byType.set(page.type, bucket);
  }

  for (const bucket of byType.values()) {
    const sorted = [...bucket].sort((left, right) => left.title.localeCompare(right.title));
    for (let index = 1; index < sorted.length; index += 1) {
      incrementEdge(edges, sorted[index - 1].id, sorted[index].id, "folder-affinity", 0.15);
    }
  }
}

function incrementEdge(
  edges: Map<string, WikiGraphEdge>,
  source: string,
  target: string,
  relation: WikiGraphRelation,
  weight: number,
  canvasPath?: string,
): void {
  if (source === target) {
    return;
  }
  const id = `${relation}:${source}->${target}${canvasPath ? `@${canvasPath}` : ""}`;
  const current = edges.get(id);
  if (current) {
    current.weight += weight;
    return;
  }
  edges.set(id, { id, source, target, relation, weight, canvasPath });
}

async function listFilesRecursive(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const childPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(childPath));
    } else {
      files.push(childPath);
    }
  }
  return files;
}
