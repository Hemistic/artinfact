import { build } from 'esbuild';
import {katexStyles} from './katex-css.mjs';
import {noteUiStyles} from './note-ui-css.mjs';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, dirname, join, relative, extname } from 'node:path';

const root = resolve('vendor/zotero-reader/runtime');
const scratch = resolve('.preview-data/reader-build');
const debug = process.env.CODEX_PLUGIN_DEBUG === '1';
await mkdir(scratch, { recursive: true });
const script = code => `<script>${code.replaceAll('</script', '<\\/script')}</script>`;
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const patch = (code, from, to) => {
  if (code.split(from).length !== 2) throw new Error(`Reader snapshot changed: ${from.slice(0, 70)}`);
  return code.replace(from, () => to);
};
const mime = { '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf' };
async function inlineCss(path) {
  const input = await readFile(path, 'utf8');
  const matches = [...input.matchAll(/url\(\s*(["']?)([^)"']+)\1\s*\)/g)];
  let output = input;
  for (const match of matches) {
    const url = match[2].trim(); if (/^(data:|#)/.test(url)) continue;
    const file = resolve(dirname(path), url.split(/[?#]/)[0]);
    if (relative(root, file).startsWith('..')) throw new Error(`CSS resource outside reader: ${url}`);
    const data = (await readFile(file)).toString('base64');
    output = output.replaceAll(match[0], `url("data:${mime[extname(file)] ?? 'application/octet-stream'};base64,${data}")`);
  }
  return output;
}
const assets = {};
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  for (const name of await readdir(join(root, 'pdf/web', directory))) {
    if (/^(LICENSE|README)/.test(name)) continue;
    assets[`${directory}/${name}`] = (await readFile(join(root, 'pdf/web', directory, name))).toString('base64');
  }
}
let worker = await readFile(join(root, 'pdf/build/pdf.worker.mjs'), 'utf8');
const fallback = `data:text/javascript;base64,${assets['wasm/openjpeg_nowasm_fallback.js']}`;
worker = patch(worker, 'const path = `${this.#wasmUrl}openjpeg_nowasm_fallback.js`;', `const path = ${JSON.stringify(fallback)};`);
await writeFile(join(scratch, 'worker.mjs'), worker);
let viewer = await readFile(join(root, 'pdf/web/viewer.mjs'), 'utf8');
// Viewer options otherwise reset an explicitly configured, bundled Worker port to null.
viewer=patch(viewer,'Object.assign(GlobalWorkerOptions, workerParams);','workerParams.workerPort = GlobalWorkerOptions.workerPort ?? workerParams.workerPort; Object.assign(GlobalWorkerOptions, workerParams);');
viewer = patch(viewer, '...apiParams,\n      ...args', '...apiParams,\n      ...window.__codexPdfOptions,\n      ...args');
const dedicatedWorker=(await build({stdin:{contents:worker.replaceAll('import.meta.url','self.location.href'),resolveDir:root},bundle:true,write:false,platform:'browser',target:'es2022',format:'iife',minify:!debug,legalComments:'none'})).outputFiles[0].text;
viewer = `import * as api from ${JSON.stringify(join(root, 'pdf/build/pdf.mjs'))}; import { prepareLocalViewer } from ${JSON.stringify(resolve('src/ui/viewer-local.ts'))}; globalThis.pdfjsLib=api; const workerUrl=URL.createObjectURL(new Blob([${JSON.stringify(dedicatedWorker)}],{type:'text/javascript'}));const pdfWorker=new Worker(workerUrl,{name:'Artinfact PDF'});pdfWorker.addEventListener('error',event=>window.parent.__codexPost?.({type:'codex-reader:error',payload:{message:'PDF Worker: '+event.message}}));api.GlobalWorkerOptions.workerPort=pdfWorker;addEventListener('pagehide',()=>{pdfWorker.terminate();URL.revokeObjectURL(workerUrl);},{once:true});prepareLocalViewer();\n` + viewer;
await writeFile(join(scratch, 'viewer.mjs'), viewer);
const viewerBundle = await build({
  entryPoints: [join(scratch, 'viewer.mjs')],
  bundle: true, write: false, platform: 'browser', target: 'es2022', format: 'esm', minify: !debug, sourcemap: debug ? 'inline' : false, legalComments: 'inline',
});
const viewerCss = await inlineCss(join(root, 'pdf/web/viewer.css'));
const themeCss = await readFile('src/ui/reader-theme.css', 'utf8');
const viewerHtml = (await readFile(join(root, 'pdf/web/viewer.html'), 'utf8'))
  .replace(/<script[^>]*\ssrc=[^>]*><\/script>/g, '')
  .replace('<link rel="stylesheet" href="viewer.css">', () => `<style>${viewerCss}${themeCss}</style>`);
const inlineViewer = viewerHtml.replace('</head>', () => `${script(`for(const type of ['error','unhandledrejection'])addEventListener(type,event=>window.parent.__codexPost?.({type:'codex-reader:error',payload:{message:'PDF 内核: '+String(event.message||event.reason?.message||event.reason).slice(0,400)}}));addEventListener('securitypolicyviolation',event=>window.parent.__codexPost?.({type:'codex-reader:error',payload:{message:'PDF 资源策略: '+event.violatedDirective+' '+event.blockedURI}}));window.__CODEX_ASSETS__=${json(assets)};`)}<script type="module">${viewerBundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></head>`);
let reader = await readFile(join(root, 'reader.js'), 'utf8');
for(const [start,end]of [['function PopupPreview(props) {','function SidebarPreview(props) {'],['function SidebarPreview(props) {','/* harmony default export */']]){
 const from=reader.indexOf(start),to=reader.indexOf(end,from+start.length);
 if(from<0||to<0)throw Error('Reader annotation preview changed');
 const section=reader.slice(from,to),anchor=/  let \{\n    annotation(?:,\n    state,\n    type)?\n  \} = props;/;
 if(!anchor.test(section))throw Error('Reader preview annotation binding changed');
 reader=reader.slice(0,from)+section.replace(anchor,match=>match+'\n  annotation = window.__codexLayoutPreview(annotation);')+reader.slice(to);
}
// Focus and citation refresh can arrive before PDF.js has created its page views.
reader = patch(reader, '    this._a11yVirtualCursorTarget = page.div;', '    if (!page?.div) return;\n    this._a11yVirtualCursorTarget = page.div;');
reader = patch(reader, "    while (!page.div.querySelector('.textLayer') && waitCounter < 5)", "    if (!page?.div) return;\n    while (!page.div.querySelector('.textLayer') && waitCounter < 5)");
reader = patch(reader, 'disabled: !props.enableNavigateBack,', 'disabled: !window.__codexBackEnabled(props.enableNavigateBack),');
reader = patch(reader, 'onClick: props.onNavigateBack', 'onClick: window.__codexBackAction(props.onNavigateBack)');
reader = patch(reader, "title: l10n.getString('general-back'),", "title: window.__codexGraphReturn ? (document.documentElement.lang.startsWith('en') ? 'Return to graph' : '返回刚才的图谱') : l10n.getString('general-back'),");
reader = patch(reader, '    let existingAnnotation = this._getAnnotationByID(annotation.id);\n      if (existingAnnotation.readOnly', '    let existingAnnotation = this._getAnnotationByID(annotation.id);\n      if (!existingAnnotation) {\n        if (annotations.length === 1 && annotation.image && Object.keys(annotation).length === 2) return;\n        throw new Error("Cannot update missing annotation");\n      }\n      if (existingAnnotation.readOnly');
reader = patch(reader, '  _highlightPosition(position) {\n    this._highlightedPosition = position;\n    this._render();\n    setTimeout(() => {\n      this._highlightedPosition = null;\n      this._render();\n    }, 2000);\n  }', '  _highlightPosition(position, duration = 2000) {\n    clearTimeout(this._positionHighlightTimer);\n    this._highlightedPosition = position;\n    this._render();\n    this._positionHighlightTimer = setTimeout(() => {\n      this._highlightedPosition = null;\n      this._render();\n    }, duration);\n  }');
reader = patch(reader, 'this._highlightPosition(location.position);', 'this._highlightPosition(location.position, Math.max(2000, Math.min(10000, options.highlightDuration || 2000)));');
reader = patch(reader, '  let containerRef = (0,react__WEBPACK_IMPORTED_MODULE_0__.useRef)();\n  let navigationCacheRef', "  // Pending, failed and empty AI candidates must not hide the PDF bookmarks.\n  if (aiOutline?.status !== \"ready\" || !Array.isArray(aiOutline.items) || !aiOutline.items.length || !aiOutline.items.every(item => String(item?.annotation ?? item?.note ?? item?.summary ?? \"\").trim())) aiOutline = null;\n" + '  let containerRef = (0,react__WEBPACK_IMPORTED_MODULE_0__.useRef)();\n  let navigationCacheRef');
// The vendored reader is a compiled snapshot; mirror the preserved source changes here.
reader = patch(reader, "function normalizeSelectionTranslationProvider(value) {", "function normalizeSelectionTranslationProvider(value) {\n  if (value === 'google') return 'google';");
reader = patch(reader, "const timeoutMs = requestPayload.provider === 'bing' ? 15000 : 45000;", "const timeoutMs = 120000;");
reader = patch(reader, "    llmModel: currentSettings.selectionLlmModel", "    from: 'auto-detect', to: currentSettings.translationTarget || 'zh-Hans',\n    llmModel: currentSettings.selectionLlmModel");
reader = patch(reader, "    return () => {\n      clearTimeout(timeoutId);\n    };\n  }, [props.selectionTranslator,", "    return () => {\n      clearTimeout(timeoutId); requestIdRef.current++;\n    };\n  }, [props.selectionTranslator,");
const selectionStart = reader.indexOf('function SelectionPopup(props) {');
const selectionEnd = reader.indexOf('/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (SelectionPopup);', selectionStart);
if (selectionStart < 0 || selectionEnd < 0) throw new Error('Reader selection popup changed');
const selectionPopup = reader.slice(selectionStart, selectionEnd);
reader = patch(reader, selectionPopup, patch(selectionPopup, 'props.selectionTranslator ?', 'window.__codexTranslateButton(react__WEBPACK_IMPORTED_MODULE_0___default(), props.params.annotation), props.selectionTranslator ?'));
const escapedLabel = text => [...text].map(char => '\\u' + char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('');
reader = patch(reader, escapedLabel('添加中英译文到批注栏'), escapedLabel('添加原文和译文到批注栏'));
const translator = 'currentSettings.selectionTranslationEnabled ? lookupSelection : null';
if (reader.split(translator).length !== 3) throw new Error('Reader translation registration changed');
reader = reader.replaceAll(translator, 'window.__codexSelectionTranslator(lookupSelection, currentSettings)');
reader = patch(reader, '}, translationState.result.headword || selectionText), !!(translationState.result.phonetics?.us', '}, translationState.result.headword || selectionText), translationState.result.phonetics?.pronunciation && react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", {className:"translation-phonetics"}, "音标 ", translationState.result.phonetics.pronunciation), !!(translationState.result.phonetics?.us');
reader = patch(reader, '  const phonetics = [];\n  if (result.phonetics?.us)', '  const phonetics = [];\n  if (result.phonetics?.pronunciation) phonetics.push(result.phonetics.pronunciation);\n  if (result.phonetics?.us)');
reader = patch(reader, "role: \"tablist\"\n  }, props.type ===", "role: \"tablist\"\n  }, window.__codexPdfTab(react__WEBPACK_IMPORTED_MODULE_0___default(), props), props.type ===");
reader = patch(reader, "id: \"sidebarContent\",\n    className: \"sidebar-content\"\n  },", "id: \"sidebarContent\",\n    className: \"sidebar-content\"\n  }, window.__codexPdfPanel(react__WEBPACK_IMPORTED_MODULE_0___default(), props),");
if (reader.split("aiNotes: 'AI 注释',").length !== 3) throw new Error('Reader AI labels changed');
reader = reader.replaceAll("aiNotes: 'AI 注释',", "aiNotes: 'AI 大纲',");
reader = patch(reader, 'const analysisBusy = outlineBusy || insightsBusy;', 'labels.generateAiNotes = labels.generateAiNotes?.replace("AI 注释", "AI 大纲");\n  labels.regenerateAiNotes = labels.regenerateAiNotes?.replace("AI 注释", "AI 大纲");\n  const suspended = window.__codexAIEnabled === false;\n  const analysisBusy = outlineBusy || insightsBusy;');
for (const name of ['notes', 'insights']) reader = patch(reader, `className: "sidebar-ai-action ${name}",\n    disabled: analysisBusy,`, `className: "sidebar-ai-action ${name}",\n    "data-paused": suspended || undefined,\n    disabled: analysisBusy || suspended,`);
reader = patch(reader, 'title: `${notesTitle}${requirementTitle}`,', 'title: suspended ? "AI 大纲暂未开放" : `${notesTitle}${requirementTitle}`,');
reader = patch(reader, 'title: `${insightsTitle}${requirementTitle}`,', 'title: suspended ? "AI 洞察暂未开放" : `${insightsTitle}${requirementTitle}`,');
reader = patch(reader, 'className: "ai-navigation-generate",\n    disabled: busy,', 'className: "ai-navigation-generate",\n    disabled: busy || window.__codexAIEnabled === false,');
reader = patch(reader, '  reader = new _common_reader__WEBPACK_IMPORTED_MODULE_0__["default"]({', '  reader = new _common_reader__WEBPACK_IMPORTED_MODULE_0__["default"]({\n    onSetDataTransferAnnotations: window.__codexDataTransfer,');
reader = patch(reader, 'function installClaudeSelectionHooks() {', 'function installClaudeSelectionHooks() {\n  window.__codexReselect = () => { window.__codexForceSelection = true; scheduleClaudeSelectionSync(220); };');
reader = patch(reader, '  if (signature === lastPostedClaudeSelectionSignature) {', '  if (signature === lastPostedClaudeSelectionSignature && !window.__codexForceSelection) {');
reader = patch(reader, "  postToShell('electron-reader-selection-change', {\n    selection: selection ? clone(selection) : null\n  });", "  postToShell('electron-reader-selection-change', {\n    selection: selection ? clone(selection) : null, force: window.__codexForceSelection === true\n  });\n  window.__codexForceSelection = false;");
const multiStart = reader.indexOf('  if (selectedIDs.length !== 1) {', reader.indexOf('async function buildAnnotationClaudeSelection()'));
const multiEnd = reader.indexOf('  const selectedAnnotation =', multiStart);
if (multiStart < 0 || multiEnd < 0) throw new Error('Reader annotation selection changed');
reader = patch(reader, reader.slice(multiStart, multiEnd), '  if (!selectedIDs.length || selectedIDs.length > 8) return null;\n');
reader = patch(reader, '    selectedAnnotationIDs: selectedIDs\n  };', "    selectedAnnotationIDs: selectedIDs,\n    selectedAnnotations: reader._state.annotations.filter(a => selectedIDs.includes(a.id)).map(a => ({ id: a.id, type: a.type, layoutKind: a.layoutKind }))\n  };");
const themesStart = reader.indexOf('const DEFAULT_THEMES = [{');
const themesEnd = reader.indexOf('const A11Y_VIRT_CURSOR_DEBOUNCE_LENGTH = 500; // ms', themesStart);
if (themesStart < 0 || themesEnd < 0) throw new Error('Reader theme registry changed');
reader = patch(reader, reader.slice(themesStart, themesEnd), 'const DEFAULT_THEMES = window.__CODEX_GPT_THEMES__;\n');
reader = patch(reader, 'const A11Y_VIRT_CURSOR_DEBOUNCE_LENGTH = 500; // ms', 'window.__CODEX_BUILTIN_THEMES__ = DEFAULT_THEMES;\nconst A11Y_VIRT_CURSOR_DEBOUNCE_LENGTH = 500; // ms');
reader = patch(reader, 'function handleReaderThemeSelection(themeID, colorScheme) {', 'function handleReaderThemeSelection(themeID, colorScheme) {\n  if (window.__codexSelectTheme(themeID)) return;');
reader = patch(reader, "colorScheme: currentSettings.theme === 'dark' ? 'dark' : 'light',", "colorScheme: currentSettings.theme === 'dark' ? 'dark' : 'light',\n    lightTheme: 'gpt-light', darkTheme: 'gpt-dark',");
if (reader.split('applySettings(currentSettings);').length !== 3) throw new Error('Reader post-initialization settings snapshot changed');
reader = reader.replaceAll('applySettings(currentSettings);', 'applySettings(currentSettings); window.__codexSyncHostTheme();');
const legacyTheme = `    reader.setColorScheme(currentSettings.theme === 'dark' ? 'dark' : 'light');\n    if (currentSettings.theme === 'dark') {\n      reader.setDarkTheme('dark');\n    } else {\n      reader.setLightTheme();\n    }`;
reader = patch(reader, legacyTheme, '    window.__codexSyncHostTheme();');
const appearanceStart = reader.indexOf('className: "option themes"');
const appearanceEnd = reader.indexOf('\n}\n/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (AppearancePopup);', appearanceStart);
if (appearanceStart < 0 || appearanceEnd < 0) throw new Error('Reader appearance popup changed');
reader = patch(reader, reader.slice(appearanceStart, appearanceEnd), 'className: "option themes"\n  }, window.__codexThemeControls(react__WEBPACK_IMPORTED_MODULE_0___default())' + ')'.repeat(4) + ';');
reader = patch(reader, 'function setTextLayerSelection(win, selectionRanges) {', 'function setTextLayerSelection(win, selectionRanges) {\n  if (!selectionRanges.length) return;');
reader = patch(reader, `  let {\n    node: startNode,\n    offset: startOffset\n  } = getNodeOffset(container, offset);`, `  const start = getNodeOffset(container, offset);\n  if (!start || !start.node.isConnected) return;\n  let { node: startNode, offset: startOffset } = start;`);
reader = patch(reader, `  let {\n    node: endNode,\n    offset: endOffset\n  } = getNodeOffset(container, offset);`, `  const end = getNodeOffset(container, offset);\n  if (!end || !end.node.isConnected) return;\n  let { node: endNode, offset: endOffset } = end;`);
// Repeated host notifications and inactive theme updates must not reset PDF text layers.
reader = patch(reader, `    if (this._iframeWindow) {\n      this._iframeWindow.document.documentElement.dataset.colorScheme = this._colorScheme;`, `    if (this._iframeWindow) {\n      const paperTheme = this._colorScheme === 'light' ? this._lightTheme : this._darkTheme;\n      const themeKey = JSON.stringify([this._colorScheme, paperTheme?.background, paperTheme?.foreground, paperTheme?.invertImages]);\n      if (this._codexThemeKey === themeKey) return;\n      this._codexThemeKey = themeKey;\n      this._iframeWindow.document.documentElement.dataset.colorScheme = this._colorScheme;`);
const button = 'react__WEBPACK_IMPORTED_MODULE_0___default().createElement';
const toolbarStart = reader.indexOf('function Toolbar(props) {');
const toolbarEnd = reader.indexOf('function ReadingProgress(props)', toolbarStart);
if (toolbarStart < 0 || toolbarEnd < 0) throw new Error('Reader toolbar changed');
let toolbar = reader.slice(toolbarStart, toolbarEnd);
toolbar = patch(toolbar, 'className: "start"\n  },', 'className: "start"\n  }, window.__codexHomeButton(react__WEBPACK_IMPORTED_MODULE_0___default()), window.__codexAnalysisButton(react__WEBPACK_IMPORTED_MODULE_0___default()),');
const appearanceStartButton = toolbar.indexOf('/*#__PURE__*/' + button + '("button", {\n    id: "appearance",');
const appearanceEndButton = toolbar.indexOf('props.showReadAloudToggle &&', appearanceStartButton);
if (appearanceStartButton < 0 || appearanceEndButton < 0) throw new Error('Reader appearance button changed');
toolbar = toolbar.slice(0, appearanceStartButton) + toolbar.slice(appearanceEndButton);
toolbar = patch(toolbar, 'className: "standard-view"\n  })))), props.type ===', 'className: "standard-view"\n  }))), window.__codexSettingsButton(react__WEBPACK_IMPORTED_MODULE_0___default())), props.type ===');
reader = patch(reader, reader.slice(toolbarStart, toolbarEnd), toolbar);
reader = patch(reader, "this._iframe.src = 'pdf/web/viewer.html';", 'this._iframe.srcdoc = window.__CODEX_PDF_VIEWER__;');
// PDF data is supplied as bytes; srcdoc has no directory URL to resolve here.
const directoryUrl = "new URL('./', window.location).toString()";
if (reader.split(directoryUrl).length !== 3) throw new Error('Reader initialization URL snapshot changed');
reader = reader.replaceAll(directoryUrl, "'about:blank'");
reader = reader.replaceAll('window.parent.postMessage(', 'window.__codexPost(');
const readerCss = await inlineCss(join(root, 'reader.css')) + await noteUiStyles()+await katexStyles() + '.codex-selection-translate{display:flex;align-items:center;justify-content:center;gap:6px}' + '.sidebar-ai-action[data-paused]{filter:grayscale(1);cursor:not-allowed}.ai-navigation-generate:disabled{opacity:.56;cursor:not-allowed}';
const adapter = await readFile(join(root, 'codex-adapter.js'), 'utf8');
const html = '<!DOCTYPE html><html lang="zh-CN" dir="ltr" style="--sidebar-width:240px;--split-view-size:50%;--bottom-placeholder-height:0px;--toolbar-placeholder-width:0px"><head><meta charset="UTF-8"><title>Zotero PDF 阅读器</title>'
  + `<style>${readerCss}${themeCss}#read-aloud,.document-translation{display:none!important}</style></head><body class="sidebar-open"><div id="reader-ui"></div><div id="split-view"><div id="primary-view" class="primary-view"></div><div id="secondary-view" class="secondary-view"></div></div><div id="printContainer"></div>`
  + script(`window.__CODEX_READER_TOKEN__="__CODEX_READER_SESSION__";window.__CODEX_PDF_VIEWER__=${json(inlineViewer)};window.__codexPost=(message)=>window.parent.postMessage({...message,codexReaderToken:window.__CODEX_READER_TOKEN__},'*');`)
  + script(adapter) + script(reader) + '</body></html>';
await writeFile(join(root, 'reader-local.html'), html);
process.stdout.write(`Built packaged Reader HTML (${html.length} characters) with inlined PDF.js, workers, CMaps and fonts.\n`);

