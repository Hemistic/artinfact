import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { normalizePath } from "./markdown";

export interface JsonCanvasNode {
  id: string;
  type?: string;
  file?: string;
  text?: string;
  label?: string;
  url?: string;
}

export interface JsonCanvasEdge {
  id?: string;
  fromNode?: string;
  toNode?: string;
  fromSide?: string;
  toSide?: string;
  label?: string;
}

export interface ParsedCanvas {
  relativePath: string;
  absolutePath: string;
  title: string;
  nodes: JsonCanvasNode[];
  edges: JsonCanvasEdge[];
}

export async function readCanvasFiles(rootDir: string): Promise<ParsedCanvas[]> {
  const canvasDir = path.join(rootDir, "wiki", "canvases");
  if (!fsSync.existsSync(canvasDir)) {
    return [];
  }

  const files = (await listFilesRecursive(canvasDir)).filter((filePath) => filePath.endsWith(".canvas"));
  const canvases: ParsedCanvas[] = [];
  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { nodes?: JsonCanvasNode[]; edges?: JsonCanvasEdge[] };
    const relativePath = normalizePath(path.relative(rootDir, filePath));
    canvases.push({
      relativePath,
      absolutePath: filePath,
      title: path.basename(filePath, ".canvas").replace(/[-_]+/g, " "),
      nodes: parsed.nodes ?? [],
      edges: parsed.edges ?? [],
    });
  }
  return canvases.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function canvasFileNodeTarget(node: JsonCanvasNode): string | undefined {
  if (node.type !== "file" || !node.file) {
    return undefined;
  }
  return normalizePath(node.file);
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
