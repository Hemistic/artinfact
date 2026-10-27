import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export interface EnsureVaultResult {
  rootDir: string;
  created: string[];
}

const WIKI_DIRS = [
  ".raw/imports",
  "_attachments",
  "_templates",
  "wiki/sources",
  "wiki/concepts",
  "wiki/entities",
  "wiki/domains",
  "wiki/questions",
  "wiki/comparisons",
  "wiki/references",
  "wiki/decisions",
  "wiki/canvases",
  "wiki/meta",
];

export async function ensureClaudeObsidianVault(rootDir: string): Promise<EnsureVaultResult> {
  const resolvedRoot = path.resolve(rootDir);
  const created: string[] = [];
  await ensureDir(resolvedRoot, created);

  for (const dir of WIKI_DIRS) {
    await ensureDir(path.join(resolvedRoot, dir), created);
  }

  await writeIfMissing(path.join(resolvedRoot, "CLAUDE.md"), defaultClaudeInstructions(), created);
  await writeIfMissing(path.join(resolvedRoot, "WIKI.md"), defaultWikiSchema(), created);
  await writeIfMissing(path.join(resolvedRoot, "wiki", "index.md"), defaultIndex(), created);
  await writeIfMissing(path.join(resolvedRoot, "wiki", "hot.md"), defaultHotCache(), created);
  await writeIfMissing(path.join(resolvedRoot, "wiki", "log.md"), defaultLog(), created);
  await writeIfMissing(path.join(resolvedRoot, "wiki", "overview.md"), defaultOverview(), created);
  await writeIfMissing(path.join(resolvedRoot, "_templates", "source.md"), sourceTemplate(), created);
  await writeIfMissing(path.join(resolvedRoot, "_templates", "concept.md"), conceptTemplate(), created);
  await writeIfMissing(path.join(resolvedRoot, "_templates", "entity.md"), entityTemplate(), created);

  return { rootDir: resolvedRoot, created };
}

async function ensureDir(dir: string, created: string[]): Promise<void> {
  if (!fsSync.existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
    created.push(dir);
    return;
  }
  await fs.mkdir(dir, { recursive: true });
}

async function writeIfMissing(filePath: string, content: string, created: string[]): Promise<void> {
  if (fsSync.existsSync(filePath)) {
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  created.push(filePath);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultClaudeInstructions(): string {
  return `# NotebookMR Claude Wiki Vault

This vault is an Obsidian-compatible wiki controlled by NotebookMR. Obsidian is optional.

## Rules

- Treat .raw/ as immutable source storage.
- Write durable knowledge into wiki/.
- Prefer source-grounded pages: sources, concepts, entities, comparisons, questions.
- Use [[wikilinks]] aggressively. The graph builder uses these links as first-class edges.
- Keep frontmatter flat and parseable.
- Update wiki/index.md, wiki/hot.md, wiki/log.md, and wiki/overview.md after meaningful work.
- Do not use embedding similarity as the only graph relation. Prefer explicit claims, citations, wikilinks, and canvas structure.
`;
}

function defaultWikiSchema(): string {
  return `# NotebookMR Claude Wiki Schema

Ported from claude-obsidian ideas, adapted for a standalone Electron/CLI app.

## Structure

- .raw/: immutable imported sources.
- wiki/sources/: one summary page per source.
- wiki/concepts/: reusable concepts, methods, models, and terms.
- wiki/entities/: authors, datasets, methods, tools, systems, organizations.
- wiki/comparisons/: side-by-side analysis pages.
- wiki/questions/: durable answers.
- wiki/canvases/: JSON Canvas files for explicit visual relationships.
- wiki/meta/: generated reports and diagnostics.

## Graph Inputs

1. Markdown wikilinks: [[Concept Name]]
2. Frontmatter: type, title, tags, related, sources, aliases
3. JSON Canvas file nodes and edges
4. Raw source references

Embedding can still help propose edges, but explicit wiki structure wins.
`;
}

function defaultIndex(): string {
  return `---
type: meta
title: "Wiki Index"
created: ${today()}
updated: ${today()}
tags:
  - notebookmr
  - index
status: seed
---

# Wiki Index

## Sources

## Concepts

## Entities

## Comparisons

## Questions
`;
}

function defaultHotCache(): string {
  return `---
type: meta
title: "Hot Cache"
created: ${today()}
updated: ${today()}
tags:
  - notebookmr
  - hot-cache
status: seed
---

# Recent Context

No sources ingested yet.
`;
}

function defaultLog(): string {
  return `---
type: meta
title: "Operation Log"
created: ${today()}
updated: ${today()}
tags:
  - notebookmr
  - log
status: seed
---

# Operation Log
`;
}

function defaultOverview(): string {
  return `---
type: overview
title: "Knowledge Base Overview"
created: ${today()}
updated: ${today()}
tags:
  - notebookmr
  - overview
status: seed
related:
  - "[[Wiki Index]]"
---

# Knowledge Base Overview

This standalone wiki vault is maintained by NotebookMR and can be rendered as an Electron webview graph.
`;
}

function sourceTemplate(): string {
  return `---
type: source
title: "{{title}}"
created: ${today()}
updated: ${today()}
tags: []
status: developing
aliases: []
sources:
  - "{{raw_path}}"
related: []
---

# {{title}}

## Summary

## Key Claims

## Concepts

## Entities
`;
}

function conceptTemplate(): string {
  return `---
type: concept
title: "{{title}}"
created: ${today()}
updated: ${today()}
tags: []
status: developing
aliases: []
sources: []
related: []
---

# {{title}}

## Definition

## Evidence

## Related
`;
}

function entityTemplate(): string {
  return `---
type: entity
title: "{{title}}"
created: ${today()}
updated: ${today()}
tags: []
status: developing
aliases: []
sources: []
related: []
---

# {{title}}

## Role

## Evidence

## Related
`;
}
