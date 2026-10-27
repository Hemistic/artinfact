import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalization } from '@fluent/react';
import cx from 'classnames';
import { ANNOTATION_COLORS } from '../../defines';
import ViewPopup from './common/view-popup';
import CustomSections from '../common/custom-sections';

import { IconColor16 } from '../common/icons';

import IconHighlight from '../../../../res/icons/16/annotate-highlight.svg';
import IconUnderline from '../../../../res/icons/16/annotate-underline.svg';

const AUTO_TRANSLATE_DELAY_MS = 450;
const MAX_STREAMED_TRANSLATION_CHARS = 120000;

function toVisibleDebugString(value) {
	if (typeof value !== 'string') {
		return '';
	}
	return JSON.stringify(value);
}

function toCodePoints(value) {
	if (typeof value !== 'string') {
		return [];
	}
	return Array.from(value).map((char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
}

function postSelectionDebugLog(payload) {
	void payload;
}

function formatDictionaryComment(result) {
	const lines = [];
	const phonetics = [];
	if (result.phonetics?.pronunciation) phonetics.push(result.phonetics.pronunciation);

	if (result.phonetics?.us) {
		phonetics.push(`US ${result.phonetics.us}`);
	}
	if (result.phonetics?.uk) {
		phonetics.push(`UK ${result.phonetics.uk}`);
	}
	if (phonetics.length) {
		lines.push(phonetics.join(' | '));
	}
	for (const meaning of result.meanings || []) {
		lines.push([meaning.pos, meaning.definition].filter(Boolean).join(' '));
	}
	return lines.filter(Boolean).join('\n');
}

function getCommentFromTranslation(result) {
	if (!result) {
		return '';
	}
	if (result.mode === 'dictionary') {
		return formatDictionaryComment(result);
	}
	return result.translatedText || '';
}

function SelectionPopup(props) {
	const { l10n } = useLocalization();
	const [translationState, setTranslationState] = useState({
		status: 'idle',
		result: null,
		partialText: '',
		error: '',
	});
	const [retryToken, setRetryToken] = useState(0);
	const requestIdRef = useRef(0);
	const selectionKey = useMemo(() => JSON.stringify({
		text: props.params.annotation?.text || '',
		sortIndex: props.params.annotation?.sortIndex || '',
		position: props.params.annotation?.position || null,
	}), [props.params.annotation]);
	const selectionText = props.params.annotation?.text || '';
	const translationComment = useMemo(
		() => getCommentFromTranslation(translationState.result),
		[translationState.result],
	);
	const canAddBilingualAnnotation = translationState.status === 'success' && !!translationComment;
	const disableAnnotationActions = !!props.readOnly;

	function handleColorPick(color) {
		if (disableAnnotationActions) {
			return;
		}
		let type = props.textSelectionAnnotationMode;
		props.onAddAnnotation({ ...props.params.annotation, type, color });
	}

	function handleAddToNote() {
		props.onAddToNote([props.params.annotation]);
	}

	function handleAddToWorkspaceNote() {
		if (typeof props.onAddSelectionToWorkspaceNote !== 'function') {
			return;
		}
		props.onAddSelectionToWorkspaceNote({
			annotation: props.params.annotation,
			translatedText: translationState.status === 'success' ? translationComment : '',
		});
	}

	function handleRetry() {
		setRetryToken((value) => value + 1);
	}

	function handleAddBilingualAnnotation() {
		if (!canAddBilingualAnnotation || disableAnnotationActions) {
			return;
		}
		props.onAddAnnotation({
			...props.params.annotation,
			type: 'highlight',
			color: props.highlightColor || ANNOTATION_COLORS[0][1],
			comment: translationComment,
		}, true);
	}

	useEffect(() => {
		if (!props.selectionTranslator || !selectionText) {
			setTranslationState({
				status: 'idle',
				result: null,
				partialText: '',
				error: '',
			});
			return undefined;
		}

		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;
		setTranslationState({
			status: 'loading',
			result: null,
			partialText: '',
			error: '',
		});

		const timeoutId = setTimeout(async () => {
			try {
				postSelectionDebugLog({
					source: 'selection-translation',
					stage: 'before-lookup',
					selectionText,
					selectionTextVisible: toVisibleDebugString(selectionText),
					selectionTextLength: selectionText.length,
					selectionTextCodePoints: toCodePoints(selectionText),
				});

				const result = await props.selectionTranslator({
					text: selectionText,
					from: 'en',
					to: 'zh-Hans',
				}, {
					onProgress: (progress) => {
						const delta = typeof progress?.delta === 'string' ? progress.delta : '';
						if (!delta || requestIdRef.current !== requestId) {
							return;
						}
						setTranslationState((current) => {
							const previous = typeof current.partialText === 'string' ? current.partialText : '';
							const nextText = `${previous}${delta}`.slice(0, MAX_STREAMED_TRANSLATION_CHARS);
							return {
								status: 'streaming',
								result: null,
								partialText: nextText,
								error: '',
							};
						});
					},
				});

				postSelectionDebugLog({
					source: 'selection-translation',
					stage: 'after-lookup',
					selectionText,
					selectionTextVisible: toVisibleDebugString(selectionText),
					selectionTextLength: selectionText.length,
					selectionTextCodePoints: toCodePoints(selectionText),
					mode: result?.mode || '',
					type: result?.type || '',
					headword: result?.headword || '',
					phonetics: result?.phonetics || null,
					meanings: Array.isArray(result?.meanings) ? result.meanings : null,
					meaningsCount: Array.isArray(result?.meanings) ? result.meanings.length : 0,
					translatedText: result?.translatedText || '',
					debug: result?.debug || null,
				});

				if (requestIdRef.current !== requestId) {
					return;
				}
				setTranslationState({
					status: 'success',
					result,
					partialText: '',
					error: '',
				});
			}
			catch (error) {
				postSelectionDebugLog({
					source: 'selection-translation',
					stage: 'lookup-error',
					selectionText,
					selectionTextVisible: toVisibleDebugString(selectionText),
					selectionTextLength: selectionText.length,
					selectionTextCodePoints: toCodePoints(selectionText),
					error: error instanceof Error ? error.message : String(error),
				});

				if (requestIdRef.current !== requestId) {
					return;
				}
				setTranslationState({
					status: 'error',
					result: null,
					partialText: '',
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}, AUTO_TRANSLATE_DELAY_MS);

		return () => {
			clearTimeout(timeoutId);
			requestIdRef.current++;
		};
	}, [props.selectionTranslator, retryToken, selectionKey, selectionText]);

	return (
		<ViewPopup
			className="selection-popup"
			rect={props.params.rect}
			uniqueRef={selectionKey}
			padding={20}
		>
			<div className="colors" data-tabstop={1}>
				{ANNOTATION_COLORS.map((color, index) => (<button
					key={index}
					tabIndex={-1}
					className="toolbar-button color-button"
					title={l10n.getString(color[0])}
					disabled={disableAnnotationActions}
					onClick={() => handleColorPick(color[1])}
				><IconColor16 color={color[1]}/></button>))}
			</div>
			<div className="tool-toggle" data-tabstop={1}>
				<button
					tabIndex={-1}
					className={cx('highlight', { active: props.textSelectionAnnotationMode === 'highlight' })}
					title={l10n.getString('reader-highlight-text')}
					disabled={disableAnnotationActions}
					onClick={() => props.onChangeTextSelectionAnnotationMode('highlight')}
				><IconHighlight/></button>
				<button
					tabIndex={-1}
					className={cx('underline', { active: props.textSelectionAnnotationMode === 'underline' })}
					title={l10n.getString('reader-underline-text')}
					disabled={disableAnnotationActions}
					onClick={() => props.onChangeTextSelectionAnnotationMode('underline')}
				><IconUnderline/></button>
			</div>
			{window.__codexTranslateButton?.(React, props.params.annotation)}
			{props.selectionTranslator ? (
				<button
					className="toolbar-button wide-button"
					data-tabstop={1}
					disabled={!canAddBilingualAnnotation || disableAnnotationActions}
					onClick={handleAddBilingualAnnotation}
				>
					添加原文和译文到批注栏
				</button>
			) : props.enableAddToNote &&
				<button className="toolbar-button wide-button" data-tabstop={1} onClick={handleAddToNote}>
					{l10n.getString('reader-add-to-note')}
				</button>}
			{typeof props.onAddSelectionToWorkspaceNote === 'function' && (
				<button className="toolbar-button wide-button" data-tabstop={1} onClick={handleAddToWorkspaceNote}>
					添加到笔记
				</button>
			)}
			{props.selectionTranslator && (
				<div className="translation-result">
					{(translationState.status === 'loading' || translationState.status === 'streaming') && (
						<div className="translation-card translation-text-card">
							{translationState.partialText ? (
								<div className="translation-text translation-text-scroll">{translationState.partialText}</div>
							) : (
								<div className="translation-status">正在自动翻译...</div>
							)}
							{translationState.partialText && (
								<div className="translation-status translation-streaming-status">正在翻译...</div>
							)}
						</div>
					)}
					{translationState.status === 'error' && (
						<div className="translation-error">
							<div className="translation-status">翻译失败</div>
							<div className="translation-error-message">{translationState.error}</div>
							<button className="toolbar-button retry-button" onClick={handleRetry}>
								重试
							</button>
						</div>
					)}
					{translationState.status === 'success' && translationState.result?.mode === 'dictionary' && (
						<div className="translation-card">
							<div className="translation-headword">{translationState.result.headword || selectionText}</div>
							{translationState.result.phonetics?.pronunciation && <div className="translation-phonetics">音标 {translationState.result.phonetics.pronunciation}</div>}
							{!!(translationState.result.phonetics?.us || translationState.result.phonetics?.uk) && (
								<div className="translation-phonetics">
									{translationState.result.phonetics?.us && (
										<span>US {translationState.result.phonetics.us}</span>
									)}
									{translationState.result.phonetics?.uk && (
										<span>UK {translationState.result.phonetics.uk}</span>
									)}
								</div>
							)}
							<div className="translation-meanings">
								{(translationState.result.meanings || []).map((meaning, index) => (
									<div key={index} className="translation-meaning">
										<span className="translation-pos">{meaning.pos}</span>
										<span>{meaning.definition}</span>
									</div>
								))}
							</div>
						</div>
					)}
					{translationState.status === 'success' && translationState.result?.mode === 'translation' && (
						<div className="translation-card translation-text-card">
							<div className="translation-text translation-text-scroll">{translationState.result.translatedText}</div>
						</div>
					)}
				</div>
			)}
			<CustomSections type="TextSelectionPopup" annotation={props.params.annotation}/>
		</ViewPopup>
	);
}

export default SelectionPopup;
