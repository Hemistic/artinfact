# Workspace home

Markup, workspace layout and palette ported from the user-provided pdf-ai/electron/shell.html, shell.js and shell.css. Semantic colors from sidebar-theme.css. Font notices retained. Only the assigned plugin pane is styled; native Codex window and chat stay outside it.

The original shell's expanded HTML/CSS book has been replaced with the official Spell UI React/TypeScript PerspectiveBook installed with `npx shadcn@4.21.1 add @spell/perspective-book --yes --overwrite` on 2026-10-01, using https://spell.sh/r/perspective-book.json. The installed source is `src/ui/components/perspective-book.tsx`, with its registry content retained unchanged. Documentation: https://spell.sh/docs/perspective-book; upstream: https://github.com/xxtomm/spell-ui. Its MIT license is included. React islands are mounted/unmounted by `workspace-book.tsx`. Tailwind utilities are built locally without global preflight; the book's original size and workspace colors are applied around the real component.

New shell and integration icons use named official Lucide 1.49.0 SVG nodes (ISC); no character or hand-drawn substitutes. Zotero's original SVG icons are preserved. React/ReactDOM 19.3.0, Tailwind 4.3.3, clsx and tailwind-merge retain their included licenses. No external scripts or icon/font CDNs are required at runtime.
