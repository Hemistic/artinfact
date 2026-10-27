"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// vendor/mineru/source/runtime-paths.js
var require_runtime_paths = __commonJS({
  "vendor/mineru/source/runtime-paths.js"(exports2) {
    "use strict";
    exports2.getPdfWorkerDir = () => __dirname;
  }
});

// vendor/mineru/source/mineru-layout-normalizer.js
var require_mineru_layout_normalizer = __commonJS({
  "vendor/mineru/source/mineru-layout-normalizer.js"(exports2, module2) {
    "use strict";
    var fs = require("fs/promises");
    var path = require("path");
    var { getPdfWorkerDir } = require_runtime_paths();
    var MAX_LAYOUT_JSON_CHARS = 80 * 1024 * 1024;
    var MAX_LAYOUT_BLOCKS = 2e4;
    var MAX_COMPOSITE_IMAGE_ITEMS = 32;
    var MAX_COMPOSITE_CANVAS_DIMENSION = 12e3;
    var MAX_COMPOSITE_CANVAS_PIXELS = 32 * 1024 * 1024;
    var MAX_BBOX_COORDINATE = 1e6;
    var SAFE_ASSET_SEGMENT_PATTERN = /^[A-Za-z0-9._ -]+$/u;
    function areSamePath(left, right) {
      const resolvedLeft = path.resolve(String(left || ""));
      const resolvedRight = path.resolve(String(right || ""));
      return process.platform === "win32" ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase() : resolvedLeft === resolvedRight;
    }
    function isPathInsideOrSameDirectory(targetPath, parentDir) {
      const target = path.resolve(String(targetPath || ""));
      const parent = path.resolve(String(parentDir || ""));
      if (areSamePath(target, parent)) {
        return true;
      }
      const relative = path.relative(parent, target);
      return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
    }
    function normalizeRelativeAssetPath(value) {
      const normalized = String(value || "").trim().replace(/\\/g, "/");
      if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//u.test(normalized) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(normalized)) {
        return "";
      }
      const parts = normalized.split("/").filter(Boolean);
      if (parts.length === 0 || parts.some((part) => part === "." || part === ".." || !SAFE_ASSET_SEGMENT_PATTERN.test(part))) {
        return "";
      }
      return parts.join("/");
    }
    function resolveAssetPathWithinOutputDir(outputDir, relativePath) {
      const safeRelativePath = normalizeRelativeAssetPath(relativePath);
      if (!safeRelativePath || !outputDir) {
        return null;
      }
      const rootDir = path.resolve(String(outputDir));
      const absolutePath = path.resolve(rootDir, safeRelativePath);
      if (!isPathInsideOrSameDirectory(absolutePath, rootDir)) {
        return null;
      }
      return {
        relativePath: safeRelativePath,
        absolutePath
      };
    }
    function flattenMineruBlocks(parsed) {
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.flatMap((entry) => Array.isArray(entry) ? entry : [entry]).filter(Boolean);
    }
    function getMineruBlockPageIndex(block) {
      const zeroBasedCandidates = [
        block?.page_idx,
        block?.page_index,
        block?.pageIndex,
        block?.content?.page_idx,
        block?.content?.page_index,
        block?.content?.pageIndex
      ];
      for (const value of zeroBasedCandidates) {
        const pageIndex = Number(value);
        if (Number.isInteger(pageIndex) && pageIndex >= 0) {
          return pageIndex;
        }
      }
      const oneBasedCandidates = [
        block?.page_number,
        block?.page_no,
        block?.pageNo,
        block?.page,
        block?.content?.page_number,
        block?.content?.page_no,
        block?.content?.pageNo,
        block?.content?.page
      ];
      for (const value of oneBasedCandidates) {
        const pageNumber = Number(value);
        if (Number.isInteger(pageNumber) && pageNumber > 0) {
          return pageNumber - 1;
        }
      }
      return null;
    }
    function normalizeMineruContentListPages2(parsed) {
      if (!Array.isArray(parsed)) {
        return [];
      }
      if (parsed.every((entry) => Array.isArray(entry))) {
        return parsed;
      }
      const blocks = flattenMineruBlocks(parsed);
      let hasExplicitPageIndex = false;
      for (const block of blocks) {
        if (getMineruBlockPageIndex(block) !== null) {
          hasExplicitPageIndex = true;
          break;
        }
      }
      if (!hasExplicitPageIndex) {
        return blocks.length ? [blocks] : [];
      }
      const pages = [];
      let currentPageIndex = 0;
      for (const block of blocks) {
        const explicitPageIndex = getMineruBlockPageIndex(block);
        if (explicitPageIndex !== null) {
          currentPageIndex = explicitPageIndex;
        }
        if (!pages[currentPageIndex]) {
          pages[currentPageIndex] = [];
        }
        pages[currentPageIndex].push(block);
      }
      return pages.map((pageItems) => pageItems || []);
    }
    function extractRichText2(node) {
      if (!node) {
        return "";
      }
      if (typeof node === "string") {
        return node.trim();
      }
      if (Array.isArray(node)) {
        return node.map((item) => extractRichText2(item)).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      }
      if (typeof node.text === "string") {
        return node.text.trim();
      }
      if (typeof node.text_content === "string") {
        return node.text_content.trim();
      }
      if (typeof node.content === "string") {
        return node.content.trim();
      }
      const nestedKeys = [
        "item_content",
        "paragraph_content",
        "title_content",
        "image_caption",
        "image_footnote",
        "chart_caption",
        "chart_footnote",
        "table_caption",
        "table_footnote",
        "page_header_content",
        "page_footer_content",
        "page_footnote_content",
        "page_aside_text_content"
      ];
      for (const key of nestedKeys) {
        if (Array.isArray(node[key])) {
          return extractRichText2(node[key]);
        }
      }
      if (typeof node.math_content === "string") {
        return node.math_content.trim();
      }
      return "";
    }
    function normalizeText(value) {
      return String(value || "").replace(/\r/g, " ").replace(/\s+/g, " ").trim();
    }
    function stripInlineHtml(value) {
      return normalizeText(String(value || "").replace(/<[^>]+>/g, " "));
    }
    function firstRichText(...candidates) {
      for (const candidate of candidates) {
        const text = extractRichText2(candidate);
        if (text) {
          return normalizeText(text);
        }
      }
      return "";
    }
    function getTitleText(block) {
      return firstRichText(
        block?.content?.title_content,
        block?.title,
        block?.text,
        block?.content?.text,
        block?.content
      );
    }
    function getParagraphText(block) {
      return firstRichText(
        block?.content?.paragraph_content,
        block?.text,
        block?.text_content,
        block?.content?.text,
        block?.content?.text_content,
        block?.content
      );
    }
    function getListItemText(item) {
      return normalizeText(extractRichText2(item?.item_content || item));
    }
    function getCaptionText(block) {
      const blockType = String(block?.type || "").toLowerCase();
      if (blockType === "table") {
        return normalizeText([
          extractRichText2(block?.table_caption),
          extractRichText2(block?.content?.table_caption),
          extractRichText2(block?.table_footnote),
          extractRichText2(block?.content?.table_footnote)
        ].filter(Boolean).join(" "));
      }
      return normalizeText([
        extractRichText2(block?.chart_caption),
        extractRichText2(block?.content?.chart_caption),
        extractRichText2(block?.image_caption),
        extractRichText2(block?.content?.image_caption),
        extractRichText2(block?.chart_footnote),
        extractRichText2(block?.content?.chart_footnote),
        extractRichText2(block?.image_footnote),
        extractRichText2(block?.content?.image_footnote)
      ].filter(Boolean).join(" "));
    }
    function getEquationText(block) {
      return firstRichText(
        block?.content?.math_content,
        block?.math_content,
        block?.latex,
        block?.tex,
        block?.text,
        block?.content
      );
    }
    function getMediaImagePath(block) {
      const imagePath = block?.img_path || block?.image_path || block?.content?.image_source?.path || block?.content?.img_path || block?.content?.image_path;
      return normalizeRelativeAssetPath(imagePath);
    }
    function getBlockBBox(block) {
      const bbox = Array.isArray(block?.bbox) ? block.bbox.map((value) => Number(value)) : [];
      if (bbox.length !== 4 || bbox.some((value) => !Number.isFinite(value))) {
        return null;
      }
      const [x1, y1, x2, y2] = bbox;
      if (bbox.some((value) => Math.abs(value) > MAX_BBOX_COORDINATE)) {
        return null;
      }
      if (x2 <= x1 || y2 <= y1) {
        return null;
      }
      return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 };
    }
    function getHeadingLevel(block) {
      const rawLevel = Number(block?.content?.level);
      if (Number.isFinite(rawLevel) && rawLevel > 0) {
        return Math.min(6, Math.max(1, Math.floor(rawLevel)));
      }
      return 1;
    }
    function isFullFigureCaption(text) {
      return /(?:^|\s)(?:fig(?:ure)?\.?)\s*[A-Za-z]*\d[A-Za-z0-9.-]*[.:：\s]/i.test(stripInlineHtml(text));
    }
    function isFullTableCaption(text) {
      return /(?:^|\s)table\s*[A-Za-z]*\d[A-Za-z0-9.-]*[.:：\s]/i.test(stripInlineHtml(text));
    }
    function isSubfigureCaption(text) {
      return /^\(?[a-z]\)?\.?/i.test(stripInlineHtml(text));
    }
    function getCaptionLabel(text, fallbackKind, fallbackIndex) {
      const normalized = stripInlineHtml(text);
      const tableMatch = normalized.match(/(?:^|\s)table\s*([A-Za-z]*\d[A-Za-z0-9.-]*)/i);
      if (tableMatch) {
        return `table-${tableMatch[1].replace(/[.:：]+$/u, "")}`;
      }
      const figureMatch = normalized.match(/(?:^|\s)fig(?:ure)?\.?\s*([A-Za-z]*\d[A-Za-z0-9.-]*)/i);
      if (figureMatch) {
        return `figure-${figureMatch[1].replace(/[.:：]+$/u, "")}`;
      }
      return `${fallbackKind}-${fallbackIndex}`;
    }
    function splitTrailingSubcaption(caption) {
      const normalized = normalizeText(caption);
      const match = normalized.match(/^(.*\S)\s+(\([a-z]\)\s+[^()]+)$/i);
      if (!match) {
        return null;
      }
      const head = normalizeText(match[1]);
      const tail = normalizeText(match[2]);
      if (tail.length > 64) {
        return null;
      }
      if (!head || !tail || !isFullFigureCaption(head) && !isFullTableCaption(head)) {
        return null;
      }
      return { head, tail };
    }
    function getBBoxArray(bbox) {
      if (Array.isArray(bbox)) {
        return bbox;
      }
      if (bbox && typeof bbox === "object") {
        return [bbox.x1, bbox.y1, bbox.x2, bbox.y2];
      }
      return null;
    }
    function getBBoxArea(bbox) {
      const values = getBBoxArray(bbox);
      if (!values) {
        return 0;
      }
      const width = Math.max(0, Number(values[2]) - Number(values[0]));
      const height = Math.max(0, Number(values[3]) - Number(values[1]));
      return width * height;
    }
    function getIntersectionArea(a, b) {
      const boxA = getBBoxArray(a);
      const boxB = getBBoxArray(b);
      if (!boxA || !boxB) {
        return 0;
      }
      const x1 = Math.max(Number(boxA[0]), Number(boxB[0]));
      const y1 = Math.max(Number(boxA[1]), Number(boxB[1]));
      const x2 = Math.min(Number(boxA[2]), Number(boxB[2]));
      const y2 = Math.min(Number(boxA[3]), Number(boxB[3]));
      return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    }
    function hasDescriptiveCaption(media) {
      const caption = stripInlineHtml(media?.caption);
      return media?.hasFullCaption || caption.length >= 80;
    }
    function shouldMergePendingFragmentsWithMedia(fragments, media) {
      if (media?.kind !== "image" || !media?.bbox || !hasDescriptiveCaption(media)) {
        return false;
      }
      const compatibleFragments = fragments.filter((item) => item.kind === media.kind);
      if (!compatibleFragments.length) {
        return false;
      }
      return compatibleFragments.every((item) => {
        if (!item.bbox || item.hasFullCaption) {
          return false;
        }
        const area = getBBoxArea(item.bbox);
        return area > 0 && getIntersectionArea(item.bbox, media.bbox) / area >= 0.9;
      });
    }
    function getMediaInfo(block, blockIndex) {
      const blockType = String(block?.type || "").toLowerCase();
      const caption = getCaptionText(block);
      const trailingCaptionSplit = splitTrailingSubcaption(caption);
      let kind = blockType === "table" ? "table" : "image";
      if (isFullTableCaption(caption)) {
        kind = "table";
      } else if (isFullFigureCaption(caption)) {
        kind = "image";
      }
      const hasFullCaption = kind === "image" ? isFullFigureCaption(caption) : isFullTableCaption(caption);
      return {
        type: "media",
        kind,
        block,
        blockIndex,
        caption,
        trailingCaptionSplit,
        hasFullCaption,
        isFragment: !caption || isSubfigureCaption(caption),
        imagePath: getMediaImagePath(block),
        bbox: getBlockBBox(block),
        html: typeof block?.content?.html === "string" ? block.content.html : "",
        originalBlockType: blockType
      };
    }
    function isMediaBlock(block) {
      const type = String(block?.type || "").toLowerCase();
      return type === "image" || type === "table" || type === "chart";
    }
    function groupMineruBlocks(blocks) {
      const output = [];
      let pendingMedia = [];
      let mediaOrdinal = 0;
      function flushPending() {
        for (const item of pendingMedia) {
          mediaOrdinal += 1;
          output.push({
            type: "mediaGroup",
            kind: item.kind,
            caption: item.caption,
            label: getCaptionLabel(item.caption, item.kind, mediaOrdinal),
            items: [item]
          });
        }
        pendingMedia = [];
      }
      for (const [blockIndex, block] of blocks.entries()) {
        if (!isMediaBlock(block)) {
          flushPending();
          output.push({ type: "block", block, blockIndex });
          continue;
        }
        const media = getMediaInfo(block, blockIndex);
        if (media.hasFullCaption && media.trailingCaptionSplit && pendingMedia.length) {
          const compatibleFragments2 = pendingMedia.filter((item) => item.kind === media.kind);
          const incompatibleFragments2 = pendingMedia.filter((item) => !compatibleFragments2.includes(item));
          pendingMedia = incompatibleFragments2;
          flushPending();
          if (compatibleFragments2.length) {
            mediaOrdinal += 1;
            output.push({
              type: "mediaGroup",
              kind: media.kind,
              caption: media.trailingCaptionSplit.head,
              label: getCaptionLabel(media.trailingCaptionSplit.head, media.kind, mediaOrdinal),
              items: compatibleFragments2
            });
          }
          pendingMedia.push({
            ...media,
            caption: media.trailingCaptionSplit.tail,
            hasFullCaption: false,
            isFragment: true
          });
          continue;
        }
        if (!media.hasFullCaption) {
          if (shouldMergePendingFragmentsWithMedia(pendingMedia, media)) {
            const compatibleFragments2 = pendingMedia.filter((item) => item.kind === media.kind);
            const incompatibleFragments2 = pendingMedia.filter((item) => !compatibleFragments2.includes(item));
            pendingMedia = incompatibleFragments2;
            flushPending();
            mediaOrdinal += 1;
            output.push({
              type: "mediaGroup",
              kind: media.kind,
              caption: media.caption,
              label: getCaptionLabel(media.caption, media.kind, mediaOrdinal),
              items: [...compatibleFragments2, media]
            });
            continue;
          }
          pendingMedia.push(media);
          continue;
        }
        const compatibleFragments = pendingMedia.filter((item) => item.kind === media.kind);
        const incompatibleFragments = pendingMedia.filter((item) => !compatibleFragments.includes(item));
        pendingMedia = incompatibleFragments;
        flushPending();
        mediaOrdinal += 1;
        output.push({
          type: "mediaGroup",
          kind: media.kind,
          caption: media.caption,
          label: getCaptionLabel(media.caption, media.kind, mediaOrdinal),
          items: [...compatibleFragments, media]
        });
      }
      flushPending();
      return output;
    }
    function getUniqueCompositeName(usedNames, label) {
      const safeLabel = String(label || "composite").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "composite";
      let name = `${safeLabel}.jpg`;
      let suffix = 2;
      while (usedNames.has(name)) {
        name = `${safeLabel}-${suffix}.jpg`;
        suffix += 1;
      }
      usedNames.add(name);
      return name;
    }
    function resolveCanvasModule() {
      const candidates = [
        path.join(getPdfWorkerDir(), "pdf.js", "node_modules", "@napi-rs", "canvas"),
        path.join(__dirname, "node_modules", "@napi-rs", "canvas")
      ];
      for (const candidate of candidates) {
        try {
          return require(candidate);
        } catch {
        }
      }
      throw new Error("Cannot find @napi-rs/canvas for MinerU composite rendering");
    }
    function getUnionBBox(items) {
      const bboxes = items.map((item) => item.bbox).filter(Boolean);
      if (!bboxes.length) {
        return null;
      }
      const x1 = Math.min(...bboxes.map((bbox) => bbox.x1));
      const y1 = Math.min(...bboxes.map((bbox) => bbox.y1));
      const x2 = Math.max(...bboxes.map((bbox) => bbox.x2));
      const y2 = Math.max(...bboxes.map((bbox) => bbox.y2));
      return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 };
    }
    function buildMineruLayoutMediaGroups2(parsed) {
      if (!Array.isArray(parsed)) {
        return [];
      }
      const pages = normalizeMineruContentListPages2(parsed);
      const mediaGroups = [];
      for (const [pageIndex, pageItems] of pages.entries()) {
        const groupedBlocks = groupMineruBlocks(Array.isArray(pageItems) ? pageItems : []);
        for (const entry of groupedBlocks) {
          if (entry.type !== "mediaGroup") {
            continue;
          }
          const unionBBox = getUnionBBox(entry.items);
          if (!unionBBox) {
            continue;
          }
          mediaGroups.push({
            kind: entry.kind,
            layoutKind: entry.kind === "table" ? "table" : "figure",
            pageIndex,
            caption: entry.caption,
            label: entry.label,
            bbox: [unionBBox.x1, unionBBox.y1, unionBBox.x2, unionBBox.y2],
            unionBBox,
            blockIndices: entry.items.map((item) => item.blockIndex),
            imagePaths: entry.items.map((item) => item.imagePath).filter(Boolean),
            childBBoxes: entry.items.map((item) => item.bbox).filter(Boolean),
            itemCount: entry.items.length,
            isComposite: entry.kind === "image" && entry.items.length > 1
          });
        }
      }
      return mediaGroups;
    }
    async function createCompositeImage({ group, outputDir, usedNames }) {
      const imageItems = group.items.filter((item) => item.imagePath);
      if (group.kind !== "image" || imageItems.length <= 1) {
        return imageItems[0]?.imagePath || "";
      }
      if (imageItems.length > MAX_COMPOSITE_IMAGE_ITEMS) {
        return imageItems[0]?.imagePath || "";
      }
      const resolvedOutputDir = outputDir ? path.resolve(String(outputDir)) : "";
      if (!resolvedOutputDir) {
        return imageItems[0]?.imagePath || "";
      }
      const union = getUnionBBox(imageItems);
      if (!union) {
        return imageItems[0]?.imagePath || "";
      }
      const { createCanvas, loadImage } = resolveCanvasModule();
      const scale = 2;
      const padding = 8;
      const canvasWidth = Math.max(1, Math.ceil(union.width * scale) + padding * 2);
      const canvasHeight = Math.max(1, Math.ceil(union.height * scale) + padding * 2);
      if (canvasWidth > MAX_COMPOSITE_CANVAS_DIMENSION || canvasHeight > MAX_COMPOSITE_CANVAS_DIMENSION || canvasWidth * canvasHeight > MAX_COMPOSITE_CANVAS_PIXELS) {
        return imageItems[0]?.imagePath || "";
      }
      const canvas = createCanvas(canvasWidth, canvasHeight);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvasWidth, canvasHeight);
      for (const item of imageItems) {
        const resolvedImage = resolveAssetPathWithinOutputDir(resolvedOutputDir, item.imagePath);
        if (!resolvedImage) {
          return imageItems[0]?.imagePath || "";
        }
        const imageFullPath = resolvedImage.absolutePath;
        const image = await loadImage(imageFullPath);
        const x = Math.round((item.bbox.x1 - union.x1) * scale) + padding;
        const y = Math.round((item.bbox.y1 - union.y1) * scale) + padding;
        const width = Math.max(1, Math.round(item.bbox.width * scale));
        const height = Math.max(1, Math.round(item.bbox.height * scale));
        context.drawImage(image, x, y, width, height);
      }
      const compositeDir = path.resolve(resolvedOutputDir, "images", "_composite");
      if (!isPathInsideOrSameDirectory(compositeDir, resolvedOutputDir)) {
        return imageItems[0]?.imagePath || "";
      }
      await fs.mkdir(compositeDir, { recursive: true });
      const compositeName = getUniqueCompositeName(usedNames, group.label);
      const compositeRelativePath = path.posix.join("images", "_composite", compositeName);
      const compositePath = path.resolve(resolvedOutputDir, compositeRelativePath);
      if (!isPathInsideOrSameDirectory(compositePath, compositeDir)) {
        return imageItems[0]?.imagePath || "";
      }
      await fs.writeFile(compositePath, canvas.toBuffer("image/jpeg", 92));
      return compositeRelativePath;
    }
    function renderTitleBlock(block) {
      const title = getTitleText(block);
      if (!title) {
        return "";
      }
      return `${"#".repeat(getHeadingLevel(block))} ${title}`;
    }
    function renderParagraphBlock(block) {
      return getParagraphText(block);
    }
    function renderListBlock(block) {
      const listItems = Array.isArray(block?.content?.list_items) ? block.content.list_items : [];
      return listItems.map((item) => getListItemText(item)).filter(Boolean).map((text) => String(block?.content?.list_type || "").toLowerCase() === "reference_list" ? text : `- ${text}`).join("\n");
    }
    function renderEquationBlock(block) {
      const text = getEquationText(block);
      return text ? `$$
${text}
$$` : "";
    }
    function renderCodeBlock(block) {
      const text = getParagraphText(block);
      return text ? `\`\`\`
${text}
\`\`\`` : "";
    }
    async function renderMediaGroup(group, outputDir, usedCompositeNames) {
      const mediaPath = await createCompositeImage({ group, outputDir, usedNames: usedCompositeNames });
      const caption = normalizeText(group.caption);
      if (group.kind === "table") {
        const tableItem = group.items[group.items.length - 1];
        const parts2 = [];
        if (caption) {
          parts2.push(caption);
        }
        if (tableItem?.html) {
          parts2.push(tableItem.html);
        } else if (mediaPath) {
          parts2.push(`![](${mediaPath})`);
        }
        return parts2.join("\n\n");
      }
      const parts = [];
      if (mediaPath) {
        parts.push(`![](${mediaPath})`);
      }
      if (caption) {
        parts.push(caption);
      }
      return parts.join("  \n");
    }
    async function normalizeMineruMarkdownLayout({ markdown = "", jsonText = "", outputDir = "" } = {}) {
      if (String(jsonText || "").length > MAX_LAYOUT_JSON_CHARS) {
        throw new Error(`MinerU layout JSON \u8FC7\u5927 (${MAX_LAYOUT_JSON_CHARS} chars)`);
      }
      const parsed = JSON.parse(jsonText);
      const blocks = flattenMineruBlocks(parsed);
      if (blocks.length > MAX_LAYOUT_BLOCKS) {
        throw new Error(`MinerU layout block \u6570\u91CF\u8D85\u8FC7\u4E0A\u9650 (${MAX_LAYOUT_BLOCKS})`);
      }
      const groupedBlocks = groupMineruBlocks(blocks);
      const usedCompositeNames = /* @__PURE__ */ new Set();
      const rendered = [];
      for (const entry of groupedBlocks) {
        let chunk = "";
        if (entry.type === "mediaGroup") {
          chunk = await renderMediaGroup(entry, outputDir, usedCompositeNames);
        } else {
          const block = entry.block;
          const blockType = String(block?.type || "").toLowerCase();
          if (blockType === "title") {
            chunk = renderTitleBlock(block);
          } else if (["paragraph", "text", "ref_text", "aside_text", "page_footnote"].includes(blockType)) {
            chunk = renderParagraphBlock(block);
          } else if (blockType === "list") {
            chunk = renderListBlock(block);
          } else if (blockType === "equation_interline" || blockType === "equation") {
            chunk = renderEquationBlock(block);
          } else if (blockType === "code") {
            chunk = renderCodeBlock(block);
          }
        }
        if (chunk) {
          rendered.push(chunk);
        }
      }
      const normalizedMarkdown = rendered.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
      return {
        markdown: normalizedMarkdown || markdown,
        groups: groupedBlocks.filter((entry) => entry.type === "mediaGroup").map((entry) => ({
          kind: entry.kind,
          caption: entry.caption,
          label: entry.label,
          blockIndices: entry.items.map((item) => item.blockIndex),
          imagePaths: entry.items.map((item) => item.imagePath).filter(Boolean),
          bboxes: entry.items.map((item) => item.bbox).filter(Boolean),
          unionBBox: getUnionBBox(entry.items),
          isComposite: entry.kind === "image" && entry.items.length > 1
        }))
      };
    }
    module2.exports = {
      buildMineruLayoutMediaGroups: buildMineruLayoutMediaGroups2,
      normalizeMineruContentListPages: normalizeMineruContentListPages2,
      normalizeMineruMarkdownLayout
    };
  }
});

// vendor/mineru/source/layout-derived.js
var { randomUUID } = require("node:crypto");
var createID = () => randomUUID().replaceAll("-", "").slice(0, 16);
var nowISO = () => (/* @__PURE__ */ new Date()).toISOString();
var { normalizeMineruContentListPages, buildMineruLayoutMediaGroups } = require_mineru_layout_normalizer();
function normalizePageLabel(pageIndex) {
  return String(pageIndex + 1);
}
function padSortIndexSegment(value, length) {
  return String(Math.max(0, Math.floor(Number(value) || 0))).slice(0, length).padStart(length, "0");
}
function getRectFromBox(box) {
  if (!box) {
    return null;
  }
  const x1 = Number(box.x);
  const y1 = Number(box.y);
  const x2 = Number(box.x2);
  const y2 = Number(box.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return null;
  }
  return [
    Math.min(x1, x2),
    Math.min(y1, y2),
    Math.max(x1, x2),
    Math.max(y1, y2)
  ];
}
function getSortIndexForRect(pageMetrics, pageIndex, rect) {
  const pageHeight = Number(pageMetrics?.[pageIndex]?.height || 0);
  const top = Math.max(0, (pageHeight || rect[3] || 0) - rect[3]);
  return [
    padSortIndexSegment(pageIndex, 5),
    padSortIndexSegment(0, 6),
    padSortIndexSegment(top, 5)
  ].join("|");
}
function buildLayoutAnnotationComment(item, fallbackLabel) {
  const parts = [];
  const label = String(item?.caption_label || fallbackLabel || "").trim();
  const caption = String(item?.caption_text || "").trim();
  const title = String(item?.title_text || "").trim();
  if (label) {
    parts.push(label);
  }
  if (caption) {
    parts.push(caption);
  } else if (title) {
    parts.push(title);
  }
  return parts.join("\n");
}
function getBoxFromLayoutItems(items) {
  const boxes = items.map((item) => item?.box).filter(Boolean).map((box) => {
    const x1 = Number(box.x);
    const y1 = Number(box.y);
    const x22 = Number(box.x2);
    const y22 = Number(box.y2);
    if (![x1, y1, x22, y22].every(Number.isFinite)) {
      return null;
    }
    return {
      x: Math.min(x1, x22),
      y: Math.min(y1, y22),
      x2: Math.max(x1, x22),
      y2: Math.max(y1, y22)
    };
  }).filter(Boolean);
  if (!boxes.length) {
    return null;
  }
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const x2 = Math.max(...boxes.map((box) => box.x2));
  const y2 = Math.max(...boxes.map((box) => box.y2));
  return {
    x,
    y,
    x2,
    y2,
    width: x2 - x,
    height: y2 - y
  };
}
function getLayoutItemCaptionLabel(item, kind, fallbackIndex) {
  const prefix = kind === "figure" ? "Figure" : "Table";
  const captionText = [
    item?.caption_label,
    item?.caption_text,
    item?.title_text,
    item?.text
  ].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  const pattern = kind === "figure" ? /\b(Fig(?:ure)?\.?\s*[A-Za-z0-9.-]+)/i : /\b(Table\s*[A-Za-z0-9.-]+)/i;
  const match = captionText.match(pattern);
  if (match) {
    return match[1].replace(/^fig\b/i, "Figure").replace(/^figure/i, "Figure").replace(/^table/i, "Table").replace(/\s+/g, " ").trim();
  }
  return String(item?.caption_label || `${prefix} ${item?.index || fallbackIndex || ""}`).trim();
}
function canMergeLegacyLayoutLabel(label, kind) {
  const normalized = String(label || "").trim();
  if (kind === "figure") {
    return /\b(?:fig(?:ure)?\.?)\s*[A-Za-z0-9.-]+/i.test(normalized) && !/^figure$/i.test(normalized);
  }
  return /\btable\s*[A-Za-z0-9.-]+/i.test(normalized) && !/^table$/i.test(normalized);
}
function groupLegacyLayoutItems(items, kind) {
  const groups = [];
  const labeledGroups = /* @__PURE__ */ new Map();
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const label = getLayoutItemCaptionLabel(item, kind, index + 1);
    const mergeKey = canMergeLegacyLayoutLabel(label, kind) ? label.toLowerCase() : "";
    if (mergeKey) {
      const existing = labeledGroups.get(mergeKey);
      if (existing) {
        existing.items.push(item);
        continue;
      }
      const group = { label, items: [item] };
      labeledGroups.set(mergeKey, group);
      groups.push(group);
      continue;
    }
    groups.push({ label, items: [item] });
  }
  return groups.map((group, groupIndex) => {
    const representative = group.items[group.items.length - 1] || {};
    const box = getBoxFromLayoutItems(group.items);
    return {
      ...representative,
      box,
      caption_label: group.label || representative.caption_label,
      caption_text: representative.caption_text || group.items.map((item) => item.caption_text).filter(Boolean).join(" "),
      layoutItemCount: group.items.length,
      layoutItemIndices: group.items.map((item) => item.index).filter((value) => value !== void 0),
      index: representative.index || groupIndex + 1
    };
  }).filter((item) => item.box);
}
function getLegacyPageItems(page, kind) {
  const directKey = kind === "figure" ? "figures" : "tables";
  if (Array.isArray(page?.[directKey])) {
    return page[directKey];
  }
  const layoutRegions = page?.layout_regions && typeof page.layout_regions === "object" ? page.layout_regions : {};
  const classNames = kind === "figure" ? ["figure"] : ["table"];
  return classNames.flatMap((className) => Array.isArray(layoutRegions[className]) ? layoutRegions[className].map((region) => ({
    ...region,
    index: region.index || region.id,
    caption_label: kind === "figure" ? `Figure ${region.index || region.id || ""}` : `Table ${region.index || region.id || ""}`
  })) : []);
}
function createLayoutAnnotation({ kind, pageIndex, box, item, color, pageMetrics, sourcePath }) {
  const rect = getRectFromBox(box);
  if (!rect) {
    return null;
  }
  const labelPrefix = kind === "figure" ? "Figure" : "Table";
  return {
    id: createID(),
    type: "image",
    color,
    pageLabel: normalizePageLabel(pageIndex),
    sortIndex: getSortIndexForRect(pageMetrics, pageIndex, rect),
    position: {
      pageIndex,
      rects: [rect]
    },
    text: String(item?.caption_label || `${labelPrefix} ${item?.index || ""}`).trim(),
    comment: buildLayoutAnnotationComment(item, `${labelPrefix} ${item?.index || ""}`),
    tags: [],
    dateCreated: nowISO(),
    dateModified: nowISO(),
    projectOrigin: "layout-json",
    layoutKind: kind,
    layoutSourcePath: sourcePath,
    layoutItemCount: item?.layoutItemCount || 1,
    layoutItemIndices: item?.layoutItemIndices || []
  };
}
function getRectFromBBoxArray(bbox, pageHeight = 0) {
  if (!Array.isArray(bbox) || bbox.length < 4) {
    return null;
  }
  const [x1, y1, x2, y2] = bbox.map((value) => Number(value));
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return null;
  }
  const normalizedPageHeight = Number(pageHeight || 0);
  if (normalizedPageHeight > 0) {
    return [
      Math.min(x1, x2),
      Math.min(normalizedPageHeight - y2, normalizedPageHeight - y1),
      Math.max(x1, x2),
      Math.max(normalizedPageHeight - y2, normalizedPageHeight - y1)
    ];
  }
  return [
    Math.min(x1, x2),
    Math.min(y1, y2),
    Math.max(x1, x2),
    Math.max(y1, y2)
  ];
}
function buildContentListCoordinateSpace(parsed) {
  const pages = normalizeMineruContentListPages(parsed);
  const pageBounds = [];
  let documentMaxX = 0;
  let documentMaxY = 0;
  for (const [pageIndex, pageItems] of pages.entries()) {
    let pageMaxX = 0;
    let pageMaxY = 0;
    if (Array.isArray(pageItems)) {
      for (const item of pageItems) {
        if (!Array.isArray(item?.bbox) || item.bbox.length < 4) {
          continue;
        }
        const [x1, y1, x2, y2] = item.bbox.map((value) => Number(value));
        if (![x1, y1, x2, y2].every(Number.isFinite)) {
          continue;
        }
        pageMaxX = Math.max(pageMaxX, x1, x2);
        pageMaxY = Math.max(pageMaxY, y1, y2);
      }
    }
    documentMaxX = Math.max(documentMaxX, pageMaxX);
    documentMaxY = Math.max(documentMaxY, pageMaxY);
    pageBounds[pageIndex] = {
      sourceWidth: pageMaxX,
      sourceHeight: pageMaxY
    };
  }
  return {
    pageBounds,
    documentSourceWidth: documentMaxX,
    documentSourceHeight: documentMaxY
  };
}
function normalizeContentListExtent(value) {
  const numericValue = Number(value || 0);
  if (!(numericValue > 0)) {
    return 0;
  }
  if (numericValue >= 850 && numericValue <= 1050) {
    return 1e3;
  }
  return numericValue;
}
function mapContentListRectToPdfRect(bbox, pageMetrics, coordinateSpace, pageIndex) {
  if (!Array.isArray(bbox) || bbox.length < 4) {
    return null;
  }
  const [x1, y1, x2, y2] = bbox.map((value) => Number(value));
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return null;
  }
  const pdfWidth = Number(pageMetrics?.width || 0);
  const pdfHeight = Number(pageMetrics?.height || 0);
  if (!(pdfWidth > 0) || !(pdfHeight > 0)) {
    return getRectFromBBoxArray(bbox);
  }
  const pageBounds = coordinateSpace?.pageBounds?.[pageIndex] || {};
  const sourceWidth = normalizeContentListExtent(pageBounds.sourceWidth || coordinateSpace?.documentSourceWidth || 0);
  const sourceHeight = normalizeContentListExtent(pageBounds.sourceHeight || coordinateSpace?.documentSourceHeight || 0);
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    return getRectFromBBoxArray(bbox);
  }
  const scaleX = pdfWidth / sourceWidth;
  const scaleY = pdfHeight / sourceHeight;
  return [
    Math.min(x1, x2) * scaleX,
    (sourceHeight - Math.max(y1, y2)) * scaleY,
    Math.max(x1, x2) * scaleX,
    (sourceHeight - Math.min(y1, y2)) * scaleY
  ];
}
function extractRichText(node) {
  if (!node) {
    return "";
  }
  if (typeof node === "string") {
    return node.trim();
  }
  if (Array.isArray(node)) {
    return node.map((item) => extractRichText(item)).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  if (typeof node.content === "string") {
    return node.content.trim();
  }
  const nestedKeys = [
    "item_content",
    "paragraph_content",
    "title_content",
    "image_caption",
    "image_footnote",
    "chart_caption",
    "chart_footnote",
    "table_caption",
    "table_footnote",
    "page_header_content",
    "page_footer_content",
    "page_footnote_content",
    "page_aside_text_content"
  ];
  for (const key of nestedKeys) {
    if (Array.isArray(node[key])) {
      return extractRichText(node[key]);
    }
  }
  return "";
}
function extractContentListLabel(caption, kind) {
  const normalizedCaption = String(caption || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!normalizedCaption) {
    return kind === "figure" ? "Figure" : "Table";
  }
  const pattern = kind === "figure" ? /\b(Figure\s*[A-Za-z0-9.-]*)/i : /\b(Table\s*[A-Za-z0-9.-]*)/i;
  const match = normalizedCaption.match(pattern);
  return match?.[1]?.trim() || (kind === "figure" ? "Figure" : "Table");
}
function buildContentListAnnotationComment({ label, caption, footnote }) {
  const parts = [];
  const normalizedLabel = String(label || "").trim();
  const normalizedCaption = String(caption || "").trim();
  const normalizedFootnote = String(footnote || "").trim();
  if (normalizedCaption) {
    parts.push(normalizedCaption);
  } else if (normalizedLabel) {
    parts.push(normalizedLabel);
  }
  if (normalizedFootnote) {
    parts.push(normalizedFootnote);
  }
  return parts.join("\n");
}
function createContentListAnnotation({ kind, pageIndex, item, color, pageMetrics, sourcePath, coordinateSpace }) {
  const rect = mapContentListRectToPdfRect(item?.bbox, pageMetrics?.[pageIndex], coordinateSpace, pageIndex);
  if (!rect) {
    return null;
  }
  const content = item?.content || {};
  const caption = kind === "figure" ? extractRichText(item?.chart_caption || content.chart_caption || item?.image_caption || content.image_caption) : extractRichText(item?.table_caption || content.table_caption);
  const footnote = kind === "figure" ? extractRichText(item?.chart_footnote || content.chart_footnote || item?.image_footnote || content.image_footnote) : extractRichText(item?.table_footnote || content.table_footnote);
  const label = extractContentListLabel(caption, kind);
  const assetPath = String(item?.img_path || item?.image_path || content?.image_source?.path || content?.img_path || content?.image_path || "").trim();
  return {
    id: createID(),
    type: "image",
    color,
    pageLabel: normalizePageLabel(pageIndex),
    sortIndex: getSortIndexForRect(pageMetrics, pageIndex, rect),
    position: {
      pageIndex,
      rects: [rect]
    },
    text: label,
    comment: buildContentListAnnotationComment({ label, caption, footnote }),
    tags: [],
    dateCreated: nowISO(),
    dateModified: nowISO(),
    projectOrigin: "layout-json",
    layoutKind: kind,
    layoutSourcePath: sourcePath,
    layoutAssetPath: assetPath
  };
}
function createContentListGroupAnnotation({ group, color, pageMetrics, sourcePath, coordinateSpace }) {
  const kind = group.layoutKind === "table" ? "table" : "figure";
  const rect = mapContentListRectToPdfRect(group.bbox, pageMetrics?.[group.pageIndex], coordinateSpace, group.pageIndex);
  if (!rect) {
    return null;
  }
  const caption = String(group.caption || "").trim();
  const label = extractContentListLabel(caption || group.label, kind);
  const assetPath = String(group.imagePaths?.[0] || "").trim();
  return {
    id: createID(),
    type: "image",
    color,
    pageLabel: normalizePageLabel(group.pageIndex),
    sortIndex: getSortIndexForRect(pageMetrics, group.pageIndex, rect),
    position: {
      pageIndex: group.pageIndex,
      rects: [rect]
    },
    text: label,
    comment: buildContentListAnnotationComment({ label, caption }),
    tags: [],
    dateCreated: nowISO(),
    dateModified: nowISO(),
    projectOrigin: "layout-json",
    layoutKind: kind,
    layoutSourcePath: sourcePath,
    layoutAssetPath: assetPath,
    layoutBlockIndices: group.blockIndices || [],
    layoutChildBBoxes: group.childBBoxes || [],
    layoutComposite: !!group.isComposite
  };
}
function extractLayoutAnnotationsFromContentList(parsed, pageMetrics, sourcePath) {
  if (!Array.isArray(parsed)) {
    return [];
  }
  const coordinateSpace = buildContentListCoordinateSpace(parsed);
  const mediaGroups = buildMineruLayoutMediaGroups(parsed);
  if (mediaGroups.length) {
    return mediaGroups.map((group) => createContentListGroupAnnotation({
      group,
      color: group.layoutKind === "figure" ? "#18a0fb" : "#ff5f2e",
      pageMetrics,
      sourcePath,
      coordinateSpace
    })).filter(Boolean);
  }
  const importedAnnotations = [];
  const pages = normalizeMineruContentListPages(parsed);
  for (const [pageIndex, pageItems] of pages.entries()) {
    if (!Array.isArray(pageItems)) {
      continue;
    }
    for (const item of pageItems) {
      const itemType = String(item?.type || "").trim().toLowerCase();
      if (itemType !== "image" && itemType !== "table" && itemType !== "chart") {
        continue;
      }
      const annotation = createContentListAnnotation({
        kind: itemType === "table" ? "table" : "figure",
        pageIndex,
        item,
        color: itemType === "table" ? "#ff5f2e" : "#18a0fb",
        pageMetrics,
        sourcePath,
        coordinateSpace
      });
      if (annotation) {
        importedAnnotations.push(annotation);
      }
    }
  }
  return importedAnnotations;
}
function extractLayoutAnnotationsFromLegacyJson(parsed, pageMetrics, sourcePath) {
  const pages = Array.isArray(parsed?.pages) ? parsed.pages : [];
  const importedAnnotations = [];
  for (const page of pages) {
    const pageIndex = Math.max(0, Number(page?.page_number || 1) - 1);
    for (const figure of groupLegacyLayoutItems(getLegacyPageItems(page, "figure"), "figure")) {
      const annotation = createLayoutAnnotation({
        kind: "figure",
        pageIndex,
        box: figure?.box,
        item: figure,
        color: "#18a0fb",
        pageMetrics,
        sourcePath
      });
      if (annotation) {
        importedAnnotations.push(annotation);
      }
    }
    for (const table of groupLegacyLayoutItems(getLegacyPageItems(page, "table"), "table")) {
      const annotation = createLayoutAnnotation({
        kind: "table",
        pageIndex,
        box: table?.box,
        item: table,
        color: "#ff5f2e",
        pageMetrics,
        sourcePath
      });
      if (annotation) {
        importedAnnotations.push(annotation);
      }
    }
  }
  return importedAnnotations;
}
module.exports = { extractLayoutAnnotationsFromContentList, extractLayoutAnnotationsFromLegacyJson, mapContentListRectToPdfRect, buildContentListCoordinateSpace };
