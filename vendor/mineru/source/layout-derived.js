const {randomUUID}=require('node:crypto');const createID=()=>randomUUID().replaceAll('-','').slice(0,16);const nowISO=()=>new Date().toISOString();const {normalizeMineruContentListPages,buildMineruLayoutMediaGroups}=require('./mineru-layout-normalizer');
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


module.exports={extractLayoutAnnotationsFromContentList,extractLayoutAnnotationsFromLegacyJson,mapContentListRectToPdfRect,buildContentListCoordinateSpace};
