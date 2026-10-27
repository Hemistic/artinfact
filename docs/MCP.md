# Local MCP integration

## Runtime contract

- Entrypoint: `dist/server/index.js`, built from `src/server/index.ts`.
- Transport: stdio. Protocol traffic uses stdout; diagnostics belong on stderr or local diagnostic files.
- Plugin registration: `mcp.json` and `.mcp.json`, server key `work-layout`.
- Keep `dist/`, `vendor/`, `skills/` and manifests together. The service loads UI resources and worker/runtime files relative to its installation directory.
- Node.js 22+; initial distributed native runtime is Windows x64.

For a manual client, use an absolute path as shown in [INSTALL.md](INSTALL.md). The packaged `${PLUGIN_ROOT}` variable is expanded by a plugin host. There is no public hosted endpoint and no separate Artinfact model API key.

## Tool families

| Family | Purpose | Main implementation |
| --- | --- | --- |
| `layout_*` | Workspace location and layout profiles | `src/server/server.ts`, `workspace-settings.ts` |
| `pdf_*` | Reader, source state, workspaces, MinerU, references, AI tasks, Pages and translation | `src/server/pdf-tools.ts` and related `pdf-*`, `workspace-tools.ts`, `translation-tools.ts` |
| `whiteboard_*` | Boards, notes, source cards, connectors, regions, card actions and export/import | `src/server/whiteboard-tools.ts`, `src/whiteboard/whiteboard-mcp.ts` |
| `wiki_*` | Persistent research Wiki, source-backed graph and queries | `src/server/research-tools.ts`, `research-wiki.ts` |

The runtime is the authoritative tool/schema catalog. `tools/list` may include app-only tools that are not intended as free-form Agent commands. UI resources carry host-specific metadata for MCP Apps and OpenAI integration. Other clients must respect their capabilities and each tool's input schema rather than assuming every visible control is a generic text tool.

## Research and writeback

1. The user selects a card, PDF, reference, connection or region and chooses a research command.
2. Request/read tools bind a task to actual workspace, document, board and card identifiers.
3. The Agent reads the requested source material and images. It must distinguish source evidence from inference and missing information.
4. The matching complete/writeback tool validates the task, structured output, citations and applicable revisions before saving it.
5. Read back the result. Preserve the original source, image, user edits and unrelated cards. A stale or cancelled task must not be overwritten by a fabricated success.

See `docs/agent-workbench.md`, `docs/research-workflow.md` and the bundled `skills/` for the existing detailed workflows. Reference abstract reading and deeper full-text reading are different tasks; do not claim full-text reading based only on an abstract.

## Local state and configuration

| Environment variable | Purpose |
| --- | --- |
| `CODEX_LAYOUT_WORKSPACE` | Explicit workspace directory override |
| `CODEX_WORKSPACE_SETTINGS_DIR` | Host preferences and diagnostics location |
| `CODEX_PDF_DATA_DIR` | Fallback PDF state store location |
| `CODEX_MINERU_LOCAL_DIR` | Optional local processor directory override |
| `CODEX_PDF_PREVIEW_DIR` | Development preview data location |
| `CODEX_PDF_PREVIEW_PORT` | Development preview port, default 4180 |

Defaults use the configured local Artinfact workspace and the user's Codex plugin-data directory. These locations are not source directories. Separate instances used for verification should point at isolated paths, as `verify:runtime` does.

## What verification establishes

`npm run verify:runtime` starts the actual bundled stdio server with isolated state, lists tools/resources, calls `pdf_open` on the synthetic fixture and checks its local PDF URL. It does not ask an Agent to interpret a paper, send translations, download models, or exercise Pages. UI interaction and research quality need separate desktop-host acceptance.

