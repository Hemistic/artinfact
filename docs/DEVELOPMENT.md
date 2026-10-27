# Development

## Start

Use Windows x64 and Node.js 22+. Install all locked dependencies with `npm ci`; build with `npm run build`. Build outputs go to `dist/`, and derived vendor adapters are refreshed by the build scripts. Required native canvas binaries and upstream reader assets are intentionally retained under `vendor/`; do not apply a blanket vendor or node_modules deletion there.

## Architecture

```text
Desktop host / Agent
   | stdio MCP + MCP Apps resource bridge
   v
src/server/index.ts -> server.ts + tool modules
   |                         |
   | local stores / workers  | user-triggered research task contracts
   v                         v
PDF reader + home UI       whiteboard + Milkdown + graph
src/ui/                   src/whiteboard/
   |                         |
   +------ configured local workspace ------+
```

The MCP service is TypeScript bundled for Node. Browser views are bundled locally. Source analysis is not a second model service: the host Agent obtains task context, reads sources, and completes the corresponding task with validated output. Keep deterministic preparation separate from requested interpretation.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Build the production MCP, UI, whiteboard and integration adapters |
| `npm run typecheck` | Check TypeScript without emitting files |
| `npm run verify:runtime` | Isolated MCP startup, tool discovery and synthetic PDF endpoint smoke check |
| `npm run preview:pdf` | Integrated PDF/whiteboard development preview on localhost:4180 |
| `npm run preview` | Original layout-only development preview on localhost:4177 |
| `npm run package:github` | Build a complete Windows x64 local-marketplace ZIP and SHA-256 |
| `npm run source:status` | Show the committed source revision and tracked working changes |
| `npm run source:bundle -- --output <file.bundle>` | Export committed Git history for offline source transfer |

The existing focused checks remain in `tests/` for maintainers. Run relevant checks for a change; a broad suite is not a substitute for host UI acceptance. The legacy `npm run package` command is retained for older overlay workflows; use `package:github` for this repository's complete standalone release.

## Release workflow

1. Update versions consistently in `package.json`, lockfile, both plugin manifests, and release documentation.
2. Build and check the relevant behavior. Verify PDF opening and any changed interactions in the desktop host.
3. Run `npm run verify:runtime` and `npm run package:github`.
4. Inspect the ZIP and hashes, install into a separate local marketplace, and confirm the displayed version.
5. Commit the source, tag the commit, and attach the built ZIP plus hash to a GitHub Release. Keep the repository private until the maintainer explicitly changes its audience.

The packaging script uses explicit root entries, excludes development dependencies and user data, includes complete corresponding source and component notices, and rejects links or missing critical runtime files. GitHub source archives omit generated `dist/`; they are not ready-to-run plugin downloads.

## Dependencies and provenance

`package-lock.json` pins npm dependencies. Upstream snapshots, component licenses and provenance records live under `vendor/`. `NOTICE.md` describes integration changes. Normal builds do not require the original developer's `pdf-ai` checkout; vendor-import scripts are maintenance tools and require an explicit external source path.

The original plugin technical identity `codex-work-layout` is retained. Do not rename it as part of a UI label change or replace user workspace data while refreshing a package.

## Git hygiene

Commit source, documentation, manifests, lockfile, regression check sources and required vendor snapshots. Keep `dist/`, `releases/`, normal `node_modules/`, preview data, models, PDFs, processing logs, local settings, credentials and support records out of Git. Synthetic fixtures under `review-fixtures/` are the intentional PDF exception. A Git bundle includes committed files only.

