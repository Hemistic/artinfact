import {bookTheme} from '../shared/workspace-books.js';
import {selectedHomeWorkspace} from '../shared/workspace-home.js';
import {createWorkspaceViewSwitch} from '../shared/workspace-view-switch.js';
import type {WorkspaceGraphMode} from '../shared/workspace-graph-views.js';
import {mountWorkspaceBook} from './workspace-book.js';
import {bookMetadata,validBookTitle,validBookAuthor} from '../shared/book-metadata.js';
import {iconMarkup,setControlIcon,type UiIcon} from './icons.js';
export type HomeDocument={id:string;name:string;title?:string;author?:string;sourcePath:string;projectDir?:string;[key:string]:unknown};
export type HomeWorkspace={id:string;name:string;rootDir:string;documents:HomeDocument[]};
export type HomeSnapshot={workspaces:HomeWorkspace[];activeWorkspaceId:string};
type Hooks={version:string;run(action:()=>Promise<unknown>):void;notice(message:string,error?:boolean):void;
 workspaceMenu(snapshot:HomeSnapshot,selectedId:string):void;manageMenu(snapshot:HomeSnapshot,workspace:HomeWorkspace):void;
 graph(id:string,mode:WorkspaceGraphMode):Promise<void>;process(id:string):Promise<void>;choose(id:string):void;
 open(id:string,document:HomeDocument):Promise<void>;convert(id:string,document:HomeDocument):Promise<unknown>;
 describe(id:string,document:HomeDocument):Promise<HomeDocument>;
 editMetadata(id:string,document:HomeDocument):Promise<HomeDocument|undefined>;
 directory(document:HomeDocument):string;folder(id:string,document:HomeDocument):Promise<unknown>;
 remove(id:string,document:HomeDocument):Promise<void>;importFiles(files:File[],id:string):Promise<unknown>};
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
// Shared home view extracted verbatim from workspace-shell; hosts provide storage and editor actions.
export function installWorkspaceHomeView(home:HTMLElement,hooks:Hooks){
 let bookUnmounts:(()=>void)[]=[];
 let generation=0,metadataQueue=Promise.resolve();const described=new Set<string>();
 const visibleBooks=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){const book=entry.target as HTMLElement;visibleBooks.unobserve(book);const job=metadataJobs.get(book);metadataJobs.delete(book);job?.();}},{rootMargin:'80px'});
 const metadataJobs=new Map<Element,()=>void>();
 function iconButton(name:UiIcon,action:()=>Promise<unknown>,title:string,label=''){
  const b=document.createElement('button');b.type='button';b.textContent=label;b.title=title;
  b.onclick=()=>hooks.run(action);setControlIcon(b,name,!!label);return b;
 }
  function render(snapshot: HomeSnapshot, workspaceId: string, busy=false) {
    if (!snapshot) return;
    const viewGeneration=++generation;visibleBooks.disconnect();metadataJobs.clear();
    for (const unmount of bookUnmounts) unmount(); bookUnmounts = [];
    home.innerHTML = `<div class="home-content"><div class="home-hero"><div class="home-brand-lockup"><div class="home-brand-mark" aria-hidden="true"></div><div class="home-eyebrow">AIF · 事实阅读工作台</div></div><div class="home-title-row"><h1>Art in Fact</h1><div class="home-view-switch"></div></div><p>让每一份阅读痕迹成为可追溯的 artifact：在 PDF / EPUB 中阅读、标注、翻译和推理，并保留证据的来处。</p></div><section class="home-recent-section"><div class="home-section-header"><div class="home-section-heading"><span class="home-workspace-label">工作区</span><button id="home-workspace-select" aria-label="切换工作区" aria-haspopup="dialog"></button></div><div class="home-tools"></div></div><div class="home-recent-list"></div></section></div>`;
    const selected = selectedHomeWorkspace(snapshot, workspaceId);
    const selector = home.querySelector<HTMLButtonElement>('#home-workspace-select')!;
    selector.textContent=selected?.name??'选择工作区';const caret=document.createElement('span');caret.className='workspace-select-caret';caret.innerHTML=iconMarkup('chevron');selector.append(caret);
    home.querySelector('.home-tools')?.setAttribute('aria-label','工作区操作');selector.disabled = busy; selector.title = selected?.rootDir ?? '';
    selector.onclick=()=>hooks.workspaceMenu(snapshot, workspaceId);
    const switcher=createWorkspaceViewSwitch({disabled:busy||!selected,select:async mode=>{if(selected)await hooks.graph(selected.id,mode);},onError:message=>hooks.notice(message,true)});
    switcher.classList.add('home-view-switch');home.querySelector('.home-view-switch')!.replaceWith(switcher);
    const version = document.createElement('span'); version.className = 'home-version'; version.textContent = `v${hooks.version}`; version.title = '当前运行的 Artinfact 插件版本'; version.setAttribute('aria-label', `Artinfact 插件版本 ${hooks.version}`); home.prepend(version);
    const process=iconButton('graph',async()=>{if(workspaceId)await hooks.process(workspaceId);},'资料处理','资料处理');process.className='secondary-action-button with-icon';process.setAttribute('aria-haspopup','dialog');process.disabled=busy||!selected;
    const manage=iconButton('more',async()=>{if(selected)hooks.manageMenu(snapshot,selected);},'管理当前工作区');manage.className='secondary-action-button home-manage-trigger with-icon';manage.setAttribute('aria-haspopup','dialog');manage.disabled=busy||!selected;home.querySelector('.home-tools')!.append(process,manage);
    if (selected) {
      const w = selected;
      const section = document.createElement('section'); section.className = 'home-workspace-column active'; section.dataset.workspaceId = w.id;
      section.innerHTML = '<div class="home-workspace-container"><div class="home-workspace-books"></div><div class="home-workspace-drop-indicator" role="status" hidden>放下 PDF 或 Markdown 添加到此工作区</div></div>';
      const books = section.querySelector('.home-workspace-books')!;
      if (!w.documents.length) { const empty = document.createElement('p'); empty.className = 'home-recent-empty'; empty.onclick = () => { hooks.choose(w.id); }; empty.textContent = '添加 PDF 到当前工作区'; books.append(empty); }
      for (const doc of w.documents) {
        const card = document.createElement('article'); const {title,author}=bookMetadata(doc); const theme = bookTheme(doc.id, doc.sourcePath, doc.name);
        card.className = 'home-recent-item perspective-book-card'; card.dataset.documentId = doc.id; for (const [key, value] of Object.entries({ '--book-bg': theme.bg, '--book-fg': theme.fg, '--book-edge': theme.edge, '--book-page': '#ffffff', '--book-page-line': '#ded7ca' })) card.style.setProperty(key, value);
        card.innerHTML = `<div class="spell-perspective-book" title="${escape(title)}" aria-label="打开 ${escape(title)}" role="button" tabindex="0"></div><div class="home-recent-actions"><details class="home-recent-menu"><summary class="home-recent-menu-button" aria-label="更多操作"></summary><div class="home-recent-menu-popup"><button data-action="open-document">打开文档</button><button data-action="book-metadata">编辑题名与作者</button><button data-action="convert-document">本机解析与进度</button><button data-action="open-folder">打开文件夹</button><button data-action="copy-folder">复制地址</button></div></details><button class="home-recent-remove" aria-label="移除文档"></button></div>`;
        const cover=card.querySelector<HTMLElement>('.spell-perspective-book')!;let unmount=mountWorkspaceBook(cover,title,author);bookUnmounts.push(()=>unmount());
        const metadataKey=w.id+':'+doc.id;
        if(!busy&&!described.has(metadataKey)&&(!validBookTitle(doc.title,doc.name)||!validBookAuthor(doc.author))){metadataJobs.set(cover,()=>{described.add(metadataKey);metadataQueue=metadataQueue.then(async()=>{
          if(viewGeneration!==generation||!cover.isConnected){described.delete(metadataKey);return;}const result=await hooks.describe(w.id,doc);Object.assign(doc,{title:result.title,author:result.author});if(viewGeneration!==generation||!cover.isConnected)return;
          const label=bookMetadata(doc);unmount();unmount=mountWorkspaceBook(cover,label.title,label.author);cover.title=label.title+(label.author?'\n'+label.author:'');cover.setAttribute('aria-label','打开 '+label.title);
        }).catch(()=>{});});visibleBooks.observe(cover);}
        setControlIcon(card.querySelector('summary')!, 'more', false); setControlIcon(card.querySelector('.home-recent-remove')!, 'close', false);
        for (const [action, icon] of [['open-document', 'book'], ['convert-document', 'refresh'], ['open-folder', 'folder'], ['copy-folder', 'clipboard']] as const) setControlIcon(card.querySelector(`[data-action="${action}"]`)!, icon);
        const book = card.querySelector<HTMLElement>('.spell-perspective-book')!; const read = () => { if (!busy) hooks.run(() => hooks.open(w.id, doc)); }; book.onclick = read; book.onkeydown = e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); read(); } };
        const more = card.querySelector<HTMLDetailsElement>('details')!; more.ontoggle = () => { if (more.open) for (const other of home.querySelectorAll<HTMLDetailsElement>('details[open]')) if (other !== more) other.open = false; };
        card.querySelector<HTMLButtonElement>('[data-action="open-document"]')!.onclick = () => { more.open = false; read(); };
        card.querySelector<HTMLButtonElement>('[data-action="book-metadata"]')!.onclick=()=>{more.open=false;hooks.run(async()=>{const updated=await hooks.editMetadata(w.id,doc);if(!updated)return;Object.assign(doc,{title:updated.title,author:updated.author});if(!cover.isConnected)return;const label=bookMetadata(doc);unmount();unmount=mountWorkspaceBook(cover,label.title,label.author);cover.title=label.title+(label.author?'\n'+label.author:'');cover.setAttribute('aria-label','打开 '+label.title);});};
        card.querySelector<HTMLButtonElement>('[data-action="convert-document"]')!.onclick = () => { more.open = false; hooks.run(()=>hooks.convert(w.id,doc)); };
        card.querySelector<HTMLButtonElement>('[data-action="copy-folder"]')!.onclick = () => hooks.run(async () => { await navigator.clipboard.writeText(hooks.directory(doc)); more.open = false; hooks.notice('目录已复制'); });
        card.querySelector<HTMLButtonElement>('[data-action="open-folder"]')!.onclick = () => hooks.run(async () => { await hooks.folder(w.id,doc); more.open = false; });
        card.querySelector<HTMLButtonElement>('.home-recent-remove')!.onclick = () => hooks.run(async () => { await hooks.remove(w.id,doc); }); books.append(card);
      }
      section.ondragover = e => { if (!busy && [...e.dataTransfer?.types ?? []].includes('Files')) { e.preventDefault(); section.classList.add('is-pdf-drop-target'); section.querySelector<HTMLElement>('.home-workspace-drop-indicator')!.hidden = false; } }; section.ondragleave = () => { section.classList.remove('is-pdf-drop-target'); section.querySelector<HTMLElement>('.home-workspace-drop-indicator')!.hidden = true; }; section.ondrop = e => { e.preventDefault(); e.stopPropagation(); section.classList.remove('is-pdf-drop-target'); section.querySelector<HTMLElement>('.home-workspace-drop-indicator')!.hidden = true; const files = [...e.dataTransfer?.files ?? []].filter(f => /\.(pdf|md)$/i.test(f.name)); hooks.run(() => hooks.importFiles(files, w.id)); };
      home.querySelector('.home-recent-list')!.append(section);

    }

  }
 return {render,destroy(){++generation;visibleBooks.disconnect();metadataJobs.clear();for(const unmount of bookUnmounts)unmount();home.replaceChildren();}};
}
