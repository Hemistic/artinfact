const crypto = require('crypto');
const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');

function requireContextRuntimeModule(fileName) {
	const roots = [
		process.env.PDF_AI_CONTEXT_RUNTIME_ROOT,
		process.resourcesPath,
		__dirname,
		process.resourcesPath ? path.join(process.resourcesPath, 'app.asar') : '',
		path.join(__dirname, 'app.asar'),
	]
		.filter((root, index, allRoots) => root && allRoots.indexOf(root) === index);
	for (const root of roots) {
		const candidate = path.join(root, fileName);
		if (fsSync.existsSync(candidate)) {
			return require(candidate);
		}
	}
	return require(`./${fileName}`);
}

const { withProjectStateWriteLock } = requireContextRuntimeModule('project-state-lock.js');
const {
	AI_OUTLINE_EXTERNAL_SKILL_GENERATION_MODE,
	AI_OUTLINE_MINERU_NAVIGATION_GENERATION_MODE,
	AI_OUTLINE_SCHEMA_VERSION,
	AI_OUTLINE_SOURCE_MINERU,
	buildAiOutlineSource,
	buildMineruNavigationOutline,
	isMineruNavigationSource,
	normalizeAiOutline,
	normalizeAiOutlineLanguage,
	} = requireContextRuntimeModule('ai-outline-service.js');
const {
	applyNativePdfOutline,
	parseMineruContentTreeFromFile,
	} = requireContextRuntimeModule('mineru-content-tree.js');
const {
	AI_INSIGHT_COLORS,
	buildAiInsightSource,
	buildClearedAiInsightMeta,
	buildNarrowTextRectFallback,
	extractMineruBlocks,
	findQuoteRangeInText,
	getPdfRectsForBlockQuote,
	normalizeAiInsightMeta,
	} = requireContextRuntimeModule('ai-insight-service.js');
const {
	findPdfTextRects,
	getNativePdfOutline,
	getPdfPageMetrics,
	} = requireContextRuntimeModule('pdfai-context-pdf.js');

const SAFE_PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const PROJECT_STATE_MAX_BYTES = 8 * 1024 * 1024;
const MAX_AI_INSIGHTS = 10000;
const MAX_TEXT_CHARS = 20000;
const MAX_FIELD_CHARS = 4096;
const MAX_TAGS = 50;
const MAX_POSITION_JSON_BYTES = 1024 * 1024;
const MIN_AI_INSIGHT_QUOTE_CHARS = 18;
const MAX_PREPARED_AI_INSIGHTS = 96;
const MAX_PREPARED_AI_INSIGHT_QUOTE_CHARS = 900;
const MAX_MINERU_JSON_BYTES = 64 * 1024 * 1024;
const STATE_RENAME_RETRY_DELAYS_MS = [0, 12, 30, 65, 130, 260, 520, 900];
const AI_CONTEXT_BRIEF_MAX_BLOCKS = 32;
const AI_CONTEXT_BRIEF_MAX_BLOCK_CHARS = 1100;
const AI_CONTEXT_BRIEF_MAX_CHARS = 24000;

function clone(value) {
	return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isRetryableStateRenameError(error) {
	return ['EACCES', 'EBUSY', 'EEXIST', 'EPERM'].includes(String(error?.code || ''));
}

async function renameStateFileWithRetry(tempPath, statePath) {
	let lastError = null;
	for (const delayMs of STATE_RENAME_RETRY_DELAYS_MS) {
		if (delayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
		try {
			await fs.rename(tempPath, statePath);
			return;
		}
		catch (error) {
			lastError = error;
			if (!isRetryableStateRenameError(error)) {
				throw error;
			}
		}
	}
	throw lastError || new Error('Failed to replace project state file');
}

function clampText(value, maxLength = MAX_FIELD_CHARS) {
	return String(value || '').replace(/[\r\n\t]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maxLength);
}

function isPathInsideOrSameDirectory(targetPath, parentPath) {
	const relative = path.relative(parentPath, targetPath);
	return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeProjectID(value) {
	const projectID = String(value || '').trim();
	if (!SAFE_PROJECT_ID_PATTERN.test(projectID)) {
		throw new Error('Invalid project ID');
	}
	return projectID;
}

async function resolveProjectContext({ workspace, projectID }) {
	const requestedWorkspace = String(workspace || '').trim();
	if (!requestedWorkspace) {
		throw new Error('workspace is required');
	}
	const root = await fs.realpath(path.resolve(requestedWorkspace));
	const rootStat = await fs.stat(root);
	if (!rootStat.isDirectory()) {
		throw new Error('workspace must be a directory');
	}
	const safeProjectID = normalizeProjectID(projectID);
	const projectDir = path.resolve(root, safeProjectID);
	if (!isPathInsideOrSameDirectory(projectDir, root) || projectDir === root) {
		throw new Error('Project path is outside the workspace');
	}
	const projectStat = await fs.lstat(projectDir);
	if (!projectStat.isDirectory() || projectStat.isSymbolicLink()) {
		throw new Error('Project directory is unavailable');
	}
	const realProjectDir = await fs.realpath(projectDir);
	if (!isPathInsideOrSameDirectory(realProjectDir, root)) {
		throw new Error('Project directory resolves outside the workspace');
	}
	const statePath = path.join(realProjectDir, 'state.json');
	if (!isPathInsideOrSameDirectory(statePath, realProjectDir)) {
		throw new Error('Invalid project state path');
	}
	return {
		workspace: root,
		projectID: safeProjectID,
		projectDir: realProjectDir,
		statePath,
	};
}

async function readProjectState(context) {
	const stat = await fs.stat(context.statePath);
	if (!stat.isFile() || stat.size > PROJECT_STATE_MAX_BYTES) {
		throw new Error('Project state is missing or exceeds the supported size');
	}
	let state;
	try {
		state = JSON.parse(await fs.readFile(context.statePath, 'utf8'));
	}
	catch (error) {
		throw new Error(`Could not parse project state: ${error?.message || String(error)}`);
	}
	if (!state || typeof state !== 'object' || Array.isArray(state)) {
		throw new Error('Project state must be a JSON object');
	}
	if (state.projectID && String(state.projectID) !== context.projectID) {
		throw new Error('Project state does not match the requested project ID');
	}
	return state;
}

function isSafeProjectArtifactPath(value, context) {
	if (typeof value !== 'string' || !value.trim()) {
		return false;
	}
	const candidate = path.resolve(value);
	return isPathInsideOrSameDirectory(candidate, context.projectDir);
}

async function findFirstReadableArtifact(candidates, maxBytes = MAX_MINERU_JSON_BYTES) {
	for (const candidate of [...new Set(candidates)]) {
		try {
			const stat = await fs.stat(candidate);
			if (stat.isFile() && stat.size <= maxBytes) {
				return candidate;
			}
		}
		catch {
			// Continue through stale artifact paths left by an interrupted conversion.
		}
	}
	return '';
}

async function resolveMineruArtifacts(context, state = {}) {
	const outputDir = path.join(context.projectDir, 'mineru');
	const preferredJson = isSafeProjectArtifactPath(state?.mineruArtifacts?.jsonPath, context)
		? path.resolve(state.mineruArtifacts.jsonPath)
		: '';
	const preferredMarkdown = isSafeProjectArtifactPath(state?.mineruArtifacts?.markdownPath, context)
		? path.resolve(state.mineruArtifacts.markdownPath)
		: '';
	let entries = [];
	try {
		entries = await fs.readdir(outputDir, { withFileTypes: true });
	}
	catch {
		entries = [];
	}
	const files = entries
		.filter((entry) => entry.isFile())
		.map((entry) => path.join(outputDir, entry.name));
	const jsonPath = await findFirstReadableArtifact([
		preferredJson,
		...files.filter((candidate) => /-mineru\.json$/iu.test(candidate)),
		...files.filter((candidate) => /\.json$/iu.test(candidate)),
	]);
	const markdownPath = await findFirstReadableArtifact([
		preferredMarkdown,
		...files.filter((candidate) => /-mineru\.md$/iu.test(candidate)),
		...files.filter((candidate) => /\.md$/iu.test(candidate)),
	], MAX_MINERU_JSON_BYTES);
	return {
		outputDir,
		jsonPath,
		markdownPath,
		hasJson: Boolean(jsonPath),
		hasMarkdown: Boolean(markdownPath),
	};
}

async function loadMineruBlocks(context, state) {
	const artifacts = await resolveMineruArtifacts(context, state);
	if (!artifacts.jsonPath) {
		return { artifacts, blocks: [] };
	}
	try {
		const raw = await fs.readFile(artifacts.jsonPath, 'utf8');
		const blocks = extractMineruBlocks(JSON.parse(raw));
		return { artifacts, blocks, raw };
	}
	catch (error) {
		return {
			artifacts: {
				...artifacts,
				jsonError: `Could not read MinerU JSON: ${error?.message || String(error)}`,
			},
			blocks: [],
		};
	}
}

async function resolveProjectPdfPath(context, state = {}) {
	const candidates = [
		state.workingPdfPath,
		path.join(context.projectDir, 'working.pdf'),
		state.sourcePath,
	]
		.filter((candidate) => typeof candidate === 'string' && candidate.trim())
		.map((candidate) => path.resolve(candidate));
	for (const candidate of [...new Set(candidates)]) {
		try {
			const stat = await fs.stat(candidate);
			if (stat.isFile() && path.extname(candidate).toLowerCase() === '.pdf') {
				return candidate;
			}
		}
		catch {
			// Use the next available workspace copy when the original source moved.
		}
	}
	throw new Error('Project PDF is unavailable');
}

async function buildProjectAiOutlineSource(context, state, artifacts, pdfPath, nativeOutline = null) {
	const artifactPath = artifacts?.jsonPath || artifacts?.markdownPath || '';
	if (!artifactPath) {
		throw new Error('MinerU Markdown/JSON is required before building an AI outline source');
	}
	let contentTree = await parseMineruContentTreeFromFile(artifactPath, {
		documentTitle: state.documentTitle || path.parse(state.sourcePath || artifactPath).name || 'Document',
		markdownPath: artifacts?.markdownPath || '',
	});
	let resolvedNativeOutline = nativeOutline;
	if (!resolvedNativeOutline) {
		try {
			resolvedNativeOutline = await getNativePdfOutline(pdfPath);
		}
		catch {
			resolvedNativeOutline = { items: [], flatItems: [] };
		}
	}
	if (Array.isArray(resolvedNativeOutline?.items) && resolvedNativeOutline.items.length) {
		contentTree = applyNativePdfOutline(contentTree, resolvedNativeOutline);
	}
	return {
		contentTree,
		nativeOutline: resolvedNativeOutline,
		source: buildAiOutlineSource(contentTree, {
			nativeOutline: resolvedNativeOutline?.items || [],
		}),
	};
}

function serializeAiOutlineSourceForInspect(source) {
	if (!source || typeof source !== 'object') {
		return null;
	}
	return {
		outlineSource: String(source.outlineSource || ''),
		sourceFingerprint: String(source.sourceFingerprint || ''),
		nativeOutlineCount: Math.max(0, Number(source.nativeOutlineCount) || 0),
		navigationItemCount: Math.max(0, Number(source.navigationItemCount) || 0),
		entries: (Array.isArray(source.entries) ? source.entries : []).map((entry) => ({
			...(entry?.id ? { id: String(entry.id) } : {}),
			...(entry?.parentID ? { parentID: String(entry.parentID) } : {}),
			...(Number.isInteger(Number(entry?.nativeOutlineOrder)) ? { nativeOutlineOrder: Number(entry.nativeOutlineOrder) } : {}),
			title: clampText(entry?.originalTitle || entry?.title, 1024),
			level: Math.max(1, Number(entry?.level) || 1),
			pageIndex: Number.isInteger(Number(entry?.pageIndex)) ? Number(entry.pageIndex) : null,
			blockIndex: Number.isInteger(Number(entry?.blockIndex)) ? Number(entry.blockIndex) : null,
			sourceBlockIndices: Array.isArray(entry?.sourceBlockIndices) ? entry.sourceBlockIndices : [],
			content: clampText(entry?.sourceText, 900),
		})),
	};
}

async function writeProjectState(context, state) {
	const serialized = `${JSON.stringify(state, null, 2)}\n`;
	if (Buffer.byteLength(serialized, 'utf8') > PROJECT_STATE_MAX_BYTES) {
		throw new Error('Updated project state exceeds the supported size');
	}
	const tempPath = path.join(context.projectDir, `.state-${process.pid}-${crypto.randomUUID()}.tmp`);
	try {
		await fs.writeFile(tempPath, serialized, 'utf8');
		await renameStateFileWithRetry(tempPath, context.statePath);
	}
	finally {
		await fs.rm(tempPath, { force: true }).catch(() => {});
	}
}

function isAiInsightAnnotation(annotation) {
	return Boolean(annotation?.aiInsightKind)
		|| /^ai-(?:evidence|insight)(?:-|$)/u.test(String(annotation?.projectOrigin || ''));
}

function normalizeInsightKind(value) {
	const kind = String(value || '').trim().toLowerCase();
	return kind === 'innovation' || kind === 'innovative' ? 'innovation' : 'evidence';
}

function getAiInsightColor(value) {
	const annotation = value && typeof value === 'object' ? value : {};
	const requestedOrigin = String(annotation.projectOrigin || '').trim();
	const inferredKind = /^ai-insight(?:-|$)/u.test(requestedOrigin) ? 'innovation' : '';
	return AI_INSIGHT_COLORS[normalizeInsightKind(annotation.aiInsightKind || annotation.kind || inferredKind)];
}

function copyPosition(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	try {
		const serialized = JSON.stringify(value);
		if (Buffer.byteLength(serialized, 'utf8') > MAX_POSITION_JSON_BYTES) {
			return undefined;
		}
		return JSON.parse(serialized);
	}
	catch {
		return undefined;
	}
}

function normalizeTags(value) {
	if (!Array.isArray(value)) {
		return [];
	}
	const seen = new Set();
	return value
		.slice(0, MAX_TAGS)
		.map((tag) => {
			const name = clampText(tag?.name || tag, 120);
			if (!name || seen.has(name)) {
				return null;
			}
			seen.add(name);
			const next = { name };
			const color = clampText(tag?.color, 64);
			if (color) {
				next.color = color;
			}
			return next;
		})
		.filter(Boolean);
}

function normalizeContextAnnotations(value) {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.filter((annotation) => annotation && typeof annotation === 'object' && !Array.isArray(annotation))
		.map((annotation) => {
			const next = { ...annotation, tags: normalizeTags(annotation.tags) };
			if (isAiInsightAnnotation(next)) {
				next.color = getAiInsightColor(next);
			}
			return next;
		});
}

function narrowAiInsightPosition(position, quote, sourceText = '') {
	const nextPosition = copyPosition(position);
	if (!nextPosition || !Array.isArray(nextPosition.rects) || nextPosition.rects.length !== 1 || !quote) {
		return nextPosition;
	}
	const rects = buildNarrowTextRectFallback(nextPosition.rects[0], sourceText || quote, quote);
	if (rects.length > 1) {
		nextPosition.rects = rects;
	}
	return nextPosition;
}

async function loadMineruBlockTextByIndex(context, state) {
	const { blocks } = await loadMineruBlocks(context, state);
	return new Map(blocks.map((block) => [block.blockIndex, block.text]));
}

function normalizeAiInsight(value, index, sourceText = '') {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	const requestedOrigin = clampText(value.projectOrigin, 120);
	// Older CLI payloads identify innovations through projectOrigin only.
	const inferredKind = /^ai-insight(?:-|$)/u.test(requestedOrigin) ? 'innovation' : '';
	const kind = normalizeInsightKind(value.aiInsightKind || value.kind || inferredKind);
	const projectOrigin = /^ai-(?:evidence|insight)(?:-|$)/u.test(requestedOrigin)
		? requestedOrigin
		: (kind === 'innovation' ? 'ai-insight-innovation' : 'ai-evidence');
	const requestedID = clampText(value.id, 180);
	const id = requestedID || `${projectOrigin}-${crypto.createHash('sha256')
		.update(`${Date.now()}:${index}:${value.text || value.comment || ''}`)
		.digest('hex').slice(0, 16)}`;
	const next = {
		id,
		type: clampText(value.type || 'highlight', 80),
		projectOrigin,
		aiInsightKind: kind,
	};
	for (const key of ['aiInsightKey', 'aiInsightEvidenceFor', 'aiInsightEvidenceRole', 'aiInsightSourceBlockId', 'aiInsightPromptVersion']) {
		const text = clampText(value[key], 160);
		if (text) {
			next[key] = text;
		}
	}
	const sourceBlockIndex = Number(value.aiInsightSourceBlockIndex);
	if (Number.isInteger(sourceBlockIndex) && sourceBlockIndex >= 0) {
		next.aiInsightSourceBlockIndex = sourceBlockIndex;
	}
	for (const key of ['text', 'comment', 'quote', 'highlightText']) {
		const text = clampText(value[key], MAX_TEXT_CHARS);
		if (text) {
			next[key] = text;
		}
	}
	for (const key of ['pageLabel', 'sortIndex', 'authorName']) {
		const text = clampText(value[key], MAX_FIELD_CHARS);
		if (text) {
			next[key] = text;
		}
	}
	// AI-managed highlights have a stable visual vocabulary regardless of model output.
	next.color = getAiInsightColor(next);
	const tags = normalizeTags(value.tags);
	next.tags = tags;
	const position = narrowAiInsightPosition(value.position, next.quote, sourceText);
	if (position) {
		next.position = position;
	}
	for (const key of ['readOnly']) {
		if (typeof value[key] === 'boolean') {
			next[key] = value[key];
		}
	}
	return next;
}

function buildClearedAiOutline(language) {
	return {
		schemaVersion: AI_OUTLINE_SCHEMA_VERSION,
		language: normalizeAiOutlineLanguage(language),
		status: 'cleared',
		provider: '',
		model: '',
		generationMode: '',
		outlineSource: '',
		sourceFingerprint: '',
		nativeOutlineCount: 0,
		navigationItemCount: 0,
		generatedAt: new Date().toISOString(),
		items: [],
	};
}

function makeContextPayload(context, state) {
	const annotations = normalizeContextAnnotations(state.annotations);
	const configuredMineru = state?.mineruArtifacts && typeof state.mineruArtifacts === 'object'
		? state.mineruArtifacts
		: {};
	return {
		workspace: context.workspace,
		projectID: context.projectID,
		projectDir: context.projectDir,
		document: {
			title: String(state.documentTitle || ''),
			author: String(state.documentAuthor || ''),
			sourcePath: String(state.sourcePath || ''),
		},
		aiOutline: normalizeAiOutline(state.aiOutline),
		aiInsights: clone(annotations.filter(isAiInsightAnnotation)),
		aiInsightMeta: normalizeAiInsightMeta(state.aiInsightMeta),
		mineru: {
			outputDir: String(configuredMineru.outputDir || path.join(context.projectDir, 'mineru')),
			markdownPath: String(configuredMineru.markdownPath || ''),
			jsonPath: String(configuredMineru.jsonPath || ''),
		},
	};
}

async function readAiContext(payload = {}) {
	const context = await resolveProjectContext(payload);
	const state = await readProjectState(context);
	return makeContextPayload(context, state);
}

function makePreparationDiagnostic(index, level, code, message, extra = {}) {
	return {
		index,
		level,
		code,
		message,
		...extra,
	};
}

function makePreparedContextResult({
	valid,
	hasAiOutline,
	aiOutline,
	hasAiInsights,
	aiInsights,
	diagnostics,
	mineru,
}) {
	return {
		valid,
		...(hasAiOutline ? { aiOutline: aiOutline ?? null } : {}),
		...(hasAiInsights ? { aiInsights: Array.isArray(aiInsights) ? aiInsights : [] } : {}),
		diagnostics: Array.isArray(diagnostics) ? diagnostics : [],
		mineru: mineru || {},
	};
}

function getPreparedInsightKind(value) {
	const kind = String(value?.aiInsightKind || value?.kind || '').trim().toLowerCase();
	return kind === 'innovation' || kind === 'innovative'
		? 'innovation'
		: kind === 'evidence'
			? 'evidence'
			: '';
}

function getSourceBlockForPreparedInsight(value, blocksByIndex, blocksById) {
	const rawSourceBlockIndex = value?.aiInsightSourceBlockIndex ?? value?.sourceBlockIndex;
	const sourceBlockIndex = rawSourceBlockIndex === '' || rawSourceBlockIndex === null || rawSourceBlockIndex === undefined
		? Number.NaN
		: Number(rawSourceBlockIndex);
	const sourceBlockId = clampText(value?.aiInsightSourceBlockId || value?.blockId || value?.sourceBlockId, 160);
	const hasRequestedSource = (Number.isInteger(sourceBlockIndex) && sourceBlockIndex >= 0) || Boolean(sourceBlockId);
	const indexedBlock = Number.isInteger(sourceBlockIndex) && sourceBlockIndex >= 0
		? blocksByIndex.get(sourceBlockIndex)
		: null;
	const namedBlock = sourceBlockId ? blocksById.get(sourceBlockId) : null;
	if (indexedBlock && namedBlock && indexedBlock.blockIndex !== namedBlock.blockIndex) {
		return { error: 'The supplied source block ID and index refer to different MinerU blocks.' };
	}
	return { block: indexedBlock || namedBlock || null, hasRequestedSource };
}

function findUniqueSourceBlockByQuote(blocks, quote) {
	const matches = (Array.isArray(blocks) ? blocks : [])
		.filter((block) => !block?.isReference && findQuoteRangeInText(block?.text, quote));
	return matches.length === 1
		? { block: matches[0] }
		: matches.length > 1
			? { error: 'quote matches more than one MinerU source block; provide aiInsightSourceBlockId or aiInsightSourceBlockIndex.' }
			: { block: null };
}

function getSortIndexForPreparedInsight(pageIndex, rects) {
	const firstRect = Array.isArray(rects) ? rects.find((rect) => Array.isArray(rect) && rect.length >= 4) : null;
	const top = Math.max(0, Number(firstRect?.[3] || 0));
	return [
		String(Math.max(0, Number(pageIndex) || 0)).padStart(5, '0'),
		'000000',
		String(Math.floor(top * 100)).padStart(8, '0'),
	].join('|');
}

function normalizePreparedInsight(value, index, blocksByIndex, blocksById, blocks) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {
			index,
			valid: false,
			diagnostics: [makePreparationDiagnostic(index, 'error', 'invalid-insight', 'Each AI insight must be a JSON object.')],
		};
	}
	const diagnostics = [];
	const kind = getPreparedInsightKind(value);
	if (!kind) {
		diagnostics.push(makePreparationDiagnostic(index, 'error', 'invalid-kind', 'aiInsightKind must be innovation or evidence.'));
	}
	const key = clampText(value.aiInsightKey || value.key, 160);
	if (!key) {
		diagnostics.push(makePreparationDiagnostic(index, 'error', 'missing-key', 'Each AI insight requires a stable aiInsightKey.'));
	}
	const text = clampText(value.text || value.title, MAX_TEXT_CHARS);
	if (!text) {
		diagnostics.push(makePreparationDiagnostic(index, 'error', 'missing-text', 'Each AI insight requires a concise text title.'));
	}
	const quote = clampText(value.quote || value.highlightText, MAX_PREPARED_AI_INSIGHT_QUOTE_CHARS);
	if (quote.length < MIN_AI_INSIGHT_QUOTE_CHARS) {
		diagnostics.push(makePreparationDiagnostic(index, 'error', 'invalid-quote', `quote must contain at least ${MIN_AI_INSIGHT_QUOTE_CHARS} source characters.`));
	}
	const source = getSourceBlockForPreparedInsight(value, blocksByIndex, blocksById);
	let sourceRecovered = false;
	if (!source.error && !source.block && !source.hasRequestedSource && quote.length >= MIN_AI_INSIGHT_QUOTE_CHARS) {
		const recovered = findUniqueSourceBlockByQuote(blocks, quote);
		source.block = recovered.block || null;
		source.error = recovered.error || '';
		sourceRecovered = Boolean(recovered.block);
	}
	if (source.error) {
		diagnostics.push(makePreparationDiagnostic(index, 'error', 'source-block-mismatch', source.error));
	}
	else if (!source.block) {
		diagnostics.push(makePreparationDiagnostic(index, 'error', 'missing-source-block', 'Each AI insight requires aiInsightSourceBlockId or aiInsightSourceBlockIndex.'));
	}
	else if (source.block.isReference) {
		diagnostics.push(makePreparationDiagnostic(index, 'error', 'reference-source', 'Reference-list blocks cannot be used for AI insights.'));
	}
	else if (quote && !findQuoteRangeInText(source.block.text, quote)) {
		diagnostics.push(makePreparationDiagnostic(index, 'error', 'quote-not-in-source-block', 'quote must be a verbatim excerpt from the selected MinerU source block.'));
	}
	const evidenceFor = clampText(value.aiInsightEvidenceFor || value.evidenceFor, 160);
	const next = {
		...clone(value),
		aiInsightKind: kind,
		aiInsightKey: key,
		text,
		quote,
		highlightText: quote,
		type: 'highlight',
		color: getAiInsightColor({ aiInsightKind: kind }),
	};
	if (!next.comment && value.summary) {
		next.comment = clampText(value.summary, MAX_TEXT_CHARS);
	}
	delete next.evidenceFor;
	if (kind === 'evidence' && evidenceFor) {
		next.aiInsightEvidenceFor = evidenceFor;
	}
	else {
		delete next.aiInsightEvidenceFor;
	}
	if (source.block) {
		next.aiInsightSourceBlockId = source.block.id;
		next.aiInsightSourceBlockIndex = source.block.blockIndex;
	}
	return {
		index,
		key,
		kind,
		evidenceFor,
		block: source.block || null,
		value: next,
		diagnostics: [
			...diagnostics,
			...(sourceRecovered ? [makePreparationDiagnostic(index, 'warning', 'source-block-recovered', 'Recovered the source block from a unique quote match.')] : []),
		],
		valid: diagnostics.every((diagnostic) => diagnostic.level !== 'error'),
	};
}

function addPreparationError(record, code, message) {
	record.diagnostics.push(makePreparationDiagnostic(record.index, 'error', code, message, {
		aiInsightKey: record.key || '',
	}));
	record.valid = false;
}

function normalizePreparedRects(value) {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.filter((rect) => Array.isArray(rect) && rect.length >= 4)
		.map((rect) => rect.slice(0, 4).map(Number))
		.filter((rect) => rect.every(Number.isFinite) && rect[0] !== rect[2] && rect[1] !== rect[3]);
}

function prepareAiOutline(value, source, fallbackLanguage, options = {}) {
	const diagnostics = [];
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {
			valid: false,
			value: null,
			diagnostics: [makePreparationDiagnostic(-1, 'error', 'invalid-ai-outline', 'aiOutline must be a JSON object.')],
		};
	}
	const sourceEntries = Array.isArray(source?.entries) ? source.entries : [];
	if (!sourceEntries.length) {
		return {
			valid: false,
			value: null,
			diagnostics: [makePreparationDiagnostic(-1, 'error', 'outline-source-unavailable', 'No native PDF outline or MinerU chapter tree is available for this document.')],
		};
	}
	if (isMineruNavigationSource(source)) {
		const suppliedByID = new Map();
		for (const item of Array.isArray(value.items) ? value.items : []) {
			const id = clampText(item?.id ?? item?.sectionId ?? item?.sectionID, 160);
			if (!id) {
				diagnostics.push(makePreparationDiagnostic(-1, 'error', 'invalid-mineru-navigation-id', 'Each MinerU navigation item requires its stable id.'));
				continue;
			}
			if (suppliedByID.has(id)) {
				diagnostics.push(makePreparationDiagnostic(-1, 'error', 'duplicate-mineru-navigation-id', `MinerU navigation id "${id}" is supplied more than once.`));
				continue;
			}
			suppliedByID.set(id, item);
		}
		const sourceIDSet = new Set(sourceEntries.map((entry) => String(entry.id || '')));
		for (const id of suppliedByID.keys()) {
			if (!sourceIDSet.has(id)) {
				diagnostics.push(makePreparationDiagnostic(-1, 'error', 'unknown-mineru-navigation-id', `MinerU navigation id "${id}" does not exist in this document.`));
			}
		}
		const annotations = new Map();
		for (const entry of sourceEntries) {
			const supplied = suppliedByID.get(entry.id);
			const annotation = clampText(supplied?.annotation ?? supplied?.note ?? supplied?.summary, 160);
			if (!annotation) {
				diagnostics.push(makePreparationDiagnostic(-1, 'error', 'missing-mineru-navigation-annotation', `MinerU navigation id "${entry.id}" requires one concise annotation.`));
			}
			annotations.set(entry.id, annotation);
		}
		return {
			valid: diagnostics.every((diagnostic) => diagnostic.level !== 'error'),
			value: buildMineruNavigationOutline(source, {
				language: normalizeAiOutlineLanguage(value.language || fallbackLanguage),
				status: 'ready',
				provider: 'pdfai-context-skill',
				model: clampText(value.model || '', 120),
				pageMetrics: options.pageMetrics,
				generatedAt: new Date().toISOString(),
				annotations,
			}),
			diagnostics,
		};
	}

	const nativeItems = sourceEntries;
	const suppliedByOrder = new Map();
	for (const item of Array.isArray(value.items) ? value.items : []) {
		const order = Number(item?.nativeOutlineOrder ?? item?.order);
		if (!Number.isInteger(order) || order <= 0) {
			diagnostics.push(makePreparationDiagnostic(-1, 'error', 'invalid-native-outline-order', 'Each aiOutline item requires a positive nativeOutlineOrder.'));
			continue;
		}
		if (suppliedByOrder.has(order)) {
			diagnostics.push(makePreparationDiagnostic(-1, 'error', 'duplicate-native-outline-order', `nativeOutlineOrder ${order} is supplied more than once.`));
			continue;
		}
		suppliedByOrder.set(order, item);
	}
	const nativeOrderSet = new Set(nativeItems.map((item) => Number(item.nativeOutlineOrder)));
	for (const order of suppliedByOrder.keys()) {
		if (!nativeOrderSet.has(order)) {
			diagnostics.push(makePreparationDiagnostic(-1, 'error', 'unknown-native-outline-order', `nativeOutlineOrder ${order} does not exist in this PDF.`));
		}
	}
	const items = nativeItems.map((nativeItem) => {
		const supplied = suppliedByOrder.get(Number(nativeItem.nativeOutlineOrder));
		const annotation = clampText(supplied?.annotation ?? supplied?.note ?? supplied?.summary, 160);
		if (!annotation) {
			diagnostics.push(makePreparationDiagnostic(-1, 'error', 'missing-outline-annotation', `nativeOutlineOrder ${nativeItem.nativeOutlineOrder} requires one concise annotation.`));
		}
		return {
			nativeOutlineOrder: Number(nativeItem.nativeOutlineOrder),
			originalTitle: String(nativeItem.originalTitle || nativeItem.title || ''),
			level: Math.max(0, Math.floor(Number(nativeItem.level) || 0)),
			pageIndex: Number.isInteger(Number(nativeItem.pageIndex)) ? Number(nativeItem.pageIndex) : null,
			annotation,
			points: [],
			sourceBlockIndices: Array.isArray(supplied?.sourceBlockIndices)
				? [...new Set(supplied.sourceBlockIndices.map(Number).filter((number) => Number.isInteger(number) && number >= 0))].slice(0, 200)
				: [],
		};
	});
	return {
		valid: diagnostics.every((diagnostic) => diagnostic.level !== 'error'),
		value: {
			schemaVersion: AI_OUTLINE_SCHEMA_VERSION,
			language: normalizeAiOutlineLanguage(value.language || fallbackLanguage),
			status: 'ready',
			provider: 'pdfai-context-skill',
			model: clampText(value.model || '', 120),
			generationMode: AI_OUTLINE_EXTERNAL_SKILL_GENERATION_MODE,
			outlineSource: 'pdf-native',
			sourceFingerprint: '',
			nativeOutlineCount: nativeItems.length,
			navigationItemCount: 0,
			generatedAt: new Date().toISOString(),
			items,
		},
		diagnostics,
	};
}

async function inspectAiContext(payload = {}) {
	const context = await resolveProjectContext(payload);
	const state = await readProjectState(context);
	const baseContext = makeContextPayload(context, state);
	const [{ artifacts, blocks }, pdfPath] = await Promise.all([
		loadMineruBlocks(context, state),
		resolveProjectPdfPath(context, state),
	]);
	let nativeOutline = { items: [], flatItems: [], pageCount: 0, outlineCount: 0 };
	let nativeOutlineError = '';
	try {
		nativeOutline = await getNativePdfOutline(pdfPath);
	}
	catch (error) {
		nativeOutlineError = error?.message || String(error);
	}
	let aiOutlineSource = null;
	let aiOutlineSourceError = '';
	if (artifacts.hasJson || artifacts.hasMarkdown) {
		try {
			const resolved = await buildProjectAiOutlineSource(context, state, artifacts, pdfPath, nativeOutline);
			aiOutlineSource = serializeAiOutlineSourceForInspect(resolved.source);
		}
		catch (error) {
			aiOutlineSourceError = error?.message || String(error);
		}
	}
	return {
		...baseContext,
		document: {
			...baseContext.document,
			workingPdfPath: pdfPath,
		},
		mineru: {
			...artifacts,
			blockCount: blocks.length,
		},
		nativeOutline: nativeOutline.flatItems || [],
		nativeOutlineInfo: {
			pageCount: Number(nativeOutline.pageCount || 0),
			outlineCount: Number(nativeOutline.outlineCount || 0),
			error: nativeOutlineError,
		},
		aiOutlineSource: aiOutlineSource
			? { ...aiOutlineSource, error: aiOutlineSourceError }
			: { outlineSource: 'none', entries: [], error: aiOutlineSourceError },
	};
}

function makeAiContextBriefBlock(block) {
	return {
		id: String(block.id || ''),
		blockIndex: Number(block.blockIndex),
		pageIndex: Number(block.pageIndex),
		page: Number(block.pageIndex) + 1,
		text: clampText(block.text, AI_CONTEXT_BRIEF_MAX_BLOCK_CHARS),
	};
}

function collectAiContextBriefBlockIds(source) {
	const orderedIds = [];
	const seen = new Set();
	const add = (value) => {
		const id = String(value || '').trim();
		if (!id || seen.has(id)) return;
		seen.add(id);
		orderedIds.push(id);
	};
	for (const block of source.blocks || []) {
		if (block?.blockIndex <= 2 && !block?.isReference) add(block.id);
	}
	for (const cue of source.contributionCues || []) add(cue?.id);
	for (const zone of source.coverageCues || []) {
		for (const block of zone?.blocks || []) add(block?.id);
	}
	const eligible = (source.blocks || []).filter((block) => !block?.isReference && block?.text?.length >= MIN_AI_INSIGHT_QUOTE_CHARS);
	for (const block of eligible.slice(-3)) add(block.id);
	return orderedIds;
}

function buildAiContextBrief(source, language = 'en') {
	const blocksById = new Map((source?.blocks || []).map((block) => [block.id, block]));
	const selectedIds = collectAiContextBriefBlockIds(source);
	const selected = [];
	const selectedSet = new Set();
	let selectedChars = 0;
	const tryAdd = (block) => {
		if (!block || block.isReference || selectedSet.has(block.id)
			|| selected.length >= AI_CONTEXT_BRIEF_MAX_BLOCKS) {
			return;
		}
		const briefBlock = makeAiContextBriefBlock(block);
		const blockChars = briefBlock.text.length;
		if (selected.length && selectedChars + blockChars > AI_CONTEXT_BRIEF_MAX_CHARS) {
			return;
		}
		selected.push(briefBlock);
		selectedSet.add(block.id);
		selectedChars += blockChars;
	};
	for (const id of selectedIds) {
		const block = blocksById.get(id);
		tryAdd(block);
		// A named contribution often has its precise mechanism in the adjacent
		// MinerU block, so retain immediate readable neighbours as evidence options.
		for (const offset of [-1, 1]) {
			tryAdd(blocksById.get(`b-${Number(block?.blockIndex) + offset}`));
		}
	}
	for (const block of source.blocks || []) {
		tryAdd(block);
		if (selected.length >= AI_CONTEXT_BRIEF_MAX_BLOCKS || selectedChars >= AI_CONTEXT_BRIEF_MAX_CHARS) break;
	}
	selected.sort((left, right) => left.blockIndex - right.blockIndex || left.pageIndex - right.pageIndex);
	return {
		schemaVersion: 1,
		language: normalizeAiOutlineLanguage(language),
		documentTitle: String(source?.documentTitle || ''),
		sourceFingerprint: String(source?.sourceFingerprint || ''),
		instructions: 'Use only these locatable blocks for this bounded task. Do not read the raw MinerU Markdown or JSON files.',
		blocks: selected,
		contributionBlockIds: (source?.contributionCues || []).map((cue) => cue.id).filter((id) => selectedSet.has(id)),
		coverage: (source?.coverageCues || []).map((zone) => ({
			id: zone.id,
			label: normalizeAiOutlineLanguage(language) === 'zh' ? zone.zh : zone.en,
			blockIds: (zone.blocks || []).map((block) => block.id).filter((id) => selectedSet.has(id)),
		})).filter((zone) => zone.blockIds.length),
		statistics: {
			totalLocatableBlockCount: Array.isArray(source?.blocks) ? source.blocks.length : 0,
			briefBlockCount: selected.length,
			briefCharacters: selectedChars,
		},
	};
}

async function briefAiContext(payload = {}) {
	const context = await resolveProjectContext(payload);
	const state = await readProjectState(context);
	const [{ artifacts, raw }, markdown] = await Promise.all([
		loadMineruBlocks(context, state),
		(async () => {
			const resolved = await resolveMineruArtifacts(context, state);
			if (!resolved.markdownPath) return '';
			return fs.readFile(resolved.markdownPath, 'utf8').catch(() => '');
		})(),
	]);
	if (!raw) {
		throw new Error('MinerU JSON with locatable text blocks is required before building an AI context brief');
	}
	const source = buildAiInsightSource({
		markdown,
		mineruJson: raw,
		documentTitle: state.documentTitle || '',
	});
	return {
		workspace: context.workspace,
		projectID: context.projectID,
		mineru: {
			outputDir: artifacts.outputDir,
			blockCount: source.blocks.length,
			hasMarkdown: Boolean(artifacts.markdownPath),
			hasJson: Boolean(artifacts.jsonPath),
		},
		brief: buildAiContextBrief(source, payload.language),
	};
}

async function prepareAiInsights(payload = {}) {
	const context = await resolveProjectContext(payload);
	const state = await readProjectState(context);
	const input = payload.input && typeof payload.input === 'object' && !Array.isArray(payload.input)
		? payload.input
		: {};
	const hasAiInsights = Object.hasOwn(input, 'aiInsights');
	const hasAiOutline = Object.hasOwn(input, 'aiOutline');
	if (!hasAiInsights && !hasAiOutline) {
		throw new Error('prepare input must contain aiInsights and/or aiOutline');
	}
	if (hasAiInsights && !Array.isArray(input.aiInsights)) {
		throw new Error('aiInsights must be an array');
	}
	const { artifacts, blocks, raw } = await loadMineruBlocks(context, state);
	if (!raw || !blocks.length) {
		throw new Error('MinerU JSON with locatable text blocks is required before preparing AI insights');
	}
	const source = buildAiInsightSource({
		markdown: '',
		mineruJson: raw,
		documentTitle: state.documentTitle || '',
	});
	const blocksByIndex = new Map(source.blocks.map((block) => [block.blockIndex, block]));
	const blocksById = new Map(source.blocks.map((block) => [block.id, block]));
	const requestedInsights = Array.isArray(input.aiInsights) ? input.aiInsights : [];
	if (requestedInsights.length > MAX_PREPARED_AI_INSIGHTS) {
		throw new Error(`prepare supports at most ${MAX_PREPARED_AI_INSIGHTS} AI insights at once`);
	}
	const records = requestedInsights
		.map((insight, index) => normalizePreparedInsight(insight, index, blocksByIndex, blocksById, source.blocks));
	const keyRecords = new Map();
	for (const record of records) {
		if (!record.valid || !record.key) {
			continue;
		}
		if (keyRecords.has(record.key)) {
			addPreparationError(record, 'duplicate-key', `aiInsightKey "${record.key}" is used more than once.`);
			addPreparationError(keyRecords.get(record.key), 'duplicate-key', `aiInsightKey "${record.key}" is used more than once.`);
		}
		else {
			keyRecords.set(record.key, record);
		}
	}
	const diagnostics = records.flatMap((record) => record.diagnostics);
	if (diagnostics.some((diagnostic) => diagnostic.level === 'error')) {
		return makePreparedContextResult({
			valid: false,
			hasAiOutline,
			aiOutline: null,
			hasAiInsights,
			aiInsights: [],
			diagnostics,
			mineru: { ...artifacts, blockCount: blocks.length },
		});
	}
	const pdfPath = await resolveProjectPdfPath(context, state);
	let pageMetrics = null;
	const ensurePageMetrics = async () => {
		if (!pageMetrics) {
			pageMetrics = await getPdfPageMetrics(pdfPath);
		}
		return pageMetrics;
	};
	let preparedOutline = null;
	if (hasAiOutline) {
		try {
			const outlineRuntime = await buildProjectAiOutlineSource(context, state, artifacts, pdfPath);
			let outlinePageMetrics = [];
			if (isMineruNavigationSource(outlineRuntime.source)) {
				try {
					outlinePageMetrics = (await ensurePageMetrics()).pages || [];
				}
				catch (error) {
					diagnostics.push(makePreparationDiagnostic(-1, 'warning', 'mineru-navigation-position-unavailable', error?.message || String(error)));
				}
			}
			const prepared = prepareAiOutline(input.aiOutline, outlineRuntime.source, payload.language, {
				pageMetrics: outlinePageMetrics,
			});
			preparedOutline = prepared.value;
			diagnostics.push(...prepared.diagnostics);
		}
		catch (error) {
			diagnostics.push(makePreparationDiagnostic(-1, 'error', 'outline-source-unavailable', error?.message || String(error)));
		}
		if (diagnostics.some((diagnostic) => diagnostic.level === 'error')) {
			return makePreparedContextResult({
				valid: false,
				hasAiOutline,
				aiOutline: null,
				hasAiInsights,
				aiInsights: [],
				diagnostics,
				mineru: { ...artifacts, blockCount: blocks.length },
			});
		}
	}
	if (!records.length) {
		return makePreparedContextResult({
			valid: true,
			hasAiOutline,
			aiOutline: preparedOutline,
			hasAiInsights,
			aiInsights: [],
			diagnostics: [
				...diagnostics,
				...(preparedOutline ? [makePreparationDiagnostic(-1, 'info', 'outline-ready', 'AI outline annotations prepared.')] : []),
			],
			mineru: { ...artifacts, blockCount: blocks.length },
		});
	}
	try {
		pageMetrics = await ensurePageMetrics();
	}
	catch (error) {
		return makePreparedContextResult({
			valid: false,
			hasAiOutline,
			aiOutline: null,
			hasAiInsights,
			aiInsights: [],
			diagnostics: [
				...diagnostics,
				makePreparationDiagnostic(-1, 'error', 'pdf-metrics-unavailable', error?.message || String(error)),
			],
			mineru: { ...artifacts, blockCount: blocks.length },
		});
	}
	for (const record of records) {
		const rects = getPdfRectsForBlockQuote(record.block, record.value.quote, source.pageBounds, pageMetrics.pages);
		if (!rects.length) {
			addPreparationError(record, 'fallback-position-unavailable', 'Could not create a PDF fallback position from the selected MinerU block.');
			continue;
		}
		record.value.position = {
			pageIndex: record.block.pageIndex,
			rects,
		};
		record.value.pageLabel = String(record.block.pageIndex + 1);
		record.value.sortIndex = getSortIndexForPreparedInsight(record.block.pageIndex, rects);
		record.positionSource = 'mineru-fallback';
	}
	if (records.some((record) => !record.valid)) {
		return makePreparedContextResult({
			valid: false,
			hasAiOutline,
			aiOutline: null,
			hasAiInsights,
			aiInsights: [],
			diagnostics: records.flatMap((record) => record.diagnostics),
			mineru: { ...artifacts, blockCount: blocks.length },
		});
	}
	try {
		const matches = await findPdfTextRects(pdfPath, records.map((record) => ({
			id: `insight-${record.index}`,
			pageIndex: record.block.pageIndex,
			quote: record.value.quote,
		})));
		const matchByID = new Map((Array.isArray(matches) ? matches : [])
			.map((match) => [match?.id, normalizePreparedRects(match?.rects)]));
		for (const record of records) {
			const rects = matchByID.get(`insight-${record.index}`) || [];
			if (!rects.length) {
				continue;
			}
			record.value.position.rects = rects;
			record.value.sortIndex = getSortIndexForPreparedInsight(record.block.pageIndex, rects);
			record.positionSource = 'pdf-text';
		}
	}
	catch (error) {
		diagnostics.push(makePreparationDiagnostic(-1, 'warning', 'pdf-text-refinement-unavailable', error?.message || String(error)));
	}
	return makePreparedContextResult({
		valid: true,
		hasAiOutline,
		aiOutline: preparedOutline,
		hasAiInsights,
		aiInsights: records.map((record) => record.value),
		diagnostics: [
			...diagnostics,
			...records.map((record) => makePreparationDiagnostic(record.index, 'info', 'position-ready', 'PDF position prepared.', {
				aiInsightKey: record.key,
				positionSource: record.positionSource,
				pageIndex: record.block.pageIndex,
			})),
			...(preparedOutline ? [makePreparationDiagnostic(-1, 'info', 'outline-ready', 'AI outline annotations prepared.')] : []),
		],
		mineru: { ...artifacts, blockCount: blocks.length },
	});
}

function hasPreparedAiInsightPosition(value) {
	const pageIndex = Number(value?.position?.pageIndex);
	return Number.isInteger(pageIndex)
		&& pageIndex >= 0
		&& normalizePreparedRects(value?.position?.rects).length > 0;
}

function formatPreparationDiagnostics(diagnostics) {
	const messages = (Array.isArray(diagnostics) ? diagnostics : [])
		.filter((diagnostic) => diagnostic?.level === 'error')
		.slice(0, 3)
		.map((diagnostic) => String(diagnostic.message || diagnostic.code || '').trim())
		.filter(Boolean);
	return messages.join(' ');
}

async function writeAiContext(payload = {}) {
	const context = await resolveProjectContext(payload);
	const rawInput = payload.input && typeof payload.input === 'object' && !Array.isArray(payload.input)
		? payload.input
		: {};
	let input = rawInput;
	// Outline records are source-bound just like insight records. Canonicalize
	// every non-clear outline write here so an AI provider cannot invent section
	// IDs, native bookmark orders, titles, or navigation locations by skipping
	// the optional explicit `prepare` command.
	if (rawInput.aiOutline && typeof rawInput.aiOutline === 'object' && !Array.isArray(rawInput.aiOutline)
		&& String(rawInput.aiOutline.status || '').trim().toLowerCase() !== 'cleared') {
		const prepared = await prepareAiInsights({
			...payload,
			input: { aiOutline: rawInput.aiOutline },
		});
		if (!prepared.valid || !prepared.aiOutline) {
			const detail = formatPreparationDiagnostics(prepared?.diagnostics);
			throw new Error(`AI outline requires a valid source-bound chapter set before write.${detail ? ` ${detail}` : ''}`);
		}
		input = {
			...input,
			aiOutline: prepared.aiOutline,
		};
	}
	// The Skill asks the model to run `prepare` before `write`, but a provider can
	// still omit that command. Never persist an AI insight without a navigable PDF
	// position: enrich the complete incoming set through the same validation and
	// coordinate pipeline before acquiring the state-write lock.
	if (Array.isArray(input.aiInsights)
		&& input.aiInsights.length
		&& input.aiInsights.some((insight) => !hasPreparedAiInsightPosition(insight))) {
		const prepared = await prepareAiInsights({
			...payload,
			input: { aiInsights: input.aiInsights },
		});
		if (!prepared.valid || !Array.isArray(prepared.aiInsights)
			|| prepared.aiInsights.length !== input.aiInsights.length
			|| prepared.aiInsights.some((insight) => !hasPreparedAiInsightPosition(insight))) {
			const detail = formatPreparationDiagnostics(prepared?.diagnostics);
			throw new Error(`AI insights require valid PDF positions before write.${detail ? ` ${detail}` : ''}`);
		}
		input = {
			...input,
			aiInsights: prepared.aiInsights,
		};
	}
	return withProjectStateWriteLock(context.statePath, async () => {
		const state = await readProjectState(context);
		state.annotations = normalizeContextAnnotations(state.annotations);
		// Clearing is intentionally scoped to the `clear` command. Older insight-only
		// preflight payloads can contain aiOutline: null and must not erase notes.
		if (Object.prototype.hasOwnProperty.call(input, 'aiOutline') && input.aiOutline !== null) {
			const aiOutline = normalizeAiOutline(input.aiOutline);
			if (!aiOutline) {
				throw new Error('aiOutline must contain valid annotation items or a cleared status');
			}
			state.aiOutline = aiOutline;
		}
		if (Object.prototype.hasOwnProperty.call(input, 'aiInsights')) {
			if (!Array.isArray(input.aiInsights)) {
				throw new Error('aiInsights must be an array');
			}
			const blockTextByIndex = await loadMineruBlockTextByIndex(context, state);
			const keptAnnotations = (Array.isArray(state.annotations) ? state.annotations : []).filter((annotation) => !isAiInsightAnnotation(annotation));
			const aiInsights = input.aiInsights
				.slice(0, MAX_AI_INSIGHTS)
				.map((insight, index) => normalizeAiInsight(
					insight,
					index,
					blockTextByIndex.get(Number(insight?.aiInsightSourceBlockIndex)) || '',
				))
				.filter(Boolean);
			state.annotations = [...keptAnnotations, ...aiInsights];
		}
		if (Object.prototype.hasOwnProperty.call(input, 'aiInsightMeta')) {
			const aiInsightMeta = normalizeAiInsightMeta(input.aiInsightMeta);
			if (input.aiInsightMeta !== null && !aiInsightMeta) {
				throw new Error('aiInsightMeta must be a valid AI insight metadata object');
			}
			state.aiInsightMeta = aiInsightMeta;
		}
		await writeProjectState(context, state);
		return makeContextPayload(context, state);
	});
}

async function clearAiContext(payload = {}) {
	const context = await resolveProjectContext(payload);
	return withProjectStateWriteLock(context.statePath, async () => {
		const state = await readProjectState(context);
		state.annotations = normalizeContextAnnotations(state.annotations);
		const scope = String(payload.scope || 'all').trim().toLowerCase();
		if (!['outline', 'insights', 'all'].includes(scope)) {
			throw new Error('scope must be outline, insights, or all');
		}
		if (scope === 'outline' || scope === 'all') {
			state.aiOutline = buildClearedAiOutline(payload.language || state.aiOutline?.language);
		}
		if (scope === 'insights' || scope === 'all') {
			state.annotations = (Array.isArray(state.annotations) ? state.annotations : []).filter((annotation) => !isAiInsightAnnotation(annotation));
			state.aiInsightMeta = buildClearedAiInsightMeta(payload.language || state.aiInsightMeta?.language);
		}
		await writeProjectState(context, state);
		return makeContextPayload(context, state);
	});
}

module.exports = {
	briefAiContext,
	buildAiContextBrief,
	clearAiContext,
	getAiInsightColor,
	inspectAiContext,
	isAiInsightAnnotation,
	normalizeAiInsight,
	prepareAiInsights,
	readAiContext,
	resolveProjectContext,
	writeAiContext,
};
