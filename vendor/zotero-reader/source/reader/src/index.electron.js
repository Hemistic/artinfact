import Reader from './common/reader';
import { getTextFromSelectionRanges } from './pdf/selection';
import zoteroFTL from '../locales/en-US/zotero.ftl';
import readerFTL from '../locales/en-US/reader.ftl';
import brandFTL from '../locales/en-US/brand.ftl';
import { lookupSelection as localLookupSelection } from '../../bing_translate_test.mjs';

const DEFAULT_SETTINGS = {
	translationFontSize: 16,
	annotationSidebarFontSize: 14,
	theme: 'light',
	uiLanguage: 'en',
	bailianApiKey: '',
	selectionTranslationEnabled: true,
};

const ANNOTATION_SIDEBAR_FONT_SIZE_MIN = 12;
const ANNOTATION_SIDEBAR_FONT_SIZE_MAX = 18;

const READ_ALOUD_VOICES_STORAGE_KEY = 'electron:readAloudVoices';
const READ_ALOUD_SETTINGS_STORAGE_KEY = 'electron:readAloudSettings';
const BAILIAN_TTS_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const BAILIAN_TTS_MODEL = 'qwen3-tts-instruct-flash';
const BAILIAN_VOICE_NAMES = ['Cherry', 'Ethan', 'Chelsie', 'Serena', 'Dylan', 'Jada', 'Sunny'];
const BAILIAN_VOICE_LOCALES = ['en-US', 'zh-CN'];

let reader = null;
let currentStorageKey = null;
let currentSettings = { ...DEFAULT_SETTINGS };
let currentAnnotations = [];
let currentViewState = null;
let currentDocumentType = null;
let currentDocumentTranslationState = {
	active: false,
	inProgress: false,
	progressPercent: 0,
	stage: '',
	detail: '',
};
let comparePaneStylesInjected = false;
let mainPaneScrollBridgeApplied = false;
let selectionLookupRequestID = 0;
let claudeSelectionSyncTimer = null;
let claudeSelectionSyncRequestID = 0;
let lastPostedClaudeSelectionSignature = '';
const pendingSelectionLookupRequests = new Map();
const CLAUDE_SELECTION_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const CLAUDE_SELECTION_IMAGE_MAX_DIMENSION = 2200;
const CLAUDE_SELECTION_MAX_REFERENCES = 120;
const CLAUDE_SELECTION_REFERENCE_TEXT_MAX_CHARS = 20000;
const EXTERNAL_PDF_NAVIGATION_MAX_RECTS = 128;
const EXTERNAL_PDF_NAVIGATION_MAX_PAGE_INDEX = 100000;

function estimateBase64Bytes(value) {
	const text = String(value || '').replace(/\s+/g, '');
	if (!text) {
		return 0;
	}
	const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
	return Math.max(0, Math.floor(text.length * 3 / 4) - padding);
}

function estimateDataUrlBytes(value) {
	const text = String(value || '');
	const commaIndex = text.indexOf(',');
	if (commaIndex < 0) {
		return text.length;
	}
	const header = text.slice(0, commaIndex).toLowerCase();
	const body = text.slice(commaIndex + 1);
	return header.includes(';base64') ? estimateBase64Bytes(body) : body.length;
}

function getDataUrlMediaType(value) {
	const match = String(value || '').match(/^data:([^;,]+)/i);
	return match ? match[1].toLowerCase() : 'image/png';
}

function loadImageFromDataUrl(dataUrl) {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error('Failed to load annotation image'));
		image.src = dataUrl;
	});
}

async function compressClaudeSelectionImage(dataUrl) {
	if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
		return dataUrl;
	}
	const originalSize = estimateDataUrlBytes(dataUrl);
	if (originalSize > 0 && originalSize <= CLAUDE_SELECTION_IMAGE_MAX_BYTES) {
		return dataUrl;
	}

	try {
		const image = await loadImageFromDataUrl(dataUrl);
		const width = Number(image.naturalWidth || image.width || 0);
		const height = Number(image.naturalHeight || image.height || 0);
		if (!width || !height) {
			return dataUrl;
		}

		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d');
		if (!context) {
			return dataUrl;
		}

		let scale = Math.min(1, CLAUDE_SELECTION_IMAGE_MAX_DIMENSION / Math.max(width, height));
		const qualities = [0.88, 0.78, 0.68, 0.58, 0.48];
		let best = dataUrl;
		for (let attempt = 0; attempt < 6; attempt += 1) {
			const targetWidth = Math.max(1, Math.round(width * scale));
			const targetHeight = Math.max(1, Math.round(height * scale));
			canvas.width = targetWidth;
			canvas.height = targetHeight;
			context.save();
			context.fillStyle = '#fff';
			context.fillRect(0, 0, targetWidth, targetHeight);
			context.drawImage(image, 0, 0, targetWidth, targetHeight);
			context.restore();

			for (const quality of qualities) {
				const candidate = canvas.toDataURL('image/jpeg', quality);
				best = candidate;
				if (estimateDataUrlBytes(candidate) <= CLAUDE_SELECTION_IMAGE_MAX_BYTES) {
					return candidate;
				}
			}
			scale *= 0.82;
		}
		return best;
	}
	catch (error) {
		postClaudeSelectionDebugLog({
			stage: 'reader-annotation-image-compress-failed',
			error: error?.message || String(error),
			originalSize,
		});
		return dataUrl;
	}
}

function normalizeSelectionTranslationProvider(value) {
  if (value === 'google') return 'google';
	const provider = String(value || '').trim().toLowerCase();
	if (provider === 'deepseek-v4-flash' || provider === 'deepseekv4flash') {
		return 'deepseek-v4-flash';
	}
	if (provider === 'sidebar-cli' || provider === 'ai-sidebar-cli' || provider === 'llm') {
		return 'sidebar-cli';
	}
	return 'bing';
}

function buildSelectionLookupPayload(payload = {}) {
	const provider = normalizeSelectionTranslationProvider(currentSettings.selectionTranslationProvider);
	return {
		...(payload || {}),
		provider,
		from: 'auto-detect', to: currentSettings.translationTarget || 'zh-Hans',
		llmModel: currentSettings.selectionLlmModel,
	};
}

async function lookupSelection(payload, { onProgress } = {}) {
	const requestPayload = buildSelectionLookupPayload(payload);
	if (window.electronAPI?.lookupSelection) {
		return window.electronAPI.lookupSelection(requestPayload);
	}
	if (isEmbeddedMode()) {
		const requestId = `selection-${Date.now()}-${selectionLookupRequestID++}`;
		return new Promise((resolve, reject) => {
			// Bing keeps the original 15s budget. LLM selection translation needs longer (~45s).
			const timeoutMs = 120000;
			const timeoutId = window.setTimeout(() => {
				pendingSelectionLookupRequests.delete(requestId);
				reject(new Error('Selection lookup timed out'));
			}, timeoutMs);

			pendingSelectionLookupRequests.set(requestId, {
				resolve,
				reject,
				timeoutId,
				onProgress: typeof onProgress === 'function' ? onProgress : null,
			});

			window.parent.postMessage({
				type: 'electron-reader:lookup-selection-request',
				payload: {
					requestId,
					request: requestPayload,
				},
			}, '*');
		});
	}
	return localLookupSelection(requestPayload);
}

function getEmbeddedParams() {
	return new URLSearchParams(window.location.search);
}

function getEmbeddedPane() {
	return getEmbeddedParams().get('pane') === 'compare' ? 'compare' : 'main';
}

function isComparePaneMode() {
	return isEmbeddedMode() && getEmbeddedPane() === 'compare';
}

function buildBailianVoicesResponse() {
	const voices = {};
	const locales = {};

	for (const locale of BAILIAN_VOICE_LOCALES) {
		const voiceIDs = BAILIAN_VOICE_NAMES.map((voiceName) => `${voiceName}@${locale}`);
		locales[locale] = {
			default: [voiceIDs[0]],
			other: voiceIDs.slice(1),
		};
		for (const voiceName of BAILIAN_VOICE_NAMES) {
			voices[`${voiceName}@${locale}`] = { label: voiceName };
		}
	}

	return {
		standard: [{
			creditsPerMinute: 1,
			segmentGranularity: 'paragraph',
			sentenceDelay: 0,
			voices,
			locales,
		}],
	};
}

function normalizeApiKey(value) {
	return typeof value === 'string' ? value.trim() : '';
}

function loadReadAloudVoices() {
	try {
		return JSON.parse(localStorage.getItem(READ_ALOUD_VOICES_STORAGE_KEY) || '{}');
	}
	catch {
		return {};
	}
}

function saveReadAloudVoices(readAloudVoices) {
	localStorage.setItem(READ_ALOUD_VOICES_STORAGE_KEY, JSON.stringify(readAloudVoices));
}

function loadReadAloudSettings() {
	try {
		const parsed = JSON.parse(localStorage.getItem(READ_ALOUD_SETTINGS_STORAGE_KEY) || '{}');
		return {
			instructions: typeof parsed.instructions === 'string' ? parsed.instructions : '',
		};
	}
	catch {
		return { instructions: '' };
	}
}

function saveReadAloudSettings(settings) {
	localStorage.setItem(READ_ALOUD_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function getReadAloudInstructions() {
	return loadReadAloudSettings().instructions;
}

function setReadAloudInstructions(instructions) {
	saveReadAloudSettings({
		...loadReadAloudSettings(),
		instructions: typeof instructions === 'string' ? instructions : '',
	});
}

function hasBailianApiKey() {
	return Boolean(normalizeApiKey(currentSettings.bailianApiKey));
}

function openShellSettings() {
	if (!isEmbeddedMode()) {
		return;
	}
	window.parent.postMessage({ type: 'electron-reader-open-settings' }, '*');
}

function getBailianLanguageType(locale) {
	return typeof locale === 'string' && locale.toLowerCase().startsWith('zh')
		? 'Chinese'
		: 'English';
}

function getBailianVoiceName(voiceID) {
	return String(voiceID || '').split('@')[0] || 'Cherry';
}

function getBailianSampleText(locale) {
	return typeof locale === 'string' && locale.toLowerCase().startsWith('zh')
		? '欢迎使用 PDF AI Reader 的朗读功能。'
		: 'Welcome to PDF AI Reader read aloud.';
}

async function fetchBailianAudioBlob(text, voice) {
	const apiKey = normalizeApiKey(currentSettings.bailianApiKey);
	if (!apiKey) {
		return { audio: null, error: 'unknown' };
	}

	const instructions = getReadAloudInstructions().trim();
	const payload = {
		model: BAILIAN_TTS_MODEL,
		input: {
			text,
			voice: getBailianVoiceName(voice.id),
			language_type: getBailianLanguageType(voice.locale),
		},
		stream: false,
	};

	if (instructions) {
		payload.instructions = instructions;
		payload.optimize_instructions = true;
	}

	let response;
	try {
		response = await fetch(BAILIAN_TTS_ENDPOINT, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(payload),
		});
	}
	catch {
		return { audio: null, error: 'network' };
	}

	let data;
	try {
		data = await response.json();
	}
	catch {
		return { audio: null, error: response.ok ? 'unknown' : 'network' };
	}

	if (!response.ok) {
		console.error('Bailian TTS request failed', response.status, data);
		return { audio: null, error: response.status >= 500 ? 'network' : 'unknown' };
	}

	const audioURL = data?.output?.audio?.url;
	if (!audioURL) {
		console.error('Bailian TTS response missing audio URL', data);
		return { audio: null, error: 'unknown' };
	}

	try {
		const audioResponse = await fetch(audioURL);
		if (!audioResponse.ok) {
			return { audio: null, error: 'network' };
		}
		return { audio: await audioResponse.blob() };
	}
	catch {
		return { audio: null, error: 'network' };
	}
}

const readAloudRemoteInterface = {
	preferRemoteOnly: true,
	hideTierSelect: true,
	hasAPIKey: () => hasBailianApiKey(),
	openGlobalSettings: () => openShellSettings(),
	getInstructions: () => getReadAloudInstructions(),
	setInstructions: (instructions) => setReadAloudInstructions(instructions),
	async getVoices() {
		return {
			voices: buildBailianVoicesResponse(),
			standardCreditsRemaining: null,
			premiumCreditsRemaining: null,
			devMode: false,
		};
	},
	async getCreditsRemaining() {
		return {
			standardCreditsRemaining: null,
			premiumCreditsRemaining: null,
		};
	},
	async resetCredits() {
		return {
			standardCreditsRemaining: null,
			premiumCreditsRemaining: null,
		};
	},
	async getAudio(segment, voice) {
		const text = segment === 'sample'
			? getBailianSampleText(voice.locale)
			: segment?.text?.trim();
		if (!text) {
			return { audio: null, error: 'unknown' };
		}
		return fetchBailianAudioBlob(text, voice);
	},
};

function notifyShellTheme(theme) {
	if (!isEmbeddedMode()) {
		return;
	}
	window.parent.postMessage({
		type: 'electron-reader-theme-change',
		payload: { theme },
	}, '*');
}

function isEmbeddedMode() {
	const params = getEmbeddedParams();
	return params.get('embedded') === '1' || window.parent !== window;
}

function getAnnotationsStorageKey(storageKey) {
	return `annotations:${storageKey}`;
}

function getViewStateStorageKey(storageKey) {
	return `viewState:${storageKey}`;
}

function postToShell(type, payload) {
	if (!isEmbeddedMode()) {
		return;
	}
	window.parent.postMessage({ type, payload }, '*');
}

function postClaudeSelectionDebugLog(payload) {
	postToShell('electron-reader-debug-log', {
		source: 'claude-selection',
		...payload,
	});
	try {
		console.log('[claude-selection]', JSON.stringify(payload));
	}
	catch {
		// Ignore debug serialization failures.
	}
}

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function normalizeExternalPdfNavigationRect(rect) {
	if (!Array.isArray(rect) || rect.length < 4) {
		return null;
	}
	const [x1, y1, x2, y2] = rect.slice(0, 4).map(Number);
	if (![x1, y1, x2, y2].every(Number.isFinite)) {
		return null;
	}
	const left = Math.min(x1, x2);
	const bottom = Math.min(y1, y2);
	const right = Math.max(x1, x2);
	const top = Math.max(y1, y2);
	return right > left && top > bottom ? [left, bottom, right, top] : null;
}

function normalizeExternalPdfNavigationPosition(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	const pageIndex = Math.floor(Number(value.pageIndex));
	if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex > EXTERNAL_PDF_NAVIGATION_MAX_PAGE_INDEX) {
		return null;
	}
	const rects = Array.isArray(value.rects)
		? value.rects.slice(0, EXTERNAL_PDF_NAVIGATION_MAX_RECTS).map(normalizeExternalPdfNavigationRect).filter(Boolean)
		: [];
	const nextPageRects = Array.isArray(value.nextPageRects)
		? value.nextPageRects.slice(0, EXTERNAL_PDF_NAVIGATION_MAX_RECTS).map(normalizeExternalPdfNavigationRect).filter(Boolean)
		: [];
	const position = { pageIndex, rects };
	if (nextPageRects.length) {
		position.nextPageRects = nextPageRects;
	}
	for (const key of ['width', 'height']) {
		const number = Number(value[key]);
		if (Number.isFinite(number) && number > 0) {
			position[key] = number;
		}
	}
	return position;
}

async function navigateToExternalPdfPosition(payload = {}) {
	const requestId = String(payload?.requestId || '').slice(0, 160);
	const position = normalizeExternalPdfNavigationPosition(payload?.position);
	if (!position) {
		postToShell('electron-reader-anchor-navigation-result', {
			requestId,
			ok: false,
			error: 'Invalid PDF position',
		});
		return;
	}
	if (currentDocumentType !== 'pdf' || !reader || typeof reader.navigate !== 'function') {
		postToShell('electron-reader-anchor-navigation-result', {
			requestId,
			ok: false,
			error: 'PDF reader is not ready',
		});
		return;
	}

	try {
		await reader._primaryView?.initializedPromise;
		const location = position.rects.length || position.nextPageRects?.length
			? { position }
			: { pageIndex: position.pageIndex };
		await reader.navigate(location, {
			block: 'center',
			behavior: 'smooth',
			ifNeeded: false,
		});
		postToShell('electron-reader-anchor-navigation-result', {
			requestId,
			ok: true,
			pageIndex: position.pageIndex,
			rectCount: position.rects.length,
		});
	}
	catch (error) {
		postToShell('electron-reader-anchor-navigation-result', {
			requestId,
			ok: false,
			error: error?.message || String(error),
		});
	}
}

function truncateForLabel(value, maxLength = 18) {
	const text = String(value || '').replace(/\s+/g, ' ').trim();
	if (!text) {
		return '';
	}
	return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function buildClaudeSelectionSignature(selection) {
	return selection ? JSON.stringify(selection) : '';
}

function countNonEmptyLines(text) {
	if (!text) {
		return 0;
	}
	const lines = String(text)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	return lines.length;
}

function getPdfSelectionRanges() {
	const selectionRanges = reader?._primaryView?._selectionRanges;
	return Array.isArray(selectionRanges) ? selectionRanges.filter(Boolean) : [];
}

function normalizeRect(rect) {
	if (!Array.isArray(rect) || rect.length < 4 || rect.some((value) => !Number.isFinite(Number(value)))) {
		return null;
	}
	const [x1, y1, x2, y2] = rect.map(Number);
	return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

function rectsOverlap(left, right, tolerance = 0.5) {
	const a = normalizeRect(left);
	const b = normalizeRect(right);
	return !!a && !!b
		&& a[0] <= b[2] + tolerance
		&& a[2] + tolerance >= b[0]
		&& a[1] <= b[3] + tolerance
		&& a[3] + tolerance >= b[1];
}

function getPositionRectsForPage(position, pageIndex) {
	if (!position || !Number.isInteger(pageIndex)) {
		return [];
	}
	if (Number(position.pageIndex) === pageIndex) {
		return Array.isArray(position.rects) ? position.rects : [];
	}
	if (Number(position.pageIndex) + 1 === pageIndex) {
		return Array.isArray(position.nextPageRects) ? position.nextPageRects : [];
	}
	return [];
}

function getReaderReferencesForSelection(selectionRanges) {
	const primaryView = reader?._primaryView;
	const pdfPages = primaryView?._pdfPages;
	if (!Array.isArray(selectionRanges) || !selectionRanges.length || !pdfPages || typeof pdfPages !== 'object') {
		return { citationTexts: [], citationNumbers: [], citationMarkers: [] };
	}

	const references = new Map();
	const citationNumbers = new Set();
	const citationMarkers = new Set();
	for (const selectionRange of selectionRanges) {
		const pageIndex = Number(selectionRange?.position?.pageIndex);
		if (!Number.isInteger(pageIndex) || !pdfPages[pageIndex]) {
			continue;
		}
		const selectionRects = getPositionRectsForPage(selectionRange.position, pageIndex);
		if (!selectionRects.length) {
			continue;
		}
		const overlays = Array.isArray(pdfPages[pageIndex].overlays) ? pdfPages[pageIndex].overlays : [];
		for (const overlay of overlays) {
			if (overlay?.type !== 'citation') {
				continue;
			}
			const overlayRects = getPositionRectsForPage(overlay.position, pageIndex);
			if (!selectionRects.some((selectionRect) => overlayRects.some((overlayRect) => rectsOverlap(selectionRect, overlayRect)))) {
				continue;
			}
			const marker = Array.isArray(overlay.word)
				? overlay.word.map((char) => char?.c || '').join('').replace(/\s+/g, ' ').trim()
				: '';
			if (marker) {
				citationMarkers.add(marker.slice(0, 500));
			}
			for (const reference of Array.isArray(overlay.references) ? overlay.references : []) {
				const text = String(reference?.text || '')
					.replace(/\s+/g, ' ')
					.trim()
					.slice(0, CLAUDE_SELECTION_REFERENCE_TEXT_MAX_CHARS);
				if (!text) {
					continue;
				}
				const index = Number(reference?.index);
				if (Number.isInteger(index) && index > 0) {
					citationNumbers.add(String(index));
				}
				const key = `${Number.isInteger(index) ? index : ''}\u0000${text.toLowerCase()}`;
				references.set(key, Number.isInteger(index) ? `[${index}] ${text.replace(/^\s*\[?\d+\]?[.)]?\s*/u, '')}` : text);
				if (references.size >= CLAUDE_SELECTION_MAX_REFERENCES) {
					break;
				}
			}
			if (references.size >= CLAUDE_SELECTION_MAX_REFERENCES) {
				break;
			}
		}
		if (references.size >= CLAUDE_SELECTION_MAX_REFERENCES) {
			break;
		}
	}
	return {
		citationTexts: [...references.values()],
		citationNumbers: [...citationNumbers].slice(0, CLAUDE_SELECTION_MAX_REFERENCES),
		citationMarkers: [...citationMarkers].slice(0, CLAUDE_SELECTION_MAX_REFERENCES),
	};
}

function getSelectedAnnotationIDs() {
	return [...new Set([
		...(Array.isArray(reader?._state?.selectedAnnotationIDs)
			? reader._state.selectedAnnotationIDs
			: []),
		...(Array.isArray(reader?._primaryView?._selectedAnnotationIDs)
			? reader._primaryView._selectedAnnotationIDs
			: []),
	].filter(Boolean))];
}

function isVisualAnnotation(annotation) {
	if (!annotation || typeof annotation !== 'object') {
		return false;
	}
	return annotation.type === 'image'
		|| annotation.type === 'ink'
		|| (typeof annotation.image === 'string' && annotation.image.startsWith('data:image/'));
}

function summarizeClaudeAnnotation(annotation) {
	if (!annotation || typeof annotation !== 'object') {
		return null;
	}

	return {
		id: annotation.id || '',
		type: annotation.type || '',
		pageLabel: annotation.pageLabel || '',
		hasInlineImage: typeof annotation.image === 'string' && annotation.image.startsWith('data:'),
		hasComment: Boolean(String(annotation.comment || '').trim()),
		hasText: Boolean(String(annotation.text || '').trim()),
		isVisual: isVisualAnnotation(annotation),
	};
}

function buildPdfTextClaudeSelection() {
	const selectionRanges = getPdfSelectionRanges();
	if (!selectionRanges.length || selectionRanges[0]?.collapsed) {
		return null;
	}

	const selectedText = getTextFromSelectionRanges(selectionRanges).trim();
	if (!selectedText) {
		return null;
	}

	const sortedRanges = selectionRanges
		.slice()
		.sort((left, right) => {
			const leftPage = Number(left?.position?.pageIndex ?? 0);
			const rightPage = Number(right?.position?.pageIndex ?? 0);
			if (leftPage !== rightPage) {
				return leftPage - rightPage;
			}
			return Number(left?.anchorOffset ?? 0) - Number(right?.anchorOffset ?? 0);
		});

	const startPageIndex = Number(sortedRanges[0]?.position?.pageIndex ?? 0);
	const endPageIndex = Number(sortedRanges[sortedRanges.length - 1]?.position?.pageIndex ?? startPageIndex);
	const charCount = [...selectedText].length;
	const lineCount = Math.max(1, countNonEmptyLines(selectedText));
	const readerReferences = getReaderReferencesForSelection(selectionRanges);

	return {
		kind: 'pdf-text',
		selectedText,
		startLine: startPageIndex + 1,
		endLine: endPageIndex + 1,
		startColumn: 1,
		endColumn: Math.max(1, charCount),
		displayLabel: `选择 ${lineCount} 行文字`,
		...(readerReferences.citationTexts.length ? readerReferences : {}),
	};
}

function buildAnnotationSelectionText(annotations, includeFigureHint = false) {
	return annotations.map((annotation, index) => {
		const chunks = [];
		const titleParts = [`批注 ${index + 1}`];
		if (annotation.type) {
			titleParts.push(`类型: ${annotation.type}`);
		}
		if (annotation.pageLabel) {
			titleParts.push(`页码: ${annotation.pageLabel}`);
		}
		chunks.push(titleParts.join(' | '));

		const text = String(annotation.text || '').trim();
		if (text && !(includeFigureHint && isVisualAnnotation(annotation))) {
			chunks.push(`正文:\n${text}`);
		}

		const comment = String(annotation.comment || '').trim();
		if (comment) {
			chunks.push(`批注:\n${comment}`);
		}

		if (includeFigureHint && isVisualAnnotation(annotation)) {
			chunks.push('相关图表截图已随本次选择一并附上。');
		}

		return chunks.join('\n');
	}).join('\n\n');
}

async function ensureAnnotationSelectionImages(annotations) {
	if (!Array.isArray(annotations) || !annotations.length) {
		return annotations;
	}
	const renderer = reader?._primaryView?._pdfRenderer;
	if (!renderer || typeof renderer.renderAnnotationImage !== 'function') {
		return annotations;
	}
	for (const annotation of annotations) {
		if (!isVisualAnnotation(annotation) || typeof annotation.image === 'string' && annotation.image.startsWith('data:image/')) {
			continue;
		}
		try {
			const sourceAnnotation = Array.isArray(reader?._state?.annotations)
				? reader._state.annotations.find((item) => item?.id === annotation.id) || annotation
				: annotation;
			const image = await renderer.renderAnnotationImage(sourceAnnotation);
			if (typeof image === 'string' && image.startsWith('data:image/')) {
				annotation.image = image;
				if (sourceAnnotation && sourceAnnotation !== annotation) {
					sourceAnnotation.image = image;
				}
			}
		}
		catch (error) {
			postClaudeSelectionDebugLog({
				stage: 'reader-annotation-image-render-failed',
				annotationID: annotation?.id || '',
				error: error?.message || String(error),
			});
		}
	}
	return annotations;
}

async function postAnnotationsToWorkspaceNote(annotations) {
	if (!isEmbeddedMode() || !Array.isArray(annotations) || !annotations.length) {
		return;
	}
	const prepared = clone(annotations.slice(0, 24));
	await ensureAnnotationSelectionImages(prepared);
	for (const annotation of prepared) {
		if (typeof annotation?.image === 'string' && annotation.image.startsWith('data:image/')) {
			annotation.image = await compressClaudeSelectionImage(annotation.image);
		}
	}
	postToShell('electron-reader-add-to-workspace-note', {
		annotations: clone(prepared),
	});
}

function postSelectionToWorkspaceNote(selection = {}) {
	if (!isEmbeddedMode() || !selection?.annotation) {
		return;
	}
	postToShell('electron-reader-add-selection-to-workspace-note', {
		annotation: clone(selection.annotation),
		translatedText: typeof selection.translatedText === 'string'
			? selection.translatedText.slice(0, 120000)
			: '',
	});
}

async function buildAnnotationClaudeSelection() {
	const selectedIDs = getSelectedAnnotationIDs();
	if (selectedIDs.length !== 1) {
		if (selectedIDs.length > 1) {
			postClaudeSelectionDebugLog({
				stage: 'reader-skip-multi-annotation-selection',
				selectedAnnotationIDs: selectedIDs,
				selectedAnnotationCount: selectedIDs.length,
			});
		}
		return null;
	}

	const selectedAnnotation = Array.isArray(reader?._state?.annotations)
		? reader._state.annotations.find((annotation) => annotation?.id === selectedIDs[0]) || null
		: null;
	if (!selectedAnnotation) {
		return null;
	}

	const serializedSelection = typeof reader?.getSerializedSelectedAnnotations === 'function'
		? reader.getSerializedSelectedAnnotations(selectedAnnotation, { fromText: false })
		: { annotations: [] };
	const annotations = Array.isArray(serializedSelection?.annotations)
		? serializedSelection.annotations.filter(Boolean)
		: [];
	if (!annotations.length) {
		return null;
	}
	await ensureAnnotationSelectionImages(annotations);

	const firstAnnotation = annotations[0];
	const startLine = Number(firstAnnotation?.position?.pageIndex ?? 0) + 1;
	const attachments = (await Promise.all(annotations
		.filter((annotation) => typeof annotation?.image === 'string' && annotation.image.startsWith('data:'))
		.map(async (annotation) => {
			const originalDataUrl = annotation.image;
			const dataUrl = await compressClaudeSelectionImage(originalDataUrl);
			const mediaType = getDataUrlMediaType(dataUrl);
			const extension = mediaType.split('/')[1] || 'png';
			return {
				annotationId: annotation.id || '',
				name: `annotation-${annotation.id || 'figure'}.${extension === 'jpeg' ? 'jpg' : extension}`,
				dataUrl,
				mediaType,
				mimeType: mediaType,
				size: estimateDataUrlBytes(dataUrl),
				originalSize: estimateDataUrlBytes(originalDataUrl),
			};
		}))).filter((attachment) => attachment?.dataUrl);

	postClaudeSelectionDebugLog({
		stage: 'reader-annotation-selection-analysis',
		selectedAnnotationIDs: selectedIDs,
		annotationCount: annotations.length,
		figureCount: attachments.length,
		attachmentSizes: attachments.map((attachment) => attachment.size || 0),
		attachmentOriginalSizes: attachments.map((attachment) => attachment.originalSize || 0),
		annotations: annotations.map((annotation) => summarizeClaudeAnnotation(annotation)),
	});

	let displayLabel;
	if (attachments.length > 0 && attachments.length === annotations.length) {
		displayLabel = attachments.length === 1 ? '选择图表 1 个' : `选择图表 ${attachments.length} 个`;
	}
	else if (attachments.length > 0) {
		displayLabel = `选择批注 ${annotations.length} 条（含 ${attachments.length} 个图表）`;
	}
	else if (annotations.length > 1) {
		displayLabel = `选择批注 ${annotations.length} 条`;
	}
	else {
		const summary = truncateForLabel(firstAnnotation.comment || firstAnnotation.text || firstAnnotation.pageLabel || firstAnnotation.type || '');
		displayLabel = summary ? `选择批注 ${summary}` : '选择批注';
	}

	const selectedText = buildAnnotationSelectionText(annotations, attachments.length > 0).trim();
	if (!selectedText) {
		return null;
	}

	const selection = {
		kind: attachments.length > 0 ? 'figure-annotation' : 'annotation',
		selectedText,
		startLine,
		endLine: startLine,
		startColumn: 1,
		endColumn: Math.max(1, [...selectedText].length),
		displayLabel,
		annotationID: firstAnnotation?.id || selectedIDs[0] || '',
		selectedAnnotationIDs: selectedIDs,
	};

	if (attachments.length) {
		selection.attachments = attachments;
	}

	return selection;
}

async function buildClaudeSelectionPayload() {
	if (!isEmbeddedMode() || currentDocumentType !== 'pdf' || !reader) {
		return null;
	}

	const annotationSelection = await buildAnnotationClaudeSelection();
	if (annotationSelection) {
		return annotationSelection;
	}

	return buildPdfTextClaudeSelection();
}

async function syncClaudeSelectionToShell(requestId) {
	const selection = await buildClaudeSelectionPayload();
	if (requestId !== claudeSelectionSyncRequestID) {
		return;
	}

	const signature = buildClaudeSelectionSignature(selection);
	if (signature === lastPostedClaudeSelectionSignature) {
		return;
	}

	lastPostedClaudeSelectionSignature = signature;
	postClaudeSelectionDebugLog({
		stage: 'reader-post-selection',
		hasSelection: !!selection,
		kind: selection?.kind || '',
		displayLabel: selection?.displayLabel || '',
		selectedTextLength: selection?.selectedText?.length || 0,
		attachmentsCount: Array.isArray(selection?.attachments) ? selection.attachments.length : 0,
	});
	postToShell('electron-reader-selection-change', {
		selection: selection ? clone(selection) : null,
	});
}

function scheduleClaudeSelectionSync(delay = 0) {
	if (!isEmbeddedMode()) {
		return;
	}

	claudeSelectionSyncRequestID += 1;
	const requestId = claudeSelectionSyncRequestID;
	window.clearTimeout(claudeSelectionSyncTimer);
	claudeSelectionSyncTimer = window.setTimeout(() => {
		window.requestAnimationFrame(() => {
			window.requestAnimationFrame(() => {
				syncClaudeSelectionToShell(requestId).catch((error) => {
					console.error('Failed to sync Claude selection', error);
				});
			});
		});
	}, delay);
}

function resetClaudeSelectionSyncState() {
	window.clearTimeout(claudeSelectionSyncTimer);
	claudeSelectionSyncTimer = null;
	claudeSelectionSyncRequestID += 1;
	lastPostedClaudeSelectionSignature = '';
}

const ANNOTATION_SELECTION_SYNC_DELAY_MS = 220;

async function waitForPrimaryViewReady(timeoutMs = 15000) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		const primaryView = reader?._primaryView;
		if (primaryView?.initializedPromise) {
			await primaryView.initializedPromise;
			return true;
		}
		await new Promise((resolve) => window.setTimeout(resolve, 30));
	}
	return false;
}

function installClaudeSelectionHooks() {
	if (!reader || reader.__claudeSelectionHooksInstalled) {
		return;
	}

	const originalSetSelectedAnnotations = reader.setSelectedAnnotations.bind(reader);
	reader.setSelectedAnnotations = (...args) => {
		const result = originalSetSelectedAnnotations(...args);
		scheduleClaudeSelectionSync(ANNOTATION_SELECTION_SYNC_DELAY_MS);
		return result;
	};

	const originalUpdateState = reader._updateState.bind(reader);
	reader._updateState = (state, init) => {
		const shouldSyncSelection = !!state && (
			Object.prototype.hasOwnProperty.call(state, 'primaryViewSelectionPopup')
			|| Object.prototype.hasOwnProperty.call(state, 'selectedAnnotationIDs')
		);
		const selectionDelay = state && Object.prototype.hasOwnProperty.call(state, 'selectedAnnotationIDs')
			? ANNOTATION_SELECTION_SYNC_DELAY_MS
			: 0;
		const result = originalUpdateState(state, init);
		if (shouldSyncSelection) {
			scheduleClaudeSelectionSync(selectionDelay);
		}
		return result;
	};

	reader.__claudeSelectionHooksInstalled = true;

	const primaryView = reader._primaryView;
	if (primaryView && !primaryView.__claudeSelectionHooksInstalled) {
		const originalSetSelectionRanges = primaryView._setSelectionRanges?.bind(primaryView);
		if (originalSetSelectionRanges) {
			primaryView._setSelectionRanges = (...args) => {
				const result = originalSetSelectionRanges(...args);
				postClaudeSelectionDebugLog({
					stage: 'reader-hook-selection-ranges',
					rangeCount: Array.isArray(primaryView._selectionRanges) ? primaryView._selectionRanges.length : 0,
					collapsed: !!primaryView._selectionRanges?.[0]?.collapsed,
				});
				scheduleClaudeSelectionSync(ANNOTATION_SELECTION_SYNC_DELAY_MS);
				return result;
			};
		}

		const originalSetSelectedAnnotationIDs = primaryView.setSelectedAnnotationIDs?.bind(primaryView);
		if (originalSetSelectedAnnotationIDs) {
			primaryView.setSelectedAnnotationIDs = (...args) => {
				const result = originalSetSelectedAnnotationIDs(...args);
				postClaudeSelectionDebugLog({
					stage: 'reader-hook-selected-annotations',
					selectedAnnotationCount: Array.isArray(primaryView._selectedAnnotationIDs) ? primaryView._selectedAnnotationIDs.length : 0,
				});
				scheduleClaudeSelectionSync(ANNOTATION_SELECTION_SYNC_DELAY_MS);
				return result;
			};
		}

		primaryView.__claudeSelectionHooksInstalled = true;
		postClaudeSelectionDebugLog({
			stage: 'reader-hooks-installed',
			hasPrimaryView: true,
		});
	}
}

function ensureComparePaneStyles() {
	if (!isComparePaneMode() || comparePaneStylesInjected) {
		return;
	}
	comparePaneStylesInjected = true;
	document.body.classList.add('electron-compare-pane');
	document.documentElement.classList.add('electron-compare-pane');
	const style = document.createElement('style');
	style.id = 'electron-compare-pane-style';
	style.textContent = `
		.electron-compare-pane {
			background: var(--material-toolbar) !important;
		}

		.electron-compare-pane .toolbar,
		.electron-compare-pane #sidebarContainer,
		.electron-compare-pane #sidebarResizer {
			display: none !important;
		}

		.electron-compare-pane #split-view,
		.electron-compare-pane .split-view {
			top: 0 !important;
			inset-inline-start: 0 !important;
		}
	`;
	document.head.appendChild(style);
}

async function applyMainPaneScrollBridge() {
	if (!isEmbeddedMode() || isComparePaneMode() || !reader?._primaryView?.initializedPromise) {
		return;
	}

	await reader._primaryView.initializedPromise;
	const viewerContainer = reader._primaryView?._iframeWindow?.document?.getElementById('viewerContainer');
	if (!viewerContainer || viewerContainer.dataset.electronMainScrollBridgeApplied === '1') {
		return;
	}

	viewerContainer.dataset.electronMainScrollBridgeApplied = '1';
	viewerContainer.addEventListener('scroll', () => {
		postToShell('electron-reader-scroll-position-change', {
			left: viewerContainer.scrollLeft,
			top: viewerContainer.scrollTop,
			scrollHeight: viewerContainer.scrollHeight,
			clientHeight: viewerContainer.clientHeight,
		});
	}, { passive: true });
	mainPaneScrollBridgeApplied = true;
}

async function applyComparePaneRuntimeBehavior() {
	if (!isComparePaneMode() || !reader?._primaryView?.initializedPromise) {
		return;
	}

	ensureComparePaneStyles();
	await reader._primaryView.initializedPromise;

	const iframeWindow = reader._primaryView?._iframeWindow;
	const viewerContainer = iframeWindow?.document?.getElementById('viewerContainer');
	if (!viewerContainer || viewerContainer.dataset.electronCompareBehaviorApplied === '1') {
		return;
	}

	viewerContainer.dataset.electronCompareBehaviorApplied = '1';
	const iframeStyle = iframeWindow.document.createElement('style');
	iframeStyle.textContent = `
		#viewerContainer {
			scrollbar-width: none !important;
			overflow: hidden !important;
		}

		#viewerContainer::-webkit-scrollbar {
			width: 0 !important;
			height: 0 !important;
		}
	`;
	iframeWindow.document.head.appendChild(iframeStyle);

	const preventScroll = (event) => {
		event.preventDefault();
	};
	const preventKeys = (event) => {
		if ([
			'ArrowUp',
			'ArrowDown',
			'PageUp',
			'PageDown',
			'Home',
			'End',
			' ',
		].includes(event.key)) {
			event.preventDefault();
		}
	};

	viewerContainer.addEventListener('wheel', preventScroll, { passive: false });
	viewerContainer.addEventListener('touchmove', preventScroll, { passive: false });
	iframeWindow.addEventListener('keydown', preventKeys, true);
}

function mergeAnnotationUpdates(existingAnnotations, updates) {
	const map = new Map(existingAnnotations.map((annotation) => [annotation.id, annotation]));
	for (const update of updates) {
		const current = map.get(update.id) || {};
		const next = { ...current, ...update };
		delete next.onlyTextOrComment;
		map.set(next.id, next);
	}
	return [...map.values()].sort((a, b) => (a.sortIndex > b.sortIndex) - (a.sortIndex < b.sortIndex));
}

function removeAnnotationsByID(existingAnnotations, ids) {
	const idSet = new Set(ids);
	return existingAnnotations.filter((annotation) => !idSet.has(annotation.id));
}

function persistLocalReaderState() {
	if (!currentStorageKey || currentDocumentType === 'pdf') {
		return;
	}
	localStorage.setItem(
		getAnnotationsStorageKey(currentStorageKey),
		JSON.stringify(currentAnnotations),
	);
	localStorage.setItem(
		getViewStateStorageKey(currentStorageKey),
		JSON.stringify(currentViewState),
	);
}

function syncExistingReaderAnnotations(annotations) {
	const deletedIDs = reader._state.annotations
		.filter((annotation) => !annotations.find((candidate) => candidate.id === annotation.id))
		.map((annotation) => annotation.id);
	if (deletedIDs.length) {
		reader.unsetAnnotations(deletedIDs);
	}
	if (annotations.length) {
		reader.setAnnotations(annotations);
	}
}

function normalizeAnnotationSidebarFontSize(value) {
	const fontSize = Math.round(Number(value));
	if (!Number.isFinite(fontSize)) {
		return DEFAULT_SETTINGS.annotationSidebarFontSize;
	}
	return Math.min(
		ANNOTATION_SIDEBAR_FONT_SIZE_MAX,
		Math.max(ANNOTATION_SIDEBAR_FONT_SIZE_MIN, fontSize),
	);
}

function applySettings(settings = {}) {
	currentSettings = {
		...DEFAULT_SETTINGS,
		...currentSettings,
		...settings,
	};
	currentSettings.annotationSidebarFontSize = normalizeAnnotationSidebarFontSize(
		currentSettings.annotationSidebarFontSize,
	);

	document.documentElement.style.setProperty(
		'--selection-translation-font-size',
		`${currentSettings.translationFontSize}px`,
	);
	document.documentElement.style.setProperty(
		'--annotation-sidebar-font-size',
		`${currentSettings.annotationSidebarFontSize}px`,
	);
	document.documentElement.style.setProperty(
		'--annotation-sidebar-meta-font-size',
		`${Math.max(11, currentSettings.annotationSidebarFontSize - 2)}px`,
	);
	document.documentElement.dataset.appTheme = currentSettings.theme;
	document.documentElement.lang = String(currentSettings.uiLanguage || 'en').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';

	if (reader) {
		const uiLanguage = document.documentElement.lang.startsWith('zh') ? 'zh' : 'en';
		if (reader._state.uiLanguage !== uiLanguage) {
			reader._updateState({ uiLanguage });
		}
		reader.setLoggedIn(hasBailianApiKey());
		reader.setSelectionTranslator(window.__codexSelectionTranslator(lookupSelection, currentSettings));
		reader.setColorScheme(currentSettings.theme === 'dark' ? 'dark' : 'light');
		if (currentSettings.theme === 'dark') {
			reader.setDarkTheme('dark');
		}
		else {
			reader.setLightTheme();
		}
	}
}

function handleReaderThemeSelection(themeID, colorScheme) {
	if (!reader) {
		return;
	}

	if (themeID === 'dark') {
		reader.setDarkTheme('dark');
		reader.setColorScheme('dark');
		applySettings({ theme: 'dark' });
		notifyShellTheme('dark');
		return;
	}

	if (!themeID) {
		reader.setLightTheme();
		reader.setColorScheme('light');
		applySettings({ theme: 'light' });
		notifyShellTheme('light');
		return;
	}

	if (colorScheme === 'dark') {
		reader.setDarkTheme(themeID);
	}
	else {
		reader.setLightTheme(themeID);
	}
}

async function initReader(payload) {
	const {
		type,
		buf,
		title,
		storageKey,
		settings,
		workingDocument,
		annotations,
		primaryViewState,
		projectMeta,
		readOnly,
		sidebarOpen,
		sidebarView,
		allowSelectionPopupInReadOnly,
		embeddedPane,
		documentTranslationState,
		aiOutline,
		aiAnalysis,
	} = payload;
	currentDocumentType = type;
	currentStorageKey = projectMeta?.id || storageKey || title;
	applySettings(settings);
	currentDocumentTranslationState = {
		...currentDocumentTranslationState,
		...(documentTranslationState || {}),
	};
	ensureComparePaneStyles();

	if (type === 'pdf') {
		currentAnnotations = clone(annotations || []);
		currentViewState = clone(primaryViewState || null);
	}
	else {
		currentAnnotations = JSON.parse(
			localStorage.getItem(getAnnotationsStorageKey(currentStorageKey)) || '[]',
		);
		currentViewState = JSON.parse(
			localStorage.getItem(getViewStateStorageKey(currentStorageKey)) || 'null',
		);
	}

	const nextData = type === 'pdf'
		? {
			buf: new Uint8Array(workingDocument.buf),
			url: new URL('./', window.location).toString()
		}
		: {
			buf: new Uint8Array(buf),
			url: new URL('./', window.location).toString()
		};

	if (reader && reader._type === type) {
		resetClaudeSelectionSyncState();
		syncExistingReaderAnnotations(currentAnnotations);
		reader._updateState({
			selectedAnnotationIDs: [],
			primaryViewState: currentViewState,
			secondaryViewState: null,
			title: title || 'Document',
			sidebarOpen: sidebarOpen !== undefined ? sidebarOpen : reader._state.sidebarOpen,
			sidebarView: sidebarView || reader._state.sidebarView,
			embeddedPane: embeddedPane || reader._state.embeddedPane || 'main',
			aiOutline: aiOutline || null,
			aiAnalysis: aiAnalysis || {},
			uiLanguage: String(currentSettings.uiLanguage || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en',
		});
		reader.setReadOnly(!!readOnly);
		reader.setDocumentTranslationState(currentDocumentTranslationState);
		reader.reload(nextData);
		const primaryViewReady = await waitForPrimaryViewReady();
		postClaudeSelectionDebugLog({
			stage: 'reader-wait-primary-view',
			ready: primaryViewReady,
			reusedReader: true,
		});
		installClaudeSelectionHooks();
		await applyMainPaneScrollBridge();
		await applyComparePaneRuntimeBehavior();
		applySettings(currentSettings);
		document.title = title || 'ArtInFact';
		scheduleClaudeSelectionSync(50);
		return;
	}

	resetClaudeSelectionSyncState();
	reader = new Reader({
		type,
		ftl: [zoteroFTL, readerFTL, brandFTL],
		readOnly: !!readOnly,
		allowSelectionPopupInReadOnly: !!allowSelectionPopupInReadOnly,
		data: nextData,
		annotations: currentAnnotations,
		primaryViewState: currentViewState,
		sidebarWidth: 280,
		sidebarOpen: sidebarOpen !== undefined ? sidebarOpen : true,
		sidebarView: sidebarView || 'annotations',
		bottomPlaceholderHeight: null,
		toolbarPlaceholderWidth: 0,
		embeddedPane: embeddedPane || 'main',
		authorName: 'User',
		showAnnotations: true,
		title: title || 'Document',
		selectionTranslator: window.__codexSelectionTranslator(lookupSelection, currentSettings),
		documentTranslationState: currentDocumentTranslationState,
		aiOutline: aiOutline || null,
		aiAnalysis: aiAnalysis || {},
		uiLanguage: String(currentSettings.uiLanguage || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en',
		enableReadAloud: true,
		loggedIn: hasBailianApiKey(),
		readAloudRemoteInterface,
		readAloudVoices: loadReadAloudVoices(),
		colorScheme: currentSettings.theme === 'dark' ? 'dark' : 'light',
		autoStartReadAloudOnOpen: true,
		suppressReadAloudFirstRunPopup: true,
		onOpenContextMenu(params) {
			return reader.openContextMenu(params);
		},
		onSaveAnnotations(annotations) {
			currentAnnotations = mergeAnnotationUpdates(currentAnnotations, annotations);
			if (type === 'pdf' && isEmbeddedMode()) {
				postToShell('electron-reader-save-annotations', {
					annotations: clone(annotations),
				});
			}
			else {
				persistLocalReaderState();
			}
			scheduleClaudeSelectionSync(50);
		},
		onDeleteAnnotations(ids) {
			currentAnnotations = removeAnnotationsByID(currentAnnotations, ids);
			if (type === 'pdf' && isEmbeddedMode()) {
				postToShell('electron-reader-delete-annotations', { ids });
			}
			else {
				persistLocalReaderState();
			}
			scheduleClaudeSelectionSync();
		},
		onClearAiOutline() {
			if (type === 'pdf' && isEmbeddedMode()) {
				postToShell('electron-reader-clear-ai-outline', {});
			}
		},
		onClearAiInsights() {
			if (type === 'pdf' && isEmbeddedMode()) {
				postToShell('electron-reader-clear-ai-insights', {});
			}
		},
		onGenerateAiOutline() {
			if (type === 'pdf' && isEmbeddedMode()) {
				postToShell('electron-reader-generate-ai-outline', {});
			}
		},
		onGenerateAiNavigation() {
			if (type === 'pdf' && isEmbeddedMode()) {
				postToShell('electron-reader-generate-ai-navigation', {});
			}
		},
		onGenerateAiInsights() {
			if (type === 'pdf' && isEmbeddedMode()) {
				postToShell('electron-reader-generate-ai-insights', {});
			}
		},
		onChangeViewState(state, primary) {
			if (!primary) {
				return;
			}
			currentViewState = state;
			if (type === 'pdf' && isEmbeddedMode()) {
				postToShell('electron-reader-change-view-state', { state: clone(state) });
			}
			else {
				persistLocalReaderState();
			}
		},
		onSetLightTheme(themeID) {
			handleReaderThemeSelection(themeID, 'light');
		},
		onSetDarkTheme(themeID) {
			handleReaderThemeSelection(themeID, 'dark');
		},
		onSetReadAloudVoice(readAloudVoice) {
			const readAloudVoices = {
				...loadReadAloudVoices(),
				[readAloudVoice.lang]: readAloudVoice,
			};
			saveReadAloudVoices(readAloudVoices);
		},
		onSetReadAloudStatus() {},
		onLogIn() {
			openShellSettings();
		},
		onOpenLink(url) {
			if (isEmbeddedMode()) {
				window.parent.postMessage({
					type: 'electron-reader-open-external',
					payload: { url },
				}, '*');
				return;
			}
			window.open(url, '_blank');
		},
		onToggleSidebar(open) {
			postToShell('electron-reader-sidebar-state-change', {
				open: !!open,
				view: reader?._state.sidebarView || 'annotations',
			});
		},
		onChangeSidebarWidth() {},
		onChangeSidebarView(view) {
			postToShell('electron-reader-sidebar-state-change', {
				open: reader?._state.sidebarOpen ?? true,
				view,
			});
		},
		onConfirm(_title, text) {
			return window.confirm(text);
		},
		onRotatePages(pageIndexes, degrees) {
			postToShell('electron-reader-rotate-pages', { pageIndexes, degrees });
		},
		onDeletePages(pageIndexes) {
			postToShell('electron-reader-delete-pages', { pageIndexes });
		},
		onToggleDocumentTranslation(anchorRect) {
			postToShell('electron-reader-toggle-document-translation', { anchorRect });
		},
		onAddToWorkspaceNote(annotations) {
			void postAnnotationsToWorkspaceNote(annotations).catch((error) => {
				console.error('Failed to prepare annotations for workspace note', error);
			});
		},
		onAddSelectionToWorkspaceNote(selection) {
			postSelectionToWorkspaceNote(selection);
		},
	});

	window._reader = reader;
	const primaryViewReady = await waitForPrimaryViewReady();
	postClaudeSelectionDebugLog({
		stage: 'reader-wait-primary-view',
		ready: primaryViewReady,
		reusedReader: false,
	});
	installClaudeSelectionHooks();
	await applyMainPaneScrollBridge();
	await applyComparePaneRuntimeBehavior();
	applySettings(currentSettings);
	document.title = embeddedPane === 'compare'
		? `${title || 'ArtInFact'} · 对照`
		: (title || 'ArtInFact');
	scheduleClaudeSelectionSync(50);
}

function createWelcome() {
	const welcome = document.createElement('div');
	welcome.id = 'welcome';
	welcome.style.cssText = `
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #10141b;
		color: #d3d8e3;
		font-family: "Segoe UI", sans-serif;
	`;
	welcome.innerHTML = `
		<div style="text-align:center">
			<div style="font-size:60px;margin-bottom:16px">PDF</div>
			<div style="font-size:18px">等待文档载入</div>
		</div>
	`;
	document.body.appendChild(welcome);
}

function setupEmbeddedBridge() {
	window.addEventListener('message', async (event) => {
		if (!event.data || typeof event.data.type !== 'string') {
			return;
		}

		if (event.data.type === 'electron-reader:init') {
			document.getElementById('welcome')?.remove();
			await initReader(event.data.payload);
			return;
		}

		if (event.data.type === 'electron-reader:apply-settings') {
			applySettings(event.data.payload);
			return;
		}

		if (event.data.type === 'electron-reader:apply-document-translation-state') {
			currentDocumentTranslationState = {
				...currentDocumentTranslationState,
				...(event.data.payload || {}),
			};
			reader?.setDocumentTranslationState(currentDocumentTranslationState);
			return;
		}

		if (event.data.type === 'electron-reader:apply-ai-outline') {
			reader?._updateState({ aiOutline: event.data.payload || null });
			return;
		}

		if (event.data.type === 'electron-reader:apply-ai-analysis-state') {
			reader?._updateState({ aiAnalysis: event.data.payload || {} });
			return;
		}

		if (event.data.type === 'electron-reader:ensure-native-outline') {
			reader?.ensureNativeOutline?.().catch((error) => {
				console.warn('[ai-outline] failed to preload native outline', error);
			});
			return;
		}

		if (event.data.type === 'electron-reader:set-sidebar-state') {
			if (event.data.payload?.view) {
				reader?.setSidebarView(event.data.payload.view);
			}
			if (event.data.payload?.open !== undefined) {
				reader?.toggleSidebar(!!event.data.payload.open);
			}
			return;
		}

		if (event.data.type === 'electron-reader:sync-annotations') {
			currentAnnotations = clone(event.data.payload?.annotations || []);
			if (reader) {
				syncExistingReaderAnnotations(currentAnnotations);
			}
			return;
		}

		if (event.data.type === 'electron-reader:sync-view-state' && event.data.payload?.state) {
			const nextState = clone(event.data.payload.state);
			currentViewState = nextState;
			if (reader?._primaryView?._setState) {
				await reader._primaryView._setState(nextState, false);
			}
			return;
		}

		if (event.data.type === 'electron-reader:navigate-to-position') {
			if (event.source !== window.parent) {
				return;
			}
			await navigateToExternalPdfPosition(event.data.payload || {});
			return;
		}

		if (event.data.type === 'electron-reader:sync-scroll-position' && event.data.payload) {
			const viewerContainer = reader?._primaryView?._iframeWindow?.document?.getElementById('viewerContainer');
			if (viewerContainer) {
				if (typeof event.data.payload.left === 'number') {
					viewerContainer.scrollLeft = event.data.payload.left;
				}
				if (typeof event.data.payload.top === 'number') {
					viewerContainer.scrollTop = event.data.payload.top;
				}
			}
			return;
		}

		if (event.data.type === 'electron-reader:lookup-selection-response') {
			const requestId = event.data.payload?.requestId;
			const pending = pendingSelectionLookupRequests.get(requestId);
			if (!pending) {
				return;
			}
			pendingSelectionLookupRequests.delete(requestId);
			window.clearTimeout(pending.timeoutId);
			if (event.data.payload?.error) {
				pending.reject(new Error(event.data.payload.error));
				return;
			}
			pending.resolve(event.data.payload?.result);
			return;
		}

		if (event.data.type === 'electron-reader:lookup-selection-stream') {
			const requestId = event.data.payload?.requestId;
			const pending = pendingSelectionLookupRequests.get(requestId);
			if (!pending || typeof pending.onProgress !== 'function') {
				return;
			}
			pending.onProgress({
				delta: typeof event.data.payload?.delta === 'string' ? event.data.payload.delta : '',
			});
		}
	});

	window.parent.postMessage({ type: 'electron-reader-ready' }, '*');
}

if (isEmbeddedMode()) {
	setupEmbeddedBridge();
}
else {
	createWelcome();
}
