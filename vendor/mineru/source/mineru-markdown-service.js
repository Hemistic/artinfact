const path = require('path');
const fs = require('fs/promises');
const yauzl = require('yauzl');

const { normalizeMineruMarkdownLayout } = require('./mineru-layout-normalizer');

const MAX_ZIP_BYTES = 500 * 1024 * 1024;
const MAX_TEXT_ENTRY_BYTES = 80 * 1024 * 1024;
const MAX_IMAGE_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 300 * 1024 * 1024;
const MAX_IMAGE_ENTRY_COUNT = 2000;
const MAX_PDF_UPLOAD_BYTES = 150 * 1024 * 1024;
const MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_BATCH_ITEMS = 50;
const MAX_UPLOAD_CONCURRENCY = 3;
const MAX_ZIP_IMAGE_IO_CONCURRENCY = 8;
const FETCH_JSON_TIMEOUT_MS = 30 * 1000;
const FETCH_UPLOAD_BASE_TIMEOUT_MS = 2 * 60 * 1000;
const FETCH_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_SOURCE_MARKDOWN_TEXT_CHARACTERS = 160;
const MIN_SOURCE_MARKDOWN_COVERAGE_RATIO = 0.35;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolvePdfFilePath(value, missingMessage) {
	const rawPath = typeof value === 'string' ? value.trim() : '';
	if (!rawPath) {
		throw new Error(missingMessage);
	}
	if (hasUnsafePathText(rawPath)) {
		throw new Error(`非法 PDF 路径: ${rawPath}`);
	}
	const filePath = path.resolve(rawPath);
	let stat = null;
	try {
		stat = await fs.stat(filePath);
	}
	catch {
		throw new Error(`PDF 文件不存在: ${filePath}`);
	}
	if (!stat.isFile()) {
		throw new Error(`PDF 路径不是文件: ${filePath}`);
	}
	if (path.extname(filePath).toLowerCase() !== '.pdf') {
		throw new Error(`仅支持 PDF 文件: ${filePath}`);
	}
	if (stat.size > MAX_PDF_UPLOAD_BYTES) {
		throw new Error(`PDF 文件过大，MinerU 最大支持 ${Math.round(MAX_PDF_UPLOAD_BYTES / 1024 / 1024)}MB`);
	}
	return filePath;
}

function hasUnsafePathText(value) {
	const rawPath = String(value || '').trim();
	return /[\u0000-\u001f\u007f]/u.test(rawPath)
		|| (/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(rawPath) && !/^[a-zA-Z]:[\\/]/u.test(rawPath));
}

function parseHttpUrl(value, label) {
	let url = null;
	try {
		url = new URL(String(value || '').trim());
	}
	catch {
		throw new Error(`${label} URL 无效`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`${label} URL 协议不受支持: ${url.protocol || 'unknown'}`);
	}
	return url;
}

function normalizeBaseURL(value) {
	const baseURL = String(value || '').trim();
	if (!baseURL) {
		throw new Error('缺少 MinerU 云端服务 URL，请配置 MINERU_UPLOAD_SERVICE_BASE_URL');
	}
	return parseHttpUrl(baseURL, 'MinerU cloud service').toString().replace(/\/+$/, '');
}

function getMarkdownTextCharacterCount(markdown) {
	const plainText = String(markdown || '')
		.replace(/```[\s\S]*?```/gu, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
		.replace(/\[[^\]]*\]\([^)]*\)/gu, ' ')
		.replace(/<[^>]*>/gu, ' ')
		.replace(/[`*_~>#|\[\](){}]/gu, ' ')
		.replace(/\s+/gu, '');
	return [...plainText].filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
}

function selectPreferredMarkdownOutput({ sourceMarkdown = '', normalizedMarkdown = '' } = {}) {
	const source = String(sourceMarkdown || '').trim();
	const normalized = String(normalizedMarkdown || '').trim();
	if (!source) {
		return normalized;
	}
	if (!normalized) {
		return source;
	}

	const sourceTextCharacters = getMarkdownTextCharacterCount(source);
	const normalizedTextCharacters = getMarkdownTextCharacterCount(normalized);
	// The service-generated Markdown preserves headings, tables, formulas, and links.
	// Only replace it when it is clearly sparse relative to the JSON reconstruction.
	if (
		sourceTextCharacters >= MIN_SOURCE_MARKDOWN_TEXT_CHARACTERS
		&& sourceTextCharacters >= normalizedTextCharacters * MIN_SOURCE_MARKDOWN_COVERAGE_RATIO
	) {
		return source;
	}
	return normalizedTextCharacters > sourceTextCharacters ? normalized : source;
}

function sanitizeUrlForLog(value) {
	try {
		const url = new URL(String(value || ''));
		url.search = url.search ? '?…' : '';
		url.hash = '';
		return url.toString();
	}
	catch {
		return '';
	}
}

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

function resolveOutputMarkdownPath(outputPath, sourcePath) {
	const rawOutputPath = outputPath ? String(outputPath).trim() : '';
	if (rawOutputPath && hasUnsafePathText(rawOutputPath)) {
		throw new Error(`非法 Markdown 输出路径: ${rawOutputPath}`);
	}
	const targetPath = rawOutputPath
		? path.resolve(rawOutputPath)
		: path.join(path.dirname(sourcePath), `${path.parse(sourcePath).name}-mineru.md`);
	if (hasUnsafePathText(targetPath)) {
		throw new Error(`非法 Markdown 输出路径: ${targetPath}`);
	}
	if (path.extname(targetPath).toLowerCase() !== '.md') {
		throw new Error(`Markdown 输出路径必须使用 .md 扩展名: ${targetPath}`);
	}
	if (areSamePath(path.dirname(targetPath), path.parse(targetPath).root)) {
		throw new Error(`拒绝把 MinerU 输出写到磁盘根目录: ${targetPath}`);
	}
	return targetPath;
}

function getContentLength(response) {
	const rawLength = response.headers?.get?.('content-length');
	if (!rawLength) {
		return null;
	}
	const length = Number(rawLength);
	return Number.isFinite(length) && length >= 0 ? length : null;
}

async function readResponseBodyWithLimit(response, maxBytes, label) {
	const contentLength = getContentLength(response);
	if (contentLength !== null && contentLength > maxBytes) {
		throw new Error(`${label} 体积超过上限 (${maxBytes} bytes)`);
	}

	if (response.body && typeof response.body.getReader === 'function') {
		const reader = response.body.getReader();
		const chunks = [];
		let totalBytes = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				const chunk = Buffer.from(value);
				totalBytes += chunk.length;
				if (totalBytes > maxBytes) {
					throw new Error(`${label} 体积超过上限 (${maxBytes} bytes)`);
				}
				chunks.push(chunk);
			}
			return Buffer.concat(chunks, totalBytes);
		}
		finally {
			reader.releaseLock?.();
		}
	}

	const buffer = Buffer.from(await response.arrayBuffer());
	if (buffer.length > maxBytes) {
		throw new Error(`${label} 体积超过上限 (${maxBytes} bytes)`);
	}
	return buffer;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_JSON_TIMEOUT_MS) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || FETCH_JSON_TIMEOUT_MS));
	try {
		return await fetch(url, {
			...options,
			signal: options.signal || controller.signal,
		});
	}
	finally {
		clearTimeout(timer);
	}
}

async function runWithConcurrency(items, concurrency, worker) {
	const results = new Array(items.length);
	let nextIndex = 0;
	const workerCount = Math.min(Math.max(1, concurrency), items.length);
	await Promise.all(Array.from({ length: workerCount }, async () => {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await worker(items[index], index);
		}
	}));
	return results;
}

function getErrorMessage(payload, fallback) {
	if (!payload) {
		return fallback;
	}
	return payload.message
		|| payload.error
		|| payload.errMsg
		|| payload.msg
		|| fallback;
}

async function parseJSONResponse(response, fallbackMessage) {
	let data = null;
	try {
		const raw = await readResponseBodyWithLimit(response, MAX_JSON_RESPONSE_BYTES, 'MinerU JSON response');
		data = JSON.parse(raw.toString('utf8'));
	}
	catch (error) {
		throw new Error(`${fallbackMessage}: ${error instanceof Error ? error.message : String(error)}`);
	}

	if (!response.ok) {
		throw new Error(getErrorMessage(data, `${fallbackMessage} (${response.status})`));
	}

	return data;
}

function openZipFromBuffer(buffer) {
	if (buffer.length > MAX_ZIP_BYTES) {
		throw new Error(`MinerU 返回的 zip 体积超过上限 (${MAX_ZIP_BYTES} bytes)`);
	}
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zipfile) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(zipfile);
		});
	});
}

function openZipEntryStream(zipfile, entry) {
	return new Promise((resolve, reject) => {
		zipfile.openReadStream(entry, (error, stream) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(stream);
		});
	});
}

async function readZipEntryBuffer(zipfile, entry, maxBytes) {
	if (Number(entry?.uncompressedSize || 0) > maxBytes) {
		throw new Error(`MinerU zip entry 过大: ${entry.fileName}`);
	}
	const stream = await openZipEntryStream(zipfile, entry);
	const chunks = [];
	let totalBytes = 0;

	return new Promise((resolve, reject) => {
		stream.on('data', (chunk) => {
			totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk || ''));
			if (totalBytes > maxBytes) {
				stream.destroy(new Error(`MinerU zip entry 过大: ${entry.fileName}`));
				return;
			}
			chunks.push(chunk);
		});
		stream.once('error', reject);
		stream.once('end', () => {
			resolve(Buffer.concat(chunks));
		});
	});
}

async function readZipEntryText(zipfile, entry) {
	return (await readZipEntryBuffer(zipfile, entry, MAX_TEXT_ENTRY_BYTES)).toString('utf8');
}

function scoreMarkdownEntry(entryName) {
	const lowerName = String(entryName || '').replace(/\\/g, '/').toLowerCase();
	if (lowerName.endsWith('/full.md') || lowerName === 'full.md') {
		return 4;
	}
	if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) {
		return 2;
	}
	return 0;
}

function scoreJsonEntry(entryName) {
	const lowerName = String(entryName || '').replace(/\\/g, '/').toLowerCase();
	if (lowerName.endsWith('/content_list_v2.json') || lowerName === 'content_list_v2.json') {
		return 7;
	}
	if (lowerName.endsWith('_content_list.json') || lowerName.endsWith('/content_list.json') || lowerName === 'content_list.json') {
		return 6;
	}
	if (lowerName.endsWith('/layout.json') || lowerName === 'layout.json') {
		return 4;
	}
	if (lowerName.endsWith('_model.json')) {
		return 3;
	}
	if (lowerName.endsWith('.json')) {
		return 1;
	}
	return 0;
}

function pickPreferredEntry(currentEntry, nextEntry, scoreFn) {
	if (!nextEntry) {
		return currentEntry;
	}
	if (!currentEntry) {
		return nextEntry;
	}
	return scoreFn(nextEntry.fileName) > scoreFn(currentEntry.fileName) ? nextEntry : currentEntry;
}

function normalizeZipEntryPath(entryName, expectedRoot = '') {
	const normalized = String(entryName || '').replace(/\\/g, '/');
	if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//u.test(normalized)) {
		return '';
	}
	const parts = normalized.split('/').filter(Boolean);
	if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) {
		return '';
	}
	const relativePath = parts.join('/');
	if (expectedRoot && relativePath !== expectedRoot && !relativePath.startsWith(`${expectedRoot}/`)) {
		return '';
	}
	return relativePath;
}

async function extractResultFilesFromZip(zipBuffer) {
	const zipfile = await openZipFromBuffer(zipBuffer);

	return new Promise((resolve, reject) => {
		let selectedMarkdownEntry = null;
		let selectedJsonEntry = null;
		const imageEntries = [];
		let totalImageBytes = 0;

		const finish = async () => {
			if (!selectedMarkdownEntry) {
				zipfile.close();
				reject(new Error('MinerU 返回的 zip 中没有找到 Markdown 文件'));
				return;
			}
			if (!selectedJsonEntry) {
				zipfile.close();
				reject(new Error('MinerU 返回的 zip 中没有找到 JSON 文件'));
				return;
			}

			try {
				const [markdown, jsonText, images] = await Promise.all([
					readZipEntryText(zipfile, selectedMarkdownEntry),
					readZipEntryText(zipfile, selectedJsonEntry),
					runWithConcurrency(imageEntries, MAX_ZIP_IMAGE_IO_CONCURRENCY, async (entry) => ({
						relativePath: normalizeZipEntryPath(entry.fileName, 'images'),
						buffer: await readZipEntryBuffer(zipfile, entry, MAX_IMAGE_ENTRY_BYTES),
					})),
				]);
				zipfile.close();
				resolve({
					markdownEntryName: selectedMarkdownEntry.fileName,
					jsonEntryName: selectedJsonEntry.fileName,
					markdown,
					jsonText,
					images,
				});
			}
			catch (error) {
				zipfile.close();
				reject(error);
			}
		};

		zipfile.on('entry', (entry) => {
			if (/\/$/.test(entry.fileName)) {
				zipfile.readEntry();
				return;
			}

			const normalizedName = normalizeZipEntryPath(entry.fileName);
			if (!normalizedName) {
				zipfile.readEntry();
				return;
			}
			const lowerName = normalizedName.toLowerCase();
			const isMarkdown = lowerName.endsWith('.md') || lowerName.endsWith('.markdown');
			const isJson = lowerName.endsWith('.json');
			const isImage = lowerName.startsWith('images/');
			if (isMarkdown) {
				selectedMarkdownEntry = pickPreferredEntry(selectedMarkdownEntry, entry, scoreMarkdownEntry);
			}
			if (isJson) {
				selectedJsonEntry = pickPreferredEntry(selectedJsonEntry, entry, scoreJsonEntry);
			}
			if (isImage) {
				const entrySize = Number(entry.uncompressedSize || entry.compressedSize || 0);
				if (imageEntries.length >= MAX_IMAGE_ENTRY_COUNT) {
					zipfile.close();
					reject(new Error(`MinerU 返回的 zip 图片数量超过上限 (${MAX_IMAGE_ENTRY_COUNT})`));
					return;
				}
				if (entrySize > MAX_IMAGE_ENTRY_BYTES || totalImageBytes + entrySize > MAX_TOTAL_IMAGE_BYTES) {
					zipfile.close();
					reject(new Error('MinerU 返回的 zip 图片体积超过上限'));
					return;
				}
				totalImageBytes += entrySize;
				imageEntries.push(entry);
			}
			zipfile.readEntry();
		});

		zipfile.once('end', () => {
			finish().catch(reject);
		});
		zipfile.once('error', reject);
		zipfile.readEntry();
	});
}

class MineruMarkdownService {
	constructor({
		baseURL = '',
		clientKey = '',
		pollIntervalMs = 5000,
		timeoutMs = 10 * 60 * 1000,
		logger = console,
	} = {}) {
		this.baseURL = normalizeBaseURL(baseURL);
		this.clientKey = String(clientKey || '').trim();
		this.pollIntervalMs = Math.max(1000, Number(pollIntervalMs) || 5000);
		this.timeoutMs = Math.max(10_000, Number(timeoutMs) || 10 * 60 * 1000);
		this.logger = logger || console;
		this.activeOutputPaths = new Set();
	}

	updateConnectionConfig({ baseURL, clientKey } = {}) {
		if (baseURL !== undefined) {
			this.baseURL = normalizeBaseURL(baseURL);
		}
		if (clientKey !== undefined) {
			this.clientKey = String(clientKey || '').trim();
		}
	}

	async convertPdfToMarkdown({
		filePath,
		outputPath,
		language = 'en',
		enableFormula = true,
		enableTable = true,
		isOcr = false,
		modelVersion = 'vlm',
		dataId = '',
	} = {}) {
		const sourcePath = await resolvePdfFilePath(filePath, '缺少待转换的 PDF 路径');
		if (!this.clientKey) {
			throw new Error('缺少 PDF AI Client Key，请在设置中配置。');
		}

		const targetPath = resolveOutputMarkdownPath(outputPath, sourcePath);
		if (this.activeOutputPaths.has(targetPath)) {
			throw new Error('当前 PDF 的 Markdown 转换正在执行，请等待完成后再试。');
		}
		this.activeOutputPaths.add(targetPath);
		try {
			return await this._convertPdfToMarkdown({
				sourcePath,
				targetPath,
				language,
				enableFormula,
				enableTable,
				isOcr,
				modelVersion,
				dataId,
			});
		}
		finally {
			this.activeOutputPaths.delete(targetPath);
		}
	}

	async convertPdfBatchToMarkdown({
		items = [],
		language = 'en',
		enableFormula = true,
		enableTable = true,
		isOcr = false,
		modelVersion = 'vlm',
	} = {}) {
		if (!this.clientKey) {
			throw new Error('缺少 PDF AI Client Key，请在设置中配置。');
		}
		if (Array.isArray(items) && items.length > MAX_BATCH_ITEMS) {
			throw new Error(`MinerU 批量转换数量超过上限 (${MAX_BATCH_ITEMS})`);
		}
		const preparedItems = [];
		for (const item of Array.isArray(items) ? items : []) {
			const sourcePath = await resolvePdfFilePath(item?.filePath, '缺少待转换的 PDF 路径');
			const targetPath = resolveOutputMarkdownPath(item?.outputPath, sourcePath);
			preparedItems.push({
				...item,
				sourcePath,
				targetPath,
				dataId: String(item?.dataId || `mineru-${Date.now()}-${preparedItems.length}`).trim(),
			});
		}
		if (preparedItems.length === 0) {
			return {
				batchId: '',
				requestedCount: 0,
				results: [],
				failed: [],
			};
		}

		for (const item of preparedItems) {
			if (this.activeOutputPaths.has(item.targetPath)) {
				throw new Error(`当前 PDF 的 Markdown 转换正在执行，请等待完成后再试: ${item.sourcePath}`);
			}
		}
		preparedItems.forEach((item) => this.activeOutputPaths.add(item.targetPath));
		try {
			return await this._convertPdfBatchToMarkdown({
				items: preparedItems,
				language,
				enableFormula,
				enableTable,
				isOcr,
				modelVersion,
			});
		}
		finally {
			preparedItems.forEach((item) => this.activeOutputPaths.delete(item.targetPath));
		}
	}

	async _convertPdfToMarkdown({
		sourcePath,
		targetPath,
		language,
		enableFormula,
		enableTable,
		isOcr,
		modelVersion,
		dataId,
	}) {
		const targetBasePath = targetPath.replace(/\.[^.]+$/, '');
		const jsonTargetPath = `${targetBasePath}.json`;
		const imagesDir = path.join(path.dirname(targetPath), 'images');

		const fileBuffer = await fs.readFile(sourcePath);
		this.log('convert:start', {
			sourcePath,
			targetPath,
			jsonTargetPath,
			imagesDir,
			baseURL: this.baseURL,
			language,
			enableFormula: !!enableFormula,
			enableTable: !!enableTable,
			isOcr: !!isOcr,
			modelVersion: String(modelVersion || 'vlm'),
		});

		const task = await this.createUploadTask({
			fileName: path.basename(sourcePath),
			language,
			isOcr,
			enableFormula,
			enableTable,
			modelVersion,
			dataId,
		});

		await this.uploadPdfToMineru(task.uploadUrl, fileBuffer);
		const status = await this.waitForTask(task.batchId);
		const zipUrl = String(status?.zipUrl || '').trim();
		if (!zipUrl) {
			throw new Error('MinerU 任务已完成，但没有返回 zipUrl');
		}

		const written = await this.writeZipResult({
			targetPath,
			zipUrl,
		});

		this.log('convert:done', {
			batchId: task.batchId,
			targetPath,
			jsonTargetPath,
			imagesDir,
			zipUrl: sanitizeUrlForLog(zipUrl),
			markdownEntryName: written.markdownEntryName,
			jsonEntryName: written.jsonEntryName,
			markdownLength: written.markdownLength,
			jsonLength: written.jsonLength,
			imageCount: written.imageCount,
		});

		return {
			filePath: targetPath,
			markdownPath: targetPath,
			jsonPath: jsonTargetPath,
			imagesDir,
			imageCount: written.imageCount,
			batchId: task.batchId,
			zipUrl,
			markdownEntryName: written.markdownEntryName,
			jsonEntryName: written.jsonEntryName,
		};
	}

	async _convertPdfBatchToMarkdown({
		items,
		language,
		enableFormula,
		enableTable,
		isOcr,
		modelVersion,
	}) {
		this.log('batch:convert:start', {
			count: items.length,
			baseURL: this.baseURL,
			language,
			enableFormula: !!enableFormula,
			enableTable: !!enableTable,
			isOcr: !!isOcr,
			modelVersion: String(modelVersion || 'vlm'),
			files: items.map((item) => ({
				sourcePath: item.sourcePath,
				targetPath: item.targetPath,
			})),
		});

		const batch = await this.createUploadBatch({
			files: items.map((item) => ({
				fileName: path.basename(item.sourcePath),
				dataId: item.dataId,
			})),
			language,
			isOcr,
			enableFormula,
			enableTable,
			modelVersion,
		});

		const uploadFiles = Array.isArray(batch.files) ? batch.files : [];
		if (uploadFiles.length < items.length) {
			throw new Error('MinerU 批量上传任务响应缺少文件上传地址');
		}

		await runWithConcurrency(uploadFiles.slice(0, items.length), MAX_UPLOAD_CONCURRENCY, async (file, index) => {
			const fileBuffer = await fs.readFile(items[index].sourcePath);
			await this.uploadPdfToMineru(file.uploadUrl, fileBuffer);
		});
		const status = await this.waitForBatch(batch.batchId);
		const statusFiles = Array.isArray(status?.files) ? status.files : [];
		const statusByDataId = new Map(statusFiles.map((file) => [String(file?.dataId || ''), file]));
		const results = [];
		const failed = [];

		for (const item of items) {
			const fileStatus = statusByDataId.get(item.dataId) || statusFiles[items.indexOf(item)] || null;
			const state = String(fileStatus?.state || '').trim().toLowerCase();
			const zipUrl = String(fileStatus?.zipUrl || '').trim();
			if (state !== 'done' || !zipUrl) {
				failed.push({
					...item,
					state,
					error: getErrorMessage(fileStatus, 'MinerU 解析失败'),
				});
				continue;
			}

			try {
				const written = await this.writeZipResult({
					targetPath: item.targetPath,
					zipUrl,
				});
				results.push({
					...item,
					filePath: item.targetPath,
					markdownPath: item.targetPath,
					jsonPath: written.jsonPath,
					imagesDir: written.imagesDir,
					imageCount: written.imageCount,
					batchId: batch.batchId,
					taskId: fileStatus?.taskId || '',
					zipUrl,
					markdownEntryName: written.markdownEntryName,
					jsonEntryName: written.jsonEntryName,
				});
			}
			catch (error) {
				failed.push({
					...item,
					state,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		this.log('batch:convert:done', {
			batchId: batch.batchId,
			requestedCount: items.length,
			convertedCount: results.length,
			failedCount: failed.length,
		});

		return {
			batchId: batch.batchId,
			requestedCount: items.length,
			results,
			failed,
		};
	}

	async writeZipResult({ targetPath, zipUrl }) {
		const outputRoot = path.dirname(targetPath);
		const targetBasePath = targetPath.replace(/\.[^.]+$/, '');
		const jsonTargetPath = `${targetBasePath}.json`;
		const imagesDir = path.join(outputRoot, 'images');
		const zipTempPath = `${targetBasePath}.zip.download`;

		if (!isPathInsideOrSameDirectory(imagesDir, outputRoot) || !isPathInsideOrSameDirectory(jsonTargetPath, outputRoot) || !isPathInsideOrSameDirectory(zipTempPath, outputRoot)) {
			throw new Error('MinerU 输出路径越界');
		}
		await fs.mkdir(outputRoot, { recursive: true });

		let extracted = null;
		let outputMarkdown = '';
		try {
			const zipBuffer = await this.downloadZip(zipUrl);
			await fs.writeFile(zipTempPath, zipBuffer);
			extracted = await extractResultFilesFromZip(zipBuffer);
			await fs.rm(imagesDir, { recursive: true, force: true });
			await runWithConcurrency(extracted.images, MAX_ZIP_IMAGE_IO_CONCURRENCY, async (image) => {
				if (!image.relativePath) {
					return;
				}
				const outputImagePath = path.resolve(outputRoot, image.relativePath);
				if (!isPathInsideOrSameDirectory(outputImagePath, imagesDir)) {
					throw new Error(`MinerU zip 图片路径越界: ${image.relativePath}`);
				}
				await fs.mkdir(path.dirname(outputImagePath), { recursive: true });
				await fs.writeFile(outputImagePath, image.buffer);
			});
			let normalizedMarkdown = '';
			try {
				const normalizedLayout = await normalizeMineruMarkdownLayout({
					markdown: extracted.markdown,
					jsonText: extracted.jsonText,
					outputDir: outputRoot,
				});
				normalizedMarkdown = normalizedLayout.markdown;
			}
			catch (error) {
				if (!String(extracted.markdown || '').trim()) {
					throw error;
				}
				this.log('layout:normalization-skipped', {
					message: String(error?.message || error || 'unknown error'),
				});
			}
			outputMarkdown = selectPreferredMarkdownOutput({
				sourceMarkdown: extracted.markdown,
				normalizedMarkdown,
			});
			this.log('markdown:select-output', {
				sourceLength: extracted.markdown.length,
				normalizedLength: normalizedMarkdown.length,
				outputLength: outputMarkdown.length,
				sourceTextCharacters: getMarkdownTextCharacterCount(extracted.markdown),
				normalizedTextCharacters: getMarkdownTextCharacterCount(normalizedMarkdown),
			});
			await Promise.all([
				fs.writeFile(targetPath, outputMarkdown, 'utf8'),
				fs.writeFile(jsonTargetPath, extracted.jsonText, 'utf8'),
			]);
		}
		finally {
			await fs.unlink(zipTempPath).catch(() => {});
		}

		return {
			filePath: targetPath,
			markdownPath: targetPath,
			jsonPath: jsonTargetPath,
			imagesDir,
			imageCount: extracted.images.length,
			markdownEntryName: extracted.markdownEntryName,
			jsonEntryName: extracted.jsonEntryName,
			markdownLength: outputMarkdown.length,
			jsonLength: extracted.jsonText.length,
		};
	}

	async createUploadTask({
		fileName,
		dataId,
		language,
		isOcr,
		enableFormula,
		enableTable,
		modelVersion,
	}) {
		const requestBody = {
			fileName: String(fileName || '').trim(),
			language: String(language || 'ch').trim() || 'ch',
			isOcr: !!isOcr,
			enableFormula: !!enableFormula,
			enableTable: !!enableTable,
			modelVersion: String(modelVersion || 'vlm').trim() || 'vlm',
		};

		if (String(dataId || '').trim()) {
			requestBody.dataId = String(dataId).trim();
		}

		this.log('task:create:request', requestBody);

		const response = await fetchWithTimeout(`${this.baseURL}/v1/mineru/upload-tasks`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.clientKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(requestBody),
		}, FETCH_JSON_TIMEOUT_MS);

		const payload = await parseJSONResponse(response, '创建 MinerU 上传任务失败');
		if (!payload?.batchId || !payload?.uploadUrl) {
			throw new Error(getErrorMessage(payload, 'MinerU 上传任务响应缺少 batchId 或 uploadUrl'));
		}

		this.log('task:create:response', {
			batchId: payload.batchId,
			uploadUrl: sanitizeUrlForLog(payload.uploadUrl),
			dataId: payload.dataId || '',
			remainingBalance: payload.remainingBalance,
		});

		return payload;
	}

	async createUploadBatch({
		files = [],
		language,
		isOcr,
		enableFormula,
		enableTable,
		modelVersion,
	}) {
		const requestBody = {
			files: files.map((file) => ({
				fileName: String(file?.fileName || '').trim(),
				dataId: String(file?.dataId || '').trim(),
			}))
				.filter((file) => file.fileName)
				.map((file) => (file.dataId
					? { fileName: file.fileName, dataId: file.dataId }
					: { fileName: file.fileName })),
			language: String(language || 'ch').trim() || 'ch',
			isOcr: !!isOcr,
			enableFormula: !!enableFormula,
			enableTable: !!enableTable,
			modelVersion: String(modelVersion || 'vlm').trim() || 'vlm',
		};

		this.log('batch:create:request', {
			...requestBody,
			files: requestBody.files.map((file) => ({
				fileName: file.fileName,
				dataId: file.dataId,
			})),
		});

		const response = await fetchWithTimeout(`${this.baseURL}/v1/mineru/upload-task-batches`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.clientKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(requestBody),
		}, FETCH_JSON_TIMEOUT_MS);

		const payload = await parseJSONResponse(response, '创建 MinerU 批量上传任务失败');
		if (!payload?.batchId || !Array.isArray(payload?.files)) {
			throw new Error(getErrorMessage(payload, 'MinerU 批量上传任务响应缺少 batchId 或 files'));
		}

		this.log('batch:create:response', {
			batchId: payload.batchId,
			fileCount: payload.files.length,
			remainingBalance: payload.remainingBalance,
		});

		return payload;
	}

	async uploadPdfToMineru(uploadUrl, fileBuffer) {
		const parsedUploadUrl = parseHttpUrl(uploadUrl, 'MinerU upload');
		this.log('upload:start', {
			uploadUrl: sanitizeUrlForLog(parsedUploadUrl.toString()),
			size: fileBuffer.length,
		});

		const uploadTimeoutMs = Math.max(FETCH_UPLOAD_BASE_TIMEOUT_MS, Math.ceil((fileBuffer.length / (1024 * 1024)) * 15_000));
		const response = await fetchWithTimeout(parsedUploadUrl, {
			method: 'PUT',
			body: fileBuffer,
		}, uploadTimeoutMs);
		if (!response.ok) {
			throw new Error(`上传 PDF 到 MinerU 失败 (${response.status})`);
		}

		this.log('upload:done', {
			status: response.status,
		});
	}

	async queryUploadTask(batchId) {
		const response = await fetchWithTimeout(`${this.baseURL}/v1/mineru/upload-tasks/${encodeURIComponent(batchId)}`, {
			headers: {
				Authorization: `Bearer ${this.clientKey}`,
			},
		}, FETCH_JSON_TIMEOUT_MS);
		return parseJSONResponse(response, '查询 MinerU 上传任务失败');
	}

	async queryUploadTaskBatch(batchId) {
		const response = await fetchWithTimeout(`${this.baseURL}/v1/mineru/upload-task-batches/${encodeURIComponent(batchId)}`, {
			headers: {
				Authorization: `Bearer ${this.clientKey}`,
			},
		}, FETCH_JSON_TIMEOUT_MS);
		return parseJSONResponse(response, '查询 MinerU 批量上传任务失败');
	}

	async waitForTask(batchId) {
		const deadline = Date.now() + this.timeoutMs;
		let lastState = '';

		while (Date.now() < deadline) {
			const status = await this.queryUploadTask(batchId);
			const normalizedState = String(status?.state || '').trim().toLowerCase();
			if (normalizedState !== lastState) {
				lastState = normalizedState;
				this.log('task:poll', {
					batchId,
					state: normalizedState,
					progress: status?.progress || null,
					errMsg: status?.errMsg || '',
				});
			}

			if (normalizedState === 'done') {
				return status;
			}

			if (normalizedState === 'failed') {
				throw new Error(getErrorMessage(status, 'MinerU 解析失败'));
			}

			await sleep(this.pollIntervalMs);
		}

		throw new Error('等待 MinerU Markdown 结果超时');
	}

	async waitForBatch(batchId) {
		const deadline = Date.now() + this.timeoutMs;
		let lastSummary = '';

		while (Date.now() < deadline) {
			const status = await this.queryUploadTaskBatch(batchId);
			const files = Array.isArray(status?.files) ? status.files : [];
			const summary = files.map((file) => `${file?.dataId || file?.fileName || ''}:${String(file?.state || '').toLowerCase()}`).join('|');
			if (summary !== lastSummary) {
				lastSummary = summary;
				this.log('batch:poll', {
					batchId,
					files: files.map((file) => ({
						fileName: file?.fileName || '',
						dataId: file?.dataId || '',
						state: file?.state || '',
						progress: file?.progress || null,
						errMsg: file?.errMsg || '',
					})),
				});
			}

			if (files.length > 0 && files.every((file) => {
				const state = String(file?.state || '').trim().toLowerCase();
				return state === 'done' || state === 'failed';
			})) {
				return status;
			}

			await sleep(this.pollIntervalMs);
		}

		throw new Error('等待 MinerU 批量 Markdown 结果超时');
	}

	async downloadZip(zipUrl) {
		const parsedZipUrl = parseHttpUrl(zipUrl, 'MinerU zip');
		const safeZipUrl = sanitizeUrlForLog(parsedZipUrl.toString());
		this.log('zip:download:start', { zipUrl: safeZipUrl });
		const response = await fetchWithTimeout(parsedZipUrl, {}, FETCH_DOWNLOAD_TIMEOUT_MS);
		if (!response.ok) {
			throw new Error(`下载 MinerU zip 失败 (${response.status})`);
		}
		const buffer = await readResponseBodyWithLimit(response, MAX_ZIP_BYTES, 'MinerU zip');
		this.log('zip:download:done', {
			zipUrl: safeZipUrl,
			size: buffer.length,
		});
		return buffer;
	}

	async dispose() {
	}

	log(stage, payload) {
		try {
			this.logger?.log?.(`[mineru-upload] ${stage} ${JSON.stringify(payload)}`);
		}
		catch (error) {
			this.logger?.log?.(`[mineru-upload] ${stage}`, payload, error);
		}
	}
}

module.exports = {
	MineruMarkdownService,
	selectPreferredMarkdownOutput,
};
