const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { getReaderDir } = require('./runtime-paths');

const MAX_PDF_BYTES = 512 * 1024 * 1024;
const MAX_OUTLINE_NODES = 5000;
const MAX_OUTLINE_DEPTH = 32;
const MAX_OUTLINE_TITLE_CHARS = 1024;
const OUTLINE_CACHE_LIMIT = 48;

let pdfJsModulePromise = null;
let pdfJsWorkerModulePromise = null;
const outlineCache = new Map();

function normalizeTitle(value) {
	return String(value || '')
		.replace(/\s+/gu, ' ')
		.trim()
		.slice(0, MAX_OUTLINE_TITLE_CHARS);
}

function normalizePageIndex(value) {
	const pageIndex = Number(value);
	return Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex : undefined;
}

function normalizeRects(value) {
	if (!Array.isArray(value)) return [];
	return value
		.slice(0, 32)
		.map((rect) => {
			if (!Array.isArray(rect) || rect.length < 4) return null;
			const normalized = rect.slice(0, 4).map(Number);
			return normalized.every(Number.isFinite) ? normalized : null;
		})
		.filter(Boolean);
}

function createOutlineBudget() {
	let count = 0;
	return {
		consume() {
			count += 1;
			return count <= MAX_OUTLINE_NODES;
		},
		get count() {
			return count;
		},
	};
}

function sanitizeOutlineItems(items, budget, depth = 0) {
	if (!Array.isArray(items) || depth > MAX_OUTLINE_DEPTH) return [];
	const result = [];
	for (const item of items) {
		if (!item || typeof item !== 'object' || !budget.consume()) break;
		const position = item?.location?.position && typeof item.location.position === 'object'
			? item.location.position
			: {};
		const children = sanitizeOutlineItems(item.items, budget, depth + 1);
		const title = normalizeTitle(item.title);
		if (!title) {
			result.push(...children);
			continue;
		}
		result.push({
			title,
			pageIndex: normalizePageIndex(position.pageIndex),
			rects: normalizeRects(position.rects),
			items: children,
		});
	}
	return result;
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

async function loadPdfJsModule() {
	if (!pdfJsModulePromise) {
		const assetPath = path.join(getReaderDir(), 'pdf', 'build', 'pdf.mjs');
		pdfJsModulePromise = fs.stat(assetPath)
			.then((stat) => {
				if (!stat.isFile()) {
					throw new Error(`Reader PDF.js module is unavailable: ${assetPath}`);
				}
				installPdfJsDomShims();
				return import(pathToFileURL(assetPath).href);
			})
			.catch((error) => {
				pdfJsModulePromise = null;
				throw error;
			});
	}
	return pdfJsModulePromise;
}

async function loadPdfJsWorkerModule() {
	if (!pdfJsWorkerModulePromise) {
		const assetPath = path.join(getReaderDir(), 'pdf', 'build', 'pdf.worker.mjs');
		pdfJsWorkerModulePromise = fs.stat(assetPath)
			.then((stat) => {
				if (!stat.isFile()) {
					throw new Error(`Reader PDF.js worker module is unavailable: ${assetPath}`);
				}
				return import(pathToFileURL(assetPath).href);
			})
			.catch((error) => {
				pdfJsWorkerModulePromise = null;
				throw error;
			});
	}
	return pdfJsWorkerModulePromise;
}

async function withCompatiblePdfWorker(callback) {
	const workerModule = await loadPdfJsWorkerModule();
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

function makeCacheKey(filePath, stat) {
	return [path.resolve(filePath), Math.floor(Number(stat.mtimeMs) || 0), Number(stat.size) || 0].join('|');
}

function trimOutlineCache() {
	while (outlineCache.size > OUTLINE_CACHE_LIMIT) {
		const oldestKey = outlineCache.keys().next().value;
		if (!oldestKey) break;
		outlineCache.delete(oldestKey);
	}
}

async function extractNativePdfOutline(filePath, stat) {
	const pdfJs = await loadPdfJsModule();
	const source = await fs.readFile(filePath);
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
			const budget = createOutlineBudget();
			const items = sanitizeOutlineItems(rawItems, budget);
			return {
				items,
				pageCount: Number(document.numPages) || 0,
				fileSize: Number(stat.size) || 0,
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

async function getNativePdfOutline(filePath) {
	const normalizedPath = typeof filePath === 'string' && filePath.trim() ? path.resolve(filePath) : '';
	if (!normalizedPath || path.extname(normalizedPath).toLowerCase() !== '.pdf') {
		throw new Error('A readable PDF path is required for native outline extraction');
	}
	const stat = await fs.stat(normalizedPath);
	if (!stat.isFile()) {
		throw new Error(`Native outline source is not a file: ${normalizedPath}`);
	}
	if (stat.size > MAX_PDF_BYTES) {
		throw new Error(`Native outline source exceeds ${MAX_PDF_BYTES} bytes: ${normalizedPath}`);
	}
	const cacheKey = makeCacheKey(normalizedPath, stat);
	const cached = outlineCache.get(cacheKey);
	if (cached) return cached;
	const result = extractNativePdfOutline(normalizedPath, stat).catch((error) => {
		outlineCache.delete(cacheKey);
		throw error;
	});
	outlineCache.set(cacheKey, result);
	trimOutlineCache();
	return result;
}

function clearNativePdfOutlineCache() {
	outlineCache.clear();
}

module.exports = {
	clearNativePdfOutlineCache,
	getNativePdfOutline,
};
