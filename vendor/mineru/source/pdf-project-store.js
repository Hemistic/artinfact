const crypto = require('crypto');
const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');

function requireAiContextRuntimeModule(fileName) {
	const packagedPath = process.resourcesPath
		? path.join(process.resourcesPath, fileName)
		: '';
	if (packagedPath && fsSync.existsSync(packagedPath)) {
		return require(packagedPath);
	}
	return require(`./${fileName}`);
}

const { withProjectStateWriteLock } = requireAiContextRuntimeModule('project-state-lock.js');

const {
	applyNativePdfOutline,
	parseMineruContentTreeFromFile,
} = require('./mineru-content-tree');
const { getNativePdfOutline } = require('./pdf-native-outline');
const {
	buildMineruLayoutMediaGroups,
	normalizeMineruContentListPages,
} = require('./mineru-layout-normalizer');
const {
	AI_OUTLINE_SCHEMA_VERSION,
	normalizeAiOutline,
	normalizeAiOutlineLanguage,
} = requireAiContextRuntimeModule('ai-outline-service.js');
const {
	buildClearedAiInsightMeta,
	normalizeAiInsightMeta,
} = requireAiContextRuntimeModule('ai-insight-service.js');
const {
	getAiInsightColor,
	isAiInsightAnnotation,
	normalizeAiInsight,
} = requireAiContextRuntimeModule('pdfai-context-store.js');

const LAYOUT_ANNOTATIONS_JSON_MAX_BYTES = 100 * 1024 * 1024;
const MAX_STORED_ANNOTATIONS = 10000;
const MAX_STORED_ANNOTATION_TEXT_CHARS = 20000;
const MAX_STORED_ANNOTATION_FIELD_CHARS = 4096;
const MAX_STORED_ANNOTATION_TAGS = 50;
const MAX_STORED_ANNOTATION_RECTS = 4000;
const MAX_STORED_ANNOTATION_PATHS = 1000;
const MAX_STORED_ANNOTATION_PATH_POINTS = 20000;
const MAX_PDF_PAGE_OPERATION_INDEXES = 10000;
const MAX_PROJECT_LOOKUP_DIRECTORIES = 5000;
const MAX_ANNOTATION_IMAGE_DATA_URL_CHARS = 20 * 1024 * 1024;
const MAX_ANNOTATION_IMAGE_BYTES = 15 * 1024 * 1024;
const PROJECT_ID_ERROR_PREVIEW_CHARS = 120;
const STATE_RENAME_RETRY_DELAYS_MS = [0, 12, 30, 65, 130, 260, 520, 900];

function bufferToArrayBuffer(buffer) {
	return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function clone(value) {
	if (value === undefined) {
		return undefined;
	}
	return JSON.parse(JSON.stringify(value));
}

function nowISO() {
	return new Date().toISOString();
}

function isRetryableStateRenameError(error) {
	return ['EACCES', 'EBUSY', 'EEXIST', 'EPERM'].includes(String(error?.code || ''));
}

function waitForStateRenameRetry(delayMs) {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function renameStateFileWithRetry(tempPath, statePath) {
	let lastError = null;
	for (const delayMs of STATE_RENAME_RETRY_DELAYS_MS) {
		if (delayMs > 0) {
			await waitForStateRenameRetry(delayMs);
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

function formatErrorForLog(error) {
	return {
		name: error?.name || '',
		code: error?.code || '',
		message: error?.message || String(error),
		stack: error?.stack ? String(error.stack).slice(0, 4000) : '',
	};
}

function normalizeDocumentTitle(value, fallback = '') {
	const normalized = String(value || '').replace(/\s+/g, ' ').trim();
	if (!normalized) {
		return String(fallback || '').trim();
	}
	const lowered = normalized.toLowerCase();
	if (lowered === 'untitled' || lowered === 'unknown') {
		return String(fallback || '').trim();
	}
	return normalized;
}

function isGenericManagedDocumentTitle(value) {
	const normalized = path.basename(String(value || '').trim()).toLowerCase();
	return ['source', 'source.pdf', 'working', 'working.pdf', 'document', 'document.pdf'].includes(normalized);
}

function titleFromMineruArtifactFileName(fileName) {
	const normalized = path.basename(String(fileName || ''))
		.replace(/\.(?:json|md|markdown)$/iu, '')
		.replace(/-mineru$/iu, '')
		.replace(/\s+/g, ' ')
		.trim();
	return normalized && !isGenericManagedDocumentTitle(normalized) ? normalized : '';
}

async function findLegacyMineruDocumentTitle(projectsDir, sourcePath) {
	if (typeof projectsDir !== 'string' || !projectsDir.trim() || typeof sourcePath !== 'string' || !sourcePath.trim()) {
		return '';
	}
	const projectRoot = path.resolve(projectsDir);
	const legacySourcePath = path.resolve(sourcePath);
	if (path.basename(legacySourcePath).toLowerCase() !== 'source.pdf') {
		return '';
	}
	const legacyProjectDir = path.dirname(legacySourcePath);
	const legacyProjectID = normalizeProjectID(path.basename(legacyProjectDir));
	if (
		!legacyProjectID
		|| !isPathInsideDirectory(legacyProjectDir, projectRoot)
		|| path.resolve(path.dirname(legacyProjectDir)) !== projectRoot
	) {
		return '';
	}
	const mineruDir = path.join(legacyProjectDir, 'mineru');
	try {
		const entries = await fs.readdir(mineruDir, { withFileTypes: true });
		const titles = [...new Set(entries
			.filter((entry) => entry.isFile() && /-mineru\.(?:json|md|markdown)$/iu.test(entry.name))
			.map((entry) => titleFromMineruArtifactFileName(entry.name))
			.filter(Boolean))];
		return titles.sort((left, right) => left.localeCompare(right))[0] || '';
	}
	catch {
		return '';
	}
}

function normalizeDocumentAuthor(value, options = {}) {
	const normalized = String(value || '').replace(/\s+/g, ' ').trim();
	if (!normalized) {
		return '';
	}
	const lowered = normalized.toLowerCase();
	if ([
		'unknown',
		'unknown author',
		'untitled',
		'anonymous',
		'n/a',
		'none',
		'null',
		'latex with hyperref',
		'pdftex',
		'xelatex',
		'lualatex',
	].includes(lowered)) {
		return '';
	}
	const title = String(options.title || '').replace(/\s+/g, ' ').trim().toLowerCase();
	if (title && lowered === title) {
		return '';
	}
	const fileStem = String(options.fileStem || '').replace(/\s+/g, ' ').trim().toLowerCase();
	if (fileStem && lowered === fileStem) {
		return '';
	}
	return normalized;
}

function buildPdfDocumentMetadata(rawMetadata, sourcePath = '') {
	const metadata = rawMetadata && typeof rawMetadata === 'object' ? clone(rawMetadata) : {};
	const fileStem = path.parse(sourcePath || '').name || '';
	const title = normalizeDocumentTitle(
		metadata.Title || metadata['dc:title'] || metadata.title,
		path.basename(sourcePath || ''),
	);
	const author = normalizeDocumentAuthor(
		metadata.Author || metadata['dc:creator'] || metadata.author,
		{ title, fileStem },
	);
	return {
		title,
		author,
		raw: metadata,
	};
}

function createID() {
	const alphabet = '23456789ABCDEFGHIJKLMNPQRSTUVWXYZ';
	let id = '';
	for (let i = 0; i < 8; i++) {
		id += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return id;
}

function computeFingerprint(buffer) {
	return crypto.createHash('sha256').update(buffer).digest('hex');
}

const SAFE_PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/u;

function normalizeProjectID(value) {
	const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	return SAFE_PROJECT_ID_PATTERN.test(normalized) ? normalized : '';
}

function isLegacyFingerprintID(value) {
	const candidate = String(value || '').trim();
	return candidate.length === 64 && /^[a-f0-9]{64}$/iu.test(candidate);
}

function previewProjectIDForError(value) {
	const text = String(value || '').trim();
	return text.length > PROJECT_ID_ERROR_PREVIEW_CHARS
		? `${text.slice(0, PROJECT_ID_ERROR_PREVIEW_CHARS)}...`
		: text;
}

function isPathInsideOrSameDirectory(targetPath, parentDir) {
	const resolvedTarget = path.resolve(targetPath);
	const resolvedParent = path.resolve(parentDir);
	if (resolvedTarget === resolvedParent) {
		return true;
	}
	const relativePath = path.relative(resolvedParent, resolvedTarget);
	return !!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function isPathInsideDirectory(targetPath, parentDir) {
	const resolvedTarget = path.resolve(targetPath);
	const resolvedParent = path.resolve(parentDir);
	return resolvedTarget !== resolvedParent && isPathInsideOrSameDirectory(resolvedTarget, resolvedParent);
}

function assertPathInsideOrSameDirectory(targetPath, parentDir, reason) {
	if (!isPathInsideOrSameDirectory(targetPath, parentDir)) {
		throw new Error(`${reason || 'Path'} must stay inside ${parentDir}`);
	}
	return path.resolve(targetPath);
}

function assertPathInsideDirectory(targetPath, parentDir, reason) {
	if (!isPathInsideDirectory(targetPath, parentDir)) {
		throw new Error(`${reason || 'Path'} must stay inside ${parentDir}`);
	}
	return path.resolve(targetPath);
}

function buildRenderCacheFileName(annotationID) {
	const raw = String(annotationID || '').trim();
	if (/^[A-Za-z0-9_.-]+$/u.test(raw) && raw === path.basename(raw)) {
		return `${raw}.png`;
	}
	const digest = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
	return `${digest}.png`;
}

function buildShortProjectID(fingerprint, attempt = 0) {
	const normalizedFingerprint = String(fingerprint || '').trim().toLowerCase();
	if (attempt === 0) {
		return normalizedFingerprint.slice(0, 8);
	}
	return crypto
		.createHash('sha256')
		.update(`${normalizedFingerprint}:${attempt}`)
		.digest('hex')
		.slice(0, 8);
}

function buildMineruArtifactPaths(projectDir, sourcePath) {
	const parsed = path.parse(sourcePath || 'document.pdf');
	const safeBaseName = parsed.name || 'document';
	const outputDir = path.join(projectDir, 'mineru');
	return {
		outputDir,
		markdownPath: path.join(outputDir, `${safeBaseName}-mineru.md`),
		jsonPath: path.join(outputDir, `${safeBaseName}-mineru.json`),
		imagesDir: path.join(outputDir, 'images'),
	};
}

async function resolveJsonFilePath(value, missingMessage) {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(missingMessage || '缺少 JSON 文件路径');
	}
	const filePath = path.resolve(value.trim());
	const stat = await fs.stat(filePath);
	if (!stat.isFile()) {
		throw new Error('JSON 路径不是文件');
	}
	if (path.extname(filePath).toLowerCase() !== '.json') {
		throw new Error('仅支持 JSON 文件');
	}
	return filePath;
}

function normalizeRenderCachePaths(renderCache, projectDir) {
	const nextRenderCache = {};
	const rendersDir = path.join(projectDir, 'renders');
	for (const [annotationID, imagePath] of Object.entries(renderCache || {})) {
		const fileName = path.basename(typeof imagePath === 'string' && imagePath.trim()
			? imagePath
			: `${annotationID}.png`);
		nextRenderCache[annotationID] = path.join(rendersDir, fileName);
	}
	return nextRenderCache;
}

function decodeAnnotationPngDataURL(value) {
	if (typeof value !== 'string' || value.length > MAX_ANNOTATION_IMAGE_DATA_URL_CHARS) {
		return null;
	}
	const match = value.trim().match(/^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/u);
	if (!match) {
		return null;
	}
	const imageBuffer = Buffer.from(match[1].replace(/[\r\n]/gu, ''), 'base64');
	if (!imageBuffer.length || imageBuffer.length > MAX_ANNOTATION_IMAGE_BYTES) {
		return null;
	}
	return imageBuffer;
}

function normalizeStoredMineruArtifacts(value, projectDir, sourcePath) {
	const defaults = buildMineruArtifactPaths(projectDir, sourcePath);
	const normalized = normalizeMineruArtifacts(value, projectDir, sourcePath);
	return {
		...normalized,
		outputDir: defaults.outputDir,
		markdownPath: path.join(defaults.outputDir, path.basename(normalized.markdownPath || defaults.markdownPath)),
		jsonPath: path.join(defaults.outputDir, path.basename(normalized.jsonPath || defaults.jsonPath)),
		imagesDir: path.join(defaults.outputDir, path.basename(normalized.imagesDir || defaults.imagesDir)),
	};
}

function normalizeMineruArtifacts(value, projectDir, sourcePath) {
	const defaults = buildMineruArtifactPaths(projectDir, sourcePath);
	const markdownPath = typeof value?.markdownPath === 'string' && value.markdownPath.trim()
		? value.markdownPath
		: defaults.markdownPath;
	const jsonPath = typeof value?.jsonPath === 'string' && value.jsonPath.trim()
		? value.jsonPath
		: defaults.jsonPath;
	const imagesDir = typeof value?.imagesDir === 'string' && value.imagesDir.trim()
		? value.imagesDir
		: defaults.imagesDir;
	const imageCount = Number.isFinite(Number(value?.imageCount))
		? Math.max(0, Math.floor(Number(value.imageCount)))
		: 0;
	return {
		outputDir: defaults.outputDir,
		markdownPath,
		jsonPath,
		imagesDir,
		imageCount,
		batchId: typeof value?.batchId === 'string' ? value.batchId : '',
		markdownEntryName: typeof value?.markdownEntryName === 'string' ? value.markdownEntryName : '',
		jsonEntryName: typeof value?.jsonEntryName === 'string' ? value.jsonEntryName : '',
		updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : '',
	};
}

async function buildMineruArtifactStatus(store, mineruArtifacts) {
	const [hasMarkdown, hasJson, hasImages] = await Promise.all([
		store._exists(mineruArtifacts.markdownPath),
		store._exists(mineruArtifacts.jsonPath),
		store._exists(mineruArtifacts.imagesDir),
	]);
	return {
		...mineruArtifacts,
		hasMarkdown,
		hasJson,
		hasImages: hasImages && mineruArtifacts.imageCount > 0,
	};
}

function isMineruArtifactFileName(fileName) {
	return typeof fileName === 'string'
		&& fileName === path.basename(fileName)
		&& /-mineru\.(?:json|md|markdown)$/iu.test(fileName);
}

function mineruArtifactStem(fileName) {
	return String(fileName || '').replace(/\.(?:json|md|markdown)$/iu, '');
}

async function findAlternateMineruArtifacts(projectsDir, projectDir, state = {}) {
	const candidateProjectDirs = new Set([path.resolve(projectDir)]);
	const originalSourcePath = typeof state.originalSourcePath === 'string' ? state.originalSourcePath.trim() : '';
	if (originalSourcePath) {
		const legacyProjectDir = path.dirname(path.resolve(originalSourcePath));
		if (isPathInsideDirectory(legacyProjectDir, projectsDir)) {
			candidateProjectDirs.add(legacyProjectDir);
		}
	}

	for (const candidateProjectDir of candidateProjectDirs) {
		const mineruDir = path.join(candidateProjectDir, 'mineru');
		if (!isPathInsideOrSameDirectory(mineruDir, candidateProjectDir)) continue;
		let entries = [];
		try {
			entries = await fs.readdir(mineruDir, { withFileTypes: true });
		}
		catch {
			continue;
		}
		const artifactNames = entries
			.filter((entry) => entry.isFile() && isMineruArtifactFileName(entry.name))
			.map((entry) => entry.name)
			.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
		const jsonName = artifactNames.find((name) => /\.json$/iu.test(name)) || '';
		const markdownName = artifactNames.find((name) => (
			/\.(?:md|markdown)$/iu.test(name)
			&& (!jsonName || mineruArtifactStem(name) === mineruArtifactStem(jsonName))
		)) || artifactNames.find((name) => /\.(?:md|markdown)$/iu.test(name)) || '';
		if (!jsonName && !markdownName) continue;
		return {
			outputDir: mineruDir,
			jsonPath: jsonName ? path.join(mineruDir, jsonName) : '',
			markdownPath: markdownName ? path.join(mineruDir, markdownName) : '',
			isLegacyProject: path.resolve(candidateProjectDir) !== path.resolve(projectDir),
		};
	}
	return null;
}

async function resolveMineruAnalysisArtifacts(store, projectsDir, projectDir, state = {}) {
	let artifacts = normalizeMineruArtifacts(state.mineruArtifacts, projectDir, state.sourcePath);
	let status = await buildMineruArtifactStatus(store, artifacts);
	if (status.hasMarkdown && status.hasJson) {
		return status;
	}

	// Older projects can retain the default source-mineru paths in state.json
	// while the converted pair uses the original paper title. Resolve that pair
	// once here so outline and insight generation read the same document source.
	const alternateArtifacts = await findAlternateMineruArtifacts(projectsDir, projectDir, state);
	if (!alternateArtifacts) {
		return status;
	}
	artifacts = {
		...artifacts,
		...alternateArtifacts,
		imagesDir: alternateArtifacts.imagesDir || artifacts.imagesDir,
	};
	status = await buildMineruArtifactStatus(store, artifacts);
	return {
		...status,
		isAlternateArtifactPair: true,
	};
}

function getSortIndexPrefix(sortIndex) {
	if (typeof sortIndex !== 'string') {
		return null;
	}
	const parts = sortIndex.split('|');
	if (parts.length !== 3) {
		return null;
	}
	return parts;
}

function updateSortIndexPage(sortIndex, pageIndex) {
	const parts = getSortIndexPrefix(sortIndex);
	if (!parts) {
		return sortIndex;
	}
	parts[0] = String(pageIndex).slice(0, 5).padStart(5, '0');
	return parts.join('|');
}

function clampStoredText(value, maxLength = MAX_STORED_ANNOTATION_FIELD_CHARS) {
	const text = typeof value === 'string' ? value : String(value ?? '');
	return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function toFiniteNumber(value, fallback = null) {
	const numberValue = Number(value);
	return Number.isFinite(numberValue) ? numberValue : fallback;
}

function sanitizeStoredRectList(rects) {
	if (!Array.isArray(rects)) {
		return undefined;
	}
	const result = [];
	for (const rect of rects.slice(0, MAX_STORED_ANNOTATION_RECTS)) {
		if (!Array.isArray(rect) || rect.length < 4) {
			continue;
		}
		const nextRect = rect.slice(0, 4).map((value) => toFiniteNumber(value));
		if (nextRect.every((value) => value !== null)) {
			result.push(nextRect);
		}
	}
	return result;
}

function sanitizeStoredPathList(paths) {
	if (!Array.isArray(paths)) {
		return undefined;
	}
	const result = [];
	let remainingPoints = MAX_STORED_ANNOTATION_PATH_POINTS;
	for (const pathPoints of paths.slice(0, MAX_STORED_ANNOTATION_PATHS)) {
		if (!Array.isArray(pathPoints) || remainingPoints <= 0) {
			continue;
		}
		const nextPath = [];
		for (const value of pathPoints) {
			if (nextPath.length >= remainingPoints) {
				break;
			}
			const numberValue = toFiniteNumber(value);
			if (numberValue !== null) {
				nextPath.push(numberValue);
			}
		}
		if (nextPath.length % 2 !== 0) {
			nextPath.pop();
		}
		if (nextPath.length >= 2) {
			result.push(nextPath);
			remainingPoints -= nextPath.length;
		}
	}
	return result;
}

function sanitizeStoredAnnotationPosition(position = {}) {
	if (!position || typeof position !== 'object' || Array.isArray(position)) {
		return null;
	}
	const next = {};
	const pageIndex = Math.floor(toFiniteNumber(position.pageIndex, -1));
	if (pageIndex >= 0) {
		next.pageIndex = pageIndex;
	}
	for (const key of ['width', 'height', 'fontSize', 'rotation']) {
		const value = toFiniteNumber(position[key]);
		if (value !== null) {
			next[key] = value;
		}
	}
	const rects = sanitizeStoredRectList(position.rects);
	if (rects) {
		next.rects = rects;
	}
	const nextPageRects = sanitizeStoredRectList(position.nextPageRects);
	if (nextPageRects) {
		next.nextPageRects = nextPageRects;
	}
	const paths = sanitizeStoredPathList(position.paths);
	if (paths) {
		next.paths = paths;
	}
	return Object.keys(next).length ? next : null;
}

function sanitizeStoredAnnotationTag(tag) {
	if (typeof tag === 'string') {
		const name = clampStoredText(tag.trim(), 200);
		return name ? { name } : null;
	}
	if (!tag || typeof tag !== 'object' || Array.isArray(tag)) {
		return null;
	}
	const name = clampStoredText(tag.name || tag.label || '', 200).trim();
	if (!name) {
		return null;
	}
	const next = { name };
	if (tag.color) {
		next.color = clampStoredText(tag.color, 64);
	}
	return next;
}

function sanitizeStoredAnnotation(annotation = {}) {
	if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation)) {
		return null;
	}
	const next = {};
	for (const [key, value] of Object.entries(annotation)) {
		if (value === undefined || value === null) {
			continue;
		}
		if (key === 'position') {
			const position = sanitizeStoredAnnotationPosition(value);
			if (position) {
				next.position = position;
			}
			continue;
		}
		if (key === 'tags') {
			if (Array.isArray(value)) {
				const tags = value
					.slice(0, MAX_STORED_ANNOTATION_TAGS)
					.map((tag) => sanitizeStoredAnnotationTag(tag))
					.filter(Boolean);
				next.tags = tags;
			}
			continue;
		}
		if (Array.isArray(value)) {
			if (key === 'layoutItemIndices') {
				next[key] = value.slice(0, 2000).map((item) => clampStoredText(item, 80));
			}
			continue;
		}
		if (typeof value === 'string') {
			next[key] = clampStoredText(
				value,
				key === 'text' || key === 'comment' || key === 'highlightText' || key === 'quote'
					? MAX_STORED_ANNOTATION_TEXT_CHARS
					: MAX_STORED_ANNOTATION_FIELD_CHARS,
			);
			continue;
		}
		if (typeof value === 'number') {
			if (Number.isFinite(value)) {
				next[key] = value;
			}
			continue;
		}
		if (typeof value === 'boolean') {
			next[key] = value;
		}
	}
	if (!Object.keys(next).length) {
		return null;
	}
	// Reader components expect every annotation to expose an iterable tag list.
	// Persist an empty list for legacy annotations that never had tags.
	if (!Array.isArray(next.tags)) {
		next.tags = [];
	}
	return next;
}

function sanitizeStoredAnnotations(annotations, limit = MAX_STORED_ANNOTATIONS) {
	if (!Array.isArray(annotations)) {
		return [];
	}
	return annotations
		.slice(0, limit)
		.map((annotation) => sanitizeStoredAnnotation(annotation))
		.filter(Boolean);
}

function sanitizeStoredViewState(viewState = {}) {
	if (!viewState || typeof viewState !== 'object' || Array.isArray(viewState)) {
		return null;
	}
	const next = {};
	for (const key of ['pageIndex', 'pageNumber', 'scrollMode', 'spreadMode']) {
		const value = Math.floor(toFiniteNumber(viewState[key], Number.NaN));
		if (Number.isFinite(value)) {
			next[key] = value;
		}
	}
	for (const key of ['scale', 'top', 'left']) {
		const value = toFiniteNumber(viewState[key]);
		if (value !== null) {
			next[key] = value;
		}
	}
	return Object.keys(next).length ? next : null;
}

function normalizePageIndexes(value) {
	if (!Array.isArray(value)) {
		return [];
	}
	const indexes = [];
	const seen = new Set();
	for (const item of value.slice(0, MAX_PDF_PAGE_OPERATION_INDEXES)) {
		const index = Math.floor(toFiniteNumber(item, -1));
		if (index < 0 || seen.has(index)) {
			continue;
		}
		seen.add(index);
		indexes.push(index);
	}
	return indexes;
}

function normalizeRotationDegrees(value) {
	const degrees = ((Math.floor(toFiniteNumber(value, 0)) % 360) + 360) % 360;
	if (![90, 180, 270].includes(degrees)) {
		throw new Error('Rotation degrees must be 90, 180, or 270');
	}
	return degrees;
}

function ensureAnnotationIDs(annotations, origin) {
	return sanitizeStoredAnnotations(annotations).map((annotation) => ({
		...annotation,
		id: annotation.id || createID(),
		projectOrigin: annotation.projectOrigin || origin || 'local',
	}));
}

function mergeAnnotations(baseAnnotations, updates) {
	const merged = new Map(baseAnnotations.map((annotation) => [annotation.id, annotation]));
	for (const annotation of updates) {
		merged.set(annotation.id, annotation);
	}
	return [...merged.values()]
		.sort((a, b) => (a.sortIndex > b.sortIndex) - (a.sortIndex < b.sortIndex))
		.slice(0, MAX_STORED_ANNOTATIONS);
}

function deleteAnnotationIDs(annotations, ids) {
	const idSet = new Set(ids);
	return annotations.filter((annotation) => !idSet.has(annotation.id));
}

function normalizePageLabel(pageIndex) {
	return String(pageIndex + 1);
}

function padSortIndexSegment(value, length) {
	return String(Math.max(0, Math.floor(Number(value) || 0))).slice(0, length).padStart(length, '0');
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
		Math.max(y1, y2),
	];
}

function getSortIndexForRect(pageMetrics, pageIndex, rect) {
	const pageHeight = Number(pageMetrics?.[pageIndex]?.height || 0);
	const top = Math.max(0, (pageHeight || rect[3] || 0) - rect[3]);
	return [
		padSortIndexSegment(pageIndex, 5),
		padSortIndexSegment(0, 6),
		padSortIndexSegment(top, 5),
	].join('|');
}

function buildLayoutAnnotationComment(item, fallbackLabel) {
	const parts = [];
	const label = String(item?.caption_label || fallbackLabel || '').trim();
	const caption = String(item?.caption_text || '').trim();
	const title = String(item?.title_text || '').trim();
	if (label) {
		parts.push(label);
	}
	if (caption) {
		parts.push(caption);
	}
	else if (title) {
		parts.push(title);
	}
	return parts.join('\n');
}

function getBoxFromLayoutItems(items) {
	const boxes = items
		.map((item) => item?.box)
		.filter(Boolean)
		.map((box) => {
			const x1 = Number(box.x);
			const y1 = Number(box.y);
			const x2 = Number(box.x2);
			const y2 = Number(box.y2);
			if (![x1, y1, x2, y2].every(Number.isFinite)) {
				return null;
			}
			return {
				x: Math.min(x1, x2),
				y: Math.min(y1, y2),
				x2: Math.max(x1, x2),
				y2: Math.max(y1, y2),
			};
		})
		.filter(Boolean);
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
		height: y2 - y,
	};
}

function getLayoutItemCaptionLabel(item, kind, fallbackIndex) {
	const prefix = kind === 'figure' ? 'Figure' : 'Table';
	const captionText = [
		item?.caption_label,
		item?.caption_text,
		item?.title_text,
		item?.text,
	].map((value) => String(value || '').trim()).filter(Boolean).join(' ');
	const pattern = kind === 'figure'
		? /\b(Fig(?:ure)?\.?\s*[A-Za-z0-9.-]+)/i
		: /\b(Table\s*[A-Za-z0-9.-]+)/i;
	const match = captionText.match(pattern);
	if (match) {
		return match[1]
			.replace(/^fig\b/i, 'Figure')
			.replace(/^figure/i, 'Figure')
			.replace(/^table/i, 'Table')
			.replace(/\s+/g, ' ')
			.trim();
	}
	return String(item?.caption_label || `${prefix} ${item?.index || fallbackIndex || ''}`).trim();
}

function canMergeLegacyLayoutLabel(label, kind) {
	const normalized = String(label || '').trim();
	if (kind === 'figure') {
		return /\b(?:fig(?:ure)?\.?)\s*[A-Za-z0-9.-]+/i.test(normalized) && !/^figure$/i.test(normalized);
	}
	return /\btable\s*[A-Za-z0-9.-]+/i.test(normalized) && !/^table$/i.test(normalized);
}

function groupLegacyLayoutItems(items, kind) {
	const groups = [];
	const labeledGroups = new Map();
	for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
		const label = getLayoutItemCaptionLabel(item, kind, index + 1);
		const mergeKey = canMergeLegacyLayoutLabel(label, kind) ? label.toLowerCase() : '';
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
			caption_text: representative.caption_text || group.items.map((item) => item.caption_text).filter(Boolean).join(' '),
			layoutItemCount: group.items.length,
			layoutItemIndices: group.items.map((item) => item.index).filter((value) => value !== undefined),
			index: representative.index || groupIndex + 1,
		};
	}).filter((item) => item.box);
}

function getLegacyPageItems(page, kind) {
	const directKey = kind === 'figure' ? 'figures' : 'tables';
	if (Array.isArray(page?.[directKey])) {
		return page[directKey];
	}
	const layoutRegions = page?.layout_regions && typeof page.layout_regions === 'object'
		? page.layout_regions
		: {};
	const classNames = kind === 'figure'
		? ['figure']
		: ['table'];
	return classNames.flatMap((className) => Array.isArray(layoutRegions[className])
		? layoutRegions[className].map((region) => ({
			...region,
			index: region.index || region.id,
			caption_label: kind === 'figure' ? `Figure ${region.index || region.id || ''}` : `Table ${region.index || region.id || ''}`,
		}))
		: []);
}

function createLayoutAnnotation({ kind, pageIndex, box, item, color, pageMetrics, sourcePath }) {
	const rect = getRectFromBox(box);
	if (!rect) {
		return null;
	}
	const labelPrefix = kind === 'figure' ? 'Figure' : 'Table';
	return {
		id: createID(),
		type: 'image',
		color,
		pageLabel: normalizePageLabel(pageIndex),
		sortIndex: getSortIndexForRect(pageMetrics, pageIndex, rect),
		position: {
			pageIndex,
			rects: [rect],
		},
		text: String(item?.caption_label || `${labelPrefix} ${item?.index || ''}`).trim(),
		comment: buildLayoutAnnotationComment(item, `${labelPrefix} ${item?.index || ''}`),
		tags: [],
		dateCreated: nowISO(),
		dateModified: nowISO(),
		projectOrigin: 'layout-json',
		layoutKind: kind,
		layoutSourcePath: sourcePath,
		layoutItemCount: item?.layoutItemCount || 1,
		layoutItemIndices: item?.layoutItemIndices || [],
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
			Math.max(normalizedPageHeight - y2, normalizedPageHeight - y1),
		];
	}
	return [
		Math.min(x1, x2),
		Math.min(y1, y2),
		Math.max(x1, x2),
		Math.max(y1, y2),
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
			sourceHeight: pageMaxY,
		};
	}

	return {
		pageBounds,
		documentSourceWidth: documentMaxX,
		documentSourceHeight: documentMaxY,
	};
}

function normalizeContentListExtent(value) {
	const numericValue = Number(value || 0);
	if (!(numericValue > 0)) {
		return 0;
	}
	if (numericValue >= 850 && numericValue <= 1050) {
		return 1000;
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
		(sourceHeight - Math.min(y1, y2)) * scaleY,
	];
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
	return '';
}

function extractContentListLabel(caption, kind) {
	const normalizedCaption = String(caption || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
	if (!normalizedCaption) {
		return kind === 'figure' ? 'Figure' : 'Table';
	}
	const pattern = kind === 'figure'
		? /\b(Figure\s*[A-Za-z0-9.-]*)/i
		: /\b(Table\s*[A-Za-z0-9.-]*)/i;
	const match = normalizedCaption.match(pattern);
	return match?.[1]?.trim() || (kind === 'figure' ? 'Figure' : 'Table');
}

function buildContentListAnnotationComment({ label, caption, footnote }) {
	const parts = [];
	const normalizedLabel = String(label || '').trim();
	const normalizedCaption = String(caption || '').trim();
	const normalizedFootnote = String(footnote || '').trim();
	if (normalizedCaption) {
		parts.push(normalizedCaption);
	}
	else if (normalizedLabel) {
		parts.push(normalizedLabel);
	}
	if (normalizedFootnote) {
		parts.push(normalizedFootnote);
	}
	return parts.join('\n');
}

function createContentListAnnotation({ kind, pageIndex, item, color, pageMetrics, sourcePath, coordinateSpace }) {
	const rect = mapContentListRectToPdfRect(item?.bbox, pageMetrics?.[pageIndex], coordinateSpace, pageIndex);
	if (!rect) {
		return null;
	}
	const content = item?.content || {};
	const caption = kind === 'figure'
		? extractRichText(item?.chart_caption || content.chart_caption || item?.image_caption || content.image_caption)
		: extractRichText(item?.table_caption || content.table_caption);
	const footnote = kind === 'figure'
		? extractRichText(item?.chart_footnote || content.chart_footnote || item?.image_footnote || content.image_footnote)
		: extractRichText(item?.table_footnote || content.table_footnote);
	const label = extractContentListLabel(caption, kind);
	const assetPath = String(item?.img_path || item?.image_path || content?.image_source?.path || content?.img_path || content?.image_path || '').trim();
	return {
		id: createID(),
		type: 'image',
		color,
		pageLabel: normalizePageLabel(pageIndex),
		sortIndex: getSortIndexForRect(pageMetrics, pageIndex, rect),
		position: {
			pageIndex,
			rects: [rect],
		},
		text: label,
		comment: buildContentListAnnotationComment({ label, caption, footnote }),
		tags: [],
		dateCreated: nowISO(),
		dateModified: nowISO(),
		projectOrigin: 'layout-json',
		layoutKind: kind,
		layoutSourcePath: sourcePath,
		layoutAssetPath: assetPath,
	};
}

function createContentListGroupAnnotation({ group, color, pageMetrics, sourcePath, coordinateSpace }) {
	const kind = group.layoutKind === 'table' ? 'table' : 'figure';
	const rect = mapContentListRectToPdfRect(group.bbox, pageMetrics?.[group.pageIndex], coordinateSpace, group.pageIndex);
	if (!rect) {
		return null;
	}
	const caption = String(group.caption || '').trim();
	const label = extractContentListLabel(caption || group.label, kind);
	const assetPath = String(group.imagePaths?.[0] || '').trim();
	return {
		id: createID(),
		type: 'image',
		color,
		pageLabel: normalizePageLabel(group.pageIndex),
		sortIndex: getSortIndexForRect(pageMetrics, group.pageIndex, rect),
		position: {
			pageIndex: group.pageIndex,
			rects: [rect],
		},
		text: label,
		comment: buildContentListAnnotationComment({ label, caption }),
		tags: [],
		dateCreated: nowISO(),
		dateModified: nowISO(),
		projectOrigin: 'layout-json',
		layoutKind: kind,
		layoutSourcePath: sourcePath,
		layoutAssetPath: assetPath,
		layoutBlockIndices: group.blockIndices || [],
		layoutChildBBoxes: group.childBBoxes || [],
		layoutComposite: !!group.isComposite,
	};
}

function extractLayoutAnnotationsFromContentList(parsed, pageMetrics, sourcePath) {
	if (!Array.isArray(parsed)) {
		return [];
	}
	const coordinateSpace = buildContentListCoordinateSpace(parsed);
	const mediaGroups = buildMineruLayoutMediaGroups(parsed);
	if (mediaGroups.length) {
		return mediaGroups
			.map((group) => createContentListGroupAnnotation({
				group,
				color: group.layoutKind === 'figure' ? '#18a0fb' : '#ff5f2e',
				pageMetrics,
				sourcePath,
				coordinateSpace,
			}))
			.filter(Boolean);
	}

	const importedAnnotations = [];
	const pages = normalizeMineruContentListPages(parsed);
	for (const [pageIndex, pageItems] of pages.entries()) {
		if (!Array.isArray(pageItems)) {
			continue;
		}
		for (const item of pageItems) {
			const itemType = String(item?.type || '').trim().toLowerCase();
			if (itemType !== 'image' && itemType !== 'table' && itemType !== 'chart') {
				continue;
			}
			const annotation = createContentListAnnotation({
				kind: itemType === 'table' ? 'table' : 'figure',
				pageIndex,
				item,
				color: itemType === 'table' ? '#ff5f2e' : '#18a0fb',
				pageMetrics,
				sourcePath,
				coordinateSpace,
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
		for (const figure of groupLegacyLayoutItems(getLegacyPageItems(page, 'figure'), 'figure')) {
			const annotation = createLayoutAnnotation({
				kind: 'figure',
				pageIndex,
				box: figure?.box,
				item: figure,
				color: '#18a0fb',
				pageMetrics,
				sourcePath,
			});
			if (annotation) {
				importedAnnotations.push(annotation);
			}
		}
		for (const table of groupLegacyLayoutItems(getLegacyPageItems(page, 'table'), 'table')) {
			const annotation = createLayoutAnnotation({
				kind: 'table',
				pageIndex,
				box: table?.box,
				item: table,
				color: '#ff5f2e',
				pageMetrics,
				sourcePath,
			});
			if (annotation) {
				importedAnnotations.push(annotation);
			}
		}
	}
	return importedAnnotations;
}

function adjustAnnotationsForDeletedPages(annotations, pageIndexes) {
	const deleted = [...new Set(pageIndexes)].sort((a, b) => a - b);
	const deletedSet = new Set(deleted);
	return annotations
		.filter((annotation) => !deletedSet.has(annotation.position?.pageIndex))
		.map((annotation) => {
			const shift = deleted.filter((pageIndex) => pageIndex < annotation.position.pageIndex).length;
			const nextPageIndex = annotation.position.pageIndex - shift;
			return {
				...annotation,
				pageLabel: normalizePageLabel(nextPageIndex),
				sortIndex: updateSortIndexPage(annotation.sortIndex, nextPageIndex),
				position: {
					...annotation.position,
					pageIndex: nextPageIndex,
				},
			};
		});
}

class PdfProjectStore {
	constructor({ projectsDir, pdfWorkerAdapter, logger = console }) {
		if (typeof projectsDir !== 'string' || !projectsDir.trim()) {
			throw new Error('projectsDir is required');
		}
		this._projectsDir = path.resolve(projectsDir);
		this._pdfWorker = pdfWorkerAdapter;
		this._logger = logger || console;
	}

	_log(level, event, payload = {}) {
		const logger = this._logger || console;
		const writer = logger?.[level] || logger?.log || console.log;
		try {
			writer.call(logger, `[pdf-project] ${event}`, payload);
		}
		catch {
			console.log(`[pdf-project] ${event}`, payload);
		}
	}

	async openDocument(filePath) {
		const sourceBuffer = await fs.readFile(filePath);
		const type = path.extname(filePath).toLowerCase() === '.epub' ? 'epub' : 'pdf';
		if (type === 'epub') {
			return {
				type,
				title: path.basename(filePath),
				filePath,
				buf: bufferToArrayBuffer(sourceBuffer),
			};
		}
		return this.openPdfProject(filePath, sourceBuffer);
	}

	async importPdfBuffer({ sourceBuffer, title = '', author = '', metadata = {} } = {}) {
		const source = Buffer.isBuffer(sourceBuffer) ? sourceBuffer : Buffer.from(sourceBuffer || []);
		if (!source.length) {
			throw new Error('PDF buffer is required');
		}
		const stableFileName = 'source.pdf';
		return this.openPdfProject(stableFileName, source, {
			documentTitle: title,
			documentAuthor: author,
			documentMetadata: metadata,
			sourceFileName: stableFileName,
		});
	}

	async openPdfProject(filePath, sourceBuffer = null, options = {}) {
		const startedAt = Date.now();
		this._log('info', 'open:start', {
			filePath,
			projectsDir: this._projectsDir,
			hasSourceBuffer: !!sourceBuffer,
			sourceBufferBytes: sourceBuffer ? Buffer.byteLength(sourceBuffer) : 0,
		});
		await fs.mkdir(this._projectsDir, { recursive: true });
		const source = sourceBuffer || await fs.readFile(filePath);
		const fingerprint = computeFingerprint(source);
		const { projectID, projectDir, statePath } = await this._resolveProjectSlot(fingerprint);
		this._log('info', 'open:slot', {
			filePath,
			projectID,
			projectDir,
			statePath,
			sourceBytes: source.length,
		});
		const requestedSourcePath = path.isAbsolute(String(filePath || ''))
			? path.resolve(filePath)
			: '';
		const resolvedSourcePath = this._assertProjectPath(
			path.join(projectDir, path.basename(options.sourceFileName || 'source.pdf')),
			projectDir,
			'managed source PDF',
		);
		const workingPdfPath = path.join(projectDir, 'working.pdf');
		const rendersDir = path.join(projectDir, 'renders');
		const thumbnailsDir = path.join(projectDir, 'thumbnails');
		const thumbnailPath = path.join(thumbnailsDir, 'page-1.png');

		await fs.mkdir(projectDir, { recursive: true });
		await fs.mkdir(rendersDir, { recursive: true });
		await fs.mkdir(thumbnailsDir, { recursive: true });
		await fs.writeFile(resolvedSourcePath, source);

		let state = await this._readState(statePath);
		const existingDocumentTitle = state?.documentTitle || '';
		if (!state) {
			state = {
				projectID,
				sourcePath: resolvedSourcePath,
				sourceFingerprint: fingerprint,
				workingPdfPath,
				annotations: [],
				viewState: null,
				renderCache: {},
				lastOpenedAt: nowISO(),
				dirty: false,
				embeddedAnnotationsImported: false,
				thumbnailPath,
				mineruArtifacts: normalizeMineruArtifacts(null, projectDir, resolvedSourcePath),
			};
		}
		state = this._normalizeProjectState(state, { projectID, projectDir, sourcePath: resolvedSourcePath, sourceFingerprint: fingerprint });
		if (requestedSourcePath && !isPathInsideOrSameDirectory(requestedSourcePath, projectDir)) {
			state.originalSourcePath = requestedSourcePath;
		}

		if (!await this._exists(workingPdfPath)) {
			await fs.writeFile(workingPdfPath, source);
		}

		state.sourcePath = resolvedSourcePath;
		state.sourceFingerprint = fingerprint;
		state.workingPdfPath = workingPdfPath;
		state.thumbnailPath = thumbnailPath;
		state.lastOpenedAt = nowISO();
		state.mineruArtifacts = normalizeMineruArtifacts(state.mineruArtifacts, projectDir, resolvedSourcePath);
		const metadataSourcePath = state.originalSourcePath || requestedSourcePath || resolvedSourcePath;
		const documentMetadata = await this._extractPdfDocumentMetadata(source, metadataSourcePath);
		const metadataOverride = options.documentMetadata && typeof options.documentMetadata === 'object'
			? clone(options.documentMetadata)
			: {};
		const configuredDocumentTitle = normalizeDocumentTitle(options.documentTitle, '');
		const preservedDocumentTitle = normalizeDocumentTitle(existingDocumentTitle, '');
		const metadataDocumentTitle = normalizeDocumentTitle(documentMetadata.title, '');
		const preferredDocumentTitle = [
			configuredDocumentTitle,
			preservedDocumentTitle,
			metadataDocumentTitle,
		].find((title) => title && !isGenericManagedDocumentTitle(title)) || '';
		const legacyMineruDocumentTitle = preferredDocumentTitle
			? ''
			: await findLegacyMineruDocumentTitle(
				this._projectsDir,
				state.originalSourcePath || requestedSourcePath || resolvedSourcePath,
			);
		state.documentTitle = normalizeDocumentTitle(
			preferredDocumentTitle || legacyMineruDocumentTitle,
			metadataDocumentTitle || path.basename(metadataSourcePath || resolvedSourcePath),
		);
		state.documentAuthor = normalizeDocumentAuthor(options.documentAuthor, {
			title: state.documentTitle,
			fileStem: path.parse(resolvedSourcePath || '').name || '',
		}) || documentMetadata.author;
		state.documentMetadata = {
			...documentMetadata.raw,
			...metadataOverride,
		};

		if (!state.embeddedAnnotationsImported) {
			try {
				const embedded = await this._importEmbeddedAnnotations(source, []);
				state.annotations = mergeAnnotations(
					ensureAnnotationIDs(state.annotations || [], 'local'),
					ensureAnnotationIDs(embedded, 'embedded'),
				);
				this._log('info', 'open:embedded-annotations', {
					projectID,
					imported: embedded.length,
				});
			}
			catch (error) {
				state.annotations = ensureAnnotationIDs(state.annotations || [], null);
				state.embeddedAnnotationsImportError = {
					at: nowISO(),
					...formatErrorForLog(error),
				};
				this._log('warn', 'open:embedded-annotations-failed', {
					projectID,
					filePath: resolvedSourcePath,
					error: formatErrorForLog(error),
				});
			}
			state.embeddedAnnotationsImported = true;
		}
		else {
			state.annotations = ensureAnnotationIDs(state.annotations || [], null);
		}

		try {
			await this._ensureProjectThumbnail({
				projectID,
				thumbnailPath,
				workingBuffer: source,
			});
		}
		catch (error) {
			// Thumbnail generation is best-effort; document open must not fail because
			// the current runtime lacks OffscreenCanvas support.
			console.warn('Failed to generate project thumbnail during open', error);
		}

		await this._writeState(statePath, state);
		this._log('info', 'open:payload:start', {
			projectID,
			filePath: resolvedSourcePath,
		});
		const payload = await this._buildProjectPayload(state, projectDir, {
			sourceBuffer: source,
		});
		this._log('info', 'open:done', {
			projectID,
			filePath: resolvedSourcePath,
			elapsedMs: Date.now() - startedAt,
		});
		return payload;
	}

	async savePdfProject({ projectID, sourcePath, annotations, viewState, dirty }) {
		let loadedProject;
		try {
			loadedProject = await this._loadProject(projectID);
		}
		catch (error) {
			const normalizedSourcePath = typeof sourcePath === 'string' ? sourcePath.trim() : '';
			if (!normalizedSourcePath) {
				throw error;
			}
			const reopened = await this.openPdfProject(normalizedSourcePath);
			loadedProject = await this._loadProject(reopened?.projectMeta?.id || projectID);
		}
		let { state, statePath, projectDir, rendersDir } = loadedProject;
		if (annotations) {
			state.renderCache = await this._persistAnnotationImagesToRenderCache({
				projectDir,
				rendersDir,
				annotations,
				existingRenderCache: state.renderCache,
			});
		}
		await withProjectStateWriteLock(statePath, async () => {
			const latestState = await this._readState(statePath) || state;
			const latestAiInsights = ensureAnnotationIDs(
				(Array.isArray(latestState.annotations) ? latestState.annotations : [])
					.filter(isAiInsightAnnotation),
				null,
			);
			if (annotations) {
				const incomingAnnotations = ensureAnnotationIDs(annotations, null);
				// AI analysis can be written by the sidebar's external CLI while this
				// Reader tab still holds an older annotation snapshot. A regular Reader
				// save must never erase those managed annotations. Dedicated AI actions
				// (saveAiInsights/clearAiInsights) remain the only code paths that alter
				// the persisted insight set.
				state.annotations = [
					...incomingAnnotations.filter((annotation) => !isAiInsightAnnotation(annotation)),
					...latestAiInsights,
				];
			}
			else {
				state.annotations = ensureAnnotationIDs(latestState.annotations || [], null);
			}
			state.aiOutline = normalizeAiOutline(latestState.aiOutline);
			state.aiInsightMeta = normalizeAiInsightMeta(latestState.aiInsightMeta);
			if (viewState !== undefined) {
				state.viewState = sanitizeStoredViewState(viewState);
			}
			if (dirty !== undefined) {
				state.dirty = !!dirty;
			}
			state.lastOpenedAt = nowISO();
			await this._writeState(statePath, state);
		});
		const mineruArtifactStatus = await resolveMineruAnalysisArtifacts(this, this._projectsDir, projectDir, state);
		return {
			projectMeta: {
				id: state.projectID,
				dirty: !!state.dirty,
				sourcePath: state.sourcePath,
				sourceFingerprint: state.sourceFingerprint,
				projectDir,
				workingPdfPath: state.workingPdfPath,
				thumbnailPath: state.thumbnailPath || '',
				lastOpenedAt: state.lastOpenedAt,
				documentTitle: state.documentTitle || path.basename(state.sourcePath),
				documentAuthor: state.documentAuthor || '',
				documentMetadata: clone(state.documentMetadata || {}),
				aiOutline: clone(state.aiOutline || null),
				aiInsightMeta: clone(normalizeAiInsightMeta(state.aiInsightMeta)),
				mineruArtifacts: clone(mineruArtifactStatus),
			},
		};
	}

	async exportPdf(projectID, targetPath) {
		const { state } = await this._loadProject(projectID);
		const buf = await fs.readFile(state.workingPdfPath);
		const written = await this._pdfWorker.writeAnnotations(
			bufferToArrayBuffer(buf),
			state.annotations || [],
			'',
		);
		await fs.writeFile(targetPath, Buffer.from(written));
		return { filePath: targetPath };
	}

	async getProjectResourceInfo(projectID) {
		const { state, projectDir } = await this._loadProject(projectID);
		const mineruArtifacts = await resolveMineruAnalysisArtifacts(this, this._projectsDir, projectDir, state);
		return {
			projectID: state.projectID,
			projectDir,
			sourcePath: state.sourcePath,
			dirty: !!state.dirty,
			thumbnailPath: state.thumbnailPath || '',
			documentTitle: state.documentTitle || path.basename(state.sourcePath),
			documentAuthor: state.documentAuthor || '',
			documentMetadata: clone(state.documentMetadata || {}),
			aiOutline: clone(state.aiOutline || null),
			aiInsightMeta: clone(normalizeAiInsightMeta(state.aiInsightMeta)),
			mineruArtifacts: clone(mineruArtifacts),
			exists: true,
		};
	}

	async getMineruArtifactPaths(projectID) {
		const { state, projectDir } = await this._loadProject(projectID);
		const mineruArtifacts = normalizeMineruArtifacts(state.mineruArtifacts, projectDir, state.sourcePath);
		await fs.mkdir(mineruArtifacts.outputDir, { recursive: true });
		return mineruArtifacts;
	}

	async getMineruAnalysisArtifacts(projectID) {
		const { state, projectDir } = await this._loadProject(projectID);
		return clone(await resolveMineruAnalysisArtifacts(this, this._projectsDir, projectDir, state));
	}

	async getAiInsightGenerationContext(projectID) {
		const { state, projectDir } = await this._loadProject(projectID);
		const mineruArtifacts = await resolveMineruAnalysisArtifacts(this, this._projectsDir, projectDir, state);
		let pageMetrics = [];
		if (mineruArtifacts.hasMarkdown && mineruArtifacts.hasJson) {
			const workingBuffer = await fs.readFile(state.workingPdfPath);
			const metrics = await this._getPageMetricsSafe(workingBuffer, 'working', state);
			pageMetrics = clone(metrics?.pages || []);
		}
		return {
			projectID: state.projectID,
			projectDir,
			documentTitle: state.documentTitle || path.basename(state.sourcePath),
			mineruArtifacts: clone(mineruArtifacts),
			pageMetrics,
		};
	}

	async refineAiInsightAnnotationRects(projectID, annotations) {
		const candidates = (Array.isArray(annotations) ? annotations : [])
			.filter((annotation) => (
				annotation?.id
				&& annotation?.type === 'highlight'
				&& typeof annotation?.quote === 'string'
				&& annotation.quote.trim().length >= 8
				&& Number.isInteger(Number(annotation?.position?.pageIndex))
			))
			.slice(0, 32);
		if (!candidates.length || typeof this._pdfWorker?.findTextRects !== 'function') {
			return clone(annotations || []);
		}
		const { state } = await this._loadProject(projectID);
		try {
			const workingBuffer = await fs.readFile(state.workingPdfPath);
			const matches = await this._pdfWorker.findTextRects(
				bufferToArrayBuffer(workingBuffer),
				candidates.map((annotation) => ({
					id: annotation.id,
					pageIndex: Number(annotation.position.pageIndex),
					quote: annotation.quote,
				})),
				'',
			);
			const rectsById = new Map((Array.isArray(matches) ? matches : [])
				.filter((match) => match && typeof match.id === 'string' && Array.isArray(match.rects))
				.map((match) => [match.id, match.rects
					.filter((rect) => Array.isArray(rect) && rect.length >= 4 && rect.slice(0, 4).every(Number.isFinite))
					.map((rect) => rect.slice(0, 4).map(Number))]));
			return (annotations || []).map((annotation) => {
				const rects = rectsById.get(annotation?.id);
				if (!rects?.length) {
					return annotation;
				}
				return {
					...annotation,
					position: {
						...annotation.position,
						rects,
					},
				};
			});
		}
		catch (error) {
			this._log('warn', 'ai-insight:quote-rect-refinement-failed', {
				projectID,
				error: formatErrorForLog(error),
			});
			return clone(annotations || []);
		}
	}

	async getAiOutline(projectID) {
		const { state } = await this._loadProject(projectID);
		return clone(normalizeAiOutline(state.aiOutline));
	}

	async getAiAnalysis(projectID) {
		const { state } = await this._loadProject(projectID);
		return {
			aiOutline: clone(normalizeAiOutline(state.aiOutline)),
			aiInsights: clone((state.annotations || [])
				.filter(isAiInsightAnnotation)
				.map((annotation) => ({ ...annotation, color: getAiInsightColor(annotation) }))),
			aiInsightMeta: clone(normalizeAiInsightMeta(state.aiInsightMeta)),
		};
	}

	async saveAiOutline(projectID, aiOutline) {
		const { state, statePath } = await this._loadProject(projectID);
		state.aiOutline = normalizeAiOutline(aiOutline);
		await this._writeState(statePath, state);
		return clone(state.aiOutline);
	}

	async clearAiOutline(projectID, options = {}) {
		const { state, statePath } = await this._loadProject(projectID);
		// Keep a compact tombstone so a cleared note set is not regenerated as
		// soon as the PDF reader is reopened.
		state.aiOutline = {
			schemaVersion: AI_OUTLINE_SCHEMA_VERSION,
			language: normalizeAiOutlineLanguage(options.language),
			status: 'cleared',
			provider: '',
			model: '',
			generationMode: '',
			outlineSource: '',
			sourceFingerprint: '',
			nativeOutlineCount: 0,
			navigationItemCount: 0,
			generatedAt: nowISO(),
			items: [],
		};
		await this._writeState(statePath, state);
		return clone(state.aiOutline);
	}

	async saveAiInsights(projectID, insights, aiInsightMeta = null) {
		const { state, statePath } = await this._loadProject(projectID);
		const normalizedInsights = (Array.isArray(insights) ? insights : [])
			.slice(0, MAX_STORED_ANNOTATIONS)
			.map((insight, index) => normalizeAiInsight(insight, index))
			.filter(Boolean);
		state.annotations = mergeAnnotations(
			(state.annotations || []).filter((annotation) => !isAiInsightAnnotation(annotation)),
			normalizedInsights,
		);
		state.aiInsightMeta = normalizeAiInsightMeta(aiInsightMeta) || {
			...buildClearedAiInsightMeta(aiInsightMeta?.language),
			status: normalizedInsights.length ? 'ready' : 'ready-empty',
		};
		state.dirty = true;
		state.lastOpenedAt = nowISO();
		await this._writeState(statePath, state);
		return {
			annotations: clone(state.annotations),
			aiInsights: clone(state.annotations.filter(isAiInsightAnnotation)),
			aiInsightMeta: clone(state.aiInsightMeta),
		};
	}

	async clearAiInsights(projectID, options = {}) {
		const { state, statePath } = await this._loadProject(projectID);
		const beforeCount = (state.annotations || []).length;
		state.annotations = (state.annotations || []).filter((annotation) => !isAiInsightAnnotation(annotation));
		state.aiInsightMeta = buildClearedAiInsightMeta(options.language || state.aiInsightMeta?.language);
		state.dirty = beforeCount !== state.annotations.length ? true : state.dirty;
		state.lastOpenedAt = nowISO();
		await this._writeState(statePath, state);
		return {
			annotations: clone(state.annotations),
			aiInsights: [],
			aiInsightMeta: clone(state.aiInsightMeta),
		};
	}

	async saveMineruArtifacts(projectID, payload = {}) {
		const { state, statePath, projectDir } = await this._loadProject(projectID);
		state.mineruArtifacts = normalizeStoredMineruArtifacts({
			...state.mineruArtifacts,
			...payload,
			updatedAt: nowISO(),
		}, projectDir, state.sourcePath);
		state.lastOpenedAt = nowISO();
		await this._writeState(statePath, state);
		const mineruArtifacts = await buildMineruArtifactStatus(this, state.mineruArtifacts);
		return {
			projectMeta: {
				id: state.projectID,
				dirty: !!state.dirty,
				sourcePath: state.sourcePath,
				sourceFingerprint: state.sourceFingerprint,
				projectDir,
				workingPdfPath: state.workingPdfPath,
				thumbnailPath: state.thumbnailPath || '',
				lastOpenedAt: state.lastOpenedAt,
				documentTitle: state.documentTitle || path.basename(state.sourcePath),
				documentAuthor: state.documentAuthor || '',
				documentMetadata: clone(state.documentMetadata || {}),
				aiOutline: clone(state.aiOutline || null),
				aiInsightMeta: clone(normalizeAiInsightMeta(state.aiInsightMeta)),
				mineruArtifacts: clone(mineruArtifacts),
			},
			mineruArtifacts: clone(mineruArtifacts),
		};
	}

	async exportMineruArtifact(projectID, kind, targetPath) {
		const { state, projectDir } = await this._loadProject(projectID);
		const mineruArtifacts = normalizeMineruArtifacts(state.mineruArtifacts, projectDir, state.sourcePath);
		const sourcePath = kind === 'json' ? mineruArtifacts.jsonPath : mineruArtifacts.markdownPath;
		await fs.copyFile(sourcePath, targetPath);
		return { filePath: targetPath, sourcePath };
	}

	async getMineruContentTree(projectID) {
		const { state, projectDir } = await this._loadProject(projectID);
		const mineruArtifacts = await resolveMineruAnalysisArtifacts(this, this._projectsDir, projectDir, state);
		const hasMarkdown = !!mineruArtifacts.hasMarkdown;
		const hasJson = !!mineruArtifacts.hasJson;
		if (!hasMarkdown && !hasJson) {
			throw new Error('MinerU Markdown/JSON not found for this project');
		}
		if (mineruArtifacts.isAlternateArtifactPair) {
			this._log('info', 'mineru-content-tree:alternate-artifacts', {
				projectID: state.projectID,
				projectDir,
				artifactDir: mineruArtifacts.outputDir,
				isLegacyProject: mineruArtifacts.isLegacyProject,
			});
		}
		let contentTree = await parseMineruContentTreeFromFile(hasJson ? mineruArtifacts.jsonPath : mineruArtifacts.markdownPath, {
			documentTitle: state.documentTitle || path.parse(state.sourcePath || mineruArtifacts.markdownPath || mineruArtifacts.jsonPath).name || 'Document',
			markdownPath: hasMarkdown ? mineruArtifacts.markdownPath : '',
			layoutAnnotations: state.annotations || [],
		});
		for (const pdfPath of [state.sourcePath, state.workingPdfPath]) {
			if (!pdfPath || !await this._exists(pdfPath)) continue;
			try {
				const nativeOutline = await getNativePdfOutline(pdfPath);
				contentTree = applyNativePdfOutline(contentTree, nativeOutline);
				break;
			}
			catch (error) {
				this._log('debug', 'mineru-content-tree:native-outline-failed', {
					projectID: state.projectID,
					filePath: pdfPath,
					error: formatErrorForLog(error),
				});
			}
		}
		return contentTree;
	}

	async deleteProjectResources(projectID) {
		const { state, projectDir } = await this._loadProject(projectID);
		const safeProjectDir = this._assertProjectDir(projectDir, 'project resource directory');
		if (normalizeProjectID(state.projectID) !== normalizeProjectID(projectID)) {
			throw new Error('Project identity mismatch; refusing resource deletion');
		}
		await fs.rm(safeProjectDir, { recursive: true, force: true });
		return { removed: true, projectDir: safeProjectDir };
	}

	async saveProjectThumbnail(projectID, imageBuffer) {
		const { state, statePath, projectDir } = await this._loadProject(projectID);
		const thumbnailPath = this._assertProjectPath(
			state.thumbnailPath || path.join(projectDir, 'thumbnails', 'page-1.png'),
			projectDir,
			'project thumbnail path',
		);
		await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
		await fs.writeFile(thumbnailPath, imageBuffer);
		state.thumbnailPath = thumbnailPath;
		await this._writeState(statePath, state);
		return {
			projectID: state.projectID,
			thumbnailPath,
		};
	}

	async exportFulltext(projectID, targetPath) {
		const { state } = await this._loadProject(projectID);
		const buf = await fs.readFile(state.workingPdfPath);
		const data = await this._pdfWorker.getFulltext(bufferToArrayBuffer(buf), null, '');
		await fs.writeFile(targetPath, data.text, 'utf8');
		return { filePath: targetPath, extractedPages: data.extractedPages, totalPages: data.totalPages };
	}

	async exportRecognizerData(projectID, targetPath) {
		const { state } = await this._loadProject(projectID);
		const buf = await fs.readFile(state.workingPdfPath);
		const data = await this._pdfWorker.getRecognizerData(bufferToArrayBuffer(buf), '');
		await fs.writeFile(targetPath, JSON.stringify(data, null, 2), 'utf8');
		return { filePath: targetPath };
	}

	async rotatePdfPages(projectID, pageIndexes, degrees) {
		const { state, statePath, projectDir } = await this._loadProject(projectID);
		const safePageIndexes = normalizePageIndexes(pageIndexes);
		if (!safePageIndexes.length) {
			throw new Error('No valid PDF pages were selected for rotation');
		}
		const safeDegrees = normalizeRotationDegrees(degrees);
		const buf = await fs.readFile(state.workingPdfPath);
		const nextBuffer = await this._pdfWorker.rotatePages(bufferToArrayBuffer(buf), safePageIndexes, safeDegrees, '');
		await fs.writeFile(state.workingPdfPath, Buffer.from(nextBuffer));
		state.dirty = true;
		state.lastOpenedAt = nowISO();
		await this._writeState(statePath, state);
		return this._buildProjectPayload(state, projectDir);
	}

	async deletePdfPages(projectID, pageIndexes) {
		const { state, statePath, projectDir } = await this._loadProject(projectID);
		const safePageIndexes = normalizePageIndexes(pageIndexes);
		if (!safePageIndexes.length) {
			throw new Error('No valid PDF pages were selected for deletion');
		}
		const buf = await fs.readFile(state.workingPdfPath);
		const nextBuffer = await this._pdfWorker.deletePages(bufferToArrayBuffer(buf), safePageIndexes, '');
		await fs.writeFile(state.workingPdfPath, Buffer.from(nextBuffer));
		state.annotations = adjustAnnotationsForDeletedPages(state.annotations || [], safePageIndexes);
		state.dirty = true;
		state.lastOpenedAt = nowISO();
		await this._writeState(statePath, state);
		return this._buildProjectPayload(state, projectDir);
	}

	async reloadEmbeddedAnnotations(projectID) {
		const { state, statePath, projectDir } = await this._loadProject(projectID);
		const source = await fs.readFile(state.sourcePath);
		const existingEmbedded = (state.annotations || []).filter((annotation) => annotation.projectOrigin === 'embedded');
		const { imported, deleted } = await this._pdfWorker.importAnnotations(
			bufferToArrayBuffer(source),
			clone(existingEmbedded),
			'',
			false,
		);
		let annotations = deleteAnnotationIDs(state.annotations || [], deleted || []);
		annotations = mergeAnnotations(
			annotations,
			ensureAnnotationIDs(imported || [], 'embedded'),
		);
		state.annotations = annotations;
		state.lastOpenedAt = nowISO();
		await this._writeState(statePath, state);
		return this._buildProjectPayload(state, projectDir);
	}

	async discardLocalChanges(projectID) {
		const { state, statePath, projectDir } = await this._loadProject(projectID);
		const source = await fs.readFile(state.sourcePath);
		await fs.writeFile(state.workingPdfPath, source);
		const embedded = await this._importEmbeddedAnnotations(source, []);
		state.annotations = ensureAnnotationIDs(embedded, 'embedded');
		state.dirty = false;
		state.lastOpenedAt = nowISO();
		await this._writeState(statePath, state);
		return this._buildProjectPayload(state, projectDir);
	}

	async importExternalAnnotations(projectID, kind, rawAnnotations) {
		const { state, statePath, projectDir } = await this._loadProject(projectID);
		const buf = await fs.readFile(state.workingPdfPath);
		const method = kind === 'citavi'
			? this._pdfWorker.importCitaviAnnotations.bind(this._pdfWorker)
			: this._pdfWorker.importMendeleyAnnotations.bind(this._pdfWorker);
		const imported = await method(bufferToArrayBuffer(buf), rawAnnotations, '');
		state.annotations = mergeAnnotations(
			state.annotations || [],
			ensureAnnotationIDs(imported || [], kind),
		);
		state.dirty = true;
		state.lastOpenedAt = nowISO();
		await this._writeState(statePath, state);
		return this._buildProjectPayload(state, projectDir);
	}

	async importLayoutAnnotations(projectID, jsonPath) {
		const { state, statePath, projectDir, rendersDir } = await this._loadProject(projectID);
		const resolvedJsonPath = await resolveJsonFilePath(jsonPath, '缺少布局 JSON 文件路径');
		const jsonStat = await fs.stat(resolvedJsonPath);
		if (!jsonStat.isFile()) {
			throw new Error('布局 JSON 路径不是普通文件');
		}
		if (jsonStat.size > LAYOUT_ANNOTATIONS_JSON_MAX_BYTES) {
			throw new Error(`布局 JSON 过大，最大支持 ${Math.round(LAYOUT_ANNOTATIONS_JSON_MAX_BYTES / 1024 / 1024)}MB`);
		}
		const workingBuffer = await fs.readFile(state.workingPdfPath);
		const workingMetrics = await this._pdfWorker.getPageMetrics(bufferToArrayBuffer(workingBuffer), '');
		const raw = await fs.readFile(resolvedJsonPath, 'utf8');
		const parsed = JSON.parse(raw);
		const pageMetrics = workingMetrics.pages || [];
		const importedAnnotations = Array.isArray(parsed?.pages)
			? extractLayoutAnnotationsFromLegacyJson(parsed, pageMetrics, resolvedJsonPath)
			: extractLayoutAnnotationsFromContentList(parsed, pageMetrics, resolvedJsonPath);

		state.annotations = mergeAnnotations(
			(state.annotations || []).filter((annotation) => annotation.projectOrigin !== 'layout-json'),
			importedAnnotations,
		);
		const validAnnotationIDs = new Set(state.annotations.map((annotation) => annotation.id).filter(Boolean));
		const retainedRenderCache = Object.fromEntries(
			Object.entries(state.renderCache || {}).filter(([annotationID]) => validAnnotationIDs.has(annotationID)),
		);
		const importedRenderCache = await this._renderAnnotationImagesToCache({
			projectID: state.projectID,
			projectDir,
			rendersDir,
			workingBuffer,
			annotations: importedAnnotations,
		});
		state.renderCache = {
			...retainedRenderCache,
			...importedRenderCache,
		};
		state.dirty = true;
		state.lastOpenedAt = nowISO();
		await this._writeState(statePath, state);
		return {
			payload: await this._buildProjectPayload(state, projectDir, { workingBuffer }),
			summary: {
				filePath: resolvedJsonPath,
				figures: importedAnnotations.filter((annotation) => annotation.layoutKind === 'figure').length,
				tables: importedAnnotations.filter((annotation) => annotation.layoutKind === 'table').length,
			},
		};
	}

	async clearLayoutAnnotations(projectID) {
		const { state, statePath, projectDir } = await this._loadProject(projectID);
		const beforeCount = (state.annotations || []).length;
		state.annotations = (state.annotations || []).filter((annotation) => annotation.projectOrigin !== 'layout-json');
		state.dirty = beforeCount !== state.annotations.length ? true : state.dirty;
		state.lastOpenedAt = nowISO();
		await this._writeState(statePath, state);
		return {
			payload: await this._buildProjectPayload(state, projectDir),
			removed: beforeCount - state.annotations.length,
		};
	}

	async renderPdfAnnotations(projectID) {
		const { state, statePath, projectDir, rendersDir } = await this._loadProject(projectID);
		const buf = await fs.readFile(state.workingPdfPath);
		const renderableAnnotations = (state.annotations || []).filter((annotation) => annotation.position);
		const renderCache = await this._renderAnnotationImagesToCache({
			projectID,
			projectDir,
			rendersDir,
			workingBuffer: buf,
			annotations: renderableAnnotations,
		});
		state.renderCache = renderCache;
		state.lastOpenedAt = nowISO();
		await this._writeState(statePath, state);
		return this._buildProjectPayload(state, projectDir);
	}

	async _importEmbeddedAnnotations(sourceBuffer, existingAnnotations) {
		const hasEmbedded = await this._pdfWorker.hasAnnotations(bufferToArrayBuffer(sourceBuffer), '');
		if (!hasEmbedded) {
			return [];
		}
		const { imported } = await this._pdfWorker.importAnnotations(
			bufferToArrayBuffer(sourceBuffer),
			clone(existingAnnotations),
			'',
			false,
		);
		return imported || [];
	}

	async _loadProject(projectID) {
		const normalizedProjectID = normalizeProjectID(projectID);
		let resolved = normalizedProjectID
			? await this._readProjectRecordByID(normalizedProjectID)
			: null;
		if (!resolved && normalizedProjectID) {
			resolved = await this._recoverMissingProjectState(normalizedProjectID);
		}
		if (!resolved && isLegacyFingerprintID(projectID)) {
			resolved = await this._findProjectRecordByFingerprint(projectID);
		}
		if (!resolved?.state) {
			throw new Error(`Project ${previewProjectIDForError(projectID)} not found`);
		}
		const state = this._normalizeProjectState(resolved.state, {
			projectID: resolved.projectID,
			projectDir: resolved.projectDir,
		});
		if (JSON.stringify(state) !== JSON.stringify(resolved.state)) {
			await this._writeState(resolved.statePath, state);
		}
		return {
			projectID: resolved.projectID,
			projectDir: resolved.projectDir,
			rendersDir: path.join(resolved.projectDir, 'renders'),
			statePath: resolved.statePath,
			state,
		};
	}

	async _recoverMissingProjectState(projectID) {
		const normalizedProjectID = normalizeProjectID(projectID);
		if (!normalizedProjectID) {
			return null;
		}
		const projectDir = this._projectDirForID(normalizedProjectID);
		const statePath = this._statePathForProjectDir(projectDir);
		if (await this._exists(statePath)) {
			return null;
		}
		const sourcePath = this._assertProjectPath(
			path.join(projectDir, 'source.pdf'),
			projectDir,
			'recover missing project state source PDF',
		);
		if (!await this._exists(sourcePath)) {
			return null;
		}

		const source = await fs.readFile(sourcePath);
		const sourceFingerprint = computeFingerprint(source);
		// A missing state file is recovered only from the canonical hash-derived
		// directory. This prevents arbitrary workspace folders from becoming projects.
		if (buildShortProjectID(sourceFingerprint) !== normalizedProjectID) {
			return null;
		}

		const workingPdfPath = this._assertProjectPath(
			path.join(projectDir, 'working.pdf'),
			projectDir,
			'recover missing project state working PDF',
		);
		const rendersDir = this._assertProjectPath(
			path.join(projectDir, 'renders'),
			projectDir,
			'recover missing project state renders directory',
		);
		const thumbnailsDir = this._assertProjectPath(
			path.join(projectDir, 'thumbnails'),
			projectDir,
			'recover missing project state thumbnails directory',
		);
		const thumbnailPath = this._assertProjectPath(
			path.join(thumbnailsDir, 'page-1.png'),
			projectDir,
			'recover missing project state thumbnail',
		);
		if (!await this._exists(workingPdfPath)) {
			await fs.writeFile(workingPdfPath, source);
		}
		await Promise.all([
			fs.mkdir(rendersDir, { recursive: true }),
			fs.mkdir(thumbnailsDir, { recursive: true }),
		]);

		const documentMetadata = await this._extractPdfDocumentMetadata(source, sourcePath);
		const legacyMineruDocumentTitle = await findLegacyMineruDocumentTitle(this._projectsDir, sourcePath);
		const documentTitle = normalizeDocumentTitle(
			legacyMineruDocumentTitle || documentMetadata.title,
			path.basename(sourcePath),
		);
		const state = this._normalizeProjectState({
			projectID: normalizedProjectID,
			sourcePath,
			sourceFingerprint,
			workingPdfPath,
			annotations: [],
			viewState: null,
			renderCache: {},
			lastOpenedAt: nowISO(),
			dirty: false,
			embeddedAnnotationsImported: false,
			thumbnailPath,
			documentTitle,
			documentAuthor: normalizeDocumentAuthor(documentMetadata.author, {
				title: documentTitle,
				fileStem: path.parse(sourcePath).name,
			}),
			documentMetadata: documentMetadata.raw,
			mineruArtifacts: normalizeMineruArtifacts(null, projectDir, sourcePath),
		}, {
			projectID: normalizedProjectID,
			projectDir,
			sourcePath,
			sourceFingerprint,
		});
		await this._writeState(statePath, state);
		this._log('info', 'state:recovered', {
			projectID: normalizedProjectID,
			projectDir,
		});
		return {
			projectID: normalizedProjectID,
			projectDir,
			statePath,
			state,
		};
	}

	async _ensureProjectThumbnail({ projectID, thumbnailPath, workingBuffer }) {
		if (!thumbnailPath || await this._exists(thumbnailPath) || typeof OffscreenCanvas === 'undefined') {
			return;
		}
		const pageMetrics = await this._pdfWorker.getPageMetrics(bufferToArrayBuffer(workingBuffer), '');
		const firstPage = pageMetrics?.pages?.[0];
		if (!firstPage?.width || !firstPage?.height) {
			return;
		}
		await this._pdfWorker.renderAnnotations(
			projectID,
			bufferToArrayBuffer(workingBuffer),
			[{
				id: '__thumbnail__',
				type: 'image',
				color: '#000000',
				position: {
					pageIndex: 0,
					rects: [[0, 0, Number(firstPage.width), Number(firstPage.height)]],
				},
			}],
			'',
			async (_libraryID, _annotationKey, imageBuffer) => {
				await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
				await fs.writeFile(thumbnailPath, Buffer.from(imageBuffer));
				return true;
			},
		);
	}

	async _renderAnnotationImagesToCache({ projectID, projectDir, rendersDir, workingBuffer, annotations }) {
		const renderableAnnotations = (Array.isArray(annotations) ? annotations : [])
			.filter((annotation) => annotation?.id && annotation?.position);
		if (!renderableAnnotations.length) {
			return {};
		}
		if (typeof OffscreenCanvas === 'undefined' || typeof FileReader === 'undefined') {
			console.warn('Annotation snapshot rendering is unavailable in this process; reader runtime will generate snapshots');
			return {};
		}
		const safeRendersDir = this._assertProjectPath(rendersDir, projectDir, 'project renders directory');
		await fs.mkdir(safeRendersDir, { recursive: true });
		const renderCache = {};
		const saveRenderedAnnotation = async (_libraryID, annotationKey, imageBuffer) => {
			const filePath = path.join(safeRendersDir, buildRenderCacheFileName(annotationKey));
			await fs.writeFile(filePath, Buffer.from(imageBuffer));
			renderCache[annotationKey] = filePath;
			return true;
		};
		try {
			await this._pdfWorker.renderAnnotations(
				projectID,
				bufferToArrayBuffer(workingBuffer),
				renderableAnnotations,
				'',
				saveRenderedAnnotation,
			);
		}
		catch (error) {
			console.warn('Batch annotation snapshot rendering failed; retrying one annotation at a time', error);
			for (const annotation of renderableAnnotations) {
				if (renderCache[annotation.id]) {
					continue;
				}
				try {
					await this._pdfWorker.renderAnnotations(
						projectID,
						bufferToArrayBuffer(workingBuffer),
						[annotation],
						'',
						saveRenderedAnnotation,
					);
				}
				catch (singleError) {
					console.warn(`Failed to render annotation snapshot ${annotation.id}`, singleError);
				}
			}
		}
		return renderCache;
	}

	async _persistAnnotationImagesToRenderCache({ projectDir, rendersDir, annotations, existingRenderCache }) {
		const safeRendersDir = this._assertProjectPath(rendersDir, projectDir, 'project renders directory');
		await fs.mkdir(safeRendersDir, { recursive: true });
		const validAnnotationIDs = new Set(
			(Array.isArray(annotations) ? annotations : [])
				.map((annotation) => String(annotation?.id || '').trim())
				.filter(Boolean),
		);
		const renderCache = Object.fromEntries(
			Object.entries(existingRenderCache || {})
				.filter(([annotationID]) => validAnnotationIDs.has(annotationID)),
		);
		for (const annotation of Array.isArray(annotations) ? annotations : []) {
			const annotationID = String(annotation?.id || '').trim();
			if (!annotationID) {
				continue;
			}
			const imageBuffer = decodeAnnotationPngDataURL(annotation.image);
			if (!imageBuffer) {
				continue;
			}
			const filePath = path.join(safeRendersDir, buildRenderCacheFileName(annotationID));
			await fs.writeFile(filePath, imageBuffer);
			renderCache[annotationID] = filePath;
		}
		return renderCache;
	}

	async _buildProjectPayload(state, projectDir, options = {}) {
		const workingBuffer = options.workingBuffer || await fs.readFile(state.workingPdfPath);
		const sourceBuffer = options.sourceBuffer || await fs.readFile(state.sourcePath);
		const [sourceMetrics, workingMetrics] = await Promise.all([
			this._getPageMetricsSafe(sourceBuffer, 'source', state),
			this._getPageMetricsSafe(workingBuffer, 'working', state),
		]);
		const annotations = await this._applyRenderCache(state.annotations || [], state.renderCache || {});
		const mineruArtifactStatus = await resolveMineruAnalysisArtifacts(this, this._projectsDir, projectDir, state);
		return {
			type: 'pdf',
			title: state.documentTitle || path.basename(state.sourcePath),
			filePath: state.sourcePath,
			sourceDocument: {
				filePath: state.sourcePath,
				title: state.documentTitle || path.basename(state.sourcePath),
				pageMetrics: clone(sourceMetrics.pages || []),
			},
			workingDocument: {
				filePath: state.workingPdfPath,
				title: state.documentTitle || path.basename(state.sourcePath),
				buf: bufferToArrayBuffer(workingBuffer),
				pageMetrics: clone(workingMetrics.pages || []),
			},
			annotations,
			primaryViewState: clone(state.viewState),
			projectMeta: {
				id: state.projectID,
				dirty: !!state.dirty,
				sourcePath: state.sourcePath,
				originalSourcePath: state.originalSourcePath || '',
				sourceFingerprint: state.sourceFingerprint,
				projectDir,
				workingPdfPath: state.workingPdfPath,
				thumbnailPath: state.thumbnailPath || '',
				lastOpenedAt: state.lastOpenedAt,
				documentTitle: state.documentTitle || path.basename(state.sourcePath),
				documentAuthor: state.documentAuthor || '',
				documentMetadata: clone(state.documentMetadata || {}),
				aiOutline: clone(state.aiOutline || null),
				aiInsightMeta: clone(normalizeAiInsightMeta(state.aiInsightMeta)),
				mineruArtifacts: clone(mineruArtifactStatus),
			},
		};
	}

	async _getPageMetricsSafe(buffer, label, state = {}) {
		try {
			return await this._pdfWorker.getPageMetrics(bufferToArrayBuffer(buffer), '');
		}
		catch (error) {
			this._log('warn', 'page-metrics-failed', {
				label,
				projectID: state.projectID || '',
				filePath: state.sourcePath || '',
				error: formatErrorForLog(error),
			});
			return { pages: [] };
		}
	}

	async _extractPdfDocumentMetadata(buffer, sourcePath) {
		try {
			const recognizerData = await this._pdfWorker.getRecognizerData(bufferToArrayBuffer(buffer), '');
			return buildPdfDocumentMetadata(recognizerData?.metadata, sourcePath);
		}
		catch (error) {
			console.warn('Failed to read PDF metadata, falling back to file name', error);
			return buildPdfDocumentMetadata(null, sourcePath);
		}
	}

	async _applyRenderCache(annotations, renderCache) {
		const nextAnnotations = [];
		for (const annotation of annotations) {
			const imagePath = renderCache[annotation.id];
			if (imagePath && await this._exists(imagePath)) {
				const imageBuffer = await fs.readFile(imagePath);
				nextAnnotations.push({
					...annotation,
					image: `data:image/png;base64,${imageBuffer.toString('base64')}`,
				});
			}
			else {
				nextAnnotations.push(annotation);
			}
		}
		return nextAnnotations;
	}

	_stripTransientState(state) {
		const sourceState = state && typeof state === 'object' ? state : {};
		const nextState = { ...sourceState };
		nextState.projectID = normalizeProjectID(nextState.projectID);
		const annotationsWithoutImages = Array.isArray(sourceState.annotations)
			? sourceState.annotations.map((annotation) => {
				if (!annotation || typeof annotation !== 'object') {
					return annotation;
				}
				const nextAnnotation = { ...annotation };
				delete nextAnnotation.image;
				return nextAnnotation;
			})
			: [];
		nextState.annotations = sanitizeStoredAnnotations(annotationsWithoutImages);
		nextState.viewState = sanitizeStoredViewState(sourceState.viewState);
		nextState.documentMetadata = clone(sourceState.documentMetadata || {});
		nextState.aiOutline = normalizeAiOutline(sourceState.aiOutline);
		nextState.aiInsightMeta = normalizeAiInsightMeta(sourceState.aiInsightMeta);
		return nextState;
	}

	_normalizeProjectState(state, context = {}) {
		const nextState = state && typeof state === 'object' ? { ...state } : {};
		const projectID = normalizeProjectID(context.projectID || nextState.projectID || '');
		const sourcePath = typeof context.sourcePath === 'string' && context.sourcePath.trim()
			? context.sourcePath
			: (typeof nextState.sourcePath === 'string' ? nextState.sourcePath : '');
		const sourceFingerprint = typeof context.sourceFingerprint === 'string' && context.sourceFingerprint.trim()
			? context.sourceFingerprint
			: (typeof nextState.sourceFingerprint === 'string' ? nextState.sourceFingerprint : '');
		const projectDir = context.projectDir
			? this._assertProjectDir(context.projectDir, 'project directory')
			: this._projectDirForID(projectID);
		if (!projectDir) {
			throw new Error('Invalid project ID');
		}
		nextState.projectID = projectID;
		nextState.sourcePath = sourcePath;
		nextState.sourceFingerprint = sourceFingerprint;
		nextState.workingPdfPath = path.join(projectDir, 'working.pdf');
		nextState.thumbnailPath = path.join(projectDir, 'thumbnails', 'page-1.png');
		nextState.renderCache = normalizeRenderCachePaths(nextState.renderCache, projectDir);
		nextState.mineruArtifacts = normalizeStoredMineruArtifacts(nextState.mineruArtifacts, projectDir, sourcePath);
		nextState.annotations = ensureAnnotationIDs(nextState.annotations || [], null)
			.map((annotation) => (isAiInsightAnnotation(annotation)
				? { ...annotation, color: getAiInsightColor(annotation) }
				: annotation));
		nextState.viewState = sanitizeStoredViewState(nextState.viewState);
		nextState.aiOutline = normalizeAiOutline(nextState.aiOutline);
		nextState.aiInsightMeta = normalizeAiInsightMeta(nextState.aiInsightMeta);
		const normalizedMetadata = buildPdfDocumentMetadata(nextState.documentMetadata, sourcePath);
		nextState.documentTitle = normalizeDocumentTitle(
			nextState.documentTitle,
			normalizedMetadata.title || path.basename(sourcePath || ''),
		);
		nextState.documentAuthor = normalizeDocumentAuthor(nextState.documentAuthor, {
			title: nextState.documentTitle,
			fileStem: path.parse(sourcePath || '').name || '',
		}) || normalizedMetadata.author || '';
		nextState.documentMetadata = normalizedMetadata.raw;
		return nextState;
	}

	_projectDirForID(projectID) {
		const normalizedProjectID = normalizeProjectID(projectID);
		if (!normalizedProjectID) {
			return null;
		}
		return this._assertProjectDir(path.join(this._projectsDir, normalizedProjectID), 'project directory');
	}

	_statePathForProjectDir(projectDir) {
		const safeProjectDir = this._assertProjectDir(projectDir, 'project directory');
		return this._assertProjectPath(path.join(safeProjectDir, 'state.json'), safeProjectDir, 'project state path');
	}

	_assertStorePath(targetPath, reason) {
		return assertPathInsideOrSameDirectory(targetPath, this._projectsDir, reason);
	}

	_assertProjectDir(projectDir, reason) {
		return assertPathInsideDirectory(projectDir, this._projectsDir, reason);
	}

	_assertProjectPath(targetPath, projectDir, reason) {
		const safeProjectDir = this._assertProjectDir(projectDir, 'project directory');
		return assertPathInsideOrSameDirectory(targetPath, safeProjectDir, reason);
	}

	async _resolveProjectSlot(fingerprint) {
		const existingRecord = await this._findProjectRecordByFingerprint(fingerprint);
		if (existingRecord) {
			const targetProjectID = await this._findAvailableProjectID(fingerprint);
			if (existingRecord.projectID !== targetProjectID) {
				return this._migrateProjectRecord(existingRecord, targetProjectID, fingerprint);
			}
			return {
				projectID: existingRecord.projectID,
				projectDir: existingRecord.projectDir,
				statePath: existingRecord.statePath,
			};
		}
		const projectID = await this._findAvailableProjectID(fingerprint);
		const projectDir = this._projectDirForID(projectID);
		return {
			projectID,
			projectDir,
			statePath: this._statePathForProjectDir(projectDir),
		};
	}

	async _findAvailableProjectID(fingerprint) {
		for (let attempt = 0; attempt < 256; attempt++) {
			const projectID = buildShortProjectID(fingerprint, attempt);
			const existing = await this._readProjectRecordByID(projectID);
			if (!existing?.state) {
				const projectDir = this._projectDirForID(projectID);
				if (!await this._exists(projectDir)) {
					return projectID;
				}
				continue;
			}
			if (existing.state.sourceFingerprint === fingerprint) {
				return projectID;
			}
		}
		throw new Error(`Unable to allocate short project ID for fingerprint ${fingerprint}`);
	}

	async _readProjectRecordByID(projectID) {
		const normalizedProjectID = normalizeProjectID(projectID);
		if (!normalizedProjectID) {
			return null;
		}
		const projectDir = this._projectDirForID(normalizedProjectID);
		const statePath = this._statePathForProjectDir(projectDir);
		const state = await this._readState(statePath);
		if (!state) {
			for (const entryName of await this._listProjectDirectoryNames()) {
				const candidateProjectDir = this._assertProjectDir(path.join(this._projectsDir, entryName), 'candidate project directory');
				const candidateStatePath = this._statePathForProjectDir(candidateProjectDir);
				const candidateState = await this._readState(candidateStatePath);
				if (!candidateState) {
					continue;
				}
				if (normalizeProjectID(candidateState.projectID) !== normalizedProjectID) {
					continue;
				}
				return {
					projectID: normalizedProjectID,
					projectDir: candidateProjectDir,
					statePath: candidateStatePath,
					state: candidateState,
				};
			}
			return null;
		}
		return {
			projectID: normalizedProjectID,
			projectDir,
			statePath,
			state,
		};
	}

	async _findProjectRecordByFingerprint(fingerprint) {
		for (const entryName of await this._listProjectDirectoryNames()) {
			const projectDir = this._assertProjectDir(path.join(this._projectsDir, entryName), 'candidate project directory');
			const statePath = this._statePathForProjectDir(projectDir);
			const state = await this._readState(statePath);
			if (!state) {
				continue;
			}
			if (state.sourceFingerprint === fingerprint || normalizeProjectID(state.projectID) === normalizeProjectID(fingerprint)) {
				return {
					projectID: normalizeProjectID(state.projectID) || normalizeProjectID(entryName),
					projectDir,
					statePath,
					state,
				};
			}
		}
		const legacyProjectDir = isLegacyFingerprintID(fingerprint)
			? this._assertProjectDir(path.join(this._projectsDir, fingerprint), 'legacy project directory')
			: null;
		if (legacyProjectDir && await this._exists(legacyProjectDir)) {
			const legacyStatePath = this._statePathForProjectDir(legacyProjectDir);
			return {
				projectID: normalizeProjectID(fingerprint),
				projectDir: legacyProjectDir,
				statePath: legacyStatePath,
				state: await this._readState(legacyStatePath) || {
					projectID: fingerprint,
					sourceFingerprint: fingerprint,
				},
			};
		}
		return null;
	}

	async _listProjectDirectoryNames(limit = MAX_PROJECT_LOOKUP_DIRECTORIES) {
		const names = [];
		let dir = null;
		try {
			dir = await fs.opendir(this._projectsDir);
			for await (const entry of dir) {
				if (!entry.isDirectory()) {
					continue;
				}
				names.push(entry.name);
				if (names.length >= limit) {
					break;
				}
			}
		}
		catch {
			return [];
		}
		return names;
	}

	async _migrateProjectRecord(record, targetProjectID, fingerprint) {
		const sourceProjectDir = this._assertProjectDir(record.projectDir, 'source project directory');
		const targetProjectDir = this._projectDirForID(targetProjectID);
		let resolvedProjectDir = targetProjectDir;
		if (path.resolve(sourceProjectDir) !== path.resolve(targetProjectDir)) {
			try {
				await fs.rename(sourceProjectDir, targetProjectDir);
			}
			catch (error) {
				if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') {
					throw error;
				}
				resolvedProjectDir = sourceProjectDir;
			}
		}
		const statePath = this._statePathForProjectDir(resolvedProjectDir);
		const nextState = this._normalizeProjectState(record.state, {
			projectID: targetProjectID,
			projectDir: resolvedProjectDir,
			sourceFingerprint: fingerprint,
		});
		await this._writeState(statePath, nextState);
		return {
			projectID: targetProjectID,
			projectDir: resolvedProjectDir,
			statePath,
		};
	}

	async _readState(statePath) {
		const safeStatePath = this._assertStorePath(statePath, 'project state path');
		if (!await this._exists(safeStatePath)) {
			return null;
		}
		try {
			const raw = await fs.readFile(safeStatePath, 'utf8');
			return JSON.parse(raw);
		}
		catch (error) {
			if (error instanceof SyntaxError) {
				const backupPath = this._assertStorePath(`${safeStatePath}.corrupt-${Date.now()}.json`, 'corrupt project state backup path');
				try {
					await fs.copyFile(safeStatePath, backupPath);
				}
				catch {
					// Best-effort backup only.
				}
				try {
					await fs.rm(safeStatePath, { force: true });
				}
				catch {
					// Ignore cleanup failures and let the caller rebuild from source.
				}
				console.warn(`Discarded corrupt project state: ${safeStatePath}`);
				return null;
			}
			throw error;
		}
	}

	async _writeState(statePath, state) {
		const serializableState = this._stripTransientState(state);
		const safeStatePath = this._assertStorePath(statePath, 'project state path');
		const tempPath = this._assertStorePath(
			path.join(
				path.dirname(safeStatePath),
				`.${path.basename(safeStatePath)}-${process.pid}-${crypto.randomUUID()}.tmp`,
			),
			'temporary project state path',
		);
		try {
			await fs.writeFile(tempPath, JSON.stringify(serializableState, null, 2), 'utf8');
			await renameStateFileWithRetry(tempPath, safeStatePath);
		}
		finally {
			await fs.rm(tempPath, { force: true }).catch(() => {});
		}
	}

	async _exists(targetPath) {
		try {
			await fs.access(targetPath);
			return true;
		}
		catch {
			return false;
		}
	}
}

module.exports = {
	PdfProjectStore,
	findLegacyMineruDocumentTitle,
	isGenericManagedDocumentTitle,
};
