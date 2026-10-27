const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MAX_PDF_BYTES = 512 * 1024 * 1024;
const MAX_OUTLINE_NODES = 5000;
const MAX_OUTLINE_DEPTH = 32;
const MAX_OUTLINE_TITLE_CHARS = 1024;
const MAX_TEXT_RECT_TARGETS_PER_BATCH = 32;
const MAX_TEXT_RECT_QUOTE_CHARS = 2000;

let pdfWorkerModulePromise = null;
let pdfJsModulePromise = null;
let pdfJsWorkerModulePromise = null;

function uniquePaths(values) {
	return [...new Set(values
		.filter((value) => typeof value === 'string' && value.trim())
		.map((value) => path.resolve(value)))];
}

function isFile(filePath) {
	try {
		return fsSync.statSync(filePath).isFile();
	}
	catch {
		return false;
	}
}

function isDirectory(directoryPath) {
	try {
		return fsSync.statSync(directoryPath).isDirectory();
	}
	catch {
		return false;
	}
}

function getRuntimeRoots() {
	return uniquePaths([
		process.env.PDF_AI_CONTEXT_RUNTIME_ROOT,
		process.resourcesPath,
		__dirname,
		path.resolve(__dirname, '..'),
	]);
}

function resolvePdfWorkerDir() {
	const candidates = uniquePaths([
		process.env.PDF_AI_CONTEXT_PDF_WORKER_DIR,
		...getRuntimeRoots().map((root) => path.join(root, 'pdf-worker')),
	]);
	const resolved = candidates.find((candidate) => isFile(path.join(candidate, 'src', 'index.js')));
	if (!resolved) {
		throw new Error('PDF context runtime cannot locate pdf-worker/src/index.js');
	}
	return resolved;
}

function resolveReaderDir() {
	const candidates = uniquePaths([
		process.env.PDF_AI_CONTEXT_READER_DIR,
		...getRuntimeRoots().flatMap((root) => [
			path.join(root, 'reader'),
			path.join(root, 'reader', 'build', 'electron'),
		]),
	]);
	const resolved = candidates.find((candidate) => isFile(path.join(candidate, 'pdf', 'build', 'pdf.mjs')));
	if (!resolved) {
		throw new Error('PDF context runtime cannot locate reader/pdf/build/pdf.mjs');
	}
	return resolved;
}

function normalizeArrayBuffer(value) {
	if (value instanceof ArrayBuffer) {
		return value;
	}
	if (ArrayBuffer.isView(value)) {
		return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
	}
	throw new Error('Expected PDF bytes');
}

async function readPdfBuffer(pdfPath) {
	const resolvedPath = path.resolve(String(pdfPath || ''));
	if (!resolvedPath || path.extname(resolvedPath).toLowerCase() !== '.pdf') {
		throw new Error('A readable PDF path is required');
	}
	const stat = await fs.stat(resolvedPath);
	if (!stat.isFile() || stat.size > MAX_PDF_BYTES) {
		throw new Error('PDF source is unavailable or exceeds the supported size');
	}
	return fs.readFile(resolvedPath);
}

async function getPdfWorkerModule() {
	if (!pdfWorkerModulePromise) {
		const entryPath = path.join(resolvePdfWorkerDir(), 'src', 'index.js');
		pdfWorkerModulePromise = import(pathToFileURL(entryPath).href).catch((error) => {
			pdfWorkerModulePromise = null;
			throw error;
		});
	}
	return pdfWorkerModulePromise;
}

async function importPdfJsModuleSilently(entryPath) {
	const previousLog = console.log;
	console.log = (...args) => {
		if (args.length === 1 && String(args[0]).includes('Please use the `legacy` build in Node.js environments.')) {
			return;
		}
		previousLog(...args);
	};
	try {
		return await import(pathToFileURL(entryPath).href);
	}
	finally {
		console.log = previousLog;
	}
}

function assertSafeAssetName(value, label) {
	const name = String(value || '').trim();
	if (!name || path.basename(name) !== name || !/^[A-Za-z0-9_.-]+$/u.test(name)) {
		throw new Error(`Invalid PDF ${label} asset name`);
	}
	return name;
}

async function cmapProvider(name) {
	const readerDir = resolveReaderDir();
	const safeName = assertSafeAssetName(name, 'cmap');
	return {
		compressionType: 1,
		cMapData: await fs.readFile(path.join(readerDir, 'pdf', 'web', 'cmaps', `${safeName}.bcmap`)),
	};
}

async function standardFontProvider(name) {
	const readerDir = resolveReaderDir();
	const safeName = assertSafeAssetName(name, 'standard font');
	return fs.readFile(path.join(readerDir, 'pdf', 'web', 'standard_fonts', safeName));
}

async function getPdfPageMetrics(pdfPath) {
	const [pdfWorker, buffer] = await Promise.all([
		getPdfWorkerModule(),
		readPdfBuffer(pdfPath),
	]);
	return pdfWorker.getPageMetrics(normalizeArrayBuffer(buffer), '');
}

function normalizeTextRectTargets(value) {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((entry) => {
			const pageIndex = Number(entry?.pageIndex);
			const quote = typeof entry?.quote === 'string'
				? entry.quote.trim().slice(0, MAX_TEXT_RECT_QUOTE_CHARS)
				: '';
			if (!Number.isInteger(pageIndex) || pageIndex < 0 || !quote) {
				return null;
			}
			return {
				id: String(entry?.id || '').slice(0, 256),
				pageIndex,
				quote,
			};
		})
		.filter(Boolean);
}

async function findPdfTextRects(pdfPath, targets) {
	const normalizedTargets = normalizeTextRectTargets(targets);
	if (!normalizedTargets.length) {
		return [];
	}
	const [pdfWorker, buffer] = await Promise.all([
		getPdfWorkerModule(),
		readPdfBuffer(pdfPath),
	]);
	const pdfBytes = normalizeArrayBuffer(buffer);
	const results = [];
	for (let start = 0; start < normalizedTargets.length; start += MAX_TEXT_RECT_TARGETS_PER_BATCH) {
		const batch = normalizedTargets.slice(start, start + MAX_TEXT_RECT_TARGETS_PER_BATCH);
		const matched = await pdfWorker.findTextRects(pdfBytes, batch, '', cmapProvider, standardFontProvider);
		if (Array.isArray(matched)) {
			results.push(...matched);
		}
	}
	return results;
}

function installPdfJsDomShims() {
	if (typeof globalThis.DOMMatrix === 'undefined') {
		globalThis.DOMMatrix = class DOMMatrix {};
	}
	if (typeof globalThis.ImageData === 'undefined') {
		globalThis.ImageData = class ImageData {};
	}
	if (typeof globalThis.Path2D === 'undefined') {
		globalThis.Path2D = class Path2D {};
	}
}

async function getPdfJsModule() {
	if (!pdfJsModulePromise) {
		const entryPath = path.join(resolveReaderDir(), 'pdf', 'build', 'pdf.mjs');
		installPdfJsDomShims();
		pdfJsModulePromise = importPdfJsModuleSilently(entryPath).catch((error) => {
			pdfJsModulePromise = null;
			throw error;
		});
	}
	return pdfJsModulePromise;
}

async function getPdfJsWorkerModule() {
	if (!pdfJsWorkerModulePromise) {
		const entryPath = path.join(resolveReaderDir(), 'pdf', 'build', 'pdf.worker.mjs');
		pdfJsWorkerModulePromise = import(pathToFileURL(entryPath).href).catch((error) => {
			pdfJsWorkerModulePromise = null;
			throw error;
		});
	}
	return pdfJsWorkerModulePromise;
}

async function withCompatiblePdfWorker(callback) {
	const workerModule = await getPdfJsWorkerModule();
	const target = globalThis;
	const hadWorker = Object.prototype.hasOwnProperty.call(target, 'pdfjsWorker');
	const previousWorker = target.pdfjsWorker;
	target.pdfjsWorker = workerModule;
	try {
		return await callback();
	}
	finally {
		if (hadWorker) {
			target.pdfjsWorker = previousWorker;
		}
		else {
			delete target.pdfjsWorker;
		}
	}
}

function normalizeOutlineTitle(value) {
	return String(value || '')
		.replace(/\s+/gu, ' ')
		.trim()
		.slice(0, MAX_OUTLINE_TITLE_CHARS);
}

function normalizeOutlinePageIndex(value) {
	const pageIndex = Number(value);
	return Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex : undefined;
}

function normalizeOutlineRects(value) {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.slice(0, 32)
		.map((rect) => {
			if (!Array.isArray(rect) || rect.length < 4) {
				return null;
			}
			const normalized = rect.slice(0, 4).map(Number);
			return normalized.every(Number.isFinite) ? normalized : null;
		})
		.filter(Boolean);
}

function sanitizeNativeOutline(items, budget, depth = 0) {
	if (!Array.isArray(items) || depth > MAX_OUTLINE_DEPTH) {
		return [];
	}
	const result = [];
	for (const item of items) {
		if (!item || typeof item !== 'object' || budget.count >= MAX_OUTLINE_NODES) {
			break;
		}
		budget.count += 1;
		const position = item?.location?.position && typeof item.location.position === 'object'
			? item.location.position
			: item?.position && typeof item.position === 'object'
				? item.position
				: {};
		const children = sanitizeNativeOutline(item.items, budget, depth + 1);
		const title = normalizeOutlineTitle(item.title);
		if (!title) {
			result.push(...children);
			continue;
		}
		result.push({
			title,
			pageIndex: normalizeOutlinePageIndex(position.pageIndex),
			rects: normalizeOutlineRects(position.rects),
			items: children,
		});
	}
	return result;
}

function flattenNativeOutline(items, entries = [], state = { order: 0 }, depth = 1) {
	for (const item of Array.isArray(items) ? items : []) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const title = normalizeOutlineTitle(item.title);
		if (!title) {
			flattenNativeOutline(item.items, entries, state, depth);
			continue;
		}
		state.order += 1;
		entries.push({
			nativeOutlineOrder: state.order,
			title,
			level: depth,
			pageIndex: normalizeOutlinePageIndex(item.pageIndex),
		});
		flattenNativeOutline(item.items, entries, state, depth + 1);
	}
	return entries;
}

async function getNativePdfOutline(pdfPath) {
	const [pdfJs, source] = await Promise.all([
		getPdfJsModule(),
		readPdfBuffer(pdfPath),
	]);
	return withCompatiblePdfWorker(async () => {
		const loadingTask = pdfJs.getDocument({
			data: new Uint8Array(source),
			disableWorker: true,
			useWorkerFetch: false,
			isEvalSupported: false,
			stopAtErrors: false,
			verbosity: 0,
		});
		let document = null;
		try {
			document = await loadingTask.promise;
			const rawItems = typeof document.getOutline2 === 'function'
				? await document.getOutline2()
				: await document.getOutline();
			const budget = { count: 0 };
			const items = sanitizeNativeOutline(rawItems, budget);
			return {
				items,
				flatItems: flattenNativeOutline(items),
				pageCount: Number(document.numPages) || 0,
				outlineCount: budget.count,
			};
		}
		finally {
			if (document?.destroy) {
				await document.destroy().catch(() => {});
			}
			else {
				await loadingTask.destroy?.().catch(() => {});
			}
		}
	});
}

module.exports = {
	findPdfTextRects,
	flattenNativeOutline,
	getNativePdfOutline,
	getPdfPageMetrics,
	resolvePdfWorkerDir,
	resolveReaderDir,
};
