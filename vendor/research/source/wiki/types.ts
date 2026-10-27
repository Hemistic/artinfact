export type WikiPageType =
  | "source"
  | "entity"
  | "concept"
  | "domain"
  | "comparison"
  | "question"
  | "session"
  | "fold"
  | "reference"
  | "decision"
  | "overview"
  | "meta"
  | "canvas"
  | "raw"
  | "missing"
  | "unknown";

export type WikiGraphRelation =
  | "wikilink"
  | "raw-source"
  | "canvas-contains"
  | "canvas-edge"
  | "folder-affinity";

export interface WikiSourceFile {
  id: string;
  relativePath: string;
  absolutePath: string;
  fileName: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface WikiPageSummary {
  id: string;
  relativePath: string;
  absolutePath: string;
  title: string;
  type: WikiPageType;
  status?: string;
  tags: string[];
  aliases: string[];
  sources: string[];
  links: string[];
  lineCount: number;
  updatedAt: string;
}

export interface WikiGraphNode {
  id: string;
  label: string;
  type: WikiPageType;
  relativePath?: string;
  title?: string;
  status?: string;
  tags: string[];
  degree: number;
  lineCount?: number;
  sizeBytes?: number;
}

export interface WikiGraphEdge {
  id: string;
  source: string;
  target: string;
  relation: WikiGraphRelation;
  weight: number;
  canvasPath?: string;
}

export interface WikiGraphSummary {
  pageCount: number;
  rawSourceCount: number;
  canvasCount: number;
  nodeCount: number;
  edgeCount: number;
  missingTargetCount: number;
}

export interface WikiGraph {
  generatedAt: string;
  rootDir: string;
  summary: WikiGraphSummary;
  nodes: WikiGraphNode[];
  edges: WikiGraphEdge[];
  pages: WikiPageSummary[];
  rawSources: WikiSourceFile[];
}

export interface ClaudeWikiRunInput {
  task: "ingest" | "query" | "lint" | "custom";
  prompt?: string;
  sourcePaths?: string[];
}

export interface ClaudeWikiRunResult {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
}
