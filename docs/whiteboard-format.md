# Portable whiteboard format, version 1

The Export toolbar button offers Markdown + assets, editable whiteboard, and the existing Pages workflow. Export uses explicit user action. Original boards and cards are unchanged.

## Markdown bundle

`markdown-resources.zip` contains UTF-8 `document.md`, `assets/<sha256>.<ext>`, `README.md` and `manifest.json`. Markdown refers to assets using relative paths. Keep the document and assets folder together. Regions become chapters; input edges determine order within each chapter; context edges are preserved as relationships. Cycles retain every card, with a spatial-order note. Full Markdown, equations, evidence, highlights, images and original Pages links are retained. No AI rewrite occurs.

## Editable .artinfact package

`.artinfact` is a ZIP container, not an executable. It contains:

- `whiteboard.json`: `{format:"artinfact-whiteboard",version:1,title,board,sources,pages,assets}`.
- `whiteboard.canvas`: JSON Canvas 1.0 `nodes` and `edges`. Cards use Markdown text nodes; visible regions use group nodes. Geometry, colors, direction, endpoint sides and labels are retained.
- `document.md`: readable assembled export.
- `cards/card-N.md`: individual readable card exports; asset paths are relative to this subfolder.
- `assets/`: real image bytes, named by SHA-256.
- `manifest.json`: format, version, title, timestamp and path/bytes/SHA-256 of each payload file.
- `README.md`: opening instructions and dependencies.

`board` follows the public TypeScript/Zod definition in `src/whiteboard/whiteboard-domain.ts`: versioned nodes, edges and groups with native card contents, presentation types and layout. Active tasks and undo history are not exported. `sources` preserves the referenced source names, parsed text, location metadata and bibliography entries without machine-specific source paths. `pages` preserves full authorized synced Markdown blocks and the original page URL, not a replacement summary. `assets` records asset ID, name, MIME, relative path, bytes and SHA-256.

To open in Artinfact, use + → Import local files and select `.artinfact`. Import validates the archive, schema, version, resource sizes and checksums, then creates a new board with new node/group/source identifiers. Original cards are never overwritten; active tasks are not started. Asset IDs are rekeyed by content, source citations are remapped, and Pages snapshots keep their original links.

To use another plugin, unzip the package or use the already exported folder; copy the complete folder into a JSON Canvas compatible plugin/vault and open `whiteboard.canvas`. That plugin owns its Markdown rendering and feature support. `.artinfact` itself requires this importer or another implementation of this format. Native-only metadata remains in `whiteboard.json`; generic JSON Canvas clients need not implement it.

Original PDF files are not included. Reading/editing the portable notes works independently; returning to original PDFs needs the original workspace. Remote image/Page URLs remain external references. This format does not upload content automatically.

Import caps: 64 MiB compressed, 128 MiB expanded, 6000 allowlisted entries, 64 MiB per entry, 20 MiB per image. Exports exceeding the editable import limit fail explicitly. Unsupported versions, missing images, stale snapshots and invalid digests fail without replacing a board. Temporary asset/snapshot copies may remain after a failed import, but are not published as cards. Imported source text and Pages snapshots are persisted separately in `portable-snapshots.json`, protected by the whiteboard transaction lock, so older connections updating ordinary board content cannot discard them.

JSON Canvas 1.0: https://jsoncanvas.org/spec/1.0/

## Local image resolution

Export resolves parsed MinerU and imported Markdown image paths relative to their own source document before combining cards. Each readable local image is packaged under its SHA-256 name, so identical filenames from different PDFs cannot collide. Embedded image data is materialized into the same resource folder. Code-fenced and inline-code Markdown examples remain literal. Source paths outside the source directory, missing files and unsupported local image types fail explicitly. Original card text and layout are not rewritten in storage. Imported source and Pages image references are rekeyed with the actual imported assets.
