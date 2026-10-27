import React, { useEffect, useRef, useState } from 'react';
import cx from 'classnames';
import IconChevronDown8 from '../../../../res/icons/8/chevron-8.svg';
import IconOutline from '../../../../res/icons/20/outline.svg';

const UI_TEXT = Object.freeze({
	zh: {
		aiNotes: 'AI 大纲',
		aiNavigation: 'AI 导航',
		generateAiNavigation: '生成 AI 导航',
		generateButton: '生成',
		generatingAiNavigation: '生成中...',
		clearAiNavigation: '清除 AI 导航',
		clearNavigationButton: '清除',
		clearNavigationConfirm: '清除 AI 导航？\n这不会影响 PDF 原生目录、用户批注或解析布局批注。',
		clearAiNotes: '清除 AI 注释',
		clearNotesButton: '清除',
		clearNotesConfirm: (count) => `清除 ${count} 条 AI 注释？\n这不会影响 PDF 原生目录、用户批注或解析布局批注。`,
		aiInsights: 'AI 洞察',
		clearAiInsights: '清除 AI 洞察',
		clearInsightsButton: '清除',
		clearInsightsConfirm: (count) => `清除 ${count} 条 AI 洞察？\n这不会影响用户批注和解析布局批注。`,
		innovation: '创新点',
		evidence: '关键证据',
		page: '页',
	},
	en: {
		aiNotes: 'AI Notes',
		aiNavigation: 'AI Navigation',
		generateAiNavigation: 'Generate AI Navigation',
		generateButton: 'Generate',
		generatingAiNavigation: 'Generating...',
		clearAiNavigation: 'Clear AI Navigation',
		clearNavigationButton: 'Clear',
		clearNavigationConfirm: 'Clear AI navigation?\nThis will not affect the native PDF outline, user annotations, or layout annotations.',
		clearAiNotes: 'Clear AI Notes',
		clearNotesButton: 'Clear',
		clearNotesConfirm: (count) => `Clear ${count} AI note${count === 1 ? '' : 's'}?\nThis will not affect the native PDF outline, user annotations, or layout annotations.`,
		aiInsights: 'AI Insights',
		clearAiInsights: 'Clear AI Insights',
		clearInsightsButton: 'Clear',
		clearInsightsConfirm: (count) => `Clear ${count} AI insight${count === 1 ? '' : 's'}?\nThis will not affect user annotations or layout annotations.`,
		innovation: 'Innovation',
		evidence: 'Evidence',
		page: 'p.',
	},
});

function normalizeLanguage(value) {
	return String(value || '').trim().toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function getUiText(language) {
	return UI_TEXT[normalizeLanguage(language)];
}

function isAIInsightAnnotation(annotation) {
	return Boolean(annotation?.aiInsightKind)
		|| /^ai-(?:evidence|insight)(?:-|$)/.test(String(annotation?.projectOrigin || ''));
}

function getInsightKind(annotation) {
	const explicitKind = String(annotation?.aiInsightKind || '').trim().toLowerCase();
	if (explicitKind === 'innovation' || explicitKind === 'innovative') {
		return 'innovation';
	}
	if (explicitKind === 'evidence') {
		return 'evidence';
	}
	const tags = Array.isArray(annotation?.tags) ? annotation.tags : [];
	const names = tags.map((tag) => String(tag?.name || tag || '').trim().toLowerCase()).filter(Boolean);
	if (names.some((name) => /^(?:创新点|innovation)/u.test(name))
		|| /^(?:创新点|innovation)\b/iu.test(String(annotation?.text || ''))) {
		return 'innovation';
	}
	return 'evidence';
}

function getInsightTitle(annotation, language) {
	const labels = getUiText(language);
	const text = String(annotation?.text || '').split(/\r?\n/u)[0].trim();
	const comment = String(annotation?.comment || '').replace(/^AI\s*(?:(?:关键)?(?:创新点|证据)|(?:innovation|evidence))[：:]\s*/iu, '').trim();
	return (text || comment || labels.aiInsights).replace(/^(?:创新点|关键证据|innovation|evidence)\s*(?:\d+)?\s*[：:]\s*/iu, '');
}

function getInsightPageLabel(annotation) {
	if (annotation?.pageLabel) {
		return String(annotation.pageLabel);
	}
	const pageIndex = Number(annotation?.position?.pageIndex);
	return Number.isInteger(pageIndex) && pageIndex >= 0 ? String(pageIndex + 1) : '';
}

function getAIInsightAnnotations(annotations) {
	return (annotations || [])
		.filter(isAIInsightAnnotation)
		.slice()
		.sort((left, right) => String(left.sortIndex || '').localeCompare(String(right.sortIndex || '')));
}

function groupAIInsights(annotations) {
	return {
		innovations: annotations.filter((annotation) => getInsightKind(annotation) === 'innovation'),
		evidence: annotations.filter((annotation) => getInsightKind(annotation) === 'evidence'),
	};
}

function InsightButton({ annotation, language, selectedIDs, onNavigate }) {
	const labels = getUiText(language);
	const kind = getInsightKind(annotation);
	const pageLabel = getInsightPageLabel(annotation);
	return (
		<button
			type="button"
			className={cx('ai-insight-outline-button', { selected: selectedIDs.includes(annotation.id) })}
			onClick={() => onNavigate({ annotationID: annotation.id }, { block: 'center' })}
		>
			<span
				className={cx('ai-insight-outline-kind', { innovation: kind === 'innovation' })}
				aria-label={labels[kind]}
				title={labels[kind]}
			/>
			<span className="ai-insight-outline-text">{getInsightTitle(annotation, language)}</span>
			{pageLabel && <span className="ai-insight-outline-page">{labels.page} {pageLabel}</span>}
		</button>
	);
}

function AIInsights({ annotations, selectedIDs, onNavigate, onClearAiInsights, language }) {
	const [expanded, setExpanded] = useState(true);
	useEffect(() => {
		// A newly created insight set should be visible; a user-triggered collapse
		// remains in effect while that set is still present.
		if (!annotations.length) {
			setExpanded(true);
		}
	}, [annotations.length]);
	if (!annotations.length) {
		return null;
	}
	const labels = getUiText(language);
	const groups = groupAIInsights(annotations);

	function handleClear() {
		const message = labels.clearInsightsConfirm(annotations.length);
		if (window.confirm(message)) {
			onClearAiInsights?.();
		}
	}

	return (
		<section className="ai-insights-outline" aria-label={labels.aiInsights}>
			<div className="ai-insights-outline-header">
				<button
					type="button"
					className="ai-insights-toggle"
					aria-expanded={expanded}
					onClick={() => setExpanded((value) => !value)}
				>
					<span className="ai-insights-outline-title">
					<span>{labels.aiInsights}</span>
					<span className="ai-insights-outline-count">{annotations.length}</span>
					</span>
					<IconChevronDown8 className={cx('ai-insights-toggle-icon', { collapsed: !expanded })}/>
				</button>
				<button
					type="button"
					className="ai-insights-clear"
					title={labels.clearAiInsights}
					aria-label={labels.clearAiInsights}
					onClick={handleClear}
				>{labels.clearInsightsButton}</button>
			</div>
			{expanded && ['innovation', 'evidence'].map((kind) => {
				const entries = kind === 'innovation' ? groups.innovations : groups.evidence;
				if (!entries.length) {
					return null;
				}
				return (
					<section key={kind} className={cx('ai-insight-section', { innovation: kind === 'innovation' })}>
						<div className="ai-insight-section-title">
							<span>{labels[kind]}</span>
							<span className="ai-insight-section-count">{entries.length}</span>
						</div>
						<ul className="ai-insights-outline-list">
							{entries.map((annotation) => (
								<li key={annotation.id} className="ai-insight-outline-item">
									<InsightButton annotation={annotation} language={language} selectedIDs={selectedIDs} onNavigate={onNavigate}/>
								</li>
							))}
						</ul>
					</section>
				);
			})}
		</section>
	);
}

function AIOutlineNotesHeader({ count, language, onClear }) {
	if (!count) {
		return null;
	}
	const labels = getUiText(language);
	function handleClear() {
		if (window.confirm(labels.clearNotesConfirm(count))) {
			onClear?.();
		}
	}
	return (
		<section className="ai-outline-notes-header" aria-label={labels.aiNotes}>
			<div className="ai-outline-notes-title">
				<span>{labels.aiNotes}</span>
				<span className="ai-outline-notes-count">{count}</span>
			</div>
			<button type="button" className="ai-outline-notes-clear" title={labels.clearAiNotes} aria-label={labels.clearAiNotes} onClick={handleClear}>{labels.clearNotesButton}</button>
		</section>
	);
}

function isMineruNavigationOutline(aiOutline) {
	const hasEntries = Array.isArray(aiOutline?.items) && aiOutline.items.length > 0;
	return hasEntries && (
		aiOutline?.outlineSource === 'mineru-json'
		|| aiOutline?.generationMode === 'mineru-navigation-v1'
	);
}

function getOutlineAnnotationCount(aiOutline) {
	return (Array.isArray(aiOutline?.items) ? aiOutline.items : [])
		.filter((item) => String(item?.annotation ?? item?.note ?? item?.summary ?? '').trim())
		.length;
}

function createMineruNavigationLocation(entry) {
	const position = entry?.position && typeof entry.position === 'object'
		? entry.position
		: null;
	if (position && Number.isInteger(Number(position.pageIndex))) {
		return { position };
	}
	const pageIndex = Number(entry?.pageIndex);
	return Number.isInteger(pageIndex) && pageIndex >= 0 ? { pageIndex } : null;
}

function buildMineruNavigationTree(entries) {
	const nodesByID = new Map();
	const roots = [];
	const stack = [];
	for (const entry of Array.isArray(entries) ? entries : []) {
		const id = String(entry?.id || '').trim();
		const title = String(entry?.originalTitle || entry?.title || '').trim();
		if (!id || !title || nodesByID.has(id)) {
			continue;
		}
		const node = {
			id,
			title,
			location: createMineruNavigationLocation(entry),
			items: [],
			// Keep generated levels collapsed until the user explicitly opens them.
			expanded: false,
			active: false,
			aiNavigationEntry: entry,
			level: Math.max(1, Number(entry?.level) || 1),
		};
		nodesByID.set(id, node);
		const parentID = String(entry?.parentID || entry?.parentId || '').trim();
		const namedParent = parentID ? nodesByID.get(parentID) : null;
		if (namedParent) {
			namedParent.items.push(node);
		}
		else {
			while (stack.length && stack[stack.length - 1].level >= node.level) {
				stack.pop();
			}
			const inferredParent = stack[stack.length - 1] || null;
			if (inferredParent) {
				inferredParent.items.push(node);
			}
			else {
				roots.push(node);
			}
		}
		stack.push(node);
	}
	return roots;
}

function MineruNavigationHeader({ count, language, onClear }) {
	const labels = getUiText(language);
	function handleClear() {
		if (window.confirm(labels.clearNavigationConfirm)) {
			onClear?.();
		}
	}
	return (
		<section className="ai-navigation-header" aria-label={labels.aiNavigation}>
			<div className="ai-navigation-title">
				<span>{labels.aiNavigation}</span>
				<span className="ai-navigation-count">{count}</span>
			</div>
			<button type="button" className="ai-navigation-clear" title={labels.clearAiNavigation} aria-label={labels.clearAiNavigation} onClick={handleClear}>{labels.clearNavigationButton}</button>
		</section>
	);
}

function AiNavigationEmptyState({ busy, language, onGenerate }) {
	const labels = getUiText(language);
	return (
		<section className="ai-navigation-empty" aria-label={labels.aiNavigation}>
			<div className="ai-navigation-empty-title" aria-hidden="true">
				<IconOutline/>
				<span>{labels.aiNavigation}</span>
			</div>
			<button
				type="button"
				className="ai-navigation-generate"
				disabled={busy || window.__codexAIEnabled === false}
				aria-busy={busy || undefined}
				aria-label={busy ? labels.generatingAiNavigation : labels.generateAiNavigation}
				title={busy ? labels.generatingAiNavigation : labels.generateAiNavigation}
				onClick={() => onGenerate?.()}
			>
				{busy ? labels.generatingAiNavigation : labels.generateButton}
			</button>
		</section>
	);
}

function clearActive(items) {
	for (let item of items) {
		item.active = false;
		if (item.items) {
			clearActive(item.items);
		}
	}
}

function setActive(outline, path) {
	let items = outline;
	for (let i = 0; i < path.length; i++) {
		const index = path[i];
		const item = items[index];
		if (!item) return;

		if (!item.expanded) {
			item.active = true;
			return;
		}

		if (i === path.length - 1) {
			item.active = true;
			return;
		}

		items = item.items || [];
	}
}

function needsActivation(outline, path) {
	let items = outline;
	let itemToActivate = null;

	for (let i = 0; i < path.length; i++) {
		const index = path[i];
		const item = items[index];
		if (!item) {
			return false;
		}

		if (!item.expanded) {
			itemToActivate = item;
			break;
		}

		if (i === path.length - 1) {
			itemToActivate = item;
			break;
		}

		items = item.items || [];
	}

	if (!itemToActivate) return false;
	return !!itemToActivate.active;
}

function createAIOutlineLookup(outline, aiOutline) {
	const itemOrders = new WeakMap();
	const annotations = new Map(
		(Array.isArray(aiOutline?.items) ? aiOutline.items : [])
			.map((entry) => {
				const annotation = String((entry?.annotation ?? entry?.note ?? entry?.summary) || '').trim();
				return [Number(entry?.nativeOutlineOrder), annotation ? { ...entry, annotation } : null];
			})
			.filter(([order, entry]) => Number.isInteger(order) && order > 0 && entry),
	);
	let order = 0;
	function visit(items) {
		for (const item of Array.isArray(items) ? items : []) {
			if (!item || typeof item !== 'object') {
				continue;
			}
			order += 1;
			itemOrders.set(item, order);
			visit(item.items);
		}
	}
	visit(outline);
	return {
		get(item) {
			return annotations.get(itemOrders.get(item)) || null;
		},
		count: annotations.size,
	};
}

function Item({ item, id, children, onOpenLink, onUpdate, onSelect, aiAnnotation }) {
	function handleExpandToggleClick() {
		item.expanded = !item.expanded;
		onUpdate();
	}

	function handlePointerDown() {
		onSelect(item);
	}

	function handleAiAnnotationClick(event) {
		event.preventDefault();
		event.stopPropagation();
		onSelect(item);
	}

	function handleDoubleClick() {
		if (item.items?.length) {
			handleExpandToggleClick();
		}
	}

	function handleURLClick(event) {
		event.preventDefault();
		onOpenLink(item.url);
	}

	let toggle;
	if (item.items?.length && item.childMatched !== false) {
		toggle = <div className="toggle" onClick={handleExpandToggleClick}><IconChevronDown8/></div>;
	}
	else {
		toggle = <div className="toggle"></div>;
	}

	let { expanded, active } = item;

	const nativeTitle = String(item.title || '');

	return (
		<li id={`outline-${id}`} aria-label={nativeTitle} data-ai-outline-order={aiAnnotation?.nativeOutlineOrder || undefined}>
			<div className={cx('item', { expandable: !!item.items?.length, unmatched: item.matched === false, expanded, active })} data-id={id}>
				{toggle}
					<div className="outline-item-content">
						<div className="title" title={nativeTitle} onPointerDown={handlePointerDown} onDoubleClick={handleDoubleClick}>
							{nativeTitle}{item.url && (<> [<a href={item.url} onClick={handleURLClick}>URL</a>]</>)}
						</div>
						{aiAnnotation?.annotation && (
							<button
								type="button"
								className="ai-outline-annotation"
								data-ai-outline-note-order={aiAnnotation.nativeOutlineOrder}
								title={aiAnnotation.annotation}
								onClick={handleAiAnnotationClick}
							>
								{aiAnnotation.annotation}
							</button>
						)}
					</div>
			</div>
			{children && <div className="children">{children}</div>}
		</li>
	);
}

function OutlineView({ outline, aiOutline, aiAnalysis, annotations, selectedIDs, currentOutlinePath, onNavigate, onOpenLink, onUpdate, onClearAiOutline, onClearAiInsights, onGenerateAiNavigation, uiLanguage }) {
	// Pending, failed and empty AI candidates must not hide the PDF bookmarks.
	if (aiOutline?.status !== "ready" || !Array.isArray(aiOutline.items) || !aiOutline.items.length || !aiOutline.items.every(item => String(item?.annotation ?? item?.note ?? item?.summary ?? "").trim())) aiOutline = null;
	let containerRef = useRef();
	let navigationCacheRef = useRef({ signature: '', items: [] });
	let [navigationRevision, setNavigationRevision] = useState(0);
	let language = normalizeLanguage(uiLanguage || aiOutline?.language);
	let insightAnnotations = getAIInsightAnnotations(annotations);
	let hasMineruNavigation = isMineruNavigationOutline(aiOutline);
	let navigationEntries = hasMineruNavigation && Array.isArray(aiOutline?.items) ? aiOutline.items : [];
	let navigationSignature = hasMineruNavigation
		? navigationEntries.map((entry) => [
			entry?.id,
			entry?.parentID,
			entry?.originalTitle || entry?.title,
			entry?.level,
			entry?.pageIndex,
			entry?.annotation || entry?.note || entry?.summary || '',
			JSON.stringify(entry?.position || null),
		].join('\u0001')).join('\u0002')
		: '';
	if (hasMineruNavigation && navigationCacheRef.current.signature !== navigationSignature) {
		navigationCacheRef.current = {
			signature: navigationSignature,
			items: buildMineruNavigationTree(navigationEntries),
		};
	}
	let displayOutline = hasMineruNavigation ? navigationCacheRef.current.items : outline;
	let aiOutlineLookup = hasMineruNavigation
		? { get: () => null, count: 0 }
		: createAIOutlineLookup(outline, aiOutline);
	let annotationCount = hasMineruNavigation ? getOutlineAnnotationCount(aiOutline) : aiOutlineLookup.count;
	let hasNativeOutline = Array.isArray(outline) && outline.length > 0;
	let canGenerateAiNavigation = !hasNativeOutline && Array.isArray(outline) && !hasMineruNavigation;

	useEffect(() => {
		if (!hasMineruNavigation && Array.isArray(outline) && currentOutlinePath && !needsActivation(outline, currentOutlinePath)) {
			clearActive(outline);
			setActive(outline, currentOutlinePath);
			handleUpdate();
			setTimeout(() => {
				containerRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			}, 200);
		}
	}, [currentOutlinePath, hasMineruNavigation, outline]);

	function handleUpdate() {
		if (hasMineruNavigation) {
			setNavigationRevision((value) => value + 1);
			return;
		}
		onUpdate?.([...(Array.isArray(outline) ? outline : [])]);
	}

	function handleSelect(item) {
		clearActive(Array.isArray(displayOutline) ? displayOutline : []);
		item.active = true;
		handleUpdate();
		if (item.location) {
			onNavigate(item.location, { block: 'start' });
		}
	}

	function flatten(items, list = []) {
		for (let item of items) {
			if ((item.matched !== false) || (item.childMatched !== false)) {
				list.push(item);
			}
			if (item.items && item.expanded && (item.childMatched !== false)) {
				flatten(item.items, list);
			}
		}
		return list;
	}

	function handleKeyDown(event) {
		let { key } = event;
		let list = flatten(displayOutline || []);
		let currentIndex = list.findIndex(x => x.active);
		let currentItem = list[currentIndex];
		if (!currentItem) return;

		if (key === 'ArrowUp') {
			let previousItem = list[currentIndex - 1];
			if (previousItem) {
				clearActive(displayOutline);
				previousItem.active = true;
				if (previousItem.location) onNavigate(previousItem.location, { block: 'start' });
				let element = containerRef.current.querySelector(`[data-id="${currentIndex - 1}"]`);
				if (element) element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			}
		}
		else if (key === 'ArrowDown') {
			let nextItem = list[currentIndex + 1];
			if (nextItem) {
				clearActive(displayOutline);
				nextItem.active = true;
				if (nextItem.location) onNavigate(nextItem.location, { block: 'start' });
				let element = containerRef.current.querySelector(`[data-id="${currentIndex + 1}"]`);
				if (element) element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			}
		}
		else if (key === 'Enter') {
			if (currentItem.items.length) currentItem.expanded = !currentItem.expanded;
			else if (currentItem.url) onOpenLink(currentItem.url);
		}
		else if (!window.rtl && event.key === 'ArrowLeft' || window.rtl && event.key === 'ArrowRight') {
			if (currentItem.items.length) currentItem.expanded = false;
		}
		else if (!window.rtl && event.key === 'ArrowRight' || window.rtl && event.key === 'ArrowLeft') {
			if (currentItem.items.length) currentItem.expanded = true;
		}
		else return;
		handleUpdate();
	}

	function renderItems(items, counter = ({ n: -1 })) {
		return (
			<ul>{items.map((item, index) => {
				counter.n++;
				const navigationAnnotation = String(item?.aiNavigationEntry?.annotation ?? item?.aiNavigationEntry?.note ?? item?.aiNavigationEntry?.summary ?? '').trim();
				const aiAnnotation = hasMineruNavigation
					? (navigationAnnotation ? { ...item.aiNavigationEntry, annotation: navigationAnnotation } : null)
					: aiOutlineLookup.get(item);
				return ((item.matched !== false) || (item.childMatched !== false)) && (
					<Item key={item.id || index} item={item} aiAnnotation={aiAnnotation} id={counter.n} onOpenLink={onOpenLink} onUpdate={handleUpdate} onSelect={handleSelect}>
						{item.expanded && item?.items && renderItems(item.items, counter)}
					</Item>
				);
			})}</ul>
		);
	}

	let active = flatten(displayOutline || []).findIndex(item => item.active);
	return (
		<div ref={containerRef} className={cx('outline-view', { loading: !hasMineruNavigation && outline === null && !insightAnnotations.length, 'ai-outline-ready': annotationCount > 0 || hasMineruNavigation, 'ai-navigation-available': canGenerateAiNavigation })} data-tabstop="1" tabIndex={-1} id="outlineView" role="listbox" aria-labelledby="viewOutline" onKeyDown={handleKeyDown} aria-activedescendant={active !== -1 ? `outline-${active}` : null} data-ai-outline-count={annotationCount} data-ai-navigation-count={hasMineruNavigation ? navigationEntries.length : 0} data-ai-navigation-state={hasMineruNavigation ? 'ready' : (canGenerateAiNavigation ? 'available' : 'none')} data-ai-navigation-version={navigationRevision}>
			{hasMineruNavigation
				? <MineruNavigationHeader count={navigationEntries.length} language={language} onClear={onClearAiOutline}/>
				: <AIOutlineNotesHeader count={annotationCount} language={language} onClear={onClearAiOutline}/>
			}
			{!hasMineruNavigation && outline === null
				? <div className="outline-loading"><div className="spinner"/></div>
				: (canGenerateAiNavigation
					? <AiNavigationEmptyState busy={!!aiAnalysis?.navigationBusy} language={language} onGenerate={onGenerateAiNavigation}/>
					: renderItems(displayOutline || []))}
			<AIInsights annotations={insightAnnotations} selectedIDs={selectedIDs || []} onNavigate={onNavigate} onClearAiInsights={onClearAiInsights} language={language}/>
		</div>
	);
}

export default OutlineView;
