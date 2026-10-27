import path from "node:path";

import type { WikiPageType } from "./types";

export interface ParsedFrontmatter {
  body: string;
  fields: Map<string, string | string[]>;
}

const WIKILINK_PATTERN = /\[\[([^\]]+)\]\]/g;

const KNOWN_TYPES = new Set<WikiPageType>([
  "source",
  "entity",
  "concept",
  "domain",
  "comparison",
  "question",
  "session",
  "fold",
  "reference",
  "decision",
  "overview",
  "meta",
  "canvas",
  "raw",
  "missing",
  "unknown",
]);

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function stripMarkdownExtension(value: string): string {
  return value.replace(/\.(md|markdown)$/i, "");
}

export function titleFromPath(filePath: string): string {
  return stripMarkdownExtension(path.basename(filePath)).replace(/[-_]+/g, " ").trim();
}

export function pageTypeFromPath(relativePath: string): WikiPageType {
  const normalized = normalizePath(relativePath);
  if (normalized.startsWith("wiki/sources/")) return "source";
  if (normalized.startsWith("wiki/entities/")) return "entity";
  if (normalized.startsWith("wiki/concepts/")) return "concept";
  if (normalized.startsWith("wiki/domains/")) return "domain";
  if (normalized.startsWith("wiki/comparisons/")) return "comparison";
  if (normalized.startsWith("wiki/questions/")) return "question";
  if (normalized.startsWith("wiki/sessions/")) return "session";
  if (normalized.startsWith("wiki/folds/")) return "fold";
  if (normalized.startsWith("wiki/references/")) return "reference";
  if (normalized.startsWith("wiki/decisions/")) return "decision";
  if (normalized === "wiki/overview.md") return "overview";
  if (normalized.endsWith(".canvas")) return "canvas";
  if (normalized.startsWith("wiki/meta/") || normalized === "wiki/index.md" || normalized === "wiki/hot.md" || normalized === "wiki/log.md") {
    return "meta";
  }
  return "unknown";
}

export function normalizePageType(value: string | undefined, relativePath: string): WikiPageType {
  const normalized = value?.trim().toLowerCase();
  if (normalized && KNOWN_TYPES.has(normalized as WikiPageType)) {
    return normalized as WikiPageType;
  }
  return pageTypeFromPath(relativePath);
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const normalized = content.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) {
    return { body: normalized, fields: new Map() };
  }

  const endMatch = /\r?\n---\r?\n/.exec(normalized.slice(3));
  if (!endMatch || endMatch.index < 0) {
    return { body: normalized, fields: new Map() };
  }

  const endIndex = 3 + endMatch.index;
  const rawFrontmatter = normalized.slice(3, endIndex).split(/\r?\n/);
  const fields = new Map<string, string | string[]>();
  let activeListKey: string | null = null;

  for (const line of rawFrontmatter) {
    const listMatch = /^\s*-\s+(.+?)\s*$/.exec(line);
    if (listMatch && activeListKey) {
      const current = fields.get(activeListKey);
      const values = Array.isArray(current) ? current : [];
      values.push(cleanYamlScalar(listMatch[1]));
      fields.set(activeListKey, values);
      continue;
    }

    const fieldMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!fieldMatch) {
      activeListKey = null;
      continue;
    }

    const [, key, rawValue] = fieldMatch;
    if (!rawValue) {
      activeListKey = key;
      fields.set(key, []);
      continue;
    }

    activeListKey = null;
    fields.set(key, parseYamlValue(rawValue));
  }

  return {
    body: normalized.slice(endIndex + endMatch[0].length),
    fields,
  };
}

export function fieldString(fields: Map<string, string | string[]>, key: string): string | undefined {
  const value = fields.get(key);
  return typeof value === "string" ? value : undefined;
}

export function fieldList(fields: Map<string, string | string[]>, key: string): string[] {
  const value = fields.get(key);
  if (Array.isArray(value)) return value.filter(Boolean);
  return typeof value === "string" && value ? [value] : [];
}

export function extractWikiLinks(body: string): string[] {
  const links = new Set<string>();
  for (const match of body.matchAll(WIKILINK_PATTERN)) {
    const target = normalizeWikiTarget(match[1]);
    if (target) {
      links.add(target);
    }
  }
  return [...links];
}

export function normalizeWikiTarget(value: string): string {
  return value.split("|")[0]?.split("#")[0]?.trim() ?? "";
}

function cleanYamlScalar(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function parseYamlValue(value: string): string | string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => cleanYamlScalar(item))
      .filter(Boolean);
  }
  return cleanYamlScalar(trimmed);
}
