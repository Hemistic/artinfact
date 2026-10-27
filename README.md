# Artinfact

<img src="assets/artinfact-logo.png" alt="Artinfact logo" width="80">

A local PDF research workspace with Milkdown Markdown notes, connected whiteboards, knowledge graphs, and a local MCP server.

**Version:** 0.13.52 · **Maintainer:** Hemistic · **Supported release:** Windows x64 · **Price:** Free

[中文说明](docs/README.zh-CN.md) · [Installation](docs/INSTALL.md) · [Development](docs/DEVELOPMENT.md) · [MCP integration](docs/MCP.md) · [Website](https://hemistic.github.io/artinfact-site/) · [Demo](https://hemistic.github.io/artinfact-site/tour.html)

This repository is private while the project is being prepared for distribution. Repository access and release downloads require an invitation. GitHub distribution does not imply approval or listing in the OpenAI plugin directory.

## What it does

- **Read PDFs first.** Original PDF pages, text selection, highlights, annotations, navigation, and reading state use the integrated Zotero/PDF.js reader. Reading does not require MinerU or an AI task.
- **Prepare source cards locally.** Optional MinerU parsing produces Markdown, structure JSON, figures, tables, equations, and references. Prepared material stays in the `+` library until you add it to a board.
- **Write connected notes.** Milkdown powers note editing and rendering: tables, mathematical notation, highlighted code, Mermaid, internal links, and a table of contents. Arrange, resize, connect, and group cards on a whiteboard.
- **Research when requested.** Card, reference, connection, and region commands ask the current host Agent to read relevant sources and save supported explanations, insights, or annotations through MCP. Basic preparation does not generate AI summaries.
- **Explore a knowledge graph.** Browse research relationships and adjust graph density, drag response, and node labels.
- **Link Pages.** Create, link, and synchronize Pages when the corresponding host integration is connected.
- **Export your work.** Export Markdown with assets, an editable `.artinfact` package, or `.canvas` with assets. JSON Canvas has been sampled in Obsidian 1.13.7; other viewers may differ.

## Install a ready-to-run build

1. Install **Node.js 22 or later** and a desktop host supporting local stdio MCP and MCP Apps.
2. Download `artinfact-0.13.52-windows-x64.zip` from [Releases](https://github.com/Hemistic/artinfact/releases). Extract it into a permanent folder.
3. For the installed Codex CLI, register and install the extracted local marketplace:

   ```powershell
   codex plugin marketplace add "C:\Tools\artinfact-0.13.52-windows-x64"
   codex plugin add codex-work-layout@artinfact-local
   ```

4. Restart the desktop host, enable Artinfact, and ask it to open the PDF research workspace.

Replace the example folder with your extracted directory. The release ZIP includes the built UI, MCP service, reader, required native runtime, source, and licenses. GitHub's automatic **Source code** ZIP is a development checkout and needs a build first. Detailed installation, optional MinerU setup, updates, and troubleshooting are in [INSTALL.md](docs/INSTALL.md).

## Build from source

```powershell
git clone https://github.com/Hemistic/artinfact.git
cd artinfact
npm ci
npm run build
npm run verify:runtime
npm run package:github
```

The build requires development dependencies; do not use `npm ci --omit=dev`. The resulting complete local-marketplace ZIP and SHA-256 file are written to `releases/`. No Python environment or model weights are included. macOS-related adapters remain in the source, but this repository's initial release is Windows x64; Linux packaging is not supported.

## Use only the MCP server

After building, register the absolute server path in a stdio MCP client:

```json
{
  "mcpServers": {
    "artinfact": {
      "command": "node",
      "args": ["C:/Tools/artinfact/dist/server/index.js"]
    }
  }
}
```

Keep the entire built plugin directory together. A copied `index.js` alone is insufficient. The full interface also needs MCP Apps and host-specific integration; a text-only MCP client exposes tools without guaranteeing the desktop UI or Pages. See [MCP.md](docs/MCP.md).

## Source map

| Directory | Responsibility |
| --- | --- |
| `src/server/` | Local stdio MCP, PDF storage, parsing orchestration, workspaces, research tasks and exports |
| `src/ui/` | PDF workspace, reader bridge, home UI and graph |
| `src/whiteboard/` | Cards, Milkdown editor, connectors, regions, research menus and board model |
| `src/shared/` | Shared schemas, types and language settings |
| `skills/` | Agent workflows for PDF, Pages and Wiki tasks |
| `scripts/` | Build, packaging, verification and optional MinerU installers |
| `vendor/` | Imported source snapshots, required reader/native runtimes and provenance |
| `tests/` | Existing focused regression checks for development |
| `review-fixtures/` | Synthetic sample PDF and images, with no personal research data |
| `docs/` | Installation, MCP, architecture and workflow notes |

`plugin.json` and `mcp.json` are the portable manifests. `.codex-plugin/plugin.json` and `.mcp.json` preserve Codex compatibility. The technical plugin ID remains `codex-work-layout` to preserve existing installations.

## Data and connections

Research data is stored locally, normally under the configured Artinfact workspace in your Documents folder. Host preferences also use the user's Codex plugin-data directory. User PDFs, notes, processing logs, credentials, model environments, and developer support correspondence are not part of this repository.

AI commands use your host Agent. Enabled translation, paper retrieval, Pages, and model downloads involve their respective services. Optional local MinerU parsing uses its local environment. The plugin itself has no separate paid model API requirement.

## License and support

Integration source follows **AGPL-3.0-or-later**, as recorded in the existing distribution notices. Imported components retain their own licenses. See [LICENSE](LICENSE), [NOTICE.md](NOTICE.md), [SOURCE-BUNDLE.md](SOURCE-BUNDLE.md), and component notices under `vendor/` and `third-party-licenses/`.

Contact: **quinerlyrybicki@gmail.com**. Do not attach private PDFs, credentials, or identity documents to an issue.

