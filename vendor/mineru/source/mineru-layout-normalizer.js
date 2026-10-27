const fs = require('fs/promises');
const path = require('path');

const { getPdfWorkerDir } = require('./runtime-paths');

const MAX_LAYOUT_JSON_CHARS = 80 * 1024 * 1024;
const MAX_LAYOUT_BLOCKS = 20000;
const MAX_COMPOSITE_IMAGE_ITEMS = 32;
const MAX_COMPOSITE_CANVAS_DIMENSION = 12000;
const MAX_COMPOSITE_CANVAS_PIXELS = 32 * 1024 * 1024;
const MAX_BBOX_COORDINATE = 1_000_000;
const SAFE_ASSET_SEGMENT_PATTERN = /^[A-Za-z0-9._ -]+$/u;

function areSamePath(left, right) {
	const resolvedLeft = path.resolve(String(left || ''));
	const resolvedRight = path.resolve(String(right || ''));
	return process.platform === 'win32'
		? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
		: resolvedLeft === resolvedRight;
}

function isPathInsideOrSameDirectory(targetPath, parentDir) {
	const target = path.resolve(String(targetPath || ''));
	const parent = path.resolve(String(parentDir || ''));
	if (areSamePath(target, parent)) {
		return true;
	}
	const relative = path.relative(parent, target);
	return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function normalizeRelativeAssetPath(value) {
	const normalized = String(value || '').trim().replace(/\\/g, '/');
	if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//u.test(normalized) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(normalized)) {
		return '';
	}
	const parts = normalized.split('/').filter(Boolean);
	if (parts.length === 0 || parts.some((part) => part === '.' || part === '..' || !SAFE_ASSET_SEGMENT_PATTERN.test(part))) {
		return '';
	}
	return parts.join('/');
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
		absolutePath,
	};
}

function flattenMineruBlocks(parsed) {
	if (!Array.isArray(parsed)) {
		return [];
	}
	return parsed.flatMap((entry) => (Array.isArray(entry) ? entry : [entry])).filter(Boolean);
}

function getMineruBlockPageIndex(block) {
	const zeroBasedCandidates = [
		block?.page_idx,
		block?.page_index,
		block?.pageIndex,
		block?.content?.page_idx,
		block?.content?.page_index,
		block?.content?.pageIndex,
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
		block?.content?.page,
	];
	for (const value of oneBasedCandidates) {
		const pageNumber = Number(value);
		if (Number.isInteger(pageNumber) && pageNumber > 0) {
			return pageNumber - 1;
		}
	}

	return null;
}

function normalizeMineruContentListPages(parsed) {
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

function extractRichText(node) {
	if (!node) {
		return '';
	}
	if (typeof node === 'string') {
		return node.trim();
	}
	if (Array.isArray(node)) {
		return node.map((item) => extractRichText(item)).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
	}
	if (typeof node.text === 'string') {
		return node.text.trim();
	}
	if (typeof node.text_content === 'string') {
		return node.text_content.trim();
	}
	if (typeof node.content === 'string') {
		return node.content.trim();
	}

	const nestedKeys = [
		'item_content',
		'paragraph_content',
		'title_content',
		'image_caption',
		'image_footnote',
		'chart_caption',
		'chart_footnote',
		'table_caption',
		'table_footnote',
		'page_header_content',
		'page_footer_content',
		'page_footnote_content',
		'page_aside_text_content',
	];
	for (const key of nestedKeys) {
		if (Array.isArray(node[key])) {
			return extractRichText(node[key]);
		}
	}
	if (typeof node.math_content === 'string') {
		return node.math_content.trim();
	}
	return '';
}

function normalizeText(value) {
	return String(value || '').replace(/\r/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripInlineHtml(value) {
	return normalizeText(String(value || '').replace(/<[^>]+>/g, ' '));
}

function firstRichText(...candidates) {
	for (const candidate of candidates) {
		const text = extractRichText(candidate);
		if (text) {
			return normalizeText(text);
		}
	}
	return '';
}

function getTitleText(block) {
	return firstRichText(
		block?.content?.title_content,
		block?.title,
		block?.text,
		block?.content?.text,
		block?.content,
	);
}

function getParagraphText(block) {
	return firstRichText(
		block?.content?.paragraph_content,
		block?.text,
		block?.text_content,
		block?.content?.text,
		block?.content?.text_content,
		block?.content,
	);
}

function getListItemText(item) {
	return normalizeText(extractRichText(item?.item_content || item));
}

function getCaptionText(block) {
	const blockType = String(block?.type || '').toLowerCase();
	if (blockType === 'table') {
		return normalizeText([
			extractRichText(block?.table_caption),
			extractRichText(block?.content?.table_caption),
			extractRichText(block?.table_footnote),
			extractRichText(block?.content?.table_footnote),
		].filter(Boolean).join(' '));
	}
	return normalizeText([
		extractRichText(block?.chart_caption),
		extractRichText(block?.content?.chart_caption),
		extractRichText(block?.image_caption),
		extractRichText(block?.content?.image_caption),
		extractRichText(block?.chart_footnote),
		extractRichText(block?.content?.chart_footnote),
		extractRichText(block?.image_footnote),
		extractRichText(block?.content?.image_footnote),
	].filter(Boolean).join(' '));
}

function getEquationText(block) {
	return firstRichText(
		block?.content?.math_content,
		block?.math_content,
		block?.latex,
		block?.tex,
		block?.text,
		block?.content,
	);
}

function getMediaImagePath(block) {
	const imagePath = block?.img_path
		|| block?.image_path
		|| block?.content?.image_source?.path
		|| block?.content?.img_path
		|| block?.content?.image_path;
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
		return `table-${tableMatch[1].replace(/[.:：]+$/u, '')}`;
	}
	const figureMatch = normalized.match(/(?:^|\s)fig(?:ure)?\.?\s*([A-Za-z]*\d[A-Za-z0-9.-]*)/i);
	if (figureMatch) {
		return `figure-${figureMatch[1].replace(/[.:：]+$/u, '')}`;
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
	if (!head || !tail || (!isFullFigureCaption(head) && !isFullTableCaption(head))) {
		return null;
	}
	return { head, tail };
}

function getBBoxArray(bbox) {
	if (Array.isArray(bbox)) {
		return bbox;
	}
	if (bbox && typeof bbox === 'object') {
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
	if (media?.kind !== 'image' || !media?.bbox || !hasDescriptiveCaption(media)) {
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
	const blockType = String(block?.type || '').toLowerCase();
	const caption = getCaptionText(block);
	const trailingCaptionSplit = splitTrailingSubcaption(caption);
	let kind = blockType === 'table' ? 'table' : 'image';
	if (isFullTableCaption(caption)) {
		kind = 'table';
	}
	else if (isFullFigureCaption(caption)) {
		kind = 'image';
	}
	const hasFullCaption = kind === 'image' ? isFullFigureCaption(caption) : isFullTableCaption(caption);
	return {
		type: 'media',
		kind,
		block,
		blockIndex,
		caption,
		trailingCaptionSplit,
		hasFullCaption,
		isFragment: !caption || isSubfigureCaption(caption),
		imagePath: getMediaImagePath(block),
		bbox: getBlockBBox(block),
		html: typeof block?.content?.html === 'string' ? block.content.html : '',
		originalBlockType: blockType,
	};
}

function isMediaBlock(block) {
	const type = String(block?.type || '').toLowerCase();
	return type === 'image' || type === 'table' || type === 'chart';
}

function groupMineruBlocks(blocks) {
	const output = [];
	let pendingMedia = [];
	let mediaOrdinal = 0;

	function flushPending() {
		for (const item of pendingMedia) {
			mediaOrdinal += 1;
			output.push({
				type: 'mediaGroup',
				kind: item.kind,
				caption: item.caption,
				label: getCaptionLabel(item.caption, item.kind, mediaOrdinal),
				items: [item],
			});
		}
		pendingMedia = [];
	}

	for (const [blockIndex, block] of blocks.entries()) {
		if (!isMediaBlock(block)) {
			flushPending();
			output.push({ type: 'block', block, blockIndex });
			continue;
		}

		const media = getMediaInfo(block, blockIndex);
		if (media.hasFullCaption && media.trailingCaptionSplit && pendingMedia.length) {
			const compatibleFragments = pendingMedia.filter((item) => item.kind === media.kind);
			const incompatibleFragments = pendingMedia.filter((item) => !compatibleFragments.includes(item));
			pendingMedia = incompatibleFragments;
			flushPending();

			if (compatibleFragments.length) {
				mediaOrdinal += 1;
				output.push({
					type: 'mediaGroup',
					kind: media.kind,
					caption: media.trailingCaptionSplit.head,
					label: getCaptionLabel(media.trailingCaptionSplit.head, media.kind, mediaOrdinal),
					items: compatibleFragments,
				});
			}

			pendingMedia.push({
				...media,
				caption: media.trailingCaptionSplit.tail,
				hasFullCaption: false,
				isFragment: true,
			});
			continue;
		}

		if (!media.hasFullCaption) {
			if (shouldMergePendingFragmentsWithMedia(pendingMedia, media)) {
				const compatibleFragments = pendingMedia.filter((item) => item.kind === media.kind);
				const incompatibleFragments = pendingMedia.filter((item) => !compatibleFragments.includes(item));
				pendingMedia = incompatibleFragments;
				flushPending();

				mediaOrdinal += 1;
				output.push({
					type: 'mediaGroup',
					kind: media.kind,
					caption: media.caption,
					label: getCaptionLabel(media.caption, media.kind, mediaOrdinal),
					items: [...compatibleFragments, media],
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
			type: 'mediaGroup',
			kind: media.kind,
			caption: media.caption,
			label: getCaptionLabel(media.caption, media.kind, mediaOrdinal),
			items: [...compatibleFragments, media],
		});
	}

	flushPending();
	return output;
}

function getUniqueCompositeName(usedNames, label) {
	const safeLabel = String(label || 'composite')
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		|| 'composite';
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
		path.join(getPdfWorkerDir(), 'pdf.js', 'node_modules', '@napi-rs', 'canvas'),
		path.join(__dirname, 'node_modules', '@napi-rs', 'canvas'),
	];
	for (const candidate of candidates) {
		try {
			return require(candidate);
		}
		catch {
			// Try the next runtime location.
		}
	}
	throw new Error('Cannot find @napi-rs/canvas for MinerU composite rendering');
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

function buildMineruLayoutMediaGroups(parsed) {
	if (!Array.isArray(parsed)) {
		return [];
	}

	const pages = normalizeMineruContentListPages(parsed);
	const mediaGroups = [];

	for (const [pageIndex, pageItems] of pages.entries()) {
		const groupedBlocks = groupMineruBlocks(Array.isArray(pageItems) ? pageItems : []);
		for (const entry of groupedBlocks) {
			if (entry.type !== 'mediaGroup') {
				continue;
			}
			const unionBBox = getUnionBBox(entry.items);
			if (!unionBBox) {
				continue;
			}
			mediaGroups.push({
				kind: entry.kind,
				layoutKind: entry.kind === 'table' ? 'table' : 'figure',
				pageIndex,
				caption: entry.caption,
				label: entry.label,
				bbox: [unionBBox.x1, unionBBox.y1, unionBBox.x2, unionBBox.y2],
				unionBBox,
				blockIndices: entry.items.map((item) => item.blockIndex),
				imagePaths: entry.items.map((item) => item.imagePath).filter(Boolean),
				childBBoxes: entry.items.map((item) => item.bbox).filter(Boolean),
				itemCount: entry.items.length,
				isComposite: entry.kind === 'image' && entry.items.length > 1,
			});
		}
	}

	return mediaGroups;
}

async function createCompositeImage({ group, outputDir, usedNames }) {
	const imageItems = group.items.filter((item) => item.imagePath);
	if (group.kind !== 'image' || imageItems.length <= 1) {
		return imageItems[0]?.imagePath || '';
	}
	if (imageItems.length > MAX_COMPOSITE_IMAGE_ITEMS) {
		return imageItems[0]?.imagePath || '';
	}
	const resolvedOutputDir = outputDir ? path.resolve(String(outputDir)) : '';
	if (!resolvedOutputDir) {
		return imageItems[0]?.imagePath || '';
	}

	const union = getUnionBBox(imageItems);
	if (!union) {
		return imageItems[0]?.imagePath || '';
	}

	const { createCanvas, loadImage } = resolveCanvasModule();
	const scale = 2;
	const padding = 8;
	const canvasWidth = Math.max(1, Math.ceil(union.width * scale) + padding * 2);
	const canvasHeight = Math.max(1, Math.ceil(union.height * scale) + padding * 2);
	if (
		canvasWidth > MAX_COMPOSITE_CANVAS_DIMENSION
		|| canvasHeight > MAX_COMPOSITE_CANVAS_DIMENSION
		|| canvasWidth * canvasHeight > MAX_COMPOSITE_CANVAS_PIXELS
	) {
		return imageItems[0]?.imagePath || '';
	}
	const canvas = createCanvas(canvasWidth, canvasHeight);
	const context = canvas.getContext('2d');
	context.fillStyle = '#ffffff';
	context.fillRect(0, 0, canvasWidth, canvasHeight);

	for (const item of imageItems) {
		const resolvedImage = resolveAssetPathWithinOutputDir(resolvedOutputDir, item.imagePath);
		if (!resolvedImage) {
			return imageItems[0]?.imagePath || '';
		}
		const imageFullPath = resolvedImage.absolutePath;
		const image = await loadImage(imageFullPath);
		const x = Math.round((item.bbox.x1 - union.x1) * scale) + padding;
		const y = Math.round((item.bbox.y1 - union.y1) * scale) + padding;
		const width = Math.max(1, Math.round(item.bbox.width * scale));
		const height = Math.max(1, Math.round(item.bbox.height * scale));
		context.drawImage(image, x, y, width, height);
	}

	const compositeDir = path.resolve(resolvedOutputDir, 'images', '_composite');
	if (!isPathInsideOrSameDirectory(compositeDir, resolvedOutputDir)) {
		return imageItems[0]?.imagePath || '';
	}
	await fs.mkdir(compositeDir, { recursive: true });
	const compositeName = getUniqueCompositeName(usedNames, group.label);
	const compositeRelativePath = path.posix.join('images', '_composite', compositeName);
	const compositePath = path.resolve(resolvedOutputDir, compositeRelativePath);
	if (!isPathInsideOrSameDirectory(compositePath, compositeDir)) {
		return imageItems[0]?.imagePath || '';
	}
	await fs.writeFile(compositePath, canvas.toBuffer('image/jpeg', 92));
	return compositeRelativePath;
}

function renderTitleBlock(block) {
	const title = getTitleText(block);
	if (!title) {
		return '';
	}
	return `${'#'.repeat(getHeadingLevel(block))} ${title}`;
}

function renderParagraphBlock(block) {
	return getParagraphText(block);
}

function renderListBlock(block) {
	const listItems = Array.isArray(block?.content?.list_items) ? block.content.list_items : [];
	return listItems
		.map((item) => getListItemText(item))
		.filter(Boolean)
		.map((text) => String(block?.content?.list_type || '').toLowerCase() === 'reference_list' ? text : `- ${text}`)
		.join('\n');
}

function renderEquationBlock(block) {
	const text = getEquationText(block);
	return text ? `$$\n${text}\n$$` : '';
}

function renderCodeBlock(block) {
	const text = getParagraphText(block);
	return text ? `\`\`\`\n${text}\n\`\`\`` : '';
}

async function renderMediaGroup(group, outputDir, usedCompositeNames) {
	const mediaPath = await createCompositeImage({ group, outputDir, usedNames: usedCompositeNames });
	const caption = normalizeText(group.caption);
	if (group.kind === 'table') {
		const tableItem = group.items[group.items.length - 1];
		const parts = [];
		if (caption) {
			parts.push(caption);
		}
		if (tableItem?.html) {
			parts.push(tableItem.html);
		}
		else if (mediaPath) {
			parts.push(`![](${mediaPath})`);
		}
		return parts.join('\n\n');
	}

	const parts = [];
	if (mediaPath) {
		parts.push(`![](${mediaPath})`);
	}
	if (caption) {
		parts.push(caption);
	}
	return parts.join('  \n');
}

async function normalizeMineruMarkdownLayout({ markdown = '', jsonText = '', outputDir = '' } = {}) {
	if (String(jsonText || '').length > MAX_LAYOUT_JSON_CHARS) {
		throw new Error(`MinerU layout JSON 过大 (${MAX_LAYOUT_JSON_CHARS} chars)`);
	}
	const parsed = JSON.parse(jsonText);
	const blocks = flattenMineruBlocks(parsed);
	if (blocks.length > MAX_LAYOUT_BLOCKS) {
		throw new Error(`MinerU layout block 数量超过上限 (${MAX_LAYOUT_BLOCKS})`);
	}
	const groupedBlocks = groupMineruBlocks(blocks);
	const usedCompositeNames = new Set();
	const rendered = [];

	for (const entry of groupedBlocks) {
		let chunk = '';
		if (entry.type === 'mediaGroup') {
			chunk = await renderMediaGroup(entry, outputDir, usedCompositeNames);
		}
		else {
			const block = entry.block;
			const blockType = String(block?.type || '').toLowerCase();
			if (blockType === 'title') {
				chunk = renderTitleBlock(block);
			}
			else if (['paragraph', 'text', 'ref_text', 'aside_text', 'page_footnote'].includes(blockType)) {
				chunk = renderParagraphBlock(block);
			}
			else if (blockType === 'list') {
				chunk = renderListBlock(block);
			}
			else if (blockType === 'equation_interline' || blockType === 'equation') {
				chunk = renderEquationBlock(block);
			}
			else if (blockType === 'code') {
				chunk = renderCodeBlock(block);
			}
		}
		if (chunk) {
			rendered.push(chunk);
		}
	}

	const normalizedMarkdown = rendered.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
	return {
		markdown: normalizedMarkdown || markdown,
		groups: groupedBlocks
			.filter((entry) => entry.type === 'mediaGroup')
			.map((entry) => ({
				kind: entry.kind,
				caption: entry.caption,
				label: entry.label,
				blockIndices: entry.items.map((item) => item.blockIndex),
				imagePaths: entry.items.map((item) => item.imagePath).filter(Boolean),
				bboxes: entry.items.map((item) => item.bbox).filter(Boolean),
				unionBBox: getUnionBBox(entry.items),
				isComposite: entry.kind === 'image' && entry.items.length > 1,
			})),
	};
}

module.exports = {
	buildMineruLayoutMediaGroups,
	normalizeMineruContentListPages,
	normalizeMineruMarkdownLayout,
};
