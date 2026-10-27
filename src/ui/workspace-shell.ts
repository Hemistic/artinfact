import { showDropdown } from './dropdown.js';
import { installPagesLinks } from './pages-links.js';
import { openPagesOriginal } from '../shared/pages-preview.js';
import type { ResearchDelivery } from '../shared/research-delivery.js';
import type { ReaderWorkspace,ReaderNote,ReaderNoteDraft } from './reader-workspace.js';
import {noteEditor} from '../whiteboard/note-editor.js';
import {createNoteDrafts,type NoteSaveStatus} from '../shared/note-drafts.js';
import {noteAssetIds} from '../whiteboard/flow-notes.js';
import {readerNoteReferences} from './reader-note-references.js';
import type {NoteSurfaceOptions} from '../whiteboard/note-surface.js';
import {createNoteAiProvider} from '../whiteboard/note-ai-provider.js';
import type { WorkspaceSnapshot, WorkspaceDocument } from '../server/workspaces.js';
import type { PdfDocument } from '../shared/pdf-selection.js';
import './workspace-shell.css';
import './workspace-menu.css';
import { iconMarkup, setControlIcon, type UiIcon } from './icons.js';
import { installWorkspaceConversion } from './workspace-conversion.js';
import { PLUGIN_VERSION } from '../shared/version.js';
import {selectedHomeWorkspace} from '../shared/workspace-home.js';
import type {WorkspaceGraphMode} from '../shared/workspace-graph-views.js';
import {installWorkspaceHomeView} from './workspace-home-view.js';
import {installWorkspaceHomeMenus} from './workspace-home-menu.js';
import '../shared/control-tooltip.css';
import {installPdfPreprocessing} from './pdf-preprocessing.js';

type Hooks = { send(text: string): Promise<ResearchDelivery>; navigation(value: ReaderWorkspace): void; noteDraft?():Promise<ReaderNoteDraft|undefined>;call(name: string, args: Record<string, unknown>): Promise<any>; open(workspaceId: string, id: string): Promise<void>; suspend(): Promise<void>; choose(): void; settings(): void; notice(message: string, error?: boolean): void; run(action: () => Promise<unknown>): void; graph(workspaceId: string, data?:boolean,mode?:WorkspaceGraphMode): Promise<void>; openPage(pageId: string): Promise<void>; };
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
// Port the original shell's workspace home, book cards and saved document tabs; keep Codex's chat outside this pane.
export function installWorkspaceShell(root: HTMLElement, hooks: Hooks) {
  const home = document.createElement('section'); home.id = 'workspace-home'; home.className = 'home-view'; home.textContent = '正在载入工作区…';
  const notes = document.createElement('section'); notes.className = 'workspace-pages-manager'; notes.hidden = true;
  notes.innerHTML = '<header><strong></strong><span></span></header>';
  const dialog = document.createElement('dialog'); dialog.className = 'workspace-prompt'; dialog.innerHTML = '<form><label></label><input maxlength="160" required autocomplete="off"><p></p><div><button type="button">取消</button><button class="primary">确定</button></div></form>';
  const noteList = document.createElement('dialog'); noteList.className = 'workspace-note-list'; root.append(home, notes, dialog, noteList);
  let snapshot: WorkspaceSnapshot | undefined, workspaceId = '', tabs: string[] = [], active = '', target = '', busy = false;
  let note: { workspaceId: string; nodeId: string } | undefined;
  let activeEditor:ReturnType<typeof noteEditor>|undefined;
  let noteSaveStatus:NoteSaveStatus|undefined,noteSaveError='',readerDirty=false;
  const readerDrafts=createNoteDrafts(async draft=>{
    if(!draft.title.trim())throw Error('请输入标题');if(draft.markdown.length>120000)throw Error('笔记过长');
    const saved=value(await hooks.call('whiteboard_note_write',{...draft,title:draft.title.trim()}));
    if(workspaceId===draft.workspaceId&&activeNote?.nodeId===draft.nodeId){activeNote={...saved,assets:activeNote.assets};boardNotes=boardNotes.map(n=>n.nodeId===draft.nodeId?{...n,title:saved.title}:n);renderTabs();}return saved;
  },{autoSaveMs:600,onStatus:(status,error)=>{noteSaveStatus=status;noteSaveError=error?String(error).replace(/^Error: /,''):'';renderTabs();}});
  async function flushNotes(){if(readerDirty&&hooks.noteDraft){const draft=await hooks.noteDraft();if(draft)stageNoteDraft(draft.id,draft);else readerDirty=false;}if(activeEditor?.isConnected)await activeEditor.flush();if(readerDrafts.pending()){await readerDrafts.flush();await hydrateNote();await refreshNotes();renderTabs();}}
  let boardNotes:NonNullable<ReaderWorkspace['notes']>=[],activeNote:ReaderNote|undefined;
  const noteEditorHost=document.createElement('section');noteEditorHost.className='workspace-note-editor';noteEditorHost.hidden=true;notes.append(noteEditorHost);
  const value=(result:any)=>{if(result.isError)throw Error(result.content?.find((c:any)=>c.type==='text')?.text??'笔记操作失败');return result.structuredContent;};
  async function refreshNotes(){if(!workspaceId)return;boardNotes=value(await hooks.call('whiteboard_notes_list',{workspaceId})).entries;if(activeNote&&!boardNotes.some(n=>n.nodeId===activeNote!.nodeId))activeNote=undefined;}
  function stageNoteDraft(nodeId:string,payload:{dirty?:boolean;title?:string;markdown?:string;revision?:string}){if(activeNote?.nodeId!==nodeId)return;if(payload.dirty){readerDirty=true;if(noteSaveStatus!=='dirty'&&noteSaveStatus!=='saving'){noteSaveStatus='dirty';renderTabs();}return;}if(typeof payload.revision!=='string'||typeof payload.title!=='string'||typeof payload.markdown!=='string')return;readerDirty=false;if(!activeNote.needsTitleSync&&!readerDrafts.pending()&&payload.title.trim()===activeNote.title&&payload.markdown===activeNote.markdown){if(noteSaveStatus!=='saved'){noteSaveStatus='saved';noteSaveError='';renderTabs();}return;}readerDrafts.stage({workspaceId,nodeId,title:payload.title,markdown:payload.markdown,revision:activeNote.revision});}
  async function hydrateNote(){if(!activeNote)return;const captured=activeNote;captured.assets={};for(const id of noteAssetIds(captured.markdown)){const result=await hooks.call('whiteboard_asset_read',{workspaceId,id});if(result.isError)continue;const image=result.content?.find((c:any)=>c.type==='image');if(image)captured.assets[id]='data:'+image.mimeType+';base64,'+image.data;}}
  let graphActive = false;
  const conversion = installWorkspaceConversion(root, hooks);
  const preprocessing=installPdfPreprocessing(root,hooks);
  const pages = installPagesLinks(notes, { call: hooks.call, run: hooks.run, send: hooks.send, ask, openPage: hooks.openPage });
  async function ask(label: string, value = '', detail = ''): Promise<string | null> { dialog.querySelector('label')!.textContent = label; dialog.querySelector('input')!.value = value; dialog.querySelector('p')!.textContent = detail; showDropdown(dialog); dialog.querySelector('input')!.focus(); return new Promise(resolve => { const done = (v: string | null) => { resolve(v); dialog.close(); }; dialog.querySelector('form')!.onsubmit = e => { e.preventDefault(); done(dialog.querySelector('input')!.value.trim()); }; dialog.querySelector<HTMLButtonElement>('button[type=button]')!.onclick = () => done(null); dialog.onclose = () => resolve(null); dialog.oncancel = e => { e.preventDefault(); done(null); }; }); }

  const returnHome = document.createElement('button'); returnHome.type = 'button'; returnHome.title = '返回工作区首页'; setControlIcon(returnHome, 'home', false); returnHome.onclick = () => hooks.run(showHome); notes.querySelector('header')!.prepend(returnHome);
  const current = () => snapshot?.workspaces.find(w => w.id === workspaceId);
  function adopt(value: WorkspaceSnapshot) { snapshot = value; const selected = selectedHomeWorkspace(value, workspaceId); if (selected?.id !== workspaceId) { workspaceId = selected?.id ?? ''; tabs = [...(selected?.lastSession.openTabs ?? [])]; active = selected?.lastSession.activeDocumentId ?? ''; } renderHome(); }
  async function refresh() { adopt((await hooks.call('pdf_workspace_list', {}))._meta.workspaceSnapshot); if (!workspaceId) { workspaceId = snapshot!.activeWorkspaceId; tabs = [...current()!.lastSession.openTabs]; active = current()!.lastSession.activeDocumentId; } await refreshNotes();renderTabs(); }
  async function session() { if (workspaceId) await hooks.call('pdf_workspace_session', { workspaceId, tabs, activeDocumentId: active }); }
  async function switchTo(id: string) { if (workspaceId === id) return;await flushNotes(); await hooks.suspend(); graphActive = false; await session(); const result = await hooks.call('pdf_workspace_activate', { workspaceId: id }); workspaceId = id; adopt(result._meta.workspaceSnapshot); tabs = [...current()!.lastSession.openTabs]; active = current()!.lastSession.activeDocumentId; note = undefined; activeNote=undefined;boardNotes=[];await refreshNotes();notes.hidden = true; renderTabs(); renderHome(); }
  function reading() { home.hidden = true; notes.hidden = true; root.classList.add('workspace-reading'); root.classList.remove('workspace-home-open', 'workspace-notes-open'); }
  async function showHome() { await flushNotes();await hooks.suspend(); graphActive = false; home.hidden = false; notes.hidden = true; root.classList.remove('workspace-reading', 'workspace-notes-open'); root.classList.add('workspace-home-open'); await refresh(); }
  async function showGraph(id = workspaceId,data=false,mode:WorkspaceGraphMode='constellation') { await flushNotes();await switchTo(id); reading(); graphActive = true; renderTabs(); await hooks.graph(id,data,mode); }
  async function open(id: string, documentId: string) { await flushNotes();await switchTo(id); if (documentId.startsWith('md:')) { await openNote(id, documentId.slice(3)); return; } if (!current()!.documents.some(d => d.id === documentId)) throw new Error('PDF 不在工作区中'); if (!tabs.includes(documentId)) { if (tabs.length >= 64) throw new Error('最多打开 64 个阅读标签'); tabs.push(documentId); } if (graphActive) await hooks.suspend(); const previousActive=active;graphActive=false;active=documentId;reading();renderTabs();try{await hooks.open(id,documentId);await session();}catch(error){active=previousActive;renderTabs();throw error;} }
  async function close(id: string) {await flushNotes(); if (!notes.hidden && active === id) { tabs = tabs.filter(t => t !== id); active = ''; note = undefined; if (tabs.length) await open(workspaceId, tabs.at(-1)!); else await showHome(); renderTabs(); await session(); return; } if (graphActive || !home.hidden || !notes.hidden) { tabs = tabs.filter(t => t !== id); if (active === id) active = tabs.at(-1) || ''; renderTabs(); await session(); return; } if (active === id) { await hooks.suspend(); active = ''; } tabs = tabs.filter(t => t !== id); if (!active && tabs.length) await open(workspaceId, tabs.at(-1)!); else if (!active) await showHome(); renderTabs(); await session(); }
  function button(text: string, action: () => Promise<unknown>, title?: string) { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.disabled = busy; if (title) b.title = title; b.onclick = () => hooks.run(action); return b; }
  function iconButton(name: UiIcon, action: () => Promise<unknown>, title: string, label = '') { const b = button(label, action, title); setControlIcon(b, name, !!label); return b; }
  async function createWorkspace(){await flushNotes();const name=await ask('新建工作区名称');if(!name)return;await hooks.suspend();await session();const result=await hooks.call('pdf_workspace_create',{name});workspaceId=result._meta.workspace.id;tabs=[];active='';note=undefined;activeNote=undefined;boardNotes=[];graphActive=false;adopt(result._meta.workspaceSnapshot);await refreshNotes();renderTabs();}
  const homeMenus=installWorkspaceHomeMenus(root,{run:hooks.run,select:switchTo,create:createWorkspace,
    rename:async w=>{const name=await ask('重命名工作区',w.name);if(!name)return;adopt((await hooks.call('pdf_workspace_rename',{workspaceId:w.id,name}))._meta.workspaceSnapshot);renderTabs();},
    folder:async w=>{await hooks.call('pdf_workspace_folder',{workspaceId:w.id});},choose:async w=>{target=w.id;hooks.choose();},notes:async()=>showNotes(),settings:async()=>hooks.settings(),
    archive:async w=>{const answer=await ask('输入工作区名称确认删除','','资料保留在 workspace-archives 文件夹，可从磁盘恢复。');if(answer!==w.name)return;await flushNotes();await hooks.suspend();await session();const result=await hooks.call('pdf_workspace_archive',{workspaceId:w.id});workspaceId='';tabs=[];active='';note=undefined;adopt(result._meta.workspaceSnapshot);await showHome();}
  });
  function showWorkspaceMenu(){if(snapshot)homeMenus.select(snapshot,workspaceId);}
  function showManageMenu(){const w=current();if(snapshot&&w)homeMenus.manage(snapshot,w);}
  function renderTabs() {
    hooks.navigation({ workspaceId,name: current()?.name ?? '', active, openIds: [...tabs], busy,notes:boardNotes,activeNote,noteSaveStatus,noteSaveError,
      documents: [...(current()?.documents ?? []).map(doc => ({ id: doc.id, name: doc.name })), ...(current()?.notes ?? []).map(n => ({ id: 'md:' + n.name, name: n.name }))].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true })) });
  }
  async function navigationAction(action: string, id?: string, payload?:{title?:string;markdown?:string;revision?:string}) {
    if (busy) return;
    if(action==='note-open'&&id){await openBoardNote(workspaceId,id);return;}
    if(action==='note-close'){await flushNotes();activeNote=undefined;await refreshNotes();renderTabs();return;}
    if(action==='note-page'&&id){await flushNotes();await hooks.openPage(id);return;}
    if(action==='note-create'){await createNote(workspaceId);return;}
    if(action==='note-save'&&id&&payload){stageNoteDraft(id,payload);await flushNotes();hooks.notice('笔记已保存到白板');return;}
    if (action === 'open' || action === 'close') {
      if (!id || (!current()?.documents.some(doc => doc.id === id) && !current()?.notes.some(n => 'md:' + n.name === id))) throw new Error('PDF 不在当前工作区中');
      if (action === 'open') await open(workspaceId, id); else if (tabs.includes(id)) await close(id);
    } else if (action === 'home') await showHome();
    else if (action === 'choose') { target = workspaceId; hooks.choose(); }
    else if (action === 'notes') await showNotes();
    else if (action === 'settings') hooks.settings();
  }
  async function showNotes() { const w = current(); if (!w) return;await refreshNotes();noteList.replaceChildren(); const heading = document.createElement('strong'); heading.textContent = w.name + ' · 白板笔记'; noteList.append(heading, iconButton('close', async () => noteList.close(), '关闭笔记列表'));for(const n of boardNotes)noteList.append(button(n.title,async()=>{noteList.close();await openBoardNote(w.id,n.nodeId);}));for (const n of w.notes) noteList.append(button(n.name+' · 既有资料', async () => { noteList.close(); await openNote(w.id, n.name); })); noteList.append(iconButton('plus', async () => { noteList.close(); await createNote(w.id); }, '新建白板笔记', '新建白板笔记')); showDropdown(noteList); }
  async function createNote(id: string) { const title = await ask('新建白板笔记', '阅读记录','正文保存在白板卡片中；主动导出时才生成 Markdown 或 Pages。'); if (!title) return;const created=value(await hooks.call('whiteboard_note_create',{workspaceId:id,title}));await openBoardNote(id,created.nodeId); }
  function noteEditingOptions(id:string,assets:Record<string,string>):NoteSurfaceOptions{return {
    aiProvider:createNoteAiProvider(id,activeNote!.nodeId,{call:async(name,args)=>value(await hooks.call(name,args)),send:hooks.send}),
    references:()=>readerNoteReferences({name:current()?.name??'',active,openIds:tabs,busy,documents:current()?.documents??[],notes:boardNotes,activeNote}),
    onReference:async ref=>{if(workspaceId!==id)throw Error('工作区已切换');if(ref.kind==='pdf')await open(id,ref.id);else if(ref.kind==='note')await openBoardNote(id,ref.id);else{await flushNotes();await hooks.openPage(ref.id);}},
    uploadImage:async file=>{if(workspaceId!==id)throw Error('工作区已切换');if(!/^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(file.type)||file.size>8*1024*1024)throw Error('请使用不超过 8 MB 的图片');const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('图片读取失败'));reader.readAsDataURL(file);});const saved=value(await hooks.call('whiteboard_asset_put',{workspaceId:id,name:file.name,mimeType:file.type,base64}));assets[saved.id]='data:'+file.type+';base64,'+base64;return'flow-asset:'+saved.id;},
  };}
  async function openBoardNote(id:string,nodeId:string){await flushNotes();await switchTo(id);activeNote=value(await hooks.call('whiteboard_note_read',{workspaceId:id,nodeId}));noteSaveStatus=undefined;noteSaveError='';note={workspaceId:id,nodeId};await hydrateNote();await refreshNotes();renderTabs();if(!graphActive&&home.hidden&&notes.hidden&&current()?.documents.some(d=>d.id===active))return;await hooks.suspend();graphActive=false;home.hidden=true;notes.hidden=false;noteEditorHost.hidden=false;for(const e of notes.querySelectorAll<HTMLElement>('.pages-toolbar,.pages-info'))e.hidden=true;notes.querySelector('header strong')!.textContent=activeNote!.title;let revision=activeNote!.revision;activeEditor=noteEditor(activeNote!,async edit=>{activeNote=value(await hooks.call('whiteboard_note_write',{workspaceId:id,nodeId,...edit,revision}));revision=activeNote!.revision;notes.querySelector('header strong')!.textContent=edit.title;await refreshNotes();renderTabs();},()=>{activeEditor=undefined;hooks.run(showHome);},{surface:noteEditingOptions(id,activeNote!.assets??{})});noteEditorHost.replaceChildren(activeEditor);root.classList.add('workspace-reading','workspace-notes-open');root.classList.remove('workspace-home-open');}
  async function openNote(id: string, name: string) {
    const state = (await hooks.call('pdf_workspace_pages_read', { workspaceId: id, name }))._meta.pagesPreview;
    if (await openPagesOriginal(state, hooks.openPage)) return;
    const created=value(await hooks.call('whiteboard_note_import_legacy',{workspaceId:id,name}));await openBoardNote(id,created.nodeId);
  }
  async function manageNote(id: string, name: string) { await flushNotes();await switchTo(id); await hooks.suspend(); graphActive = false; active = '';noteEditorHost.hidden=true;for(const e of notes.querySelectorAll<HTMLElement>('.pages-toolbar,.pages-info'))e.hidden=false;await pages.open(id, name,!name.startsWith('board-export:')); home.hidden = true; notes.hidden = false; root.classList.remove('workspace-home-open'); root.classList.add('workspace-reading', 'workspace-notes-open'); renderTabs(); }
  const homeView=installWorkspaceHomeView(home,{
    version:PLUGIN_VERSION,run:hooks.run,notice:hooks.notice,
    workspaceMenu:()=>showWorkspaceMenu(),manageMenu:()=>showManageMenu(),
    graph:(id,mode)=>showGraph(id,false,mode),process:id=>preprocessing.show(id),
    choose:id=>{target=id;hooks.choose();},open:(id,doc)=>open(id,doc.id),
    describe:async(id,doc)=>{const result=await hooks.call('pdf_workspace_document_describe',{workspaceId:id,documentId:doc.id});if(result.isError)throw Error('题名读取失败');return result._meta.document;},
    editMetadata:async(id,doc)=>{const title=await ask('书籍标题',doc.title?.replace(/\.pdf$/i,'')??doc.name.replace(/\.pdf$/i,''));if(!title)return;const author=await ask('作者',doc.author??'');if(author===null)return;const result=await hooks.call('pdf_workspace_document_metadata',{workspaceId:id,documentId:doc.id,title,author});if(result.isError)throw Error('书籍信息保存失败');return {...doc,title,author};},
    convert:async(id,doc)=>{const w=snapshot!.workspaces.find(w=>w.id===id)!;conversion.show({workspaceId:id,name:w.name,documents:w.documents,documentId:doc.id});},
    directory:doc=>doc.projectDir??'',folder:(id,doc)=>hooks.call('pdf_workspace_document_folder',{workspaceId:id,documentId:doc.id}),
    remove:async(id,doc)=>{const answer=await ask('输入 PDF 文件名确认移除','','文档及批注保留在工作区 .archives 文件夹。');if(answer!==doc.name)return;if(workspaceId===id&&tabs.includes(doc.id))await close(doc.id);adopt((await hooks.call('pdf_workspace_document_remove',{workspaceId:id,documentId:doc.id}))._meta.workspaceSnapshot);},
    importFiles:(files,id)=>importFiles(files,id),
  });
  function renderHome(){if(snapshot)homeView.render(snapshot,workspaceId,busy);}
  function setBusy(value: boolean) { busy = value; home.inert = value; renderTabs(); }
  async function importFiles(files: File[], id = target || workspaceId) { if (busy) throw new Error('文件正在处理，请稍候'); setBusy(true); const imported: { id: string }[] = []; const errors: string[] = []; try { for (const file of files.slice(0, 64)) { try { if(/\.md$/i.test(file.name)){if(file.size>120000)throw Error('白板笔记不能超过 120000 字符');const created=value(await hooks.call('whiteboard_note_create',{workspaceId:id,title:file.name.replace(/\.md$/i,''),markdown:await file.text()}));imported.push({id:'board-note:'+created.nodeId});continue;}if ((!file.size && !/\.md$/i.test(file.name)) || file.size > (/\.md$/i.test(file.name) ? 2 : 64) * 1048576) throw new Error(/\.md$/i.test(file.name) ? 'Markdown 不能超过 2 MB' : 'PDF 不能超过 64 MB'); const bytes = new Uint8Array(await file.arrayBuffer()); const token = (await hooks.call('pdf_workspace_upload_start', { workspaceId: id, name: file.name, size: bytes.length }))._meta.token; for (let at = 0; at < bytes.length; at += 768 * 1024) { const part = bytes.subarray(at, at + 768 * 1024); let text = ''; for (let i = 0; i < part.length; i += 16384) text += String.fromCharCode(...part.subarray(i, i + 16384)); await hooks.call('pdf_workspace_upload', { token, offset: at, data: btoa(text) }); } const result = await hooks.call('pdf_workspace_upload_finish', { token }); imported.push(result._meta.document || { id: 'md:' + result._meta.note.name }); adopt(result._meta.workspaceSnapshot); } catch (e) { errors.push(`${file.name}：${e instanceof Error ? e.message : e}`); } } await switchTo(id);await refreshNotes(); for (const d of imported) if (!d.id.startsWith('board-note:')&&!tabs.includes(d.id) && tabs.length < 64) tabs.push(d.id); if(imported.length){const last=imported.at(-1)!.id;if(last.startsWith('board-note:'))await openBoardNote(id,last.slice(11));else await open(id,last);} hooks.notice(errors.length ? `已导入 ${imported.length} 份；${errors.join('；')}` : `已导入 ${imported.length} 份文档`, !!errors.length); } finally { setBusy(false); target = ''; renderTabs(); renderHome(); } }
  async function appendAnnotations(doc: PdfDocument, input: unknown, translated = '') {
    if (!note || note.workspaceId !== doc.workspaceId) throw new Error('请先在当前工作区打开一篇笔记，再返回 PDF 添加引用');
    const targetNote = note;
    const original = value(await hooks.call('whiteboard_note_read', targetNote));
    const items = (Array.isArray(input) ? input : []).filter(a => a && typeof a === 'object').slice(0, 24); const blocks: string[] = [];
    for (const a of items) {
      const text = String(a.text ?? '').slice(0, 30000), comment = String(a.comment ?? '').slice(0, 30000); const page = Number.isSafeInteger(a.position?.pageIndex) ? a.position.pageIndex + 1 : 1;
      let block = text ? text.split(/\r?\n/).map((line: string) => '> ' + line).join('\n') : '';
      if (typeof a.image === 'string' && a.image.startsWith('data:image/')) { const match=/^data:(image\/[\w]+);base64,([\s\S]+)$/.exec(a.image);if(!match)throw Error('图片格式无效');const asset=value(await hooks.call('whiteboard_asset_put',{workspaceId:targetNote.workspaceId,name:doc.name,mimeType:match[1],base64:match[2]}));block = '![' + (a.layoutKind === 'table' ? '表格' : '图片') + '](flow-asset:' + asset.id + ')\n\n' + block; }
      if (comment) block += '\n\n' + comment;
      if (translated) block += '\n\n' + String(translated).slice(0, 120000);
      if (block) { block += '\n\n[来源：' + doc.name.replace(/[\[\]]/g, '') + ' · 第 ' + page + ' 页](../' + doc.id + '/source.pdf#page=' + page + ')'; blocks.push(block); }
    }
    if (!blocks.length) throw new Error('所选内容没有可以添加的文字或图片');
    activeNote=value(await hooks.call('whiteboard_note_write', { ...targetNote,title:original.title,markdown:original.markdown + '\n\n' + blocks.join('\n\n') + '\n', revision: original.revision }));await hydrateNote();await refreshNotes();renderTabs();
    hooks.notice('引用已保存到白板笔记：' + original.title);
  }
  return {stageNoteDraft,flushNotes, showPreprocessing:(id:string)=>preprocessing.show(id),generateResearch:(id:string)=>preprocessing.generate(id),resumeGraph(){graphActive=true;reading();renderTabs();},manageNote, navigationAction, publishNavigation: renderTabs, async showConversion(id: string, documentId?: string) { await showHome(); const w = snapshot?.workspaces.find(w => w.id === id); if (!w) throw new Error('工作区不存在'); conversion.show({ workspaceId: id, name: w.name, documents: w.documents, documentId }); }, open, appendAnnotations, refresh, showHome, importFiles, currentWorkspace: () => workspaceId, async opened(doc: PdfDocument) { if (!doc.workspaceId) return; graphActive = false; if (workspaceId !== doc.workspaceId) await switchTo(doc.workspaceId); await refresh(); if (!tabs.includes(doc.id)) tabs.push(doc.id); active = doc.id; reading(); renderTabs(); await session(); }, async closeCurrent() { if (active) await close(active); else await showHome(); }, async importPath(path: string) { const id = target || workspaceId; const result = await hooks.call('pdf_workspace_import_path', { workspaceId: id, path }); adopt(result._meta.workspaceSnapshot);if(result._meta.boardNote)await openBoardNote(id,result._meta.boardNote.nodeId);else await open(id, result._meta.document?.id || 'md:' + result._meta.note.name); }, async reset() { await hooks.suspend(); graphActive = false; workspaceId = ''; tabs = []; active = ''; await showHome(); } };
}
