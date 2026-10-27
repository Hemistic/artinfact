import { installCodexTranslationButton } from './selection-codex-button.js';
import {uiLanguage,setUiLanguage} from './ui-language.js';
setUiLanguage(uiLanguage());
import { installReaderToolbar } from './reader-toolbar.js';
import { installReaderWorkspace } from './reader-workspace.js';
import {installReaderNoteAi} from './reader-note-ai.js';
import { PDF_FEATURES } from '../shared/pdf-features.js';
import { installReaderThemes, type ThemedReaderWindow } from './reader-theme.js';
import { installMineruToolbar } from './mineru-toolbar.js';
import type { AnalysisStatus } from '../shared/mineru.js';
import type { LayoutStatus } from '../shared/layout-status.js';
import { replacedLayoutIds,layoutPreviewAnnotation } from '../shared/layout-annotations.js';
import { setDataTransferAnnotations } from '../shared/reader-transfer.js';
import { createSelectionTranslatorMemo } from '../shared/selection-translation.js';
import {installReaderCitations} from './reader-citations.js';

type AnnotationManager = { _skipAnnotationSavingDebounce: boolean; _savingInProgress: boolean; _triggerSaving(): Promise<void>; _unsavedAnnotations: Map<string, unknown> };
type PdfOutline = { title: string; dest?: string | unknown[]; items?: PdfOutline[] };
type PdfDocument = { getMetadata(): Promise<{ info?: { Title?: unknown; Author?: unknown } }>; numPages: number; getPage(index: number): Promise<{ view: number[] }>; getOutline(): Promise<PdfOutline[] | null>; getDestination(id: string): Promise<unknown[] | null>; getPageIndex(ref: unknown): Promise<number> };
type ReaderWindow = Window & { __codexGraphReturn?:boolean; __CODEX_READER_TOKEN__?: string; __codexPost?: (message: object) => void; _reader?: { _updateState(patch:object):void; _annotationManager: AnnotationManager; _state: { annotations: Record<string, unknown>[] }; setReadOnly(value:boolean):void;setAnnotations(annotations: object[]): void; unsetAnnotations(ids: string[]): void; navigate(value: object,options?:object): void; _primaryView?: { initializedPromise?: Promise<void>; _iframeWindow?: Window & { PDFViewerApplication?: { pdfDocument?: PdfDocument;pdfViewer?:any;eventBus?:any } } } } };
const readerWindow = window as ReaderWindow;let readingInteracted=false;
(window as Window & {__codexLayoutPreview?:typeof layoutPreviewAnnotation}).__codexLayoutPreview=layoutPreviewAnnotation;
(window as Window & { __codexAIEnabled?: boolean }).__codexAIEnabled = PDF_FEATURES.aiAnalysis;
const selectionWindow = window as Window & { __codexDataTransfer?: typeof setDataTransferAnnotations; __codexReselect?: () => void };
selectionWindow.__codexDataTransfer = setDataTransferAnnotations;
const themes = installReaderThemes(window as ThemedReaderWindow);
(window as Window & { __codexSelectionTranslator?: ReturnType<typeof createSelectionTranslatorMemo> }).__codexSelectionTranslator = createSelectionTranslatorMemo();
// Responses remain subject to the same parent/session checks as all reader messages.
const allowed = new Set(['codex-reader:restore-state','codex-reader:note-flush', 'codex-reader:workspace', 'electron-reader:init', 'electron-reader:apply-settings', 'electron-reader:set-sidebar-state', 'electron-reader:apply-ai-outline', 'electron-reader:apply-ai-analysis-state', 'electron-reader:ensure-native-outline', 'electron-reader:sync-annotations', 'codex-reader:metadata', 'codex-reader:document-info', 'codex-reader:layout', 'codex-reader:navigate', 'codex-reader:analysis-status', 'codex-reader:layout-status', 'codex-reader:processor-status']);
const report = (type: string, payload: object) => readerWindow.__codexPost ? readerWindow.__codexPost({ type, payload }) : window.parent.postMessage({ type, payload }, '*');
const readerCitations=installReaderCitations(window,report);
for(const type of ['codex-reader:references','codex-reader:reference-tasks','codex-reader:reference-error','codex-reader:reference-saved'])allowed.add(type);
window.addEventListener('beforeunload',()=>readerCitations.dispose());
installReaderToolbar(window as Window & Parameters<typeof installReaderToolbar>[0], report);
installCodexTranslationButton(window as Window & Parameters<typeof installCodexTranslationButton>[0], report);
allowed.add('codex-reader:open-appearance');
allowed.add('electron-reader:lookup-selection-response');
allowed.add('codex-reader:graph-return');
const mineruToolbar = installMineruToolbar(window, report);
const readerNoteAi=installReaderNoteAi(window,report);
const readerWorkspace = installReaderWorkspace(window, report,{aiProvider:nodeId=>readerNoteAi.provider(readerWorkspace.workspaceId(),nodeId)});
function fileShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'o') return;
  event.preventDefault(); event.stopImmediatePropagation();
  report(event.shiftKey ? 'codex-reader:commands' : 'codex-reader:open-file', {});
}
window.addEventListener('keydown', fileShortcut, true);
// Keyboard events stay in the PDF.js frame, so register there when it loads too.
document.addEventListener('load', event => {
  if (event.target instanceof HTMLIFrameElement) {
    event.target.contentWindow?.addEventListener('keydown', fileShortcut, true);
    for(const type of ['wheel','pointerdown','keydown'])event.target.contentWindow?.addEventListener(type,()=>{readingInteracted=true;},{capture:true,passive:true});
    event.target.contentWindow?.addEventListener('pointerup', event => { if (event.button === 0) selectionWindow.__codexReselect?.(); }, true);
  }
}, true);
document.addEventListener('pointerup', event => {
  if (event.button === 0 && event.target instanceof Element && event.target.closest('[data-sidebar-annotation-id],.annotation')) selectionWindow.__codexReselect?.();
}, true);

// The reference reader's postMessage API was written for Electron. Restrict it to our parent.
window.addEventListener('message', event => {
  const type = event.data?.type;
  if (typeof type !== 'string' || (!type.startsWith('electron-reader:') && !type.startsWith('codex-reader:'))) return;
  if (event.source !== window.parent || (readerWindow.__CODEX_READER_TOKEN__ && event.data.codexReaderToken !== readerWindow.__CODEX_READER_TOKEN__) || (!allowed.has(type) && type !== 'codex-reader:flush')) {
    event.stopImmediatePropagation(); return;
  }
  if (type === 'codex-reader:open-appearance') { event.stopImmediatePropagation(); (readerWindow._reader as typeof readerWindow._reader & { toggleAppearancePopup?(open?:boolean):void })?.toggleAppearancePopup?.(true); return; }
  if(type==='codex-reader:references'){event.stopImmediatePropagation();readerCitations.update(event.data.payload);return;}
  if(type==='codex-reader:reference-tasks'){event.stopImmediatePropagation();readerCitations.updateTasks(event.data.payload.jobs??[]);return;}
  if(type==='codex-reader:reference-error'){event.stopImmediatePropagation();readerCitations.error(String(event.data.payload.message??''));return;}
  if(type==='codex-reader:reference-saved'){event.stopImmediatePropagation();readerCitations.saved();return;}
  if (type === 'codex-reader:workspace') {
    event.stopImmediatePropagation(); readerWorkspace.update(event.data.payload); return;
  }
  if(type==='codex-reader:graph-return'){event.stopImmediatePropagation();readerWindow.__codexGraphReturn=event.data.payload?.available===true;readerWindow._reader?._updateState({});return;}
  if (type === 'codex-reader:processor-status') { event.stopImmediatePropagation(); mineruToolbar.updateProcessor(event.data.payload?.status); return; }
  if (type === 'codex-reader:analysis-status') {
    event.stopImmediatePropagation(); mineruToolbar.update(event.data.payload?.status as AnalysisStatus | undefined); return;
  }
  if (type === 'codex-reader:layout-status') {
    event.stopImmediatePropagation(); mineruToolbar.updateLayout(event.data.payload?.status as LayoutStatus | undefined); return;
  }
  if (type === 'codex-reader:document-info') {
    event.stopImmediatePropagation(); const pdf = readerWindow._reader?._primaryView?._iframeWindow?.PDFViewerApplication?.pdfDocument;
    void pdf?.getMetadata().then(value => report('codex-reader:reply', { requestId: event.data.payload?.requestId, title: typeof value.info?.Title === 'string' ? value.info.Title.slice(0, 500) : '', author: typeof value.info?.Author === 'string' ? value.info.Author.slice(0, 500) : '' })).catch(error => report('codex-reader:reply', { requestId: event.data.payload?.requestId, error: String(error) })); return;
  }
  if (type === 'codex-reader:metadata') {
    event.stopImmediatePropagation();
    void (async () => {
      const doc = readerWindow._reader?._primaryView?._iframeWindow?.PDFViewerApplication?.pdfDocument;
      if (!doc) throw new Error('PDF 尚未就绪');
      if (doc.numPages > 10000) throw new Error('PDF 页数超过上限');
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) { const page = await doc.getPage(i); pages.push({ width: page.view[2] - page.view[0], height: page.view[3] - page.view[1] }); }
      let count = 0;
      const convert = async (items: PdfOutline[], depth = 0): Promise<object[]> => {
        if (depth > 24) return []; const nodes: object[] = [];
        for (const item of items) {
          if (++count > 2000) break; let pageIndex: number | undefined;
          try { const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest; if (dest?.[0] !== undefined) pageIndex = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]); } catch { /* A broken destination must not hide the outline. */ }
          nodes.push({ title: item.title.slice(0, 1000), location: { position: { pageIndex } }, items: await convert(item.items ?? [], depth + 1) });
        }
        return nodes;
      };
      report('codex-reader:reply', { requestId: event.data.payload?.requestId, pages, outline: await convert(await doc.getOutline() ?? []) });
    })().catch(error => report('codex-reader:reply', { requestId: event.data.payload?.requestId, error: error instanceof Error ? error.message : String(error) })); return;
  }
  if (type === 'codex-reader:layout') {
    event.stopImmediatePropagation(); const reader = readerWindow._reader;
    if (reader && Array.isArray(event.data.payload?.annotations)) {
      const next = event.data.payload.annotations as { id: string }[];
      reader.unsetAnnotations(replacedLayoutIds(reader._state.annotations as {id:string;[key:string]:unknown}[],next));
      reader.setAnnotations(next);
    }
    report('codex-reader:reply', { requestId: event.data.payload?.requestId }); return;
  }
  if(type==='codex-reader:restore-state'){
    event.stopImmediatePropagation();const payload=event.data.payload;
    void(async()=>{const reader=readerWindow._reader;if(!reader||!Array.isArray(payload?.state?.annotations))throw Error('批注存档无效');await reader._primaryView?.initializedPromise;const value=payload.state;reader.setAnnotations(value.annotations);reader._updateState({aiOutline:value.aiOutline??null,...(!readingInteracted&&value.sidebar?{sidebarOpen:value.sidebar.open,sidebarView:value.sidebar.view}:{})});
      const api=reader._primaryView?._iframeWindow?.PDFViewerApplication,viewer=api?.pdfViewer,position=value.viewState;
      if(!readingInteracted&&viewer&&position){if(Number.isInteger(position.scrollMode))viewer.scrollMode=position.scrollMode;if(Number.isInteger(position.spreadMode))viewer.spreadMode=position.spreadMode;viewer.scrollPageIntoView({pageNumber:Math.max(1,Math.min(api!.pdfDocument!.numPages,(position.pageIndex||0)+1)),destArray:[null,{name:'XYZ'},position.left||null,position.top??null,parseInt(position.scale)?position.scale/100:position.scale],allowNegativeOffset:true});}
      reader.setReadOnly(false);report('codex-reader:reply',{requestId:payload.requestId});
    })().catch(error=>report('codex-reader:reply',{requestId:payload?.requestId,error:String(error)}));return;
  }
  if (type === 'codex-reader:navigate') {
    event.stopImmediatePropagation();
    void(async()=>{const reader=readerWindow._reader,position=event.data.payload?.position;if(!reader||!position)throw Error('PDF 原句定位信息无效');await reader._primaryView?.initializedPromise;await reader.navigate({position},{highlightDuration:10000});
      const view=reader._primaryView as typeof reader._primaryView&{_highlightPosition?(position:object,duration:number):void},api=view?._iframeWindow?.PDFViewerApplication,bus=api?.eventBus;
      const painted=()=>api?.pdfViewer?._pages?.[position.pageIndex]?.renderingState===3;
      if(!painted())await new Promise<void>((resolve,reject)=>{let timer:ReturnType<typeof setTimeout>;const cleanup=()=>{clearTimeout(timer);bus?.off('pagerendered',ready);},ready=(value:any)=>{if(value?.pageNumber===position.pageIndex+1&&painted()){cleanup();resolve();}};timer=setTimeout(()=>{cleanup();reject(Error('PDF 原句所在页绘制超时，请重试'));},10000);bus?.on('pagerendered',ready);if(painted()){cleanup();resolve();}});
      view?._highlightPosition?.(position,10000);report('codex-reader:reply',{requestId:event.data.payload.requestId});
    })().catch(error=>report('codex-reader:reply',{requestId:event.data.payload?.requestId,error:error instanceof Error?error.message:String(error)}));return;
  }
  if(type==='codex-reader:note-flush'){event.stopImmediatePropagation();try{report('codex-reader:reply',{requestId:event.data.payload?.requestId,note:readerWorkspace.flush()});}catch(error){report('codex-reader:reply',{requestId:event.data.payload?.requestId,error:String(error)});}return;}
  if (type === 'codex-reader:flush') {
    event.stopImmediatePropagation();
    void (async () => {
      const manager = readerWindow._reader?._annotationManager;
      if (manager) {
        manager._skipAnnotationSavingDebounce = true;
        try {
          await manager._triggerSaving();
          const deadline = Date.now() + 4000;
          while (manager._savingInProgress || manager._unsavedAnnotations.size) {
            if (Date.now() > deadline) throw new Error('批注尚未完成保存');
            await new Promise(resolve => setTimeout(resolve, 20));
            await manager._triggerSaving();
          }
        } finally { manager._skipAnnotationSavingDebounce = false; }
      }
      report('codex-reader:flushed', { requestId: event.data.payload?.requestId });
    })().catch(error => report('codex-reader:flushed', { requestId: event.data.payload?.requestId, error: error instanceof Error ? error.message : '无法保存批注' }));
  }
  if (type === 'electron-reader:init') themes.updateSettings(event.data.payload?.settings ?? {});
  if (type === 'electron-reader:apply-settings' && event.data.payload?.gptPalette) {
    event.stopImmediatePropagation();
    themes.updateSettings(event.data.payload); themes.syncHost(); return;
  }
  if (type === 'electron-reader:init') {
    const deadline = Date.now() + 20000;
    const wait = async () => {
      const view = readerWindow._reader?._primaryView;
      if (view?.initializedPromise) { let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([view.initializedPromise,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('PDF 页面初始化超时')),Math.max(1,deadline-Date.now()));})]);}finally{clearTimeout(timer);} themes.syncHost();const api=view._iframeWindow?.PDFViewerApplication;if(!api?.pdfViewer?._pages?.some((p:any)=>p?.div?.querySelector('canvas'))){await new Promise<void>((resolve,reject)=>{const bus=api?.eventBus;let timer:ReturnType<typeof setTimeout>;const painted=()=>{clearTimeout(timer);bus?.off('pagerendered',painted);resolve();};timer=setTimeout(()=>{bus?.off('pagerendered',painted);reject(Error('PDF 首屏绘制超时'));},Math.max(1,deadline-Date.now()));bus?.on('pagerendered',painted);});}report('codex-reader:loaded', {}); return; }
      if (Date.now() > deadline) throw new Error('阅读器初始化超时');
      await new Promise(resolve => setTimeout(resolve, 40)); await wait();
    };
    void wait().catch(error => report('codex-reader:error', { message: error instanceof Error ? error.message : 'PDF 加载失败' }));
  }
}, true);
window.addEventListener('unhandledrejection', event => report('codex-reader:error', { message: event.reason instanceof Error ? event.reason.message : String(event.reason).slice(0, 240) }));
window.addEventListener('error', event => { if (event.message) report('codex-reader:error', { message: event.message.slice(0, 240) }); });

