const crypto = require('crypto');

// Version 4 keeps the native PDF outline immutable. AI text is an attached
// one-sentence annotation, never a replacement for an outline title.
const AI_OUTLINE_SCHEMA_VERSION = 5;
const AI_OUTLINE_GENERATION_MODE = 'native-outline-full-v1';
const AI_OUTLINE_EXTERNAL_SKILL_GENERATION_MODE = 'external-skill-v1';
const AI_OUTLINE_MINERU_NAVIGATION_GENERATION_MODE = 'mineru-navigation-v1';
const AI_OUTLINE_SOURCE_NATIVE = 'pdf-native';
const AI_OUTLINE_SOURCE_MINERU = 'mineru-json';
const MAX_AI_OUTLINE_ITEMS = 5000;
const MAX_AI_OUTLINE_SUMMARY_CHARS = 160;
const MAX_AI_OUTLINE_POINTS = 3;
const MAX_AI_OUTLINE_POINT_CHARS = 100;
const MAX_AI_OUTLINE_SOURCE_CHARS = 2400;
const MAX_AI_OUTLINE_PROMPT_CHARS = 60000;
const MAX_NATIVE_OUTLINE_ITEMS = 5000;
const MAX_NATIVE_OUTLINE_DEPTH = 32;

function normalizeAiOutlineLanguage(value) {
	return String(value || '').trim().toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function normalizeText(value) {
	return String(value || '')
		.replace(/[\r\n\t]+/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim();
}

function clampText(value, maxChars = MAX_AI_OUTLINE_SUMMARY_CHARS) {
	const text = normalizeText(value);
	if (text.length <= maxChars) {
		return text;
	}
	return `${text.slice(0, Math.max(1, maxChars - 1)).trim()}…`;
}

function normalizeOutlinePoints(value) {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.slice(0, MAX_AI_OUTLINE_POINTS)
		.map((point) => clampText(point, MAX_AI_OUTLINE_POINT_CHARS))
		.filter(Boolean);
}


function getNodeBlockIndices(node) {
	const candidates = [
		...(Array.isArray(node?.meta?.blockIndices) ? node.meta.blockIndices : []),
		...(Number.isInteger(node?.meta?.blockIndex) ? [node.meta.blockIndex] : []),
	];
	return [...new Set(candidates
		.map((value) => Number(value))
		.filter((value) => Number.isInteger(value) && value >= 0))].slice(0, 200);
}

function normalizeBBox(value) {
	if (!Array.isArray(value) || value.length < 4) {
		return null;
	}
	const bbox = value.slice(0, 4).map(Number);
	if (!bbox.every(Number.isFinite) || bbox[0] === bbox[2] || bbox[1] === bbox[3]) {
		return null;
	}
	return [
		Math.min(bbox[0], bbox[2]),
		Math.min(bbox[1], bbox[3]),
		Math.max(bbox[0], bbox[2]),
		Math.max(bbox[1], bbox[3]),
	];
}

function getNodeNavigationAnchor(node) {
	if (!node || typeof node !== 'object') {
		return { pageIndex: null, blockIndex: null, bbox: null };
	}
	const ownPageIndex = Number(node?.meta?.pageIndex);
	const ownBlockIndex = Number(node?.meta?.blockIndex);
	const own = {
		pageIndex: Number.isInteger(ownPageIndex) && ownPageIndex >= 0 ? ownPageIndex : null,
		blockIndex: Number.isInteger(ownBlockIndex) && ownBlockIndex >= 0 ? ownBlockIndex : null,
		bbox: normalizeBBox(node?.meta?.bbox),
	};
	if (own.pageIndex !== null && own.bbox) {
		return own;
	}
	for (const child of Array.isArray(node.children) ? node.children : []) {
		const childAnchor = getNodeNavigationAnchor(child);
		if (own.pageIndex !== null && childAnchor.pageIndex !== own.pageIndex) {
			continue;
		}
		if (childAnchor.pageIndex !== null) {
			if (own.pageIndex === null) {
				return childAnchor;
			}
			return {
				pageIndex: own.pageIndex,
				blockIndex: own.blockIndex ?? childAnchor.blockIndex,
				bbox: childAnchor.bbox,
			};
		}
	}
	return own;
}

function isMineruNavigationSection(node) {
	const type = String(node?.type || '').toLocaleLowerCase();
	return type === 'section' || type === 'references';
}

function collectDirectSectionMaterial(node, textParts = [], blockIndices = [], isRoot = true) {
	if (!node || typeof node !== 'object') {
		return { textParts, blockIndices };
	}
	if (!isRoot && isMineruNavigationSection(node)) {
		return { textParts, blockIndices };
	}
	const type = String(node.type || '').toLocaleLowerCase();
	if (['text', 'equation', 'image', 'table', 'reference'].includes(type)) {
		const text = normalizeText(node.text || node.title || '');
		if (text) {
			textParts.push(text);
		}
		blockIndices.push(...getNodeBlockIndices(node));
	}
	for (const child of Array.isArray(node.children) ? node.children : []) {
		collectDirectSectionMaterial(child, textParts, blockIndices, false);
	}
	return { textParts, blockIndices };
}

function collectMineruNavigationEntries(root) {
	const entries = [];
	const usedIDs = new Set();
	const makeID = (node, fallback) => {
		const requested = clampText(node?.id || '', 160).replace(/[^A-Za-z0-9_.:-]/gu, '-');
		const base = requested || `mineru-section-${fallback}`;
		if (!usedIDs.has(base)) {
			usedIDs.add(base);
			return base;
		}
		let suffix = 2;
		while (usedIDs.has(`${base}-${suffix}`)) {
			suffix += 1;
		}
		const id = `${base}-${suffix}`;
		usedIDs.add(id);
		return id;
	};
	const visit = (nodes, parentID = '', depth = 1) => {
		for (const node of Array.isArray(nodes) ? nodes : []) {
			if (!node || typeof node !== 'object') {
				continue;
			}
			if (!isMineruNavigationSection(node)) {
				visit(node.children, parentID, depth);
				continue;
			}
			const title = clampText(node.title, 1024);
			if (!title) {
				visit(node.children, parentID, depth);
				continue;
			}
			const id = makeID(node, entries.length + 1);
			const anchor = getNodeNavigationAnchor(node);
			const material = collectDirectSectionMaterial(node);
			const sourceBlockIndices = [...new Set([
				...getNodeBlockIndices(node),
				...(anchor.blockIndex !== null ? [anchor.blockIndex] : []),
				...material.blockIndices,
			])].slice(0, 200);
			entries.push({
				id,
				parentID,
				originalTitle: title,
				title,
				level: depth,
				pageIndex: anchor.pageIndex,
				blockIndex: anchor.blockIndex,
				bbox: anchor.bbox,
				sourceText: clampText(material.textParts.join(' '), MAX_AI_OUTLINE_SOURCE_CHARS),
				sourceBlockIndices,
			});
			visit(node.children, id, depth + 1);
		}
	};
	visit(root?.children);
	return entries.slice(0, MAX_AI_OUTLINE_ITEMS);
}

function normalizeSourceExtent(value) {
	const numericValue = Number(value || 0);
	if (!(numericValue > 0)) {
		return 0;
	}
	// MinerU commonly uses a 1000-unit image coordinate plane whose last text
	// block can end before the physical page edge.
	return numericValue >= 850 && numericValue <= 1050 ? 1000 : numericValue;
}

function collectMineruPageBounds(root) {
	const boundsByPage = new Map();
	const visit = (node) => {
		if (!node || typeof node !== 'object') return;
		const pageIndex = Number(node?.meta?.pageIndex);
		const bbox = normalizeBBox(node?.meta?.bbox);
		if (Number.isInteger(pageIndex) && pageIndex >= 0 && bbox) {
			const current = boundsByPage.get(pageIndex) || { maxX: 0, maxY: 0 };
			current.maxX = Math.max(current.maxX, bbox[0], bbox[2]);
			current.maxY = Math.max(current.maxY, bbox[1], bbox[3]);
			boundsByPage.set(pageIndex, current);
		}
		for (const child of Array.isArray(node.children) ? node.children : []) {
			visit(child);
		}
	};
	visit(root);
	for (const bounds of boundsByPage.values()) {
		bounds.width = normalizeSourceExtent(bounds.maxX);
		bounds.height = normalizeSourceExtent(bounds.maxY);
	}
	return boundsByPage;
}

function getMineruNavigationPosition(entry, source, pageMetrics) {
	const pageIndex = Number(entry?.pageIndex);
	const bbox = normalizeBBox(entry?.bbox);
	if (!Number.isInteger(pageIndex) || pageIndex < 0) {
		return null;
	}
	const metricPages = Array.isArray(pageMetrics)
		? pageMetrics
		: (Array.isArray(pageMetrics?.pages) ? pageMetrics.pages : []);
	const metric = metricPages[pageIndex] || {};
	const pdfWidth = Number(metric.width || 0);
	const pdfHeight = Number(metric.height || 0);
	const bounds = source?.pageBounds?.get?.(pageIndex) || {};
	const sourceWidth = Number(bounds.width || 0);
	const sourceHeight = Number(bounds.height || 0);
	if (!bbox || !(pdfWidth > 0) || !(pdfHeight > 0) || !(sourceWidth > 0) || !(sourceHeight > 0)) {
		return { pageIndex };
	}
	const [x1, y1, x2, y2] = bbox;
	return {
		pageIndex,
		rects: [[
			Math.min(x1, x2) * pdfWidth / sourceWidth,
			(sourceHeight - Math.max(y1, y2)) * pdfHeight / sourceHeight,
			Math.max(x1, x2) * pdfWidth / sourceWidth,
			(sourceHeight - Math.min(y1, y2)) * pdfHeight / sourceHeight,
		]],
	};
}

function collectSectionMaterial(node, textParts = [], blockIndices = []) {
	if (!node || typeof node !== 'object') {
		return { textParts, blockIndices };
	}

	const type = String(node.type || '').toLowerCase();
	const isContentLeaf = ['text', 'equation', 'image', 'table'].includes(type);
	if (isContentLeaf) {
		const text = normalizeText(node.text || node.title || '');
		if (text) {
			textParts.push(text);
		}
		blockIndices.push(...getNodeBlockIndices(node));
	}

	for (const child of Array.isArray(node.children) ? node.children : []) {
		collectSectionMaterial(child, textParts, blockIndices);
	}
	return { textParts, blockIndices };
}

function collectNativeOutlineNodes(root, nodes = []) {
	if (!root || typeof root !== 'object') {
		return nodes;
	}
	const order = Number(root?.meta?.nativeOutlineOrder);
	if (Number.isInteger(order) && order > 0) {
		nodes.push(root);
	}
	for (const child of Array.isArray(root.children) ? root.children : []) {
		collectNativeOutlineNodes(child, nodes);
	}
	return nodes.sort((left, right) => Number(left.meta.nativeOutlineOrder) - Number(right.meta.nativeOutlineOrder));
}

function createSourceFingerprint(entries) {
	const digest = crypto.createHash('sha256');
	for (const entry of entries) {
		digest.update(JSON.stringify({
			id: entry.id || '',
			parentID: entry.parentID || '',
			nativeOutlineOrder: entry.nativeOutlineOrder,
			originalTitle: entry.originalTitle || entry.title || '',
			pageIndex: entry.pageIndex,
			blockIndex: entry.blockIndex,
			bbox: entry.bbox || null,
			text: entry.sourceText,
		}));
	}
	return digest.digest('hex').slice(0, 32);
}

function normalizeTitleForMatch(value) {
	return normalizeText(value)
		.toLocaleLowerCase()
		.replace(/[\p{P}\p{S}\s]+/gu, '');
}

function flattenProvidedNativeOutline(items, entries = [], state = { order: 0 }, depth = 1) {
	for (const item of Array.isArray(items) ? items : []) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const title = normalizeText(item.title);
		if (!title) {
			flattenProvidedNativeOutline(item.items, entries, state, depth);
			continue;
		}
		state.order += 1;
		const pageIndex = Number(item.pageIndex);
		entries.push({
			nativeOutlineOrder: state.order,
			originalTitle: title,
			level: depth,
			pageIndex: Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex : null,
		});
		flattenProvidedNativeOutline(item.items, entries, state, depth + 1);
	}
	return entries;
}

function collectContentLeaves(node, leaves = [], seen = new Set()) {
	if (!node || typeof node !== 'object') {
		return leaves;
	}
	const type = String(node.type || '').toLocaleLowerCase();
	if (['text', 'equation', 'image', 'table'].includes(type)) {
		const text = normalizeText(node.text || node.title || '');
		const pageIndex = Number(node?.meta?.pageIndex);
		const key = `${node.id || ''}\u0000${pageIndex}\u0000${text}`;
		if (text && !seen.has(key)) {
			seen.add(key);
			leaves.push({
				text,
				pageIndex: Number.isInteger(pageIndex) ? pageIndex : null,
				blockIndices: getNodeBlockIndices(node),
			});
		}
	}
	for (const child of Array.isArray(node.children) ? node.children : []) {
		collectContentLeaves(child, leaves, seen);
	}
	return leaves;
}

function getPageScopedMaterial(leaves, entry, nextEntry) {
	const startPage = Number.isInteger(entry?.pageIndex) ? entry.pageIndex : null;
	const endPage = Number.isInteger(nextEntry?.pageIndex) && nextEntry.pageIndex > startPage
		? nextEntry.pageIndex
		: null;
	const candidates = (Array.isArray(leaves) ? leaves : []).filter((leaf) => {
		if (!Number.isInteger(startPage) || !Number.isInteger(leaf.pageIndex)) {
			return startPage === null;
		}
		if (endPage !== null) {
			return leaf.pageIndex >= startPage && leaf.pageIndex < endPage;
		}
		return leaf.pageIndex === startPage;
	});
	return {
		textParts: candidates.map((leaf) => leaf.text),
		blockIndices: candidates.flatMap((leaf) => leaf.blockIndices || []),
	};
}

function findNativeSourceNode(entry, nativeNodes) {
	const sameOrder = nativeNodes.find((node) => Number(node?.meta?.nativeOutlineOrder) === entry.nativeOutlineOrder);
	const wantedTitle = normalizeTitleForMatch(entry.originalTitle);
	if (sameOrder && normalizeTitleForMatch(sameOrder.title) === wantedTitle) {
		return sameOrder;
	}
	const titleMatches = nativeNodes.filter((node) => normalizeTitleForMatch(node.title) === wantedTitle);
	if (titleMatches.length) {
		return titleMatches.sort((left, right) => {
			const leftDistance = Math.abs((Number(left?.meta?.pageIndex) || 0) - (entry.pageIndex || 0));
			const rightDistance = Math.abs((Number(right?.meta?.pageIndex) || 0) - (entry.pageIndex || 0));
			return leftDistance - rightDistance;
		})[0];
	}
	return sameOrder || null;
}

function buildNativeOutlineEntries(nativeNodes) {
	return nativeNodes.slice(0, MAX_AI_OUTLINE_ITEMS).map((node) => ({
		nativeOutlineOrder: Number(node.meta.nativeOutlineOrder),
		originalTitle: normalizeText(node.title),
		level: Number.isInteger(node.level) ? node.level : Number(node.meta.depth || 0) + 1,
		pageIndex: Number.isInteger(node.meta.pageIndex) ? node.meta.pageIndex : null,
	}));
}

function buildAiOutlineSource(contentTree, options = {}) {
	const nativeNodes = collectNativeOutlineNodes(contentTree?.root);
	const suppliedEntries = flattenProvidedNativeOutline(options.nativeOutline);
	// The project tree is populated from PDF.js' bookmark tree. Prefer it over
	// renderer state because a renderer can temporarily expose only a collapsed
	// or not-yet-loaded subset while the direct PDF extraction is complete.
	const treeEntries = buildNativeOutlineEntries(nativeNodes);
	const sourceEntries = treeEntries.length ? treeEntries : suppliedEntries;
	const leaves = collectContentLeaves(contentTree?.root);
	const nativeEntries = sourceEntries.slice(0, MAX_AI_OUTLINE_ITEMS).map((entry, index) => {
		const matchedNode = findNativeSourceNode(entry, nativeNodes);
		const material = matchedNode
			? collectSectionMaterial(matchedNode)
			: getPageScopedMaterial(leaves, entry, sourceEntries[index + 1]);
		return {
			...entry,
			sourceText: clampText(material.textParts.join(' '), MAX_AI_OUTLINE_SOURCE_CHARS),
			sourceBlockIndices: [...new Set(material.blockIndices)].slice(0, 200),
		};
	});
	const entries = nativeEntries.length ? nativeEntries : collectMineruNavigationEntries(contentTree?.root);
	const outlineSource = nativeEntries.length
		? AI_OUTLINE_SOURCE_NATIVE
		: (entries.length ? AI_OUTLINE_SOURCE_MINERU : 'none');
	return {
		outlineSource,
		nativeOutlineCount: nativeEntries.length,
		navigationItemCount: outlineSource === AI_OUTLINE_SOURCE_MINERU ? entries.length : 0,
		sourceFingerprint: createSourceFingerprint(entries),
		pageBounds: collectMineruPageBounds(contentTree?.root),
		entries,
	};
}

function isMineruNavigationSource(source) {
	return source?.outlineSource === AI_OUTLINE_SOURCE_MINERU;
}

function buildMineruNavigationOutline(source, options = {}) {
	if (!isMineruNavigationSource(source)) {
		return null;
	}
	const language = normalizeAiOutlineLanguage(options.language);
	const annotations = options.annotations instanceof Map ? options.annotations : new Map();
	return {
		schemaVersion: AI_OUTLINE_SCHEMA_VERSION,
		language,
		status: clampText(options.status || 'navigation-ready', 48),
		provider: clampText(options.provider || 'mineru', 48),
		model: clampText(options.model || '', 120),
		generationMode: AI_OUTLINE_MINERU_NAVIGATION_GENERATION_MODE,
		outlineSource: AI_OUTLINE_SOURCE_MINERU,
		sourceFingerprint: source.sourceFingerprint,
		nativeOutlineCount: 0,
		navigationItemCount: source.entries.length,
		generatedAt: clampText(options.generatedAt || '', 64),
		items: source.entries.map((entry) => {
			const annotation = clampText(annotations.get(entry.id) || '', MAX_AI_OUTLINE_SUMMARY_CHARS);
			const position = getMineruNavigationPosition(entry, source, options.pageMetrics);
			return {
				id: entry.id,
				parentID: entry.parentID || '',
				originalTitle: entry.originalTitle,
				title: entry.title || entry.originalTitle,
				level: entry.level,
				pageIndex: entry.pageIndex,
				blockIndex: entry.blockIndex,
				bbox: entry.bbox || null,
				sourceBlockIndices: entry.sourceBlockIndices,
				...(position ? { position } : {}),
				...(annotation ? { annotation, points: [] } : {}),
			};
		}),
	};
}

function isMineruNavigationReadyForSource(value, source) {
	const outline = normalizeAiOutline(value);
	const entries = Array.isArray(source?.entries) ? source.entries : [];
	if (!outline
		|| !isMineruNavigationSource(source)
		|| outline.status === 'cleared'
		|| outline.outlineSource !== AI_OUTLINE_SOURCE_MINERU
		|| outline.generationMode !== AI_OUTLINE_MINERU_NAVIGATION_GENERATION_MODE
		|| outline.sourceFingerprint !== String(source?.sourceFingerprint || '')
		|| outline.items.length !== entries.length) {
		return false;
	}
	return entries.every((entry, index) => (
		outline.items[index]?.id === entry.id
		&& outline.items[index]?.parentID === (entry.parentID || '')
		&& normalizeText(outline.items[index]?.originalTitle) === normalizeText(entry.originalTitle)
		&& Number(outline.items[index]?.level) === Number(entry.level)
	));
}

function normalizeNativeOutlineItems(value, depth = 0, budget = { count: 0 }) {
	if (!Array.isArray(value) || depth > MAX_NATIVE_OUTLINE_DEPTH) {
		return [];
	}
	const items = [];
	for (const item of value) {
		if (budget.count >= MAX_NATIVE_OUTLINE_ITEMS || !item || typeof item !== 'object') {
			break;
		}
		const title = normalizeText(item.title).slice(0, 1024);
		const position = item?.location?.position && typeof item.location.position === 'object'
			? item.location.position
			: item?.position && typeof item.position === 'object'
				? item.position
				: {};
		const pageIndex = Number(position.pageIndex);
		const rects = Array.isArray(position.rects)
			? position.rects
				.slice(0, 32)
				.map((rect) => {
					if (!Array.isArray(rect) || rect.length < 4) return null;
					const normalized = rect.slice(0, 4).map(Number);
					return normalized.every(Number.isFinite) ? normalized : null;
				})
				.filter(Boolean)
			: [];
		budget.count += 1;
		if (!title) {
			items.push(...normalizeNativeOutlineItems(item.items, depth + 1, budget));
			continue;
		}
		items.push({
			title,
			pageIndex: Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex : undefined,
			rects,
			items: normalizeNativeOutlineItems(item.items, depth + 1, budget),
		});
	}
	return items;
}

function chooseExtractiveSentence(sourceText) {
	const text = normalizeText(sourceText)
		.replace(/\[[0-9]+(?:\s*[,\-]\s*[0-9]+)*\]/gu, '')
		.replace(/\s+/gu, ' ')
		.trim();
	if (!text) {
		return '';
	}
	const sentences = text.split(/(?<=[.!?。！？])\s+/u).map(normalizeText).filter(Boolean);
	const candidate = sentences.find((sentence) => sentence.length >= 36) || sentences[0] || text;
	return clampText(candidate, 78);
}

function buildChineseFallbackAnnotation(entry) {
	const source = `${entry?.originalTitle || ''} ${entry?.sourceText || ''}`.toLocaleLowerCase();
	if (/references?|bibliography|参考文献/u.test(source)) {
		return '汇总支撑本文方法与实验的参考文献。';
	}
	if (/abstract|摘要/u.test(source)) {
		return '本节概括研究问题、方法思路与主要实验结论。';
	}
	if (/introduction|引言|background|背景|motivation|动机/u.test(source)) {
		return '本节交代研究问题、已有局限与本文的切入点。';
	}
	if (/related work|相关工作|prior work|existing method/u.test(source)) {
		return '本节梳理相关研究并说明本文方法的定位。';
	}
	if (/method|approach|architecture|framework|loss|algorithm|方法|框架|损失|算法/u.test(source)) {
		return '本节说明核心方法、关键机制及其实现流程。';
	}
	if (/experiment|result|ablation|dataset|evaluation|实验|结果|消融|数据集|评测/u.test(source)) {
		return '本节说明数据与评测设置，并报告实验或消融结果。';
	}
	if (/conclusion|结论|discussion|讨论/u.test(source)) {
		return '本节归纳本文贡献、实验结论与适用范围。';
	}
	return '本节概述该主题的关键研究内容。';
}

function buildFallbackAnnotation(entry, language = 'en') {
	const normalizedLanguage = normalizeAiOutlineLanguage(language);
	const sentence = chooseExtractiveSentence(entry.sourceText);
	if (normalizedLanguage === 'zh') {
		// Do not show an English extract inside a Chinese UI when the model is
		// unavailable. A localized fallback is preferable to a mixed-language note.
		if (sentence && /\p{Script=Han}/u.test(sentence)) {
			return sentence;
		}
		return buildChineseFallbackAnnotation(entry);
	}
	if (sentence) {
		return sentence;
	}
	if (/references?/iu.test(entry.originalTitle)) {
		return 'References supporting the methods and experiments in this paper.';
	}
	return clampText(entry.originalTitle ? `This section covers ${entry.originalTitle}.` : 'Main content of this section.', MAX_AI_OUTLINE_SUMMARY_CHARS);
}

function buildFallbackAiOutline(source, reason = 'extractive-fallback', options = {}) {
	const language = normalizeAiOutlineLanguage(options.language);
	if (isMineruNavigationSource(source)) {
		const annotations = new Map(source.entries.map((entry) => [
			entry.id,
			buildFallbackAnnotation(entry, language),
		]));
		return buildMineruNavigationOutline(source, {
			language,
			status: reason,
			provider: 'extractive',
			pageMetrics: options.pageMetrics,
			generatedAt: new Date().toISOString(),
			annotations,
		});
	}
	return {
		schemaVersion: AI_OUTLINE_SCHEMA_VERSION,
		language,
		status: reason,
		provider: 'extractive',
		model: '',
		generationMode: AI_OUTLINE_GENERATION_MODE,
		outlineSource: AI_OUTLINE_SOURCE_NATIVE,
		sourceFingerprint: source.sourceFingerprint,
		nativeOutlineCount: source.nativeOutlineCount,
		navigationItemCount: 0,
		generatedAt: new Date().toISOString(),
		items: source.entries.map((entry) => ({
			nativeOutlineOrder: entry.nativeOutlineOrder,
			originalTitle: entry.originalTitle,
			level: entry.level,
			pageIndex: entry.pageIndex,
			annotation: buildFallbackAnnotation(entry, language),
			sourceBlockIndices: entry.sourceBlockIndices,
		})),
	};
}

function makePrompt(source, options = {}) {
	const language = normalizeAiOutlineLanguage(options.language);
	const isNavigation = isMineruNavigationSource(source);
	const sections = source.entries.map((entry) => (isNavigation
		? {
			id: entry.id,
			parentId: entry.parentID || '',
			title: entry.originalTitle,
			level: entry.level,
			page: Number.isInteger(entry.pageIndex) ? entry.pageIndex + 1 : null,
			content: entry.sourceText || '(该条目没有可提取的正文)',
		}
		: {
			order: entry.nativeOutlineOrder,
			title: entry.originalTitle,
			level: entry.level,
			content: entry.sourceText || '(该条目没有可提取的正文)',
		}));
	if (isNavigation) {
		return (language === 'zh'
			? [
				'这篇 PDF 没有原生书签。以下是由 MinerU 解析 JSON 提取的章节导航条目。',
				'每个 id 对应一个可跳转的原文位置。必须严格保留全部 id：不能新增、删除、合并、重排、改写标题或改变层级。',
				'为每个 id 生成一条简洁中文 annotation，概括该章节正文而不是只翻译标题；建议 12-38 个汉字，最多 60 个汉字。不要返回 points、要点列表或任何额外字段。',
				'只返回 JSON，不要 Markdown 代码围栏，格式为 {"items":[{"id":"section-1","annotation":"..."}]}。',
				JSON.stringify(sections),
			]
			: [
				'This PDF has no native bookmarks. The input is a navigable chapter tree extracted from MinerU JSON.',
				'Every id maps to a source-grounded, clickable PDF location. Preserve every id exactly: do not add, delete, merge, reorder, rename titles, or change hierarchy.',
				'Generate one concise English annotation for each id that summarizes its section body, not merely its title. Use 12-38 words and no more than 60 words. Do not return points, lists, or extra fields.',
				'Return JSON only, without a Markdown fence: {"items":[{"id":"section-1","annotation":"..."}]}.',
				JSON.stringify(sections),
			])
			.join('\n')
			.slice(0, MAX_AI_OUTLINE_PROMPT_CHARS);
	}
	const prompt = language === 'zh'
		? [
			'请为一篇学术论文的 PDF 原生大纲生成中文 AI 注释。',
			'输入中的每个 order 都对应 PDF 原有的一个大纲条目。必须严格保留全部 order：不能新增、删除、合并或重排条目。',
			'每条 annotation 是该条目及其正文的内容概括，不要只翻译标题；只写一句简洁中文，建议 12-38 个汉字，最多 60 个汉字。不要返回 points、要点列表或任何额外字段。',
			'这些文字会显示在原生目录标题下方，因此绝不能改写、翻译或复述原生标题。',
			'如果条目是 References，只概括其作用；不要编造输入中没有的实验数据。',
			'只返回 JSON，不要 Markdown 代码围栏，格式为 {"items":[{"order":1,"annotation":"..."}]}。',
			JSON.stringify(sections),
		].join('\n')
		: [
			'Generate concise English AI annotations for a paper\'s native PDF outline.',
			'Every input order maps to one existing native PDF outline item. Preserve every order exactly: do not add, delete, merge, or reorder items.',
		'Each annotation should summarize the section and its body, not merely translate the title. Write exactly one concise sentence, usually 12-38 words and never more than 60 words. Do not return points, bullet lists, or extra fields.',
			'The text is rendered beneath the native outline title, so never rewrite, translate, or repeat that title.',
			'For References, only summarize its role. Do not invent experimental results not present in the input.',
		'Return JSON only, without a Markdown fence: {"items":[{"order":1,"annotation":"..."}]}.',
			JSON.stringify(sections),
		].join('\n');
	return prompt.slice(0, MAX_AI_OUTLINE_PROMPT_CHARS);
}

function extractJsonObject(value) {
	const text = String(value || '').trim()
		.replace(/^```(?:json)?\s*/iu, '')
		.replace(/\s*```$/u, '')
		.trim();
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) {
		throw new Error('AI outline response did not contain a JSON object');
	}
	return JSON.parse(text.slice(start, end + 1));
}

function normalizeGeneratedItems(source, generated, options = {}) {
	const language = normalizeAiOutlineLanguage(options.language);
	if (isMineruNavigationSource(source)) {
		const byID = new Map();
		for (const item of Array.isArray(generated?.items) ? generated.items : []) {
			const id = clampText(item?.id ?? item?.sectionId ?? item?.sectionID, 160);
			const annotation = clampText(item?.annotation ?? item?.note ?? item?.summary, MAX_AI_OUTLINE_SUMMARY_CHARS);
			if (id && annotation && !byID.has(id)) {
				byID.set(id, annotation);
			}
		}
		return buildMineruNavigationOutline(source, {
			language,
			status: 'ready',
			provider: options.provider || 'pdfai-context-skill',
			model: options.model || '',
			pageMetrics: options.pageMetrics,
			generatedAt: new Date().toISOString(),
			annotations: new Map(source.entries.map((entry) => [
				entry.id,
				byID.get(entry.id) || buildFallbackAnnotation(entry, language),
			])),
		}).items;
	}
	const byOrder = new Map();
	const rawItems = Array.isArray(generated?.items) ? generated.items : [];
	for (const item of rawItems) {
		const order = Number(item?.order ?? item?.nativeOutlineOrder);
		const annotation = clampText(item?.annotation ?? item?.note ?? item?.summary, MAX_AI_OUTLINE_SUMMARY_CHARS);
		if (Number.isInteger(order) && annotation && !byOrder.has(order)) {
			byOrder.set(order, {
				annotation,
			});
		}
	}
	return source.entries.map((entry) => ({
		...byOrder.get(entry.nativeOutlineOrder),
		nativeOutlineOrder: entry.nativeOutlineOrder,
		originalTitle: entry.originalTitle,
		level: entry.level,
		pageIndex: entry.pageIndex,
		annotation: byOrder.get(entry.nativeOutlineOrder)?.annotation || buildFallbackAnnotation(entry, language),
		points: [],
		sourceBlockIndices: entry.sourceBlockIndices,
	}));
}


function normalizeSourceBlockIndices(value) {
	return Array.isArray(value)
		? [...new Set(value.map(Number).filter((number) => Number.isInteger(number) && number >= 0))].slice(0, 200)
		: [];
}

function normalizeNavigationPosition(value, fallbackPageIndex) {
	const pageIndex = Number(value?.pageIndex ?? fallbackPageIndex);
	if (!Number.isInteger(pageIndex) || pageIndex < 0) {
		return null;
	}
	const rects = Array.isArray(value?.rects)
		? value.rects
			.slice(0, 32)
			.map(normalizeBBox)
			.filter(Boolean)
		: [];
	return {
		pageIndex,
		...(rects.length ? { rects } : {}),
	};
}

function isMineruNavigationOutlineValue(value) {
	if (value?.outlineSource === AI_OUTLINE_SOURCE_MINERU
		|| value?.generationMode === AI_OUTLINE_MINERU_NAVIGATION_GENERATION_MODE) {
		return true;
	}
	const items = Array.isArray(value?.items) ? value.items : [];
	return Boolean(items.length
		&& items.some((item) => clampText(item?.id, 160))
		&& !items.some((item) => Number.isInteger(Number(item?.nativeOutlineOrder ?? item?.order))));
}

function normalizeMineruNavigationItems(items) {
	const normalizedItems = [];
	const seenIDs = new Set();
	for (const item of items.slice(0, MAX_AI_OUTLINE_ITEMS)) {
		const id = clampText(item?.id ?? item?.sectionId ?? item?.sectionID, 160)
			.replace(/[^A-Za-z0-9_.:-]/gu, '-');
		const originalTitle = clampText(item?.originalTitle ?? item?.title, 1024);
		if (!id || !originalTitle || seenIDs.has(id)) {
			continue;
		}
		seenIDs.add(id);
		const pageIndex = Number(item?.pageIndex);
		const normalizedPageIndex = Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex : null;
		const blockIndex = Number(item?.blockIndex);
		const annotation = clampText(item?.annotation ?? item?.note ?? item?.summary, MAX_AI_OUTLINE_SUMMARY_CHARS);
		const position = normalizeNavigationPosition(item?.position, normalizedPageIndex);
		normalizedItems.push({
			id,
			parentID: clampText(item?.parentID ?? item?.parentId, 160).replace(/[^A-Za-z0-9_.:-]/gu, '-'),
			originalTitle,
			title: originalTitle,
			level: Math.max(1, Math.floor(Number(item?.level) || 1)),
			pageIndex: normalizedPageIndex,
			blockIndex: Number.isInteger(blockIndex) && blockIndex >= 0 ? blockIndex : null,
			bbox: normalizeBBox(item?.bbox),
			sourceBlockIndices: normalizeSourceBlockIndices(item?.sourceBlockIndices),
			...(position ? { position } : {}),
			...(annotation ? { annotation, points: [] } : {}),
		});
	}
	return normalizedItems;
}

function normalizeAiOutline(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	const items = Array.isArray(value.items) ? value.items : [];
	const language = normalizeAiOutlineLanguage(value.language);
	const status = clampText(value.status || 'ready', 48);
	const isNavigation = isMineruNavigationOutlineValue(value);
	if (isNavigation) {
		const normalizedItems = normalizeMineruNavigationItems(items);
		if (!normalizedItems.length && status !== 'cleared') {
			return null;
		}
		return {
			schemaVersion: AI_OUTLINE_SCHEMA_VERSION,
			language,
			status,
			provider: clampText(value.provider || '', 48),
			model: clampText(value.model || '', 120),
			generationMode: AI_OUTLINE_MINERU_NAVIGATION_GENERATION_MODE,
			outlineSource: AI_OUTLINE_SOURCE_MINERU,
			sourceFingerprint: clampText(value.sourceFingerprint || '', 80),
			nativeOutlineCount: 0,
			navigationItemCount: Math.max(0, Math.floor(Number(value.navigationItemCount) || normalizedItems.length)),
			generatedAt: clampText(value.generatedAt || '', 64),
			items: normalizedItems,
		};
	}
	const normalizedItems = [];
	const seenOrders = new Set();
	for (const item of items.slice(0, MAX_AI_OUTLINE_ITEMS)) {
		const order = Number(item?.nativeOutlineOrder ?? item?.order);
		const annotation = clampText(item?.annotation ?? item?.note ?? item?.summary, MAX_AI_OUTLINE_SUMMARY_CHARS);
		if (!Number.isInteger(order) || order <= 0 || seenOrders.has(order) || !annotation) {
			continue;
		}
		seenOrders.add(order);
		normalizedItems.push({
			nativeOutlineOrder: order,
			originalTitle: clampText(item?.originalTitle, 1024),
			level: Math.max(0, Math.floor(Number(item?.level) || 0)),
			pageIndex: Number.isInteger(Number(item?.pageIndex)) ? Number(item.pageIndex) : null,
			annotation,
			points: [],
			sourceBlockIndices: normalizeSourceBlockIndices(item?.sourceBlockIndices),
		});
	}
	if (!normalizedItems.length && status !== 'cleared') {
		return null;
	}
	return {
		schemaVersion: AI_OUTLINE_SCHEMA_VERSION,
		language,
		status,
		provider: clampText(value.provider || '', 48),
		model: clampText(value.model || '', 120),
		generationMode: clampText(value.generationMode || '', 80),
		outlineSource: AI_OUTLINE_SOURCE_NATIVE,
		sourceFingerprint: clampText(value.sourceFingerprint || '', 80),
		nativeOutlineCount: Math.max(0, Math.floor(Number(value.nativeOutlineCount) || normalizedItems.length)),
		navigationItemCount: 0,
		generatedAt: clampText(value.generatedAt || '', 64),
		items: normalizedItems,
	};
}

function isAiOutlineCompleteForSource(value, source, options = {}) {
	const outline = normalizeAiOutline(value);
	const expectedEntries = Array.isArray(source?.entries) ? source.entries : [];
	const language = normalizeAiOutlineLanguage(options.language || outline?.language);
	if (!outline
		|| outline.status === 'cleared'
		|| outline.language !== language
		|| outline.items.length !== expectedEntries.length) {
		return false;
	}
	if (isMineruNavigationSource(source)) {
		return outline.outlineSource === AI_OUTLINE_SOURCE_MINERU
			&& outline.generationMode === AI_OUTLINE_MINERU_NAVIGATION_GENERATION_MODE
			&& outline.sourceFingerprint === String(source?.sourceFingerprint || '')
			&& expectedEntries.every((entry, index) => (
				outline.items[index]?.id === entry.id
				&& outline.items[index]?.parentID === (entry.parentID || '')
				&& normalizeTitleForMatch(outline.items[index]?.originalTitle) === normalizeTitleForMatch(entry.originalTitle)
				&& Boolean(normalizeText(outline.items[index]?.annotation))
			));
	}
	if (outline.nativeOutlineCount !== expectedEntries.length) {
		return false;
	}
	const hasMatchingNativeEntries = expectedEntries.every((entry, index) => (
		Number(outline.items[index]?.nativeOutlineOrder) === Number(entry.nativeOutlineOrder)
		&& normalizeTitleForMatch(outline.items[index]?.originalTitle) === normalizeTitleForMatch(entry.originalTitle)
		&& Boolean(normalizeText(outline.items[index]?.annotation))
	));
	if (!hasMatchingNativeEntries) {
		return false;
	}
	if (outline.generationMode === AI_OUTLINE_EXTERNAL_SKILL_GENERATION_MODE) {
		// A provider skill sees the current native bookmark list through the
		// portable context CLI, but does not own the main-process source digest.
		// Preserve a complete one-to-one annotation set across reader reloads.
		return true;
	}
	return outline.generationMode === AI_OUTLINE_GENERATION_MODE
		&& outline.sourceFingerprint === String(source?.sourceFingerprint || '');
}

module.exports = {
	AI_OUTLINE_SCHEMA_VERSION,
	AI_OUTLINE_GENERATION_MODE,
	AI_OUTLINE_EXTERNAL_SKILL_GENERATION_MODE,
	AI_OUTLINE_MINERU_NAVIGATION_GENERATION_MODE,
	AI_OUTLINE_SOURCE_MINERU,
	buildAiOutlineSource,
	buildFallbackAiOutline,
	buildMineruNavigationOutline,
	isMineruNavigationSource,
	isMineruNavigationReadyForSource,
	isAiOutlineCompleteForSource,
	normalizeAiOutlineLanguage,
	normalizeNativeOutlineItems,
	normalizeAiOutline,
};
