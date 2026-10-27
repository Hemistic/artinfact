# Paper assets in the whiteboard

The only new-board preset in the interface is the empty paper workbench (`free`). Creating it never inserts source cards or queues Agent work. Existing boards and legacy research-template data remain intact.

The plus button and material drawer use the same asset tree: each document is a root, with collapsible full text, sections, figures, tables, formulas, annotations and insights. Empty categories show zero items. Pages notes have their own root. Children are grouped by document identity, never by filename, so papers with identical filenames cannot mix their assets.

Folder clicks only expand or collapse. A leaf click adds that one source; selecting an existing source locates its existing card. Leaf drags carry the original source ID and use the canvas's world coordinates at the drop position. Figure and table cards retain the full image and caption, and formulas retain KaTeX rendering. Search matches document names, category names, leaf names and captions, temporarily revealing matching ancestors while preserving normal folder expansion state.

The former expand-entire-paper action is removed from the add menu. Its backend API and previously created boards remain for compatibility, but ordinary additions do not call it.
