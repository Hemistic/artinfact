import {noteCodeHighlight} from './note-code.js';
import {codeMirror} from '@milkdown/crepe/feature/code-mirror';
import {languages} from '@codemirror/language-data';
import {safeNoteHtml} from './note-html.js';
import {insertNoteExtension} from './note-extensions.js';
import {CrepeBuilder} from '@milkdown/crepe/builder';
import {ai} from '@milkdown/crepe/feature/ai';
import {blockEdit} from '@milkdown/crepe/feature/block-edit';
import {listItem} from '@milkdown/crepe/feature/list-item';
import {linkTooltip} from '@milkdown/crepe/feature/link-tooltip';
import {table} from '@milkdown/crepe/feature/table';
import {cursor} from '@milkdown/crepe/feature/cursor';
import {placeholder} from '@milkdown/crepe/feature/placeholder';
import {imageBlock} from '@milkdown/crepe/feature/image-block';
import {editorViewCtx,type Editor} from '@milkdown/core';
import type {Ctx} from '@milkdown/ctx';
import {noteSlashRange,noteSlashSupport} from './note-slash.js';
import {insertedNoteNodePosition,insertSlashList,insertSlashTable,insertSlashDivider} from './note-slash-commands.js';
import {noteUiIcon as icon} from './note-ui-icons.js';
import {noteReferenceHref,noteReferencePlugin,type NoteEditingOptions} from './note-references.js';
import {noteSelectionToolbar} from './note-selection-toolbar.js';
import {TextSelection} from '@milkdown/prose/state';

export function insertNoteMath(ctx:Ctx,block:boolean,slash=false){
 const view=ctx.get(editorViewCtx),type=view.state.schema.nodes[block?'note_math_block':'note_math_inline'],tr=view.state.tr,range=slash?noteSlashRange(view):undefined;
 // Removing the trigger and inserting math are one undoable document change.
 if(range)tr.delete(range.from,range.to);
 const latex=tr.doc.textBetween(tr.selection.from,tr.selection.to),node=type.create(null,latex?view.state.schema.text(latex):undefined);
 tr.replaceSelectionWith(node,false);
 // ProseMirror may copy a block while fitting it into a heading/list. Use the
 // replacement's document range, never object identity, to find the new node.
 const position=insertedNoteNodePosition(tr,type);
 if(position===undefined)throw Error('Math insertion anchor missing');
 if(block&&tr.doc.nodeAt(position+node.nodeSize)?.type!==view.state.schema.nodes.paragraph)tr.insert(position+node.nodeSize,view.state.schema.nodes.paragraph.create());
 tr.setSelection(TextSelection.create(tr.doc,position+1,position+1+latex.length));view.dispatch(tr);view.focus();
}
export function editableNoteEditor(host:HTMLElement,markdown:string,assets:Record<string,string>,options:NoteEditingOptions&{readOnly?:boolean}):Editor{
 const builder=new CrepeBuilder({root:host,defaultValue:markdown});
 const handleRoot=host.closest<HTMLElement>('.wb-card')??host;
 const slash=options.readOnly?undefined:noteSlashSupport();if(slash)builder.editor.use(slash.plugin);
 const common={boldIcon:icon('bold','加粗'),italicIcon:icon('italic','斜体'),strikethroughIcon:icon('strike','删除线'),codeIcon:icon('code','行内代码'),linkIcon:icon('link','链接')};
 builder.addFeature(listItem).addFeature(table,{addRowIcon:icon('add','添加行'),addColIcon:icon('add','添加列'),deleteRowIcon:icon('remove','删除行'),deleteColIcon:icon('remove','删除列'),alignLeftIcon:icon('alignLeft','左对齐'),alignCenterIcon:icon('alignCenter','居中'),alignRightIcon:icon('alignRight','右对齐'),colDragHandleIcon:icon('dragColumn','列操作'),rowDragHandleIcon:icon('drag','行操作')}).addFeature(codeMirror,{languages,extensions:[noteCodeHighlight],searchPlaceholder:'搜索代码语言',noResultText:'没有匹配的语言',copyText:'复制代码',renderLanguage:language=>safeNoteHtml(language||'纯文本')});if(!options.readOnly)builder.addFeature(cursor,{virtual:false}).addFeature(placeholder,{text:'写下你的想法，输入 / 插入内容…'});
 builder.addFeature(imageBlock,{onUpload:async file=>{if(!options.uploadImage)throw Error('请在白板中导入图片后插入笔记');return options.uploadImage(file);},proxyDomURL:url=>url.startsWith('flow-asset:')?assets[url.slice(11)]??'':/^(https?:\/\/|data:image\/(png|jpeg|webp|gif);base64,)/i.test(url)?url:'',inlineUploadButton:'上传图片',blockUploadButton:'上传图片',blockConfirmButton:'插入',blockUploadPlaceholderText:'粘贴图片地址',inlineUploadPlaceholderText:'粘贴图片地址',blockCaptionPlaceholderText:'图题'});
 if(!options.readOnly)builder.addFeature(linkTooltip,{inputPlaceholder:'输入链接地址',editButton:icon('edit','编辑链接'),removeButton:icon('remove','移除链接'),confirmButton:icon('confirm','确认链接'),linkIcon:icon('copy','复制链接')});
 if(options.aiProvider)builder.addFeature(ai,{provider:options.aiProvider,aiIcon:icon('ai','AI 改写'),instructionPlaceholder:'说明你希望如何改写…',suggestionsHeaderLabel:'AI 编辑',sendAsPromptHeaderLabel:'自定义要求',sendAsPromptLabel:'发送要求：',submitButtonLabel:'开始改写',listboxLabel:'AI 改写方式',streamingIndicator:{fallbackLabel:'等待 Codex 改写',cancelHint:'Esc 取消'},diff:{acceptLabel:'接受',rejectLabel:'放弃'},diffActions:{retryLabel:'重新改写',rejectAllLabel:'放弃全部',acceptAllLabel:'接受全部',modSymbol:'Ctrl'},onError:error=>{let status=host.querySelector<HTMLElement>('.wb-note-ai-error');if(!status){status=document.createElement('small');status.className='wb-note-ai-error';status.setAttribute('role','status');host.append(status);}status.textContent='AI 改写失败，原文已保留：'+error.message;},buildAISuggestions:builder=>{builder.clear();for(const [id,label,prompt]of [['rewrite','改写','改写选中文字，使表达清晰自然，保留原意、事实、引文和公式。'],['polish','学术润色','用准确简洁的学术语言润色选中文字，不增加未经证实的事实。'],['shorten','精简','精简选中文字，保留核心含义、证据、引文和公式。'],['expand','扩写','补充选中文字的解释与衔接，不捏造事实、证据或来源。'],['grammar','修正语法','修正选中文字的语法、错别字和标点，保持原意。'],['chinese','翻译为中文','将选中文字翻译为简体中文，保留公式与引文链接。'],['english','翻译为英文','将选中文字翻译为英文，保留公式与引文链接。']])builder.addItem(id,{label,prompt,streamingLabel:label,icon:icon('ai',label)});}});
 if(!options.readOnly)builder.editor.use(noteSelectionToolbar(ctx=>insertNoteMath(ctx,false),!!options.aiProvider));
 if(!options.readOnly)builder.addFeature(blockEdit,{slashMenu:slash!.slashMenu,blockHandle:{root:handleRoot,getPlacement:()=> 'right-start',floatingUIOptions:{middleware:[]},getPosition:({active,blockDom})=>{
  // Reuse the card's existing padding, without reserving extra document width.
  if(!blockDom.dataset.noteBound){blockDom.dataset.noteBound='true';for(const type of ['pointerdown','click','dragstart','dragover','drop'])blockDom.addEventListener(type,event=>event.stopPropagation());}
  const bounds=handleRoot.getBoundingClientRect(),block=active.el.getBoundingClientRect(),height=blockDom.getBoundingClientRect().height;
  const top=Math.max(bounds.top,Math.min(block.top,bounds.bottom-height));
  return {x:bounds.left,y:top,left:bounds.left,right:bounds.left,top,bottom:top,width:0,height:0};
 }},handleAddIcon:icon('add','插入块'),handleDragIcon:icon('drag','拖动块'),textGroup:{label:'文本',text:{label:'正文'},...Object.fromEntries([1,2,3,4,5,6].map(level=>['h'+level,{label:'标题 '+level}])),quote:{label:'引用块'},divider:{label:'分隔线'}},listGroup:{label:'列表',bulletList:{label:'无序列表'},orderedList:{label:'有序列表'},taskList:{label:'任务列表'}},advancedGroup:{label:'内容',image:{label:'图片'},codeBlock:{label:'代码块'},table:{label:'表格'}},buildMenu:groups=>{const divider=groups.getGroup('text').group.items.find(item=>item.key==='divider');if(divider)divider.onRun=insertSlashDivider;for(const item of groups.getGroup('list').group.items){const kind=item.key==='ordered-list'?'ordered':item.key==='task-list'?'task':'bullet';item.onRun=ctx=>insertSlashList(ctx,kind);}const tableItem=groups.getGroup('advanced').group.items.find(item=>item.key==='table');if(tableItem)tableItem.onRun=insertSlashTable;groups.addGroup('navigation','笔记结构').addItem('toc',{label:'目录',icon:icon('toc','目录'),onRun:(ctx:Ctx)=>insertNoteExtension(ctx,'toc')}).addItem('mermaid',{label:'Mermaid 图表',icon:icon('diagram','Mermaid 图表'),onRun:(ctx:Ctx)=>insertNoteExtension(ctx,'mermaid')});groups.addGroup('formula','公式').addItem('inline-formula',{label:'行内公式',icon:icon('math','行内公式'),onRun:(ctx:Ctx)=>insertNoteMath(ctx,false,true)}).addItem('block-formula',{label:'公式块',icon:icon('math','公式块'),onRun:(ctx:Ctx)=>insertNoteMath(ctx,true,true)});}});
 if(options.references)builder.editor.use(noteReferencePlugin(host,options));
 return builder.editor;
}
export function bindNoteUi(host:HTMLElement,options:NoteEditingOptions){
 const pointer=(event:Event)=>{if((event.target as Element).closest('.milkdown-toolbar,.milkdown-slash-menu,.milkdown-block-handle,.wb-note-references,.ProseMirror'))event.stopPropagation();};
 const error=(message:string)=>{let status=host.querySelector<HTMLElement>('.wb-note-reference-error');if(!status){status=host.ownerDocument.createElement('small');status.className='wb-note-reference-error';status.setAttribute('role','status');host.append(status);}status.textContent=message;};
 const open=(event:MouseEvent)=>{const anchor=(event.target as Element).closest<HTMLAnchorElement>('a[href]');if(!anchor)return;
  const href=anchor.getAttribute('href');if(!href?.startsWith('#artinfact-ref/'))return;event.preventDefault();
  if(!(event.ctrlKey||event.metaKey||anchor.closest('.link-preview')))return;event.stopImmediatePropagation();
  const reference=options.references?.().find(ref=>noteReferenceHref(ref)===href);if(!reference){error('引用已移除或不属于当前工作区');return;}
  void Promise.resolve().then(()=>options.onReference?.(reference)).catch(reason=>error('打开引用失败：'+String(reason)));
 };
 host.addEventListener('pointerdown',pointer);host.addEventListener('click',open,true);
 const handleRoot=host.closest<HTMLElement>('.wb-card')??host;
 const hideHandle=()=>{for(const el of handleRoot.querySelectorAll<HTMLElement>(':scope>.milkdown-block-handle'))el.dataset.show='false';};
 handleRoot.addEventListener('scroll',hideHandle,true);
 const drag=(event:Event)=>event.stopPropagation();for(const type of ['dragstart','dragover','drop'])host.addEventListener(type,drag);
 return ()=>{handleRoot.removeEventListener('scroll',hideHandle,true);host.removeEventListener('pointerdown',pointer);host.removeEventListener('click',open,true);for(const type of ['dragstart','dragover','drop'])host.removeEventListener(type,drag);};
}
