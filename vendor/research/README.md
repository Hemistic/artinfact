# Artinfact research migration

`source/` contains the owner-provided pdf-ai Electron AI context services and its Claude Obsidian Wiki graph adapter and live graph renderer. `scripts/build-research.mjs` bundles these original services, replacing Electron runtime discovery with packaged paths. It extracts the live renderer and removes the unused CLI and unreachable old renderer; its toolbar uses the installed Lucide SVG geometry.

AI inspection, bounded brief, candidate validation, native/MinerU chapter binding, insight quote verification, PDF text rectangle refinement and annotation normalization execute in an isolated Node worker. The original writer operates only on a temporary snapshot. The TypeScript adapter commits AI fields under the plugin state lock and preserves unrelated annotations and reading state.

`runtime/pdf.cjs` exposes the original pdf-worker source's getPageMetrics and findTextRects APIs. The existing export/metadata worker remains unchanged. Reproducible generated PDF.js library inputs are included under vendor/pdf-worker/source/pdf.js/build; original PDF.js license notices and vendor licenses are retained.

The original nested Claude CLI is intentionally replaced with the official MCP Apps / OpenAI Extensions current-chat message API. Six plugin skills guide the active Codex model through the same source contracts. No model API credential or global skill installation is required.
