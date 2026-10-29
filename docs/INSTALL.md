# Installation

## Requirements

- Windows x64; this is the platform of the initial release artifact.
- Node.js 22+ available as `node` in the desktop host's environment.
- A desktop host with local stdio MCP support. MCP Apps and the corresponding host bridges are needed for the full interface and Agent/Pages interactions.
- Access to the public [GitHub repository](https://github.com/Hemistic/artinfact) and its Releases page. No repository invitation is required.

Check `node --version` in PowerShell. If Node was installed while the host was open, restart the host so it receives the updated PATH.

## Ready-to-run local plugin

1. Open the repository's [Releases page](https://github.com/Hemistic/artinfact/releases).
2. Download `artinfact-0.13.52-windows-x64.zip` and its `.sha256` file. The automatic GitHub source archives do not contain `dist/`.
3. Check the ZIP hash:

   ```powershell
   Get-FileHash -Algorithm SHA256 -LiteralPath .\artinfact-0.13.52-windows-x64.zip
   ```

4. Extract the archive into a permanent location such as `C:\Tools`. Its root has this structure:

   ```text
   artinfact-0.13.52-windows-x64/
     .agents/plugins/marketplace.json
     plugins/codex-work-layout/
       plugin.json
       .codex-plugin/plugin.json
       mcp.json
       dist/server/index.js
       dist/ui/
       dist/whiteboard/
       vendor/
       src/
       skills/
   ```

5. Register that root using the installed Codex CLI:

   ```powershell
   codex plugin marketplace add "C:\Tools\artinfact-0.13.52-windows-x64"
   codex plugin add codex-work-layout@artinfact-local
   ```

6. Restart the desktop host, enable Artinfact, and ask: **Open my PDF research workspace.** Import the supplied `review-fixtures/artinfact-review-sample.pdf` to check basic reading before adding real research material.

These commands match the locally installed CLI, whose installer subcommand is `plugin add`. On a host with different plugin controls, use its supported local marketplace flow. Do not replace live cache files manually. Public GitHub availability is separate from OpenAI directory approval.

The prebuilt plugin does not require `npm install` in the extracted runtime. Node.js is still required. Keep the extracted marketplace until the host no longer needs its source location.

## Source installation

```powershell
git clone https://github.com/Hemistic/artinfact.git
cd artinfact
npm ci
npm run build
npm run verify:runtime
npm run package:github
```

Extract the generated archive under `releases/` and use the same marketplace commands. This separate package step prevents development dependencies, Git metadata and preview data from being installed as runtime content.

`npm run preview:pdf` starts the browser development preview at `http://127.0.0.1:4180/?preview=1`. It uses `.preview-data/pdf`. Agent sends and Pages navigation are recorded as preview requests; the preview does not replace host integration testing.

## MCP-only registration

Build the source first or use the complete prebuilt plugin folder. Then, for example:

```powershell
codex mcp add artinfact -- node "C:\Tools\artinfact-0.13.52-windows-x64\plugins\codex-work-layout\dist\server\index.js"
codex mcp list
```

Do not configure both the native plugin and a duplicate manual MCP server unless you deliberately need two instances. Manual registration does not install bundled skills or guarantee a graphical MCP App in every client. `${PLUGIN_ROOT}` in the packaged manifest is a host expansion, not a literal path to paste into another client's settings.

## Optional local MinerU

PDF reading works before MinerU is installed. Choose layout parsing/Markdown conversion in the reader, select the model source, and run its download/deploy flow when needed. Environment and model files are separate downloads in the configured processor directory.

For manual Windows setup, use the included `scripts/mineru-local/Install-MinerU.cmd` or the documented PowerShell installer. See [the processor instructions](../scripts/mineru-local/README.md). Parsing prepares source cards in the `+` library; adding them to a board and invoking AI interpretation remain user actions.

## Updates and data

Save your edits and back up your configured Artinfact workspace. Extract a new release into a new permanent folder, register its marketplace root, and install/refresh the same `codex-work-layout@artinfact-local` entry using your host's supported update flow. Restart the host and confirm the displayed version. Never delete the user's workspace to update the plugin.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `node` is missing | Install Node.js 22+ and restart the host; use an absolute Node executable path for manual MCP registration if necessary. |
| `ENOENT` for `dist/whiteboard/index.html` | A source-only archive or partial folder was installed. Build and package the source, or install the complete release ZIP. |
| `Cannot find module ...vendor/research/runtime/wiki.cjs` | Restore the complete matching `vendor/` directory; do not copy only the MCP entrypoint. |
| Old version after installation | Save edits, close the old panel, restart the host, and confirm which installation is enabled. |
| No graphical UI in another MCP client | That client may support tools but lack MCP Apps or the required host bridges. |
| MinerU fails | Inspect that document's processor run log and the processor settings; basic PDF reading should remain available. |
| GitHub returns 404 | Check the repository/release URL and network access. This repository is public and does not require an invitation. |

Installation references checked 2026-10-27: [official plugin packaging and local marketplaces](https://developers.openai.com/plugins/build/plugins), [official MCP configuration](https://learn.chatgpt.com/docs/extend/mcp). Host capabilities and CLI versions can vary.

