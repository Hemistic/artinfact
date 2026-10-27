const crypto = require('crypto');
const { normalizeAiOutlineLanguage } = require('./ai-outline-service');

const AI_INSIGHT_SCHEMA_VERSION = 1;
const AI_INSIGHT_COLORS = Object.freeze({
	innovation: '#E28A13',
	evidence: '#278EE8',
});
const MAX_MARKDOWN_SOURCE_CHARS = 62000;
const MAX_STRUCTURED_SOURCE_CHARS = 62000;
const MAX_STRUCTURED_BLOCK_CHARS = 1800;
const MAX_MARKDOWN_SECTION_CHARS = 7200;
const MAX_PROMPT_BLOCKS = 520;
const MAX_PROMPT_BLOCK_CHARS = 680;
const MAX_PROMPT_BLOCK_CHARS_TOTAL = 86000;
const MAX_CONTRIBUTION_CUES = 24;
const MAX_CONTRIBUTION_CUE_CHARS = 1200;
const MAX_OUTPUT_INNOVATIONS = 12;
const MAX_EVIDENCE_PER_INNOVATION = 3;
const MIN_QUOTE_CHARS = 18;
const MAX_QUOTE_CHARS = 900;
const MAX_RECOVERED_QUOTE_CHARS = 360;
const MIN_RECOVERY_TOKEN_OVERLAP = 5;
const MIN_ELLIPSIZED_RECOVERY_COVERAGE = 0.55;
const MIN_FUZZY_RECOVERY_COVERAGE = 0.82;
const FALLBACK_TEXT_LINE_HEIGHT = 12;
const MAX_FALLBACK_TEXT_RECTS = 48;

const INSIGHT_COVERAGE_ZONES = [
	{
		id: 'abstract',
		zh: '摘要与研究问题',
		en: 'Abstract and research problem',
		pattern: /\babstract\b|摘要/iu,
	},
	{
		id: 'introduction',
		zh: '引言中的现有局限与贡献声明',
		en: 'Introduction limitations and contribution claims',
		pattern: /\b(?:introduction|limitation|challenge|main\s+contributions?|contributions?\s+are\s+as\s+follows)\b|(?:引言|局限|挑战|主要贡献|贡献如下)/iu,
	},
	{
		id: 'related-work',
		zh: '相关工作中的研究缺口',
		en: 'Research gaps in related work',
		pattern: /\b(?:related\s+work|prior\s+work|existing\s+(?:methods?|approaches?)|drawback|limitation)\b|(?:相关工作|已有方法|研究缺口|局限)/iu,
	},
	{
		id: 'method',
		zh: '方法、模块、损失或算法',
		en: 'Method, modules, losses, or algorithms',
		pattern: /\b(?:method|module|architecture|framework|loss(?:\s+function)?|algorithm|two[\s-]*stage|training)\b|(?:方法|模块|架构|框架|损失|算法|两阶段|训练)/iu,
	},
	{
		id: 'training',
		zh: '训练、优化与推理策略',
		en: 'Training, optimization, and inference strategy',
		pattern: /\b(?:training|optimization|optimizer|curriculum|augmentation|regulari[sz]ation|inference|sampling)\b|(?:训练|优化|优化器|课程学习|增强|正则化|推理|采样)/iu,
	},
	{
		id: 'data',
		zh: '数据集与评测设置',
		en: 'Dataset and evaluation setup',
		pattern: /\b(?:dataset|benchmark|data\s+generation|evaluation\s+metrics?)\b|(?:数据集|基准|数据生成|评测指标)/iu,
	},
	{
		id: 'experiments',
		zh: '实验、结果与消融',
		en: 'Experiments, results, and ablations',
		pattern: /\b(?:experiment|results?|ablation|outperform|improv(?:e|ement)|evaluation)\b|(?:实验|结果|消融|优于|提升|评估)/iu,
	},
	{
		id: 'ablation',
		zh: '消融与机制验证',
		en: 'Ablation and mechanism validation',
		pattern: /\b(?:ablation|component analysis|sensitivity|effectiveness|impact of)\b|(?:消融|组件分析|敏感性|有效性|影响)/iu,
	},
	{
		id: 'conclusion',
		zh: '结论中的最终主张',
		en: 'Conclusion claims',
		pattern: /\b(?:conclusion|in\s+summary|we\s+conclude)\b|(?:结论|综上)/iu,
	},
];

function normalizeText(value) {
	return String(value || '')
		.replace(/<\s*br\s*\/?\s*>/giu, ' ')
		.replace(/<[^>]+>/gu, ' ')
		.replace(/[\r\n\t]+/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim();
}

function clampText(value, maxChars) {
	const text = normalizeText(value);
	if (text.length <= maxChars) {
		return text;
	}
	return `${text.slice(0, Math.max(1, maxChars - 1)).trim()}...`;
}


function normalizeInsightLanguage(value) {
	return normalizeAiOutlineLanguage(value);
}

function normalizeQuoteForMatch(value) {
	return normalizeText(value)
		.replace(/[\u2010-\u2015\u2212]/gu, '-')
		.replace(/\s+/gu, '')
		.toLocaleLowerCase();
}

function getQuoteMatchTokens(value) {
	return normalizeText(value)
		.toLocaleLowerCase()
		.replace(/[\u2010-\u2015\u2212-]/gu, ' ')
		// MinerU can collapse compounds such as "two-stage" into "twostage".
		.replace(/\b(two|three|multi)(stage)\b/giu, '$1 $2')
		.match(/[\p{L}\p{N}]+/gu) || [];
}

function clampRecoveredQuote(value) {
	const text = normalizeText(value);
	if (text.length <= MAX_RECOVERED_QUOTE_CHARS) {
		return text;
	}
	const shortened = text.slice(0, MAX_RECOVERED_QUOTE_CHARS + 1);
	const boundary = Math.max(shortened.lastIndexOf(' '), shortened.lastIndexOf(','), shortened.lastIndexOf(';'));
	return shortened.slice(0, boundary > MIN_QUOTE_CHARS ? boundary : MAX_RECOVERED_QUOTE_CHARS).trim();
}

function normalizeBBox(value) {
	if (!Array.isArray(value) || value.length < 4) {
		return null;
	}
	const bbox = value.slice(0, 4).map(Number);
	if (!bbox.every(Number.isFinite)) {
		return null;
	}
	const [x1, y1, x2, y2] = bbox;
	if (x1 === x2 || y1 === y2) {
		return null;
	}
	return [
		Math.min(x1, x2),
		Math.min(y1, y2),
		Math.max(x1, x2),
		Math.max(y1, y2),
	];
}

function extractNestedText(value, depth = 0) {
	if (depth > 5 || value === null || value === undefined) {
		return '';
	}
	if (typeof value === 'string' || typeof value === 'number') {
		return normalizeText(value);
	}
	if (Array.isArray(value)) {
		return value
			.map((item) => extractNestedText(item, depth + 1))
			.filter(Boolean)
			.join(' ')
			.trim();
	}
	if (typeof value !== 'object') {
		return '';
	}
	for (const key of [
		'text',
		'content',
		'text_content',
		'paragraph_content',
		'item_content',
		'title_content',
		'latex',
		'inline_equation',
	]) {
		if (value[key] !== undefined) {
			const text = extractNestedText(value[key], depth + 1);
			if (text) {
				return text;
			}
		}
	}
	return '';
}

function getBlockPageIndex(block, fallbackPageIndex) {
	const candidates = [
		block?.page_idx,
		block?.pageIndex,
		block?.page_index,
		block?.page_id,
		fallbackPageIndex,
	];
	for (const candidate of candidates) {
		const pageIndex = Number(candidate);
		if (Number.isInteger(pageIndex) && pageIndex >= 0) {
			return pageIndex;
		}
	}
	for (const candidate of [block?.page_no, block?.page_number]) {
		const pageNumber = Number(candidate);
		if (Number.isInteger(pageNumber) && pageNumber > 0) {
			return pageNumber - 1;
		}
	}
	return null;
}

function getBlockBBox(block) {
	return normalizeBBox(block?.bbox)
		|| normalizeBBox(block?.box)
		|| normalizeBBox(block?.poly)
		|| normalizeBBox(block?.position?.bbox)
		|| null;
}

function isLikelyReferenceBlock(text, type) {
	const normalizedType = String(type || '').trim().toLocaleLowerCase();
	if (/(?:reference|bibliography|footer|header|page_number|footnote)/iu.test(normalizedType)) {
		return true;
	}
	const normalized = normalizeText(text).toLocaleLowerCase();
	return /^\[?\d{1,3}\]?\s+[a-z]/u.test(normalized)
		|| /^(?:references|bibliography)\b/iu.test(normalized);
}

function getDirectMineruBlocks(parsed) {
	if (Array.isArray(parsed)) {
		return parsed.map((block, index) => ({ block, index, pageIndex: null }));
	}
	if (Array.isArray(parsed?.content_list)) {
		return parsed.content_list.map((block, index) => ({ block, index, pageIndex: null }));
	}
	if (Array.isArray(parsed?.blocks)) {
		return parsed.blocks.map((block, index) => ({ block, index, pageIndex: null }));
	}
	if (Array.isArray(parsed?.pdf_info)) {
		const result = [];
		let index = 0;
		for (const [pageIndex, page] of parsed.pdf_info.entries()) {
			const blocks = page?.preproc_blocks || page?.blocks || page?.content_list || [];
			for (const block of Array.isArray(blocks) ? blocks : []) {
				result.push({ block, index: index++, pageIndex });
			}
		}
		return result;
	}
	if (Array.isArray(parsed?.pages)) {
		const result = [];
		let index = 0;
		for (const [pageIndex, page] of parsed.pages.entries()) {
			const blocks = page?.blocks || page?.content_list || page?.preproc_blocks || [];
			for (const block of Array.isArray(blocks) ? blocks : []) {
				result.push({ block, index: index++, pageIndex });
			}
		}
		return result;
	}
	return [];
}

function extractMineruBlocks(value) {
	let parsed = value;
	if (typeof value === 'string') {
		parsed = JSON.parse(value);
	}
	const blocks = [];
	for (const entry of getDirectMineruBlocks(parsed)) {
		const block = entry?.block;
		if (!block || typeof block !== 'object' || Array.isArray(block)) {
			continue;
		}
		const text = extractNestedText(block);
		const bbox = getBlockBBox(block);
		const pageIndex = getBlockPageIndex(block, entry.pageIndex);
		if (!text || !bbox || !Number.isInteger(pageIndex)) {
			continue;
		}
		const type = normalizeText(block.type || block.block_type || block.category || 'text').toLocaleLowerCase();
		blocks.push({
			id: `b-${entry.index}`,
			blockIndex: entry.index,
			pageIndex,
			bbox,
			type,
			text: clampText(text, 12000),
			isReference: isLikelyReferenceBlock(text, type),
		});
	}
	return blocks;
}

function normalizeSourceExtent(value) {
	const numericValue = Number(value || 0);
	if (!(numericValue > 0)) {
		return 0;
	}
	// MinerU's image-coordinate content lists commonly use an implicit 1000-unit
	// page. Content can end before the physical edge, so keep that stable extent.
	if (numericValue >= 850 && numericValue <= 1050) {
		return 1000;
	}
	return numericValue;
}

function buildPageBounds(blocks) {
	const pageBounds = new Map();
	for (const block of blocks) {
		const current = pageBounds.get(block.pageIndex) || { maxX: 0, maxY: 0 };
		current.maxX = Math.max(current.maxX, block.bbox[0], block.bbox[2]);
		current.maxY = Math.max(current.maxY, block.bbox[1], block.bbox[3]);
		pageBounds.set(block.pageIndex, current);
	}
	for (const bounds of pageBounds.values()) {
		bounds.width = normalizeSourceExtent(bounds.maxX);
		bounds.height = normalizeSourceExtent(bounds.maxY);
	}
	return pageBounds;
}

function buildMarkdownDigest(markdown) {
	const source = String(markdown || '')
		.replace(/^\s*!\[[^\]]*\]\([^\n)]*\)\s*$/gmu, '')
		.replace(/^\s*<img\b[^>]*>\s*$/gimu, '')
		.replace(/\r\n?/gu, '\n')
		.trim();
	if (source.length <= MAX_MARKDOWN_SOURCE_CHARS) {
		return source;
	}
	const chunks = [];
	const seenRanges = new Set();
	function addRange(start, end) {
		const normalizedStart = Math.max(0, Math.min(source.length, start));
		const normalizedEnd = Math.max(normalizedStart, Math.min(source.length, end));
		const key = `${normalizedStart}:${normalizedEnd}`;
		if (!seenRanges.has(key)) {
			seenRanges.add(key);
			chunks.push(source.slice(normalizedStart, normalizedEnd));
		}
	}

	addRange(0, 12000);
	const headingPattern = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:abstract|introduction|contributions?|method(?:ology)?|approach|experiment(?:s)?|results?|ablation|evaluation|discussion|conclusion|摘要|引言|贡献|方法|实验|结果|消融|结论)\b/giu;
	let match;
	while ((match = headingPattern.exec(source))) {
		addRange(match.index, match.index + MAX_MARKDOWN_SECTION_CHARS);
		if (chunks.join('\n\n---\n\n').length >= MAX_MARKDOWN_SOURCE_CHARS - 9000) {
			break;
		}
	}
	addRange(Math.max(0, source.length - 10000), source.length);
	return chunks
		.join('\n\n--- selected paper section ---\n\n')
		.slice(0, MAX_MARKDOWN_SOURCE_CHARS);
}

function buildStructuredTextDigest(blocks) {
	const eligible = (Array.isArray(blocks) ? blocks : [])
		.filter((block) => block && !block.isReference && normalizeText(block.text).length >= 12)
		.slice()
		.sort((left, right) => (
			left.blockIndex - right.blockIndex
			|| left.pageIndex - right.pageIndex
			|| left.bbox[1] - right.bbox[1]
			|| left.bbox[0] - right.bbox[0]
		));
	const parts = [];
	let size = 0;
	for (const block of eligible) {
		const text = clampText(block.text, MAX_STRUCTURED_BLOCK_CHARS);
		if (!text) {
			continue;
		}
		const part = `[Page ${block.pageIndex + 1}] ${text}`;
		const separatorSize = parts.length ? 2 : 0;
		if (size + separatorSize + part.length > MAX_STRUCTURED_SOURCE_CHARS) {
			break;
		}
		parts.push(part);
		size += separatorSize + part.length;
	}
	return parts.join('\n\n');
}

function getSemanticSourceDigest(markdownDigest, structuredTextDigest) {
	const markdownTextChars = normalizeText(markdownDigest)
		.replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
		.length;
	if (!structuredTextDigest) {
		return { digest: markdownDigest, mode: 'markdown' };
	}
	// MinerU can emit a Markdown file containing only figure/table assets while
	// the JSON still contains the paper text. Prefer that structured transcript
	// when Markdown is visibly too sparse to support a paper-level analysis.
	if (markdownTextChars < 1200 || structuredTextDigest.length > markdownTextChars * 1.6) {
		return {
			digest: structuredTextDigest,
			mode: 'mineru-json-transcript',
		};
	}
	return { digest: markdownDigest, mode: 'markdown' };
}

function scoreEvidenceBlock(block) {
	const text = block.text.toLocaleLowerCase();
	let score = Math.min(10, Math.floor(text.length / 110));
	if (block.pageIndex <= 1) score += 11;
	if (/\b(?:abstract|introduction|conclusion|contribution)\b|摘要|引言|结论|贡献/iu.test(text)) score += 10;
	if (/\b(?:we propose|we introduce|novel|first|new |our method|our approach|contribution)\b|提出|创新|首次|新方法|本文方法/iu.test(text)) score += 22;
	if (/\b(?:outperform|improve|improvement|increase|decrease|achieve|state.of.the.art|sota|ablation|recall|accuracy|success rate)\b|优于|提升|改进|消融|准确率|召回率|成功率/iu.test(text)) score += 18;
	if (/\b(?:method|architecture|loss|framework|training|algorithm)\b|方法|框架|损失|网络|算法/iu.test(text)) score += 8;
	if (block.isReference) score -= 60;
	return score;
}

function selectPromptBlocks(blocks) {
	const eligible = blocks.filter((block) => !block.isReference && block.text.length >= 12);
	const total = eligible.reduce((sum, block) => sum + Math.min(block.text.length, MAX_PROMPT_BLOCK_CHARS) + 48, 0);
	if (eligible.length <= MAX_PROMPT_BLOCKS && total <= MAX_PROMPT_BLOCK_CHARS_TOTAL) {
		return eligible;
	}

	const ranked = eligible
		.map((block) => ({ block, score: scoreEvidenceBlock(block) }))
		.sort((left, right) => right.score - left.score || left.block.blockIndex - right.block.blockIndex);
	const selectedIDs = new Set();
	let budget = 0;
	for (const { block } of ranked) {
		if (selectedIDs.size >= MAX_PROMPT_BLOCKS) {
			break;
		}
		const candidateIndices = [block.blockIndex - 1, block.blockIndex, block.blockIndex + 1];
		for (const index of candidateIndices) {
			const candidate = eligible.find((item) => item.blockIndex === index);
			if (!candidate || selectedIDs.has(candidate.id)) {
				continue;
			}
			const size = Math.min(candidate.text.length, MAX_PROMPT_BLOCK_CHARS) + 48;
			if (budget + size > MAX_PROMPT_BLOCK_CHARS_TOTAL) {
				continue;
			}
			selectedIDs.add(candidate.id);
			budget += size;
		}
	}
	return eligible.filter((block) => selectedIDs.has(block.id));
}

function scoreContributionCue(block) {
	const text = normalizeText(block?.text);
	if (!text || block?.isReference) {
		return -Infinity;
	}
	let score = 0;
	if (/\b(?:main\s+contributions?|contributions?\s+of\s+(?:this|the)\s+(?:work|paper)|contributions?\s+are\s+as\s+follows)\b|(?:主要贡献|本文贡献|贡献如下)/iu.test(text)) {
		score += 120;
	}
	if (/^\s*\d+\)\s+/u.test(text)) {
		score += 100;
	}
	if (/\b(?:we\s+(?:propose|introduce|design|construct|develop)|this\s+paper\s+(?:proposes|introduces|designs|constructs)|our\s+(?:method|network|approach))\b|(?:本文(?:提出|设计|构建)|我们(?:提出|设计|构建))/iu.test(text)) {
		score += 65;
	}
	if (/\b(?:module|loss(?:\s+function)?|dataset|two[\s-]*stage|framework|architecture|training\s+strategy)\b|(?:模块|损失|数据集|两阶段|框架|网络|训练策略)/iu.test(text)) {
		score += 32;
	}
	if (block.pageIndex <= 1) {
		score += 8;
	}
	return score;
}

function selectContributionCues(blocks) {
	return (Array.isArray(blocks) ? blocks : [])
		.map((block) => ({ block, score: scoreContributionCue(block) }))
		.filter(({ score }) => Number.isFinite(score) && score > 0)
		.sort((left, right) => right.score - left.score || left.block.blockIndex - right.block.blockIndex)
		.slice(0, MAX_CONTRIBUTION_CUES)
		.map(({ block }) => ({
			id: block.id,
			pageIndex: block.pageIndex,
			text: clampText(block.text, MAX_CONTRIBUTION_CUE_CHARS),
		}));
}

function selectCoverageCues(blocks) {
	const eligible = (Array.isArray(blocks) ? blocks : []).filter((block) => !block?.isReference && normalizeText(block?.text).length >= 12);
	return INSIGHT_COVERAGE_ZONES.map((zone) => {
		const matches = eligible
			.filter((block) => zone.pattern.test(block.text))
			.map((block) => ({ block, score: scoreEvidenceBlock(block) }))
			.sort((left, right) => right.score - left.score || left.block.blockIndex - right.block.blockIndex)
			.slice(0, 3)
			.map(({ block }) => ({
				id: block.id,
				pageIndex: block.pageIndex,
				text: clampText(block.text, MAX_CONTRIBUTION_CUE_CHARS),
			}));
		return {
			id: zone.id,
			zh: zone.zh,
			en: zone.en,
			blocks: matches,
		};
	}).filter((zone) => zone.blocks.length);
}

function buildAiInsightSource({ markdown, mineruJson, documentTitle = '' } = {}) {
	const blocks = extractMineruBlocks(mineruJson);
	if (!blocks.length) {
		throw new Error('MinerU JSON does not contain locatable text blocks');
	}
	const promptBlocks = selectPromptBlocks(blocks);
	const contributionCues = selectContributionCues(blocks);
	const coverageCues = selectCoverageCues(blocks);
	const markdownDigest = buildMarkdownDigest(markdown);
	const structuredTextDigest = buildStructuredTextDigest(blocks);
	if (!markdownDigest.trim()) {
		if (!structuredTextDigest.trim()) {
			throw new Error('MinerU Markdown and JSON text are empty');
		}
	}
	const semanticSource = getSemanticSourceDigest(markdownDigest, structuredTextDigest);
	const fingerprint = crypto.createHash('sha256')
		.update(JSON.stringify({
			documentTitle: normalizeText(documentTitle),
			markdown: String(markdown || ''),
			blocks: blocks.map((block) => ({
				id: block.id,
				pageIndex: block.pageIndex,
				bbox: block.bbox,
				text: block.text,
			})),
		}))
		.digest('hex')
		.slice(0, 32);
	return {
		documentTitle: normalizeText(documentTitle),
		sourceFingerprint: fingerprint,
		markdownDigest,
		structuredTextDigest,
		semanticDigest: semanticSource.digest,
		semanticSourceMode: semanticSource.mode,
		blocks,
		promptBlocks,
		contributionCues,
		coverageCues,
		pageBounds: buildPageBounds(blocks),
	};
}

function formatPromptBlocks(blocks) {
	return blocks.map((block) => JSON.stringify({
		blockId: block.id,
		page: block.pageIndex + 1,
		text: clampText(block.text, MAX_PROMPT_BLOCK_CHARS),
	})).join('\n');
}

function formatContributionCues(cues) {
	return (Array.isArray(cues) ? cues : [])
		.map((cue) => `[${cue.id}, p.${Number(cue.pageIndex) + 1}] ${cue.text}`)
		.join('\n');
}

function formatCoverageCues(cues, language) {
	return (Array.isArray(cues) ? cues : [])
		.map((zone) => {
			const label = language === 'zh' ? zone.zh : zone.en;
			const blocks = (Array.isArray(zone.blocks) ? zone.blocks : [])
				.map((block) => `[${block.id}, p.${Number(block.pageIndex) + 1}] ${block.text}`)
				.join('\n');
			return `${label}:\n${blocks}`;
		})
		.join('\n\n');
}

function makeDiscoveryPrompt(source, options = {}) {
	const language = normalizeInsightLanguage(options.language);
	const contributionCues = formatContributionCues(source.contributionCues);
	const coverageCues = formatCoverageCues(source.coverageCues, language);
	if (language === 'zh') {
		return [
			'你是严谨的学术论文评审。请识别论文的主要工作、研究问题/已有局限、真正的创新点及其直接支撑的关键发现，且每一项都必须能由后续原文核验。',
			'先按创新轴拆分：问题设定、方法/架构、理论、训练/优化、数据/评测、实证发现、应用。创新点必须是论文相对于已有工作的具体方法、机制、建模、训练策略、数据资源或直接支撑贡献的实验发现；不要把研究背景、任务目标、普通优点、图表标题或未来工作当作创新点。',
			'这一步只能识别论文自身主张的创新，不能在没有外部文献比对的情况下宣称全领域“首次”或“最优”。',
			'候选阶段以高召回为目标。请先完成覆盖审计：摘要与问题、引言中的局限/贡献声明、相关工作中的缺口、方法/模块/损失/算法、训练/优化、数据集/评测、实验结果、消融验证、结论都必须检查。每个区域出现明确的作者主张时，应有一个候选覆盖它或明确并入已有候选。目标为 6-12 条不重复候选，不能在 5 条或 8 条时提前停止；论文若明确给出更多独立贡献，应尽量覆盖至 12 条。下面会给出“作者主张线索”，它是覆盖检查而不是最终证据：逐一检查作者明确列出的贡献、模块、损失函数、数据集或训练策略。先在心中逐条列出每条编号贡献中的命名机制；每个机制都必须各自成为候选，除非它与另一个候选完全同义，不能用一个总称覆盖多个不同的损失、算法或数据资源。作者已经命名的具体项即使暂时只看到宽泛贡献句，也应先列为候选，后续证据核验会淘汰无法支撑的项。若一个编号贡献用“以及/and”并列多个命名机制，必须拆成多个候选，例如两个不同的损失函数和聚类算法分别成项。每个候选只对应一个明确机制、资源或直接支撑结论。研究问题或已有局限可以作为 problem 轴候选，但必须明确标明其与本文工作的关系。',
			'每个 title 用简短中文，claim 用 1-2 句说明其新在哪里；axis 必须为 problem|method|theory|training|data|empirical|application 之一；暂时不要编造页码或引用。',
			'仅返回 JSON，不要 Markdown：{"candidates":[{"id":"i1","axis":"method","title":"...","claim":"...","searchTerms":["..."]}]}。',
			`论文标题：${source.documentTitle || '未命名论文'}`,
			`作者主张线索（必须逐项检查；${contributionCues || '未提取到明确线索'}）：`,
			`论文结构覆盖检查（${coverageCues || '未提取到固定位置线索'}）：`,
			`以下是用于连续阅读的 MinerU 语义文本（来源：${source.semanticSourceMode === 'mineru-json-transcript' ? 'JSON 文本块转录' : 'Markdown'}）：`,
			source.semanticDigest || source.markdownDigest,
		].join('\n\n');
	}
	return [
		'You are a rigorous academic paper reviewer. Identify the paper\'s main work, research problem or prior limitations, central source-supported innovations, and key findings that directly substantiate those contributions.',
		'First decompose potential novelty by axis: problem setting, method/architecture, theory, training/optimization, data/evaluation, empirical finding, and application. An innovation must be a specific new method, mechanism, modeling choice, training strategy, data resource, or experimental finding directly substantiating a contribution. Do not treat background, task goals, generic benefits, figure captions, or future work as innovations.',
		'At this stage identify only the paper\'s own claimed innovation. Do not certify a global “first” or “state of the art” claim without external prior-art comparison.',
		'The candidate stage optimizes recall. Complete a coverage audit across the abstract and problem, introduction limitations/contribution claims, related-work gaps, methods/modules/losses/algorithms, training/optimization, datasets/evaluation, experimental results, ablation validation, and conclusion. When a zone contains a concrete author claim, cover it with a candidate or explicitly fold it into an existing candidate. Target 6-12 nonredundant candidates and do not stop at five or eight; when the paper states more independent contributions, cover as many as can be grounded up to twelve. An “author-claim cue” section appears below as a coverage checklist, not final evidence. Check every explicitly enumerated contribution, module, loss function, dataset, or training strategy. First make a private checklist of every named mechanism in each numbered contribution; each mechanism must have its own candidate unless it is an exact synonym of another candidate. Never use an umbrella term to cover distinct losses, algorithms, or data resources. A concrete item named by the authors should become a candidate even when its only current cue is a broad contribution sentence; the later evidence-verification stage will discard unsupported items. When one numbered contribution joins several named techniques with “and”, split them into separate candidates: for example, two distinct loss functions and a clustering algorithm must each be separate. Each candidate must represent one concrete mechanism, resource, or directly supported result. A problem or prior limitation may be a problem-axis candidate only when its relation to the paper\'s work is explicit.',
		'Use a concise English title and a one- or two-sentence claim for each item. axis must be one of problem|method|theory|training|data|empirical|application. Do not invent page numbers or citations at this stage.',
		'Return JSON only, without Markdown: {"candidates":[{"id":"i1","axis":"method","title":"...","claim":"...","searchTerms":["..."]}]}.',
		`Paper title: ${source.documentTitle || 'Untitled paper'}`,
		`Author-claim cues (check each item; ${contributionCues || 'no explicit cues extracted'}):`,
		`Paper-structure coverage checklist (${coverageCues || 'no fixed-position cues extracted'}):`,
		`Here is the MinerU semantic source for continuous reading (source: ${source.semanticSourceMode === 'mineru-json-transcript' ? 'JSON text-block transcript' : 'Markdown'}):`,
		source.semanticDigest || source.markdownDigest,
	].join('\n\n');
}

function makeGroundingPrompt(source, candidates, options = {}) {
	const language = normalizeInsightLanguage(options.language);
	const candidateJson = JSON.stringify(candidates);
	const blocks = formatPromptBlocks(source.promptBlocks);
	if (language === 'zh') {
		return [
			'你是学术证据核验器。下面的候选创新点来自论文初步阅读；你的任务是只保留能被给定 MinerU 文本块逐字核验的项目。',
			'每个保留创新点必须给出一个 anchor，说明作者提出了什么。可在有独立价值时补充 0-3 条 evidence，用于说明机制、实现、消融或实验效果；不要因为没有独立 evidence 就删除已有可靠 anchor 的创新点。候选是覆盖承诺：只要给定文本中存在可靠 anchor，就必须保留该候选，不能用相邻模块、总称或结果替代它。保持候选的粒度，不要合并不同候选：title 必须与 anchor 的机制范围一致。若 anchor 只是并列多个机制的宽泛概述，必须为 title 中的命名机制找到更专门的原文句子，否则删除该候选。',
			'blockId 必须来自下方文本块。quote 必须是同一文本块内连续的原文摘录，直接复制，不得改写、翻译、拼接或补造。quote 必须是 18-360 个字符的短而完整的连续句子或公式，不能包含或以 "..."、"…"、"[... ]" 等省略标记结束；不要复制整段长文本。若找不到独立的可靠证据，删除该创新点。不要引用 References。',
			'title 和 summary 使用中文；summary 仅概括证据链，不要扩大论文结论。evidence.explanation 用简洁中文解释此证据如何支撑对应创新点。',
			'只返回 JSON，不要 Markdown：{"innovations":[{"id":"i1","title":"...","summary":"...","anchor":{"blockId":"b-1","quote":"原文"},"evidence":[{"blockId":"b-2","quote":"原文","explanation":"...","role":"method|result|ablation"}]}]}。evidence 可以是空数组。',
			`候选创新点：${candidateJson}`,
			'可定位的 MinerU 文本块（页码仅供定位，必须以 blockId 和 quote 为准）：',
			blocks,
		].join('\n\n');
	}
	return [
		'You are an academic evidence verifier. The candidate innovations below came from an initial paper reading. Keep only items that can be literally verified from the supplied MinerU text blocks.',
		'Every retained innovation needs one anchor establishing what the authors introduce. Add zero to three evidence records only when a different source passage adds meaningful support for its mechanism, implementation, ablation, or measured outcome; do not discard a reliably anchored innovation solely because separate evidence is unavailable. Candidates are coverage commitments: retain every candidate for which the supplied text contains a reliable anchor, and never replace it with an adjacent module, umbrella term, or result. Preserve candidate granularity and never merge distinct candidates: the title must have the same mechanism scope as its anchor. When an anchor is only a broad enumeration of several techniques, find a dedicated source sentence for the named technique in the title or drop that candidate.',
		'blockId must come from the supplied blocks. quote must be one short, complete, continuous verbatim sentence or formula of 18-360 characters from that same block: do not paraphrase, translate, join fragments, invent text, use an ellipsis such as "..." or "…", or copy an entire long paragraph. Drop an innovation when independent reliable evidence is unavailable. Never use References as evidence.',
		'Write title and summary in English. The summary must only describe the evidence chain and must not inflate the paper\'s claims. evidence.explanation briefly states why that evidence supports the innovation.',
		'Return JSON only, without Markdown: {"innovations":[{"id":"i1","title":"...","summary":"...","anchor":{"blockId":"b-1","quote":"verbatim source"},"evidence":[{"blockId":"b-2","quote":"verbatim source","explanation":"...","role":"method|result|ablation"}]}]}. evidence may be an empty array.',
		`Candidate innovations: ${candidateJson}`,
		'Locatable MinerU text blocks (page is navigational only; blockId and quote are mandatory):',
		blocks,
	].join('\n\n');
}

function resolveSourceBlock(source, value) {
	const raw = String(value || '').trim();
	if (!raw) {
		return null;
	}
	const candidateIDs = new Set([raw]);
	const numeric = Number(raw.replace(/^b-/iu, ''));
	if (Number.isInteger(numeric) && numeric >= 0) {
		candidateIDs.add(`b-${numeric}`);
	}
	return source.blocks.find((block) => candidateIDs.has(block.id)) || null;
}

function recoverSourceQuote(block, rawQuote) {
	const raw = String(rawQuote || '');
	const hasEllipsis = /(?:\.\.\.|…)/u.test(raw);
	const normalizedBlock = normalizeQuoteForMatch(block?.text);
	const fragments = raw
		.split(/(?:\.\.\.|…)/u)
		.map((part) => normalizeText(part))
		.filter((part) => getQuoteMatchTokens(part).length >= MIN_RECOVERY_TOKEN_OVERLAP);

	// Prefer an exact partial quote when the model merely appended an ellipsis.
	for (const fragment of fragments) {
		const normalizedFragment = normalizeQuoteForMatch(fragment);
		if (normalizedFragment && normalizedBlock.includes(normalizedFragment)) {
			return clampRecoveredQuote(fragment);
		}
	}

	// Some MinerU exports remove a compound hyphen ("twostage"), while the
	// model restores it ("two-stage"). Recover only a complete source sentence
	// whose terms substantially overlap the model's partial quote.
	const sentences = normalizeText(block?.text)
		.split(/(?<=[.!?。！？])\s+/u)
		.map((sentence) => normalizeText(sentence))
		.filter((sentence) => sentence.length >= MIN_QUOTE_CHARS);
	const minCoverage = hasEllipsis ? MIN_ELLIPSIZED_RECOVERY_COVERAGE : MIN_FUZZY_RECOVERY_COVERAGE;
	let best = null;
	for (const sentence of sentences) {
		const sentenceTokens = [...new Set(getQuoteMatchTokens(sentence))];
		if (sentenceTokens.length < MIN_RECOVERY_TOKEN_OVERLAP) {
			continue;
		}
		const sentenceTokenSet = new Set(sentenceTokens);
		for (const fragment of fragments) {
			const fragmentTokens = [...new Set(getQuoteMatchTokens(fragment))];
			const overlap = fragmentTokens.filter((token) => sentenceTokenSet.has(token)).length;
			const coverage = overlap / sentenceTokens.length;
			if (overlap < MIN_RECOVERY_TOKEN_OVERLAP || coverage < minCoverage) {
				continue;
			}
			const score = overlap * 1000 + coverage;
			if (!best || score > best.score) {
				best = { sentence, score };
			}
		}
	}
	return best ? clampRecoveredQuote(best.sentence) : '';
}

function validateGroundedEvidence(source, value) {
	const block = resolveSourceBlock(source, value?.blockId ?? value?.blockIndex);
	let quote = clampText(value?.quote, MAX_QUOTE_CHARS);
	if (!block || block.isReference || quote.length < MIN_QUOTE_CHARS) {
		return null;
	}
	let normalizedQuote = normalizeQuoteForMatch(quote);
	const normalizedBlock = normalizeQuoteForMatch(block.text);
	if (!normalizedQuote || !normalizedBlock.includes(normalizedQuote)) {
		quote = recoverSourceQuote(block, value?.quote);
		normalizedQuote = normalizeQuoteForMatch(quote);
		if (!quote || quote.length < MIN_QUOTE_CHARS || !normalizedQuote || !normalizedBlock.includes(normalizedQuote)) {
			return null;
		}
	}
	return {
		block,
		quote,
		explanation: clampText(value?.explanation || value?.why || '', 320),
		role: clampText(value?.role || '', 32).toLocaleLowerCase(),
	};
}

function normalizeGeneratedInsights(source, generated, options = {}) {
	const seenKeys = new Set();
	const occupiedSourceQuotes = new Set();
	const insights = [];
	const rawInnovations = Array.isArray(generated?.innovations)
		? generated.innovations
		: Array.isArray(generated?.items)
			? generated.items
			: [];
	for (const [index, raw] of rawInnovations.entries()) {
		if (insights.length >= MAX_OUTPUT_INNOVATIONS || !raw || typeof raw !== 'object') {
			break;
		}
		const title = clampText(raw.title || raw.name || raw.innovation, 180);
		const summary = clampText(raw.summary || raw.claim || raw.description, 520);
		let anchor = validateGroundedEvidence(source, raw.anchor || raw.claimEvidence || raw.evidence?.[0]);
		if (!title || !summary || !anchor) {
			continue;
		}
		let anchorQuoteKey = `${anchor.block.id}\u0000${normalizeQuoteForMatch(anchor.quote)}`;
		const evidenceRecords = Array.isArray(raw.evidence) ? raw.evidence : [];
		let promotedEvidenceIndex = -1;
		// A numbered contribution sentence can name several distinct mechanisms.
		// Do not discard a later mechanism solely because it shares that broad
		// sentence with an earlier insight; promote its dedicated evidence instead.
		if (occupiedSourceQuotes.has(anchorQuoteKey)) {
			for (const [evidenceIndex, rawEvidence] of evidenceRecords.entries()) {
				const candidate = validateGroundedEvidence(source, rawEvidence);
				if (!candidate) {
					continue;
				}
				const candidateKey = `${candidate.block.id}\u0000${normalizeQuoteForMatch(candidate.quote)}`;
				if (candidateKey === anchorQuoteKey || occupiedSourceQuotes.has(candidateKey)) {
					continue;
				}
				anchor = candidate;
				anchorQuoteKey = candidateKey;
				promotedEvidenceIndex = evidenceIndex;
				break;
			}
		}
		if (occupiedSourceQuotes.has(anchorQuoteKey)) {
			continue;
		}
		const requestedKey = clampText(raw.id || raw.key || `i${index + 1}`, 64)
			.replace(/[^A-Za-z0-9_-]/gu, '-')
			.replace(/-+/gu, '-')
			.replace(/^-|-$/gu, '') || `i${index + 1}`;
		const key = seenKeys.has(requestedKey) ? `${requestedKey}-${index + 1}` : requestedKey;
		seenKeys.add(key);
		const evidence = [];
		const innovationQuoteKeys = new Set([anchorQuoteKey]);
		for (const [evidenceIndex, rawEvidence] of evidenceRecords.entries()) {
			if (evidence.length >= MAX_EVIDENCE_PER_INNOVATION) {
				break;
			}
			if (evidenceIndex === promotedEvidenceIndex) {
				continue;
			}
			const item = validateGroundedEvidence(source, rawEvidence);
			if (!item) {
				continue;
			}
			const evidenceKey = `${item.block.id}\u0000${normalizeQuoteForMatch(item.quote)}`;
			if (occupiedSourceQuotes.has(evidenceKey) || innovationQuoteKeys.has(evidenceKey)) {
				continue;
			}
			innovationQuoteKeys.add(evidenceKey);
			evidence.push(item);
		}
		for (const quoteKey of innovationQuoteKeys) {
			occupiedSourceQuotes.add(quoteKey);
		}
		insights.push({ key, title, summary, anchor, evidence });
	}
	return insights;
}

function getPdfRectForBlock(block, pageBounds, pageMetrics) {
	const metric = Array.isArray(pageMetrics) ? pageMetrics[block.pageIndex] : null;
	const pdfWidth = Number(metric?.width || 0);
	const pdfHeight = Number(metric?.height || 0);
	if (!(pdfWidth > 0) || !(pdfHeight > 0)) {
		return null;
	}
	const bounds = pageBounds?.get?.(block.pageIndex) || {};
	const sourceWidth = Number(bounds.width || 0);
	const sourceHeight = Number(bounds.height || 0);
	if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
		return null;
	}
	const [x1, y1, x2, y2] = block.bbox;
	return [
		Math.min(x1, x2) * pdfWidth / sourceWidth,
		(sourceHeight - Math.max(y1, y2)) * pdfHeight / sourceHeight,
		Math.max(x1, x2) * pdfWidth / sourceWidth,
		(sourceHeight - Math.min(y1, y2)) * pdfHeight / sourceHeight,
	];
}

function normalizePdfRect(value) {
	if (!Array.isArray(value) || value.length < 4) {
		return null;
	}
	const rect = value.slice(0, 4).map(Number);
	if (!rect.every(Number.isFinite)) {
		return null;
	}
	const [x1, y1, x2, y2] = rect;
	if (x1 === x2 || y1 === y2) {
		return null;
	}
	return [
		Math.min(x1, x2),
		Math.min(y1, y2),
		Math.max(x1, x2),
		Math.max(y1, y2),
	];
}

function findQuoteRangeInText(sourceText, quote) {
	const source = normalizeQuoteForMatch(sourceText);
	const target = normalizeQuoteForMatch(quote);
	if (!source || !target) {
		return null;
	}
	const exactIndex = source.indexOf(target);
	if (exactIndex >= 0) {
		return { start: exactIndex, end: exactIndex + target.length };
	}
	// MinerU and PDF text can differ by a word ending or formula spacing. Keep a
	// substantial quote prefix rather than falling back to one full block rectangle.
	const minimumLength = Math.max(18, Math.min(80, Math.floor(target.length * 0.45)));
	for (let length = target.length - 1; length >= minimumLength; length -= 1) {
		const index = source.indexOf(target.slice(0, length));
		if (index >= 0) {
			return { start: index, end: index + length };
		}
	}
	return null;
}

function buildNarrowTextRectFallback(rectValue, sourceText, quote) {
	const rect = normalizePdfRect(rectValue);
	if (!rect) {
		return [];
	}
	const [left, bottom, right, top] = rect;
	const height = top - bottom;
	if (height <= FALLBACK_TEXT_LINE_HEIGHT * 1.25) {
		return [rect];
	}
	const source = normalizeQuoteForMatch(sourceText) || normalizeQuoteForMatch(quote);
	const range = findQuoteRangeInText(sourceText, quote)
		|| (source ? { start: 0, end: Math.min(source.length, normalizeQuoteForMatch(quote).length || source.length) } : null);
	if (!source || !range || range.end <= range.start) {
		return [rect];
	}
	const lineCount = Math.max(1, Math.min(MAX_FALLBACK_TEXT_RECTS, Math.round(height / FALLBACK_TEXT_LINE_HEIGHT)));
	const lineStep = height / lineCount;
	const stripeHeight = Math.min(9.5, Math.max(4, lineStep * 0.76));
	const averageLineLength = Math.max(1, Math.ceil(source.length / lineCount));
	const rects = [];
	for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
		const lineStart = lineIndex * averageLineLength;
		const lineEnd = Math.min(source.length, lineStart + averageLineLength);
		const selectionStart = Math.max(lineStart, range.start);
		const selectionEnd = Math.min(lineEnd, range.end);
		if (selectionEnd <= selectionStart || lineEnd <= lineStart) {
			continue;
		}
		const lineWidth = right - left;
		const x1 = left + lineWidth * (selectionStart - lineStart) / (lineEnd - lineStart);
		const x2 = left + lineWidth * (selectionEnd - lineStart) / (lineEnd - lineStart);
		const center = top - (lineIndex + 0.5) * lineStep;
		rects.push([
			Math.max(left, x1 - 1),
			Math.max(bottom, center - stripeHeight / 2),
			Math.min(right, Math.max(x1 + 4, x2 + 1)),
			Math.min(top, center + stripeHeight / 2),
		]);
	}
	return rects.length ? rects : [rect];
}

function getPdfRectsForBlockQuote(block, quote, pageBounds, pageMetrics) {
	const rect = getPdfRectForBlock(block, pageBounds, pageMetrics);
	return rect ? buildNarrowTextRectFallback(rect, block?.text, quote) : [];
}

function getInsightSortIndex(block, rect) {
	const top = Math.max(0, Number(rect?.[3] || 0));
	return [
		String(Math.max(0, block.pageIndex)).padStart(5, '0'),
		'000000',
		String(Math.floor(top * 100)).padStart(8, '0'),
	].join('|');
}

function annotationID(sourceFingerprint, kind, key, block, quote) {
	return `ai-${kind}-${crypto.createHash('sha256')
		.update(`${sourceFingerprint}:${key}:${block.id}:${normalizeQuoteForMatch(quote)}`)
		.digest('hex')
		.slice(0, 18)}`;
}

function buildAiInsightAnnotations(source, insights, options = {}) {
	const language = normalizeInsightLanguage(options.language);
	const annotations = [];
	for (const innovation of Array.isArray(insights) ? insights : []) {
		const anchorRects = getPdfRectsForBlockQuote(innovation.anchor.block, innovation.anchor.quote, source.pageBounds, options.pageMetrics);
		if (anchorRects.length) {
			annotations.push({
				id: annotationID(source.sourceFingerprint, 'insight', innovation.key, innovation.anchor.block, innovation.anchor.quote),
				type: 'highlight',
				color: AI_INSIGHT_COLORS.innovation,
				pageLabel: String(innovation.anchor.block.pageIndex + 1),
				sortIndex: getInsightSortIndex(innovation.anchor.block, anchorRects[0]),
				position: { pageIndex: innovation.anchor.block.pageIndex, rects: anchorRects },
				text: innovation.title,
				comment: `${innovation.summary}\n\n${language === 'zh' ? '原文' : 'Source'}: ${innovation.anchor.quote}`,
				quote: innovation.anchor.quote,
				highlightText: innovation.anchor.quote,
				tags: [language === 'zh' ? 'AI 创新点' : 'AI Innovation'],
				projectOrigin: 'ai-insight-innovation',
				aiInsightKind: 'innovation',
				aiInsightKey: innovation.key,
				aiInsightSourceBlockId: innovation.anchor.block.id,
				aiInsightSourceBlockIndex: innovation.anchor.block.blockIndex,
			});
		}
		for (const [index, evidence] of innovation.evidence.entries()) {
			const rects = getPdfRectsForBlockQuote(evidence.block, evidence.quote, source.pageBounds, options.pageMetrics);
			if (!rects.length) {
				continue;
			}
			const explanation = evidence.explanation || (language === 'zh'
				? `支撑“${innovation.title}”的原文证据。`
				: `Source evidence supporting “${innovation.title}”.`);
			annotations.push({
				id: annotationID(source.sourceFingerprint, 'evidence', `${innovation.key}-${index + 1}`, evidence.block, evidence.quote),
				type: 'highlight',
				color: AI_INSIGHT_COLORS.evidence,
				pageLabel: String(evidence.block.pageIndex + 1),
				sortIndex: getInsightSortIndex(evidence.block, rects[0]),
				position: { pageIndex: evidence.block.pageIndex, rects },
				text: explanation,
				comment: `${language === 'zh' ? '支撑创新点' : 'Supports innovation'}: ${innovation.title}\n\n${language === 'zh' ? '原文' : 'Source'}: ${evidence.quote}`,
				quote: evidence.quote,
				highlightText: evidence.quote,
				tags: [language === 'zh' ? 'AI 关键证据' : 'AI Evidence'],
				projectOrigin: 'ai-evidence',
				aiInsightKind: 'evidence',
				aiInsightKey: `${innovation.key}-e${index + 1}`,
				aiInsightEvidenceFor: innovation.key,
				aiInsightEvidenceRole: evidence.role || 'evidence',
				aiInsightSourceBlockId: evidence.block.id,
				aiInsightSourceBlockIndex: evidence.block.blockIndex,
			});
		}
	}
	return annotations;
}

function normalizeAiInsightMeta(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	const status = clampText(value.status || 'ready', 48);
	if (!status) {
		return null;
	}
	return {
		schemaVersion: AI_INSIGHT_SCHEMA_VERSION,
		language: normalizeInsightLanguage(value.language),
		status,
		provider: clampText(value.provider || '', 48),
		model: clampText(value.model || '', 120),
		promptVersion: clampText(value.promptVersion || '', 80),
		sourceFingerprint: clampText(value.sourceFingerprint || '', 80),
		generatedAt: clampText(value.generatedAt || '', 64),
		innovationCount: Math.max(0, Math.floor(Number(value.innovationCount) || 0)),
		evidenceCount: Math.max(0, Math.floor(Number(value.evidenceCount) || 0)),
	};
}

function buildClearedAiInsightMeta(language) {
	return {
		schemaVersion: AI_INSIGHT_SCHEMA_VERSION,
		language: normalizeInsightLanguage(language),
		status: 'cleared',
		provider: '',
		model: '',
		promptVersion: '',
		sourceFingerprint: '',
		generatedAt: new Date().toISOString(),
		innovationCount: 0,
		evidenceCount: 0,
	};
}


module.exports = {
	AI_INSIGHT_COLORS,
	AI_INSIGHT_SCHEMA_VERSION,
	MAX_OUTPUT_INNOVATIONS,
	buildAiInsightAnnotations,
	buildNarrowTextRectFallback,
	buildAiInsightSource,
	buildClearedAiInsightMeta,
	buildStructuredTextDigest,
	extractMineruBlocks,
	findQuoteRangeInText,
	getPdfRectsForBlockQuote,
	makeDiscoveryPrompt,
	makeGroundingPrompt,
	normalizeAiInsightMeta,
	normalizeGeneratedInsights,
	normalizeInsightLanguage,
};
