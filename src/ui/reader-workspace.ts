import type * as React from 'react';
import { readerIcon } from './icons.js';
import {markdownHtml} from '../whiteboard/flow-notes.js';
import {createNoteSurface} from '../whiteboard/note-surface.js';
import type {NoteSaveStatus} from '../shared/note-drafts.js';
import {readerNoteReferences} from './reader-note-references.js';
import type {AIProvider} from '@milkdown/crepe/feature/ai';

export type ReaderNote={nodeId:string;title:string;markdown:string;revision:string;needsTitleSync?:boolean;assets?:Record<string,string>;page?:{pageId:string;title:string;markdown:string}};
export type ReaderNoteDraft={id:string;title:string;markdown:string;revision:string};
export type ReaderWorkspace = { workspaceId?:string;name: string; active: string; openIds: string[]; documents: { id: string; name: string }[]; busy: boolean; notes?:{nodeId:string;title:string;boards:{title:string}[]}[];activeNote?:ReaderNote;noteSaveStatus?:NoteSaveStatus;noteSaveError?:string };
type SidebarProps = { view: string; onChangeView(view: string): void };
type WorkspaceWindow = Window & {
  __codexPdfTab?: (react: typeof React, props: SidebarProps) => React.ReactNode;
  __codexPdfPanel?: (react: typeof React, props: SidebarProps) => React.ReactNode;
};

// Use the reader's own React instance so this is a native sidebar view, including its focus and resize behavior.
export function installReaderWorkspace(win: WorkspaceWindow, report: (type: string, payload: object) => void,services:{aiProvider?:(nodeId:string)=>AIProvider}={}) {
  let snapshotSignature='';
  let snapshot: ReaderWorkspace = { name: '', active: '', openIds: [], documents: [], busy: false };
  const listeners = new Set<(value: ReaderWorkspace) => void>();
  let flushCurrent:()=>ReaderNoteDraft|undefined=()=>undefined;
  const action = (action: string, id?: string,values?:object) => report('codex-reader:workspace-action', { action, id,...values });
  function Panel({ react, view }: { react: typeof React; view: string }) {
    const [data, setData] = react.useState(snapshot);
    const titleLive=react.useRef(data.activeNote?.title??'');
    const noteLive=react.useRef(data.activeNote);noteLive.current=data.activeNote;
    const editorHost=react.useRef<HTMLDivElement>(null),[editorReady,setEditorReady]=react.useState(false),[editorError,setEditorError]=react.useState('');
    const liveEditor=react.useRef<Awaited<ReturnType<typeof createNoteSurface>>|undefined>(undefined);
    react.useEffect(()=>{
      setEditorReady(false);setEditorError('');const note=data.activeNote;if(!editorHost.current||!note)return;let disposed=false,dirty=false,editor:Awaited<ReturnType<typeof createNoteSurface>>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
      titleLive.current=note.title;
      const flush=()=>{const current=noteLive.current;if(disposed||!dirty||!editor||current?.nodeId!==note.nodeId)return;clearTimeout(timer);dirty=false;const draft={id:note.nodeId,title:titleLive.current,markdown:editor.markdown(),revision:current.revision};action('note-draft',draft.id,draft);return draft;};
      const changed=()=>{if(disposed||!editor||noteLive.current?.nodeId!==note.nodeId)return;if(!dirty)action('note-dirty',note.nodeId);dirty=true;clearTimeout(timer);timer=setTimeout(flush,150);};
      flushCurrent=flush;
      void createNoteSurface(editorHost.current,note.markdown,changed,note.assets,{onTitleChange:heading=>{titleLive.current=heading;},aiProvider:services.aiProvider?.(note.nodeId),references:()=>readerNoteReferences(snapshot),onReference:ref=>{flush();action(ref.kind==='pdf'?'open':ref.kind==='note'?'note-open':'note-page',ref.id);}}).then(async value=>{if(disposed){await value.destroy();return;}editor=value;liveEditor.current=value;setEditorReady(true);if(note.needsTitleSync)changed();}).catch(error=>{if(!disposed)setEditorError(String(error));});
      // A save updates the revision, but must not recreate the editor or reset its caret and newer input.
      return()=>{disposed=true;clearTimeout(timer);void editor?.destroy();if(liveEditor.current===editor)liveEditor.current=undefined;if(flushCurrent===flush)flushCurrent=()=>undefined;};
    },[data.activeNote?.nodeId]);
    react.useEffect(() => { listeners.add(setData); setData(snapshot); return () => { listeners.delete(setData); }; }, []);
    react.useEffect(()=>{for(const image of win.document.querySelectorAll<HTMLImageElement>('.codex-board-note img[data-asset]')){const url=data.activeNote?.assets?.[image.dataset.asset!];if(url)image.src=url;}},[data.activeNote]);
    const h = react.createElement;
    const pagePreview=react.useMemo(()=>data.activeNote?.page?markdownHtml(data.activeNote.page.markdown):'',[data.activeNote?.page?.markdown]);
    const icon = (name: Parameters<typeof readerIcon>[1], size = 16) => readerIcon(react, name, size) as React.ReactNode;
    return h('div', {
      id: 'pdfDocumentsView', role: 'tabpanel', 'aria-labelledby': 'viewDocuments',
      className: 'viewWrapper codex-pdf-view' + (view === 'pdfs' ? '' : ' hidden'),
    }, data.activeNote ? h('div',{className:'codex-board-note'},
      h('div',{className:'codex-board-note-body'},
      h('div',{ref:editorHost}),
      editorError&&h('p',{role:'status'},'编辑器加载失败：'+editorError),
      data.activeNote.page&&h('section',{},h('h4',{},'引用的 Pages：'+data.activeNote.page.title),h('article',{className:'flow-markdown',dangerouslySetInnerHTML:{__html:pagePreview}}))),
      h('footer',{className:'codex-board-note-actions',role:'toolbar','aria-label':'笔记操作'},
        h('button',{type:'button',disabled:data.busy,onClick:()=>action('note-close')},'返回列表'),
        data.activeNote.page&&h('button',{type:'button',onClick:()=>action('note-page',data.activeNote!.page!.pageId)},'打开 Pages'),
        data.noteSaveStatus==='error'&&h('button',{type:'button',disabled:data.busy,onClick:()=>action('note-save',data.activeNote!.nodeId,{title:titleLive.current,markdown:liveEditor.current?.markdown()??data.activeNote!.markdown,revision:data.activeNote!.revision})},'重试保存'),
        h('small',{role:'status',title:data.noteSaveError},!editorReady?'正在载入编辑器…':data.noteSaveStatus==='error'?'尚未保存：'+data.noteSaveError:data.noteSaveStatus==='saving'?'正在保存…':data.noteSaveStatus==='dirty'?'等待保存…':data.noteSaveStatus==='saved'?'已保存':'修改自动保存'))
      ) : h(react.Fragment,{},
    h('div', { className: 'codex-pdf-heading' },
      h('span', { title: data.name }, data.name || '当前工作区'), h('span', {}, String(data.documents.length)),
      h('button', { type: 'button', className: 'toolbar-button codex-pdf-add', title: '打开 PDF 到当前工作区', 'aria-label': '打开 PDF', disabled: data.busy, onClick: () => action('choose') }, icon('folder'))),
    h('div', { className: 'codex-pdf-list', 'aria-label': '工作区文档' }, ...data.documents.map(doc => {
      const selected = data.active === doc.id;
      return h('div', { key: doc.id, className: 'codex-pdf-row' + (selected ? ' selected' : '') },
        h('button', { type: 'button', className: 'codex-pdf-open', title: doc.name,
          'aria-label': '阅读 ' + doc.name, 'aria-current': selected ? 'page' : undefined,
          disabled: data.busy, onClick: () => action('open', doc.id),
        }, icon('file'), h('span', {}, doc.name.replace(/\.pdf$/i, ''))),
        data.openIds.includes(doc.id) && h('button', {
          type: 'button', className: 'codex-pdf-close', title: '关闭 ' + doc.name, 'aria-label': '关闭 ' + doc.name,
          disabled: data.busy, onClick: () => action('close', doc.id),
        }, icon('close', 12)));
    })), !data.documents.length && h('p', { className: 'codex-pdf-empty' }, '打开 PDF 后在这里切换'),
    h('details',{className:'codex-board-notes',open:true},h('summary',{},'白板笔记 · '+(data.notes?.length??0)),
      h('button',{type:'button',disabled:data.busy,onClick:()=>action('note-create')},'＋ 新建白板笔记'),
      ...(data.notes??[]).map(n=>h('button',{key:n.nodeId,type:'button',disabled:data.busy,title:n.boards.map(b=>b.title).join(' / '),onClick:()=>action('note-open',n.nodeId)},icon('notes'),h('span',{},n.title))))));
  }
  win.__codexPdfTab = (react, props) => react.createElement('button', {
    id: 'viewDocuments', className: 'toolbar-button' + (props.view === 'pdfs' ? ' active' : ''),
    tabIndex: -1, title: 'PDF 文档', 'aria-label': 'PDF 文档', role: 'tab',
    'aria-selected': props.view === 'pdfs', 'aria-controls': 'pdfDocumentsView',
    onClick: () => props.onChangeView('pdfs'),
  }, readerIcon(react, 'file') as React.ReactNode);
  win.__codexPdfPanel = (react, props) => react.createElement(Panel, { react, view: props.view });
  return {workspaceId:()=>snapshot.workspaceId??'',flush:()=>flushCurrent(),update(value: ReaderWorkspace) { const signature=JSON.stringify([value.workspaceId,value.name,value.active,value.openIds,value.documents,value.busy,value.notes,value.noteSaveStatus,value.noteSaveError,value.activeNote&&[value.activeNote.nodeId,value.activeNote.title,value.activeNote.revision,value.activeNote.needsTitleSync,Object.keys(value.activeNote.assets??{}),value.activeNote.page]]);if(signature===snapshotSignature)return;snapshotSignature=signature; snapshot = value; for (const listener of listeners) listener(value); } };
}
