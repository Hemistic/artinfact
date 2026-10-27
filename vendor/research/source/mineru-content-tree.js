const fs = require('fs/promises');
const path = require('path');

const MAX_MINERU_ARTIFACT_BYTES = 120 * 1024 * 1024;
const MAX_MINERU_BLOCKS = 20000;
const MAX_MARKDOWN_LINES = 100000;
const MAX_TREE_NODES = 50000;
const SAFE_ASSET_SEGMENT_PATTERN = /^[A-Za-z0-9._ -]+$/u;

function hasUnsafePathText(value) {
	const rawPath = String(value || '').trim();
	return /[\u0000-\u001f\u007f]/u.test(rawPath)
		|| (/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(rawPath) && !/^[a-zA-Z]:[\\/]/u.test(rawPath));
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

async function resolveReadableArtifactPath(filePath, allowedExtensions, missingMessage) {
	const rawPath = typeof filePath === 'string' ? filePath.trim() : '';
	if (!rawPath) {
		throw new Error(missingMessage);
	}
	if (hasUnsafePathText(rawPath)) {
		throw new Error(`非法 MinerU artifact 路径: ${rawPath}`);
	}
	const normalizedPath = path.resolve(rawPath);
	const extension = path.extname(normalizedPath).toLowerCase();
	if (!allowedExtensions.has(extension)) {
		throw new Error(`不支持的 MinerU artifact 扩展名: ${extension || '(none)'}`);
	}
	const stat = await fs.stat(normalizedPath);
	if (!stat.isFile()) {
		throw new Error(`MinerU artifact 路径不是文件: ${normalizedPath}`);
	}
	if (stat.size > MAX_MINERU_ARTIFACT_BYTES) {
		throw new Error(`MinerU artifact 文件过大: ${normalizedPath}`);
	}
	return normalizedPath;
}

async function readTextFileWithLimit(filePath) {
	const stat = await fs.stat(filePath);
	if (!stat.isFile()) {
		throw new Error(`MinerU artifact 路径不是文件: ${filePath}`);
	}
	if (stat.size > MAX_MINERU_ARTIFACT_BYTES) {
		throw new Error(`MinerU artifact 文件过大: ${filePath}`);
	}
	return fs.readFile(filePath, 'utf8');
}

function createNode(type, payload = {}) {
	return {
		id: payload.id || '',
		type,
		title: payload.title || '',
		level: Number.isFinite(payload.level) ? payload.level : 0,
		text: payload.text || '',
		citationNumbers: Array.isArray(payload.citationNumbers) ? payload.citationNumbers : [],
		children: Array.isArray(payload.children) ? payload.children : [],
		meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : {},
	};
}

function createTreeBudget(sourceType) {
	let nodeCount = 0;
	return {
		assertBlockCount(count) {
			if (count > MAX_MINERU_BLOCKS) {
				throw new Error(`MinerU ${sourceType} block count exceeds ${MAX_MINERU_BLOCKS}`);
			}
		},
		assertLineCount(count) {
			if (count > MAX_MARKDOWN_LINES) {
				throw new Error(`MinerU Markdown line count exceeds ${MAX_MARKDOWN_LINES}`);
			}
		},
		trackNode(node) {
			nodeCount += 1;
			if (nodeCount > MAX_TREE_NODES) {
				throw new Error(`MinerU content tree node count exceeds ${MAX_TREE_NODES}`);
			}
			return node;
		},
		get nodeCount() {
			return nodeCount;
		},
	};
}

function appendChildNode(parent, node, budget) {
	if (!parent || !Array.isArray(parent.children)) {
		return node;
	}
	parent.children.push(budget ? budget.trackNode(node) : node);
	return node;
}

function appendChildNodes(parent, nodes, budget) {
	for (const node of Array.isArray(nodes) ? nodes : []) {
		appendChildNode(parent, node, budget);
	}
}

function flattenMineruBlocks(parsed) {
	if (!Array.isArray(parsed)) {
		return [];
	}
	return parsed.flatMap((entry) => (Array.isArray(entry) ? entry : [entry])).filter(Boolean);
}

function extractRichText(node) {
	if (!node) {
		return '';
	}
	if (typeof node === 'string') {
		return node.trim();
	}
	if (Array.isArray(node)) {
		return node
			.map((item) => extractRichText(item))
			.filter(Boolean)
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
	}
	if (typeof node.content === 'string') {
		return node.content.trim();
	}
	if (typeof node.text === 'string') {
		return node.text.trim();
	}
	if (typeof node.html === 'string') {
		return stripHtmlToText(node.html);
	}

	const nestedKeys = [
		'item_content',
		'paragraph_content',
		'title_content',
		'image_caption',
		'image_footnote',
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

function firstRichText(...values) {
	for (const value of values) {
		const text = normalizeText(extractRichText(value));
		if (text) {
			return text;
		}
	}
	return '';
}

function normalizeText(value) {
	return String(value || '')
		.replace(/\r/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function isReferenceHeading(text) {
	return /^references?$/i.test(normalizeText(text).replace(/[.:：\s]+$/g, ''));
}

function normalizeComparableText(value) {
	return normalizeText(value)
		.toLowerCase()
		.replace(/\.pdf$/i, '')
		.replace(/<[^>]+>/g, '')
		.replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '');
}

function isDocumentTitleHeading(title, documentTitle, blockIndex) {
	const normalizedTitle = normalizeComparableText(title);
	const normalizedDocumentTitle = normalizeComparableText(documentTitle);
	if (!normalizedTitle) return false;
	if (Number(blockIndex) === 0) return true;
	if (!normalizedDocumentTitle) return false;
	return normalizedTitle === normalizedDocumentTitle
		|| normalizedDocumentTitle.includes(normalizedTitle)
		|| normalizedTitle.includes(normalizedDocumentTitle);
}

function isLikelyFrontMatterText(text) {
	const normalized = normalizeText(text);
	if (!normalized) return true;
	if (normalized.length <= 2) return true;
	if (isAbstractParagraphText(normalized)) return false;
	if (/^accepted\b|^received\b|^keywords?\b|^key\s*words?\b|^index\s+terms?\b/i.test(normalized)) return true;
	if (/@/.test(normalized)) return true;
	if (/<sup>\s*\d+\s*<\/sup>/i.test(normalized)) return true;
	if (/\b(department|university|laboratory|institute|center|centre|school|college|research|inc\.?|ltd\.?)\b/i.test(normalized)) return true;
	const wordCount = normalized.split(/\s+/).filter(Boolean).length;
	if (wordCount <= 6 && !/[.!?。！？]/.test(normalized) && !/\[[0-9]/.test(normalized)) return true;
	return false;
}

function getTitleText(block) {
	return firstRichText(block?.content?.title_content, block?.content, block?.text, block);
}

function getParagraphText(block) {
	return firstRichText(block?.content?.paragraph_content, block?.content, block?.text, block);
}

function getListItemText(item) {
	return firstRichText(item?.item_content, item);
}

function getEquationText(block) {
	return firstRichText(block?.content?.math_content, block?.text, block?.content, block);
}

function normalizeFigureCaptionText(text) {
	const normalized = normalizeText(text);
	const match = normalized.match(/(?:fig(?:ure)?\.?)\s*\d+(?:[.:：]\s*\S|\s+\S|$)/i);
	if (match && match.index > 0) {
		return normalized.slice(match.index).trim();
	}
	return normalized;
}

function getImageCaptionText(block) {
	return normalizeFigureCaptionText(firstRichText(block?.content?.image_caption, block?.image_caption, block?.chart_caption));
}

function getImageFootnoteText(block) {
	return firstRichText(block?.content?.image_footnote, block?.image_footnote, block?.chart_footnote);
}

function getCaptionParts(value) {
	const source = Array.isArray(value) ? value : [value];
	return source
		.map((item) => normalizeText(extractRichText(item)))
		.filter(Boolean);
}

function getTableCaptionParts(block) {
	return [
		...getCaptionParts(block?.content?.table_caption),
		...getCaptionParts(block?.table_caption),
	];
}

function getTableCaptionText(block) {
	return normalizeText(getTableCaptionParts(block).join(' '));
}

function getTableFootnoteText(block) {
	return firstRichText(block?.content?.table_footnote, block?.table_footnote);
}

function stripHtmlToText(html) {
	return normalizeText(String(html || '')
		.replace(/<\s*br\s*\/?>/gi, ' ')
		.replace(/<\s*\/\s*(td|th|tr|caption|p|div)\s*>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'"));
}

function getBlockImagePath(block) {
	const imagePath = block?.content?.image_source?.path || block?.img_path;
	return normalizeRelativeAssetPath(imagePath);
}

function getImageText(block) {
	return normalizeText([getImageCaptionText(block), getImageFootnoteText(block)].filter(Boolean).join(' '));
}

function isFullFigureCaption(text) {
	return /(?:^|\s)(?:fig(?:ure)?\.?)\s*\d+(?:[.:：]\s*\S|\s+\S)/i.test(normalizeText(text));
}

function isFullTableCaption(text) {
	return /(?:^|\s)table\s*(?:\d+|[ivxlcdm]+)(?:[.:：]\s*\S|\s+\S)/i.test(normalizeText(text));
}

function isFigureCaptionStart(text) {
	return /^(?:fig(?:ure)?\.?)\s*\d+(?:[.:：\s]|$)/i.test(normalizeText(text));
}

function isTableCaptionStart(text) {
	return /^table\s*(?:\d+|[ivxlcdm]+)(?:[.:：\s]|$)/i.test(normalizeText(text));
}

function isBareTableCaptionLabel(text) {
	return /^table\s*(?:\d+|[ivxlcdm]+)\s*[.:：]?\s*$/i.test(normalizeText(text));
}

function resolveTableCaptionParts(parts, pendingLabel = '') {
	const normalizedParts = (Array.isArray(parts) ? parts : [])
		.map((part) => normalizeText(part))
		.filter(Boolean);
	let nextPendingLabel = '';
	if (normalizedParts.length > 1 && isBareTableCaptionLabel(normalizedParts[normalizedParts.length - 1])) {
		const hasCurrentLabel = normalizedParts
			.slice(0, -1)
			.some((part) => isTableCaptionStart(part) || isFullTableCaption(part) || isBareTableCaptionLabel(part));
		if (hasCurrentLabel) {
			nextPendingLabel = normalizedParts.pop();
		}
	}

	const tableStartIndex = normalizedParts.findIndex((part) => isTableCaptionStart(part)
		|| isFullTableCaption(part)
		|| isBareTableCaptionLabel(part));
	if (tableStartIndex >= 0) {
		const label = normalizedParts[tableStartIndex];
		const following = [];
		for (let index = tableStartIndex + 1; index < normalizedParts.length; index += 1) {
			const part = normalizedParts[index];
			if (isFigureCaptionStart(part) || isFullFigureCaption(part)) {
				continue;
			}
			if (isTableCaptionStart(part) || isFullTableCaption(part) || isBareTableCaptionLabel(part)) {
				break;
			}
			following.push(part);
		}
		return {
			caption: isBareTableCaptionLabel(label)
				? normalizeText([label, ...following].join(' '))
				: label,
			nextPendingLabel,
		};
	}

	if (pendingLabel && normalizedParts.length) {
		return {
			caption: normalizeText([pendingLabel, ...normalizedParts].join(' ')),
			nextPendingLabel,
		};
	}

	return {
		caption: '',
		nextPendingLabel,
	};
}

function findCaptionPart(parts, predicate) {
	return (Array.isArray(parts) ? parts : [])
		.map((part) => normalizeText(part))
		.find((part) => part && predicate(part)) || '';
}

function getFirstFigureCaptionPart(parts) {
	return findCaptionPart(parts, isFigureCaptionStart) || findCaptionPart(parts, isFullFigureCaption);
}

function getFirstTableCaptionPart(parts) {
	return findCaptionPart(parts, isTableCaptionStart) || findCaptionPart(parts, isFullTableCaption);
}

function isSubfigureCaption(text) {
	return /^(?:\([a-z]\)|[a-z][.)])(?:[.:：\s]|$)/i.test(normalizeText(text));
}

function isFragmentImageNode(node) {
	if (!node || node.type !== 'image') {
		return false;
	}
	const caption = normalizeText(node.meta?.caption || node.text || node.title);
	if (!caption) return true;
	if (isFullFigureCaption(caption) || isFullTableCaption(caption)) return false;
	return isSubfigureCaption(caption)
		|| /^(?:fig(?:ure)?\.?)\s*\d+$/i.test(caption)
		|| caption.length <= 24;
}

function pushImageNode(parent, imageNode, budget) {
	const caption = normalizeText(imageNode.meta?.caption || imageNode.text || imageNode.title);
	const fragmentNodes = [];
	while (parent.children.length > 0) {
		const candidate = parent.children[parent.children.length - 1];
		if (!isFragmentImageNode(candidate)) {
			break;
		}
		fragmentNodes.unshift(parent.children.pop());
	}

	if (!isFullFigureCaption(caption) && (!caption || !fragmentNodes.length)) {
		appendChildNode(parent, imageNode, budget);
		return;
	}

	if (!fragmentNodes.length) {
		appendChildNode(parent, imageNode, budget);
		return;
	}

	const imagePaths = [
		...fragmentNodes.flatMap((node) => Array.isArray(node.meta?.imagePaths)
			? node.meta.imagePaths
			: [node.meta?.imagePath].filter(Boolean)),
		...(Array.isArray(imageNode.meta?.imagePaths) ? imageNode.meta.imagePaths : [imageNode.meta?.imagePath].filter(Boolean)),
	];
	const blockIndices = [
		...fragmentNodes.flatMap((node) => Array.isArray(node.meta?.blockIndices)
			? node.meta.blockIndices
			: [node.meta?.blockIndex].filter((value) => Number.isFinite(value))),
		...(Array.isArray(imageNode.meta?.blockIndices)
			? imageNode.meta.blockIndices
			: [imageNode.meta?.blockIndex].filter((value) => Number.isFinite(value))),
	];

	appendChildNode(parent, {
		...imageNode,
		meta: {
			...imageNode.meta,
			imagePaths,
			blockIndices,
			mergedFragmentCount: fragmentNodes.length + 1,
			isMergedComposite: true,
		},
	}, budget);
}

function attachCaptionToPreviousImage(parent, caption) {
	const normalizedCaption = normalizeText(caption);
	if (!parent || !normalizedCaption || !Array.isArray(parent.children) || parent.children.length === 0) {
		return false;
	}
	const previous = parent.children[parent.children.length - 1];
	if (!previous || previous.type !== 'image') {
		return false;
	}
	const previousCaption = normalizeText(previous.meta?.caption || previous.text || previous.title);
	if (isFullFigureCaption(previousCaption) || isFullTableCaption(previousCaption)) {
		return false;
	}
	previous.title = normalizedCaption;
	previous.text = normalizeText([normalizedCaption, previous.text].filter(Boolean).join(' '));
	previous.citationNumbers = extractCitationNumbers(previous.text);
	previous.meta = {
		...(previous.meta || {}),
		caption: normalizedCaption,
		captionSource: 'following-table-caption',
	};
	return true;
}

function getTableText(block) {
	return normalizeText([
		getTableCaptionText(block),
		getTableFootnoteText(block),
		stripHtmlToText(block?.content?.html || block?.table_body),
	].filter(Boolean).join(' '));
}

function getNumberedHeadingLevel(title) {
	const normalized = normalizeText(title);
	const match = normalized.match(/^(\d+(?:\.\d+)*)(?:[\s.)、:：-]|$)/);
	if (!match) {
		return 0;
	}
	return Math.max(1, Math.min(8, match[1].split('.').filter(Boolean).length));
}

function getSemanticHeadingLevel(title) {
	const normalized = normalizeText(title);
	if (!normalized) {
		return 0;
	}

	// MinerU commonly flattens IEEE-style headings such as "III. METHOD"
	// and "A. Overview" to the same text_level. Prefer their explicit labels.
	if (/^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX)\s*[.．、:：)]\s+\S/u.test(normalized)) {
		return 1;
	}
	if (/^[A-Z]\s*[.．、:：)]\s+\S/u.test(normalized)) {
		return 2;
	}
	if (/^(?:chapter|section|appendix)\s+\w+/iu.test(normalized) || /^第[一二三四五六七八九十百千万零〇\d]+章/u.test(normalized)) {
		return 1;
	}
	if (/^第[一二三四五六七八九十百千万零〇\d]+节/u.test(normalized)) {
		return 2;
	}
	return 0;
}

function getHeadingLevel(block, title = '') {
	const numberedLevel = getNumberedHeadingLevel(title);
	if (numberedLevel > 0) {
		return numberedLevel;
	}
	const semanticLevel = getSemanticHeadingLevel(title);
	if (semanticLevel > 0) {
		return semanticLevel;
	}
	const rawLevel = Number(block?.content?.level);
	if (Number.isFinite(rawLevel) && rawLevel > 0) {
		return Math.max(1, Math.floor(rawLevel));
	}
	const textLevel = Number(block?.text_level);
	if (Number.isFinite(textLevel) && textLevel > 0) {
		return Math.max(1, Math.floor(textLevel));
	}
	return 1;
}

function extractCitationNumbers(text) {
	const numbers = new Set();
	const source = String(text || '');
	const bracketRegex = /\[(\d+(?:\s*(?:,|-)\s*\d+)*)\]/g;
	for (const match of source.matchAll(bracketRegex)) {
		const segment = match[1] || '';
		for (const piece of segment.split(',')) {
			const normalized = piece.trim();
			if (!normalized) {
				continue;
			}
			const rangeMatch = normalized.match(/^(\d+)\s*-\s*(\d+)$/);
			if (rangeMatch) {
				const start = Number(rangeMatch[1]);
				const end = Number(rangeMatch[2]);
				if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 100) {
					for (let index = start; index <= end; index += 1) {
						numbers.add(String(index));
					}
				}
				continue;
			}
			numbers.add(normalized);
		}
	}
	return [...numbers];
}

function makeLeafTitle(text, fallbackPrefix, ordinal) {
	const normalized = normalizeText(text);
	if (!normalized) {
		return `${fallbackPrefix} ${ordinal}`;
	}
	return normalized;
}

function isAbstractHeading(text) {
	return /^(abstract|摘要)$/i.test(normalizeText(text).replace(/[.:：\s]+$/g, ''));
}

function isAbstractParagraphText(text) {
	return /^(abstract|摘要)\s*[—\-–:：]/i.test(normalizeText(text));
}

function normalizeHeadingComparable(text) {
	return normalizeText(text).replace(/[.:：\s]+$/g, '');
}

function isLikelyStructuredHeading(text) {
	const normalized = normalizeHeadingComparable(text);
	if (!normalized) return false;
	if (isAbstractHeading(normalized) || isReferenceHeading(normalized)) return true;
	if (/^(acknowledg(e)?ments?|appendix)\b/i.test(normalized)) return true;
	if (/^(?:[IVXLC]+|\d+(?:\.\d+)*|[A-Z])[\s.)、:：-]+/u.test(normalized)) return true;
	if (/^[A-Z][A-Z0-9\s,;:()/-]{3,}$/u.test(normalized) && normalized.split(/\s+/).length <= 8) return true;
	return false;
}

function isLikelySpuriousHeading(text) {
	const normalized = normalizeText(text);
	if (!normalized) return true;
	if (/corresponding\s+author/i.test(normalized)) return true;
	if (/^\*+/.test(normalized)) return true;
	if (!isLikelyStructuredHeading(normalized)) return true;
	return false;
}

function cleanMarkdownInline(value) {
	return normalizeText(stripHtmlToText(String(value || '')
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/\*([^*]+)\*/g, '$1')
		.replace(/\\([\\`*_[\]{}()#+\-.!|>])/g, '$1')));
}

function parseMarkdownHeading(line) {
	const match = String(line || '').match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
	if (!match) {
		return null;
	}
	const title = cleanMarkdownInline(match[2]);
	if (!title) {
		return null;
	}
	return {
		level: Math.max(1, match[1].length),
		title,
	};
}

function getMarkdownHeadingLevel(markdownLevel, title) {
	const numberedLevel = getNumberedHeadingLevel(title);
	if (numberedLevel > 0) {
		return numberedLevel;
	}
	return Math.max(1, Number(markdownLevel) - 1 || 1);
}

function parseMarkdownImage(line) {
	const match = String(line || '').match(/!\[([^\]]*)\]\(([^)]+)\)/);
	if (!match) {
		return null;
	}
	const trailing = String(line || '').slice(match.index + match[0].length);
	return {
		alt: cleanMarkdownInline(match[1]),
		path: String(match[2] || '').trim(),
		trailingText: cleanMarkdownInline(trailing),
	};
}

function isMarkdownHtmlTableStart(line) {
	return /<\s*table\b/i.test(String(line || ''));
}

function isMarkdownPipeTableStart(lines, index) {
	const first = String(lines[index] || '');
	const second = String(lines[index + 1] || '');
	return first.includes('|')
		&& second.includes('|')
		&& /-{3,}/.test(second)
		&& /^\s*\|?[\s:|.-]+\|?\s*$/.test(second);
}

function isMarkdownDisplayMathStart(line) {
	const trimmed = String(line || '').trim();
	return trimmed.startsWith('$$') || trimmed.startsWith('\\[');
}

function isMarkdownSpecialStart(lines, index) {
	const line = String(lines[index] || '');
	if (!line.trim()) {
		return true;
	}
	return !!parseMarkdownHeading(line)
		|| !!parseMarkdownImage(line)
		|| isMarkdownHtmlTableStart(line)
		|| isMarkdownPipeTableStart(lines, index)
		|| isMarkdownDisplayMathStart(line);
}

function readMarkdownCaption(lines, index, expectedKind = '') {
	let cursor = index;
	while (cursor < lines.length && !String(lines[cursor] || '').trim()) {
		cursor += 1;
	}
	if (cursor >= lines.length) {
		return { caption: '', nextIndex: index };
	}
	const first = cleanMarkdownInline(lines[cursor]);
	const isFigure = isFigureCaptionStart(first);
	const isTable = isTableCaptionStart(first);
	if (expectedKind === 'image' && !isFigure && !isTable) {
		return { caption: '', nextIndex: index };
	}
	if (expectedKind === 'table' && !isTable) {
		return { caption: '', nextIndex: index };
	}
	if (!isFigure && !isTable) {
		return { caption: '', nextIndex: index };
	}

	const parts = [first];
	cursor += 1;
	while (cursor < lines.length && String(lines[cursor] || '').trim() && !isMarkdownSpecialStart(lines, cursor)) {
		parts.push(cleanMarkdownInline(lines[cursor]));
		cursor += 1;
	}
	return {
		caption: normalizeText(parts.join(' ')),
		nextIndex: cursor,
	};
}

function readMarkdownHtmlTable(lines, index) {
	const parts = [];
	let cursor = index;
	while (cursor < lines.length) {
		const line = String(lines[cursor] || '');
		parts.push(line);
		cursor += 1;
		if (/<\s*\/\s*table\s*>/i.test(line)) {
			break;
		}
	}
	return {
		html: parts.join('\n'),
		nextIndex: cursor,
	};
}

function readMarkdownPipeTable(lines, index) {
	const parts = [];
	let cursor = index;
	while (cursor < lines.length && String(lines[cursor] || '').includes('|') && String(lines[cursor] || '').trim()) {
		parts.push(String(lines[cursor] || ''));
		cursor += 1;
	}
	const text = parts
		.filter((line, lineIndex) => lineIndex !== 1 || !/-{3,}/.test(line))
		.map((line) => line.split('|').map((cell) => cleanMarkdownInline(cell)).filter(Boolean).join(' '))
		.filter(Boolean)
		.join('\n');
	return {
		raw: parts.join('\n'),
		text: normalizeText(text),
		nextIndex: cursor,
	};
}

function readMarkdownDisplayMath(lines, index) {
	const parts = [];
	const start = String(lines[index] || '').trim();
	const endToken = start.startsWith('\\[') ? '\\]' : '$$';
	let cursor = index;
	while (cursor < lines.length) {
		const line = String(lines[cursor] || '');
		parts.push(line);
		cursor += 1;
		const trimmed = line.trim();
		if (cursor - 1 > index && trimmed.endsWith(endToken)) {
			break;
		}
		if (cursor - 1 === index && trimmed.length > endToken.length && trimmed.endsWith(endToken)) {
			break;
		}
	}
	return {
		text: parts.join('\n').trim(),
		nextIndex: cursor,
	};
}

function readMarkdownParagraph(lines, index) {
	const parts = [];
	let cursor = index;
	while (cursor < lines.length && String(lines[cursor] || '').trim() && !isMarkdownSpecialStart(lines, cursor)) {
		parts.push(String(lines[cursor] || '').trim());
		cursor += 1;
	}
	return {
		text: cleanMarkdownInline(parts.join(' ')),
		nextIndex: cursor,
	};
}

function referenceCitationNumber(text) {
	const match = normalizeText(text).match(/^(?:\[(\d+)\]|(\d+)[.)])\s+/);
	return match?.[1] || match?.[2] || '';
}

function normalizeLayoutAnnotationText(value) {
	return normalizeText(stripHtmlToText(value));
}

function layoutAnnotationSortKey(annotation) {
	return String(annotation?.sortIndex || [
		String(Number(annotation?.position?.pageIndex) || 0).padStart(5, '0'),
		'000000',
		'000000',
	].join('|'));
}

function isLayoutMediaAnnotation(annotation) {
	return annotation
		&& annotation.projectOrigin === 'layout-json'
		&& (annotation.layoutKind === 'figure' || annotation.layoutKind === 'table');
}

function buildLayoutMediaNodes(layoutAnnotations = []) {
	let figureOrdinal = 0;
	let tableOrdinal = 0;
	return (Array.isArray(layoutAnnotations) ? layoutAnnotations : [])
		.filter(isLayoutMediaAnnotation)
		.slice()
		.sort((left, right) => layoutAnnotationSortKey(left).localeCompare(layoutAnnotationSortKey(right)))
		.map((annotation, index) => {
			const isTable = annotation.layoutKind === 'table';
			if (isTable) {
				tableOrdinal += 1;
			}
			else {
				figureOrdinal += 1;
			}
			const ordinal = isTable ? tableOrdinal : figureOrdinal;
			const fallbackTitle = isTable ? `Table ${ordinal}` : `Figure ${ordinal}`;
			const comment = normalizeLayoutAnnotationText(annotation.comment);
			const label = normalizeLayoutAnnotationText(annotation.text);
			const title = comment || label || fallbackTitle;
			const assetPath = normalizeRelativeAssetPath(annotation.layoutAssetPath);
			return createNode(isTable ? 'table' : 'image', {
				id: `layout-${annotation.id || index}`,
				title,
				text: title,
				level: 1,
				citationNumbers: extractCitationNumbers(title),
				meta: {
					sourceType: 'layout-json',
					annotationId: annotation.id || '',
					sortIndex: layoutAnnotationSortKey(annotation),
					pageIndex: Number.isFinite(Number(annotation.position?.pageIndex)) ? Number(annotation.position.pageIndex) : undefined,
					pageLabel: annotation.pageLabel || '',
					imagePath: assetPath,
					imagePaths: [assetPath].filter(Boolean),
					caption: comment,
					label,
					ordinal,
					layoutKind: annotation.layoutKind,
					layoutSourcePath: annotation.layoutSourcePath || '',
					layoutBlockIndices: Array.isArray(annotation.layoutBlockIndices) ? annotation.layoutBlockIndices : [],
					layoutComposite: !!annotation.layoutComposite,
					position: annotation.position || null,
				},
			});
		});
}

function pushSectionNode(stack, rootNode, sectionNode, budget) {
	while (stack.length > 1 && stack[stack.length - 1].level >= sectionNode.level) {
		stack.pop();
	}
	const parent = stack[stack.length - 1] || rootNode;
	appendChildNode(parent, sectionNode, budget);
	stack.push(sectionNode);
}

function ensureReferencesNode(rootNode, budget) {
	let node = rootNode.children.find((item) => item.type === 'references');
	if (!node) {
		node = createNode('references', {
			id: 'references',
			title: 'References',
			level: 1,
			children: [],
			meta: {
				isSynthetic: true,
			},
		});
		appendChildNode(rootNode, node, budget);
	}
	return node;
}

function buildMineruContentTree(parsed, options = {}) {
	const blocks = flattenMineruBlocks(parsed);
	const budget = createTreeBudget('JSON');
	budget.assertBlockCount(blocks.length);
	const documentTitle = normalizeText(options.documentTitle)
		|| getTitleText(blocks.find((block) => String(block?.type || '').toLowerCase() === 'title'))
		|| 'Document';
	const rootNode = budget.trackNode(createNode('document', {
		id: 'root',
		title: documentTitle,
		level: 0,
		children: [],
		meta: {
			blockCount: blocks.length,
		},
	}));
	const sectionStack = [rootNode];
	const referenceMap = new Map();
	let referencesNode = null;
	let textOrdinal = 0;
	let imageOrdinal = 0;
	let tableOrdinal = 0;
	let bodyStarted = false;
	let abstractStarted = false;
	let abstractNode = null;
	let pendingTableCaptionLabel = '';

	const ensureAbstractNode = () => {
		if (abstractNode) {
			return abstractNode;
		}
		abstractNode = createNode('section', {
			id: 'section-abstract',
			title: 'Abstract',
			level: 1,
			meta: {
				isSynthetic: true,
				isAbstract: true,
			},
		});
		appendChildNode(rootNode, abstractNode, budget);
		return abstractNode;
	};

	for (const [blockIndex, block] of blocks.entries()) {
		const blockType = String(block?.type || '').trim().toLowerCase();
		if (!blockType) {
			continue;
		}

		const textBlockLevel = Number(block?.text_level);
		const titleForHeadingCheck = blockType === 'text' || blockType === 'title' ? getTitleText(block) : '';
		const isDocumentTitleBlock = (blockType === 'title' || (blockType === 'text' && textBlockLevel === 1))
			&& isDocumentTitleHeading(titleForHeadingCheck, documentTitle, blockIndex);
		const isTextHeading = blockType === 'text'
			&& Number.isFinite(textBlockLevel)
			&& textBlockLevel > 0
			&& (isDocumentTitleBlock || !isLikelySpuriousHeading(titleForHeadingCheck));
		if (blockType === 'title' || isTextHeading) {
			const title = titleForHeadingCheck || getTitleText(block);
			if (!title) {
				continue;
			}
			if (isReferenceHeading(title)) {
				referencesNode = ensureReferencesNode(rootNode, budget);
				continue;
			}
			if (isDocumentTitleHeading(title, documentTitle, blockIndex)) {
				continue;
			}
			if (isTextHeading && isAbstractHeading(title)) {
				textOrdinal += 1;
				bodyStarted = true;
				abstractStarted = true;
				const parent = sectionStack[sectionStack.length - 1] || rootNode;
				appendChildNode(parent, createNode('text', {
					id: `text-${blockIndex}`,
					title,
					text: title,
					level: parent.level + 1,
					citationNumbers: [],
					meta: {
						blockIndex,
						blockType,
						pageIndex: Number.isFinite(Number(block?.page_idx)) ? Number(block.page_idx) : undefined,
						bbox: Array.isArray(block?.bbox) ? block.bbox : undefined,
						isAbstractHeading: true,
					},
				}), budget);
				continue;
			}
			bodyStarted = true;
			abstractStarted = false;
			const sectionNode = createNode('section', {
				id: `section-${blockIndex}`,
				title,
				level: getHeadingLevel(block, title),
				meta: {
					blockIndex,
					pageIndex: Number.isFinite(Number(block?.page_idx)) ? Number(block.page_idx) : undefined,
					bbox: Array.isArray(block?.bbox) ? block.bbox : undefined,
				},
			});
			pushSectionNode(sectionStack, rootNode, sectionNode, budget);
			continue;
		}

		if (blockType === 'list' && String(block?.content?.list_type || '').trim().toLowerCase() === 'reference_list') {
			referencesNode = ensureReferencesNode(rootNode, budget);
			const listItems = Array.isArray(block?.content?.list_items) ? block.content.list_items : [];
			for (const [itemIndex, item] of listItems.entries()) {
				const text = getListItemText(item);
				if (!text) {
					continue;
				}
				const match = text.match(/^\[(\d+)\]\s*(.+)$/);
				const citationNumber = match?.[1] || '';
				const normalizedText = citationNumber ? `[${citationNumber}] ${match[2].trim()}` : text;
				if (citationNumber) {
					referenceMap.set(citationNumber, normalizedText);
				}
				appendChildNode(referencesNode, createNode('reference', {
					id: `reference-${citationNumber || `${blockIndex}-${itemIndex}`}`,
					title: normalizedText,
					text: normalizedText,
					level: 2,
					citationNumbers: citationNumber ? [citationNumber] : [],
					meta: {
						blockIndex,
						itemIndex,
						citationNumber,
					},
				}), budget);
			}
			continue;
		}

		if (blockType === 'ref_text') {
			const text = getParagraphText(block);
			if (!text) {
				continue;
			}
			referencesNode = ensureReferencesNode(rootNode, budget);
			const citationNumbers = extractCitationNumbers(text);
			const citationNumber = citationNumbers[0] || '';
			if (citationNumber) {
				referenceMap.set(citationNumber, text);
			}
			appendChildNode(referencesNode, createNode('reference', {
				id: `reference-${citationNumber || blockIndex}`,
				title: makeLeafTitle(text, 'Reference', blockIndex + 1),
				text,
				level: 2,
				citationNumbers,
				meta: {
					blockIndex,
					blockType,
					pageIndex: Number.isFinite(Number(block?.page_idx)) ? Number(block.page_idx) : undefined,
					bbox: Array.isArray(block?.bbox) ? block.bbox : undefined,
				},
			}), budget);
			continue;
		}

		let text = '';
		let leafType = '';
		let leafCaption = '';
		if (blockType === 'paragraph' || blockType === 'text') {
			text = getParagraphText(block);
			leafType = 'text';
			if (!bodyStarted && isAbstractParagraphText(text)) {
				textOrdinal += 1;
				const parent = ensureAbstractNode();
				appendChildNode(parent, createNode('text', {
					id: `text-${blockIndex}`,
					title: makeLeafTitle(text, 'Abstract', textOrdinal),
					text,
					level: parent.level + 1,
					citationNumbers: extractCitationNumbers(text),
					meta: {
						blockIndex,
						blockType,
						pageIndex: Number.isFinite(Number(block?.page_idx)) ? Number(block.page_idx) : undefined,
						bbox: Array.isArray(block?.bbox) ? block.bbox : undefined,
						isAbstract: true,
					},
				}), budget);
				continue;
			}
			if (!bodyStarted && isLikelyFrontMatterText(text)) {
				continue;
			}
			if (abstractStarted && text && !isLikelyFrontMatterText(text)) {
				bodyStarted = true;
			}
		}
		else if (blockType === 'equation_interline' || blockType === 'equation') {
			text = getEquationText(block);
			leafType = 'equation';
		}
		else if (blockType === 'list') {
			const items = Array.isArray(block?.content?.list_items) ? block.content.list_items : [];
			text = normalizeText(items.map((item) => getListItemText(item)).filter(Boolean).join('\n'));
			leafType = 'text';
		}
		else if (blockType === 'image') {
			imageOrdinal += 1;
			text = getImageText(block);
			leafCaption = getImageCaptionText(block);
			leafType = 'image';
		}
		else if (blockType === 'chart') {
			imageOrdinal += 1;
			text = getImageText(block);
			leafCaption = getImageCaptionText(block);
			leafType = 'image';
		}
		else if (blockType === 'table') {
			const tableCaptionParts = getTableCaptionParts(block);
			const tableCaptionInfo = resolveTableCaptionParts(tableCaptionParts, pendingTableCaptionLabel);
			const tableCaption = tableCaptionInfo.caption || getFirstTableCaptionPart(tableCaptionParts);
			pendingTableCaptionLabel = tableCaptionInfo.nextPendingLabel || '';
			const figureCaption = getFirstFigureCaptionPart(tableCaptionParts);
			const htmlText = stripHtmlToText(block?.content?.html || block?.table_body);
			const footnoteText = getTableFootnoteText(block);
			if (figureCaption && tableCaption) {
				attachCaptionToPreviousImage(sectionStack[sectionStack.length - 1] || rootNode, figureCaption);
			}
			text = normalizeText([
				tableCaption || getTableCaptionText(block),
				footnoteText,
				htmlText,
			].filter(Boolean).join(' '));
			if (!tableCaption && !isFullTableCaption(text) && isFullFigureCaption(text)) {
				imageOrdinal += 1;
				leafType = 'image';
				leafCaption = figureCaption || getTableCaptionText(block);
			}
			else {
				tableOrdinal += 1;
				leafType = 'table';
				leafCaption = tableCaption || getTableCaptionText(block);
			}
		}
		else {
			continue;
		}

		if (!text && leafType !== 'image' && leafType !== 'table') {
			continue;
		}

		textOrdinal += 1;
		const parent = sectionStack[sectionStack.length - 1] || rootNode;
		const fallbackTitle = leafType === 'equation'
			? 'Equation'
			: leafType === 'image'
				? `Figure ${imageOrdinal}`
				: leafType === 'table'
					? `Table ${tableOrdinal}`
					: 'Text';
		const title = leafType === 'image' || leafType === 'table'
			? (leafCaption || fallbackTitle)
			: (text ? makeLeafTitle(text, fallbackTitle, textOrdinal) : fallbackTitle);
		const meta = {
			blockIndex,
			blockType,
			pageIndex: Number.isFinite(Number(block?.page_idx)) ? Number(block.page_idx) : undefined,
			bbox: Array.isArray(block?.bbox) ? block.bbox : undefined,
		};
		if (leafType === 'image') {
			meta.imagePath = getBlockImagePath(block);
			meta.imagePaths = [meta.imagePath].filter(Boolean);
			meta.blockIndices = [blockIndex];
			meta.caption = blockType === 'table'
				? (getFirstFigureCaptionPart(getTableCaptionParts(block)) || getTableCaptionText(block))
				: getImageCaptionText(block);
			meta.footnote = blockType === 'table' ? getTableFootnoteText(block) : getImageFootnoteText(block);
			if (blockType === 'table') {
				meta.html = typeof block?.content?.html === 'string'
					? block.content.html
					: (typeof block?.table_body === 'string' ? block.table_body : '');
				meta.originalBlockType = 'table';
				meta.tableType = block?.content?.table_type || '';
				meta.tableNestLevel = block?.content?.table_nest_level || 0;
			}
			meta.ordinal = imageOrdinal;
		}
		else if (leafType === 'table') {
			meta.imagePath = getBlockImagePath(block);
			meta.caption = leafCaption || getFirstTableCaptionPart(getTableCaptionParts(block)) || getTableCaptionText(block);
			meta.footnote = getTableFootnoteText(block);
			meta.html = typeof block?.content?.html === 'string'
				? block.content.html
				: (typeof block?.table_body === 'string' ? block.table_body : '');
			meta.tableType = block?.content?.table_type || '';
			meta.tableNestLevel = block?.content?.table_nest_level || 0;
			meta.ordinal = tableOrdinal;
		}
		const leafNode = createNode(leafType, {
			id: `${leafType}-${blockIndex}`,
			title,
			text,
			level: parent.level + 1,
			citationNumbers: extractCitationNumbers(text),
			meta,
		});
		if (leafType === 'image') {
			pushImageNode(parent, leafNode, budget);
		}
		else {
			appendChildNode(parent, leafNode, budget);
		}
	}

	return {
		title: documentTitle,
		root: rootNode,
		references: Object.fromEntries([...referenceMap.entries()].sort((left, right) => Number(left[0]) - Number(right[0]))),
		stats: {
			blockCount: blocks.length,
			sectionCount: countNodesByType(rootNode, 'section'),
			textCount: countNodesByType(rootNode, 'text'),
			equationCount: countNodesByType(rootNode, 'equation'),
			imageCount: countNodesByType(rootNode, 'image'),
			tableCount: countNodesByType(rootNode, 'table'),
			referenceCount: countNodesByType(rootNode, 'reference') || referenceMap.size,
			nodeCount: budget.nodeCount,
		},
	};
}

function buildMineruContentTreeFromMarkdown(markdown, options = {}) {
	const source = String(markdown || '').replace(/\r\n?/g, '\n');
	const lines = source.split('\n');
	const budget = createTreeBudget('Markdown');
	budget.assertLineCount(lines.length);
	const layoutMediaNodes = buildLayoutMediaNodes(options.layoutAnnotations);
	const preferLayoutMedia = layoutMediaNodes.length > 0;
	const firstDocumentHeading = lines
		.map((line) => parseMarkdownHeading(line))
		.find((heading) => heading && !isAbstractHeading(heading.title) && !isReferenceHeading(heading.title));
	const documentTitle = firstDocumentHeading?.title || normalizeText(options.documentTitle) || 'Document';
	const rootNode = budget.trackNode(createNode('document', {
		id: 'root',
		title: documentTitle,
		level: 0,
		children: [],
		meta: {
			sourceType: 'markdown',
			lineCount: lines.length,
			sourcePath: options.sourcePath || '',
		},
	}));
	const sectionStack = [rootNode];
	const referenceMap = new Map();
	let referencesNode = null;
	let referenceMode = false;
	let textOrdinal = 0;
	let imageOrdinal = 0;
	let tableOrdinal = 0;
	let equationOrdinal = 0;
	let blockOrdinal = 0;
	let bodyStarted = false;
	let pendingAbstract = false;

	const currentParent = () => sectionStack[sectionStack.length - 1] || rootNode;
	const setReferenceMode = () => {
		referencesNode = ensureReferencesNode(rootNode, budget);
		sectionStack.length = 0;
		sectionStack.push(rootNode, referencesNode);
		referenceMode = true;
		bodyStarted = true;
		pendingAbstract = false;
	};
	const addReferenceNode = (text, lineIndex) => {
		const citationNumber = referenceCitationNumber(text) || extractCitationNumbers(text)[0] || '';
		if (citationNumber) {
			referenceMap.set(citationNumber, text);
		}
		referencesNode = referencesNode || ensureReferencesNode(rootNode, budget);
		appendChildNode(referencesNode, createNode('reference', {
			id: `reference-${citationNumber || lineIndex}`,
			title: makeLeafTitle(text, 'Reference', referencesNode.children.length + 1),
			text,
			level: 2,
			citationNumbers: citationNumber ? [citationNumber] : extractCitationNumbers(text),
			meta: {
				sourceType: 'markdown',
				lineIndex,
				citationNumber,
			},
		}), budget);
	};
	const addLeafNode = (leafType, payload, lineIndex) => {
		const parent = currentParent();
		const node = createNode(leafType, {
			id: `${leafType}-${lineIndex}-${blockOrdinal}`,
			title: payload.title,
			text: payload.text,
			level: parent.level + 1,
			citationNumbers: extractCitationNumbers(payload.text),
			meta: {
				sourceType: 'markdown',
				lineIndex,
				...(payload.meta || {}),
			},
		});
		if (leafType === 'image') {
			pushImageNode(parent, node, budget);
		}
		else {
			appendChildNode(parent, node, budget);
		}
	};

	for (let index = 0; index < lines.length;) {
		const rawLine = String(lines[index] || '');
		if (!rawLine.trim()) {
			index += 1;
			continue;
		}

		const heading = parseMarkdownHeading(rawLine);
		if (heading) {
			if (isReferenceHeading(heading.title)) {
				setReferenceMode();
				blockOrdinal += 1;
				index += 1;
				continue;
			}
			if (isDocumentTitleHeading(heading.title, documentTitle, blockOrdinal)) {
				blockOrdinal += 1;
				index += 1;
				continue;
			}
			if (isAbstractHeading(heading.title)) {
				sectionStack.length = 0;
				sectionStack.push(rootNode);
				const abstractNode = createNode('section', {
					id: `section-abstract-${index}-${blockOrdinal}`,
					title: heading.title,
					level: 1,
					meta: {
						sourceType: 'markdown',
						lineIndex: index,
						markdownLevel: heading.level,
						isAbstract: true,
					},
				});
				appendChildNode(rootNode, abstractNode, budget);
				sectionStack.push(abstractNode);
				referenceMode = false;
				bodyStarted = true;
				pendingAbstract = true;
				blockOrdinal += 1;
				index += 1;
				continue;
			}

			referenceMode = false;
			pendingAbstract = false;
			bodyStarted = true;
			const sectionNode = createNode('section', {
				id: `section-${index}-${blockOrdinal}`,
				title: heading.title,
				level: getMarkdownHeadingLevel(heading.level, heading.title),
				meta: {
					sourceType: 'markdown',
					lineIndex: index,
					markdownLevel: heading.level,
				},
			});
			pushSectionNode(sectionStack, rootNode, sectionNode, budget);
			blockOrdinal += 1;
			index += 1;
			continue;
		}

		const image = parseMarkdownImage(rawLine);
		if (image) {
			if (preferLayoutMedia) {
				const captionResult = readMarkdownCaption(lines, index + 1, 'image');
				blockOrdinal += 1;
				index = captionResult.caption ? captionResult.nextIndex : index + 1;
				continue;
			}
			const inlineCaption = image.trailingText && (isFigureCaptionStart(image.trailingText) || isTableCaptionStart(image.trailingText))
				? image.trailingText
				: '';
			const captionResult = inlineCaption
				? { caption: inlineCaption, nextIndex: index + 1 }
				: readMarkdownCaption(lines, index + 1, 'image');
			const caption = captionResult.caption;
			const isTableImage = isTableCaptionStart(caption);
			const leafType = isTableImage ? 'table' : 'image';
			if (isTableImage) {
				tableOrdinal += 1;
			}
			else {
				imageOrdinal += 1;
			}
			const ordinal = isTableImage ? tableOrdinal : imageOrdinal;
			const fallbackTitle = isTableImage ? `Uncaptioned table ${ordinal}` : `Uncaptioned figure ${ordinal}`;
			const text = normalizeText([caption, image.alt].filter(Boolean).join(' '));
			addLeafNode(leafType, {
				title: caption || image.alt || fallbackTitle,
				text: text || caption || image.alt || fallbackTitle,
				meta: {
					imagePath: image.path,
					imagePaths: [image.path].filter(Boolean),
					caption,
					ordinal,
					originalBlockType: 'markdown-image',
				},
			}, index);
			blockOrdinal += 1;
			index = captionResult.nextIndex;
			continue;
		}

		if (isMarkdownHtmlTableStart(rawLine)) {
			const table = readMarkdownHtmlTable(lines, index);
			if (preferLayoutMedia) {
				const captionResult = readMarkdownCaption(lines, table.nextIndex, '');
				blockOrdinal += 1;
				index = captionResult.caption ? captionResult.nextIndex : table.nextIndex;
				continue;
			}
			const captionResult = readMarkdownCaption(lines, table.nextIndex, '');
			const caption = captionResult.caption;
			const htmlText = stripHtmlToText(table.html);
			if (caption && isFigureCaptionStart(caption)) {
				const parent = currentParent();
				const previous = parent.children[parent.children.length - 1];
				if (previous?.type === 'image' && !previous.meta?.caption) {
					previous.title = caption;
					previous.text = normalizeText([caption, previous.text, htmlText].filter(Boolean).join(' '));
					previous.meta = {
						...(previous.meta || {}),
						caption,
						html: table.html,
						ocrTableText: htmlText,
					};
				}
				else {
					imageOrdinal += 1;
					addLeafNode('image', {
						title: caption,
						text: normalizeText([caption, htmlText].filter(Boolean).join(' ')) || caption,
						meta: {
							caption,
							html: table.html,
							ocrTableText: htmlText,
							ordinal: imageOrdinal,
							originalBlockType: 'markdown-html-table-figure',
						},
					}, index);
				}
				blockOrdinal += 1;
				index = captionResult.nextIndex;
				continue;
			}
			tableOrdinal += 1;
			const text = normalizeText([caption, htmlText].filter(Boolean).join(' '));
			addLeafNode('table', {
				title: caption || `Uncaptioned table ${tableOrdinal}`,
				text: text || caption || `Uncaptioned table ${tableOrdinal}`,
				meta: {
					caption,
					html: table.html,
					ordinal: tableOrdinal,
					originalBlockType: 'markdown-html-table',
				},
			}, index);
			blockOrdinal += 1;
			index = caption ? captionResult.nextIndex : table.nextIndex;
			continue;
		}

		if (isMarkdownPipeTableStart(lines, index)) {
			const table = readMarkdownPipeTable(lines, index);
			if (preferLayoutMedia) {
				const captionResult = readMarkdownCaption(lines, table.nextIndex, 'table');
				blockOrdinal += 1;
				index = captionResult.caption ? captionResult.nextIndex : table.nextIndex;
				continue;
			}
			const captionResult = readMarkdownCaption(lines, table.nextIndex, 'table');
			tableOrdinal += 1;
			const caption = captionResult.caption;
			const text = normalizeText([caption, table.text].filter(Boolean).join(' '));
			addLeafNode('table', {
				title: caption || `Uncaptioned table ${tableOrdinal}`,
				text: text || caption || `Uncaptioned table ${tableOrdinal}`,
				meta: {
					caption,
					html: table.raw,
					ordinal: tableOrdinal,
					originalBlockType: 'markdown-pipe-table',
				},
			}, index);
			blockOrdinal += 1;
			index = captionResult.nextIndex;
			continue;
		}

		if (isMarkdownDisplayMathStart(rawLine)) {
			const equation = readMarkdownDisplayMath(lines, index);
			equationOrdinal += 1;
			addLeafNode('equation', {
				title: `Equation ${equationOrdinal}`,
				text: equation.text,
				meta: {
					ordinal: equationOrdinal,
				},
			}, index);
			blockOrdinal += 1;
			index = equation.nextIndex;
			continue;
		}

		const paragraph = readMarkdownParagraph(lines, index);
		const text = paragraph.text;
		if (!text) {
			index = Math.max(index + 1, paragraph.nextIndex);
			continue;
		}
		if (referenceMode || currentParent().type === 'references') {
			addReferenceNode(text, index);
			blockOrdinal += 1;
			index = paragraph.nextIndex;
			continue;
		}
		if (!bodyStarted) {
			blockOrdinal += 1;
			index = paragraph.nextIndex;
			continue;
		}
		textOrdinal += 1;
		addLeafNode('text', {
			title: makeLeafTitle(text, 'Text', textOrdinal),
			text,
			meta: {
				isAbstract: pendingAbstract || undefined,
			},
		}, index);
		bodyStarted = true;
		pendingAbstract = false;
		blockOrdinal += 1;
		index = paragraph.nextIndex;
	}

	appendChildNodes(rootNode, layoutMediaNodes, budget);

	return {
		title: documentTitle,
		root: rootNode,
		references: Object.fromEntries([...referenceMap.entries()].sort((left, right) => Number(left[0]) - Number(right[0]))),
		stats: {
			blockCount: blockOrdinal,
			lineCount: lines.length,
			sourceType: 'markdown',
			sectionCount: countNodesByType(rootNode, 'section'),
			textCount: countNodesByType(rootNode, 'text'),
			equationCount: countNodesByType(rootNode, 'equation'),
			imageCount: countNodesByType(rootNode, 'image'),
			tableCount: countNodesByType(rootNode, 'table'),
			referenceCount: countNodesByType(rootNode, 'reference') || referenceMap.size,
			nodeCount: budget.nodeCount,
		},
	};
}

function cloneMineruTreeNode(node, children = []) {
	return {
		...node,
		citationNumbers: Array.isArray(node?.citationNumbers) ? [...node.citationNumbers] : [],
		children: Array.isArray(children) ? children : [],
		meta: node?.meta && typeof node.meta === 'object' ? { ...node.meta } : {},
	};
}

function getMineruNodePageIndex(node) {
	const pageIndex = Number(node?.meta?.pageIndex);
	return Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex : undefined;
}

function getMineruNodeBlockIndex(node) {
	const blockIndex = Number(node?.meta?.blockIndex);
	return Number.isInteger(blockIndex) && blockIndex >= 0 ? blockIndex : undefined;
}

function isMineruAbstractLeaf(node) {
	return !!node?.meta?.isAbstract
		|| !!node?.meta?.isAbstractHeading
		|| isAbstractHeading(node?.title)
		|| isAbstractParagraphText(node?.text);
}

function isMineruBodyLeaf(node) {
	return ['text', 'paragraph', 'equation'].includes(String(node?.type || ''))
		&& !!normalizeText(node?.text);
}

function collectMineruBodyRecords(rootNode) {
	const sections = [];
	const leaves = [];
	const visit = (node, sectionAncestors = []) => {
		if (!node || typeof node !== 'object') return;
		const isSection = String(node.type || '') === 'section';
		const nextSectionAncestors = isSection ? [...sectionAncestors, node] : sectionAncestors;
		if (isSection) {
			sections.push({
				node,
				ancestors: sectionAncestors,
				pageIndex: getMineruNodePageIndex(node),
			});
		}
		if (isMineruBodyLeaf(node)) {
			leaves.push({
				node,
				sectionAncestors: nextSectionAncestors,
				pageIndex: getMineruNodePageIndex(node),
			});
		}
		for (const child of Array.isArray(node.children) ? node.children : []) {
			visit(child, nextSectionAncestors);
		}
	};
	visit(rootNode);
	return { sections, leaves };
}

function normalizeOutlineTitleForMatching(value) {
	let normalized = normalizeComparableText(value);
	normalized = normalized
		.replace(/^(?:section|chapter|part)\d+/iu, '')
		.replace(/^\d+(?=[a-z\u4e00-\u9fff])/iu, '')
		.replace(/^[ivxlcdm]+(?=[a-z\u4e00-\u9fff])/iu, '');
	return normalized;
}

function scoreOutlineTitleMatch(left, right) {
	const normalizedLeft = normalizeOutlineTitleForMatching(left);
	const normalizedRight = normalizeOutlineTitleForMatching(right);
	if (!normalizedLeft || !normalizedRight) return 0;
	if (normalizedLeft === normalizedRight) return 1;
	const shorterLength = Math.min(normalizedLeft.length, normalizedRight.length);
	if (shorterLength < 4) return 0;
	if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
		return 0.88 + Math.min(0.08, shorterLength / 200);
	}
	return 0;
}

function getNativeOutlinePageIndex(item) {
	const pageIndex = Number(item?.pageIndex);
	return Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex : undefined;
}

function buildNativeOutlineNodes(items, rootNode) {
	const flatNodes = [];
	let ordinal = 0;
	const appendItems = (sourceItems, parentNode, depth = 1) => {
		const children = [];
		for (const item of Array.isArray(sourceItems) ? sourceItems : []) {
			if (!item || typeof item !== 'object') continue;
			const title = normalizeText(item.title);
			if (!title) {
				children.push(...appendItems(item.items, parentNode, depth));
				continue;
			}
			ordinal += 1;
			const pageIndex = getNativeOutlinePageIndex(item);
			const node = createNode('section', {
				id: `native-outline-${ordinal}`,
				title,
				level: parentNode.level + 1,
				children: [],
				meta: {
					nativeOutline: true,
					nativeOutlineOrder: ordinal,
					pageIndex,
					rects: Array.isArray(item.rects) ? item.rects : [],
					depth,
				},
			});
			flatNodes.push({
				node,
				pageIndex,
				ordinal,
				depth,
			});
			node.children.push(...appendItems(item.items, node, depth + 1));
			children.push(node);
		}
		return children;
	};
	return {
		children: appendItems(items, rootNode),
		flatNodes,
	};
}

function mapMineruSectionsToNativeOutline(sectionRecords, nativeNodes) {
	const mapping = new Map();
	for (const sectionRecord of sectionRecords) {
		let bestCandidate = null;
		for (const nativeRecord of nativeNodes) {
			const titleScore = scoreOutlineTitleMatch(sectionRecord.node?.title, nativeRecord.node?.title);
			if (titleScore < 0.8) continue;
			const sectionPage = sectionRecord.pageIndex;
			const nativePage = nativeRecord.pageIndex;
			const pageDistance = Number.isInteger(sectionPage) && Number.isInteger(nativePage)
				? Math.abs(sectionPage - nativePage)
				: 0;
			const score = (titleScore * 100) - Math.min(pageDistance, 20);
			if (!bestCandidate || score > bestCandidate.score || (score === bestCandidate.score && nativeRecord.ordinal < bestCandidate.ordinal)) {
				bestCandidate = { ...nativeRecord, score };
			}
		}
		if (bestCandidate) {
			mapping.set(sectionRecord.node, bestCandidate.node);
		}
	}
	return mapping;
}

function findFallbackNativeOutlineNode(nativeNodes, pageIndex) {
	if (!nativeNodes.length) return null;
	if (!Number.isInteger(pageIndex)) return nativeNodes[0].node;
	const candidates = nativeNodes.filter((item) => Number.isInteger(item.pageIndex) && item.pageIndex <= pageIndex);
	if (candidates.length) {
		return candidates[candidates.length - 1].node;
	}
	return nativeNodes[0].node;
}

function collectMineruNodesByType(rootNode, type, nodes = []) {
	if (!rootNode || typeof rootNode !== 'object') return nodes;
	if (String(rootNode.type || '') === type) {
		nodes.push(rootNode);
	}
	for (const child of Array.isArray(rootNode.children) ? rootNode.children : []) {
		collectMineruNodesByType(child, type, nodes);
	}
	return nodes;
}

function applyNativePdfOutline(contentTree, nativeOutline) {
	const sourceRoot = contentTree?.root;
	const nativeItems = Array.isArray(nativeOutline?.items) ? nativeOutline.items : (Array.isArray(nativeOutline) ? nativeOutline : []);
	if (!sourceRoot || typeof sourceRoot !== 'object' || !nativeItems.length) {
		return contentTree;
	}

	const rootNode = cloneMineruTreeNode(sourceRoot, []);
	const nativeTree = buildNativeOutlineNodes(nativeItems, rootNode);
	if (!nativeTree.flatNodes.length) {
		return contentTree;
	}

	const { sections, leaves } = collectMineruBodyRecords(sourceRoot);
	const sectionMapping = mapMineruSectionsToNativeOutline(sections, nativeTree.flatNodes);
	const firstMappedSectionBlockIndex = [...sectionMapping.keys()]
		.map((node) => getMineruNodeBlockIndex(node))
		.filter(Number.isInteger)
		.sort((left, right) => left - right)[0];
	let abstractNode = null;
	const getAbstractNode = () => {
		if (!abstractNode) {
			abstractNode = createNode('section', {
				id: 'native-outline-abstract',
				title: 'Abstract',
				level: 1,
				children: [],
				meta: {
					supplementalOutline: true,
					isAbstract: true,
				},
			});
		}
		return abstractNode;
	};
	for (const leaf of leaves) {
		let targetNode = null;
		for (let index = leaf.sectionAncestors.length - 1; index >= 0; index -= 1) {
			targetNode = sectionMapping.get(leaf.sectionAncestors[index]) || null;
			if (targetNode) break;
		}
		const blockIndex = getMineruNodeBlockIndex(leaf.node);
		const precedesFirstMappedSection = leaf.sectionAncestors.length === 0
			&& Number.isInteger(blockIndex)
			&& Number.isInteger(firstMappedSectionBlockIndex)
			&& blockIndex < firstMappedSectionBlockIndex;
		if (!targetNode && (isMineruAbstractLeaf(leaf.node) || precedesFirstMappedSection)) {
			targetNode = getAbstractNode();
		}
		targetNode = targetNode || findFallbackNativeOutlineNode(nativeTree.flatNodes, leaf.pageIndex);
		if (targetNode) {
			targetNode.children.push(cloneMineruTreeNode(leaf.node, []));
		}
	}

	const references = collectMineruNodesByType(sourceRoot, 'reference')
		.map((node) => cloneMineruTreeNode(node, []));
	if (references.length) {
		rootNode.children.push(createNode('references', {
			id: 'native-outline-references',
			title: 'References',
			level: 1,
			children: references,
			meta: { sourceType: 'mineru' },
		}));
	}
	for (const type of ['image', 'table']) {
		rootNode.children.push(...collectMineruNodesByType(sourceRoot, type)
			.map((node) => cloneMineruTreeNode(node, [])));
	}
	rootNode.children.unshift(...nativeTree.children);
	if (abstractNode?.children.length) {
		rootNode.children.unshift(abstractNode);
	}
	rootNode.meta = {
		...(rootNode.meta || {}),
		outlineSource: 'native-pdf',
		nativeOutlineCount: nativeTree.flatNodes.length,
	};

	return {
		...contentTree,
		root: rootNode,
		stats: {
			...(contentTree.stats || {}),
			outlineSource: 'native-pdf',
			nativeOutlineCount: nativeTree.flatNodes.length,
		},
	};
}

function countNodesByType(node, type) {
	if (!node || typeof node !== 'object') {
		return 0;
	}
	let count = 0;
	const stack = [node];
	while (stack.length) {
		const current = stack.pop();
		if (!current || typeof current !== 'object') {
			continue;
		}
		if (current.type === type) {
			count += 1;
		}
		if (Array.isArray(current.children)) {
			for (const child of current.children) {
				stack.push(child);
			}
		}
	}
	return count;
}

async function parseMineruContentTreeFromFile(filePath, options = {}) {
	const normalizedPath = await resolveReadableArtifactPath(
		filePath,
		new Set(['.json', '.md', '.markdown']),
		'MinerU artifact path is required',
	);
	if (/\.md(?:own)?$/i.test(normalizedPath) || /\.markdown$/i.test(normalizedPath)) {
		const markdown = await readTextFileWithLimit(normalizedPath);
		return buildMineruContentTreeFromMarkdown(markdown, {
			...options,
			sourcePath: normalizedPath,
		});
	}
	try {
		const raw = await readTextFileWithLimit(normalizedPath);
		const parsed = JSON.parse(raw);
		return buildMineruContentTree(parsed, {
			...options,
			sourcePath: normalizedPath,
		});
	}
	catch (error) {
		const markdownPath = options.markdownPath
			? await resolveReadableArtifactPath(options.markdownPath, new Set(['.md', '.markdown']), 'MinerU markdown artifact path is required')
			: '';
		if (markdownPath) {
			const markdown = await readTextFileWithLimit(markdownPath);
			return buildMineruContentTreeFromMarkdown(markdown, {
				...options,
				sourcePath: markdownPath,
				jsonPath: normalizedPath,
			});
		}
		throw error;
	}
}

module.exports = {
	applyNativePdfOutline,
	buildMineruContentTree,
	buildMineruContentTreeFromMarkdown,
	parseMineruContentTreeFromFile,
};
