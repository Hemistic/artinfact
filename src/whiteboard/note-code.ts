import {syntaxHighlighting} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {classHighlighter,highlightTree} from '@lezer/highlight';

// The same Lezer token classes serve CodeMirror and the lightweight card copy.
export const noteCodeHighlight=syntaxHighlighting(classHighlighter);
export function snapshotNoteCode(root:HTMLElement){
 for(const block of root.querySelectorAll<HTMLElement>('.milkdown-code-block[data-code-source]')){
  const label=document.createElement('span'),pre=document.createElement('pre'),code=document.createElement('code'),copy=document.createElement('button'),tools=document.createElement('div');
  label.className='wb-code-language';label.textContent=block.dataset.codeLanguage||'纯文本';
  tools.className='wb-code-tools';copy.type='button';copy.textContent='复制代码';copy.dataset.codeCopy='true';tools.append(label,copy);
  pre.className='wb-code-static';code.textContent=block.dataset.codeSource!;pre.append(code);block.replaceChildren(tools,pre);block.classList.remove('selected');
 }
}
export function bindStaticNoteCode(root:HTMLElement){
 for(const block of root.querySelectorAll<HTMLElement>('.milkdown-code-block[data-code-source]')){
  const copy=block.querySelector<HTMLButtonElement>('[data-code-copy]'),source=block.dataset.codeSource!,name=(block.dataset.codeLanguage||'').toLowerCase(),code=block.querySelector<HTMLElement>('.wb-code-static code');
  if(copy)copy.onclick=async e=>{e.stopPropagation();try{await navigator.clipboard.writeText(source);copy.textContent='已复制';}catch{copy.textContent='复制失败';}};
  if(!code||!source||source.length>100_000)continue;
  const language=languages.find(item=>item.name.toLowerCase()===name||item.alias.includes(name));if(!language)continue;
  void language.load().then(({language})=>{
   if(!code.isConnected)return;
   const fragment=document.createDocumentFragment();let end=0;
   highlightTree(language.parser.parse(source),classHighlighter,(from,to,classes)=>{if(from>end)fragment.append(source.slice(end,from));const span=document.createElement('span');span.className=classes;span.textContent=source.slice(from,to);fragment.append(span);end=to;});
   fragment.append(source.slice(end));code.replaceChildren(fragment);
  }).catch(()=>{/* Unknown grammars keep readable source. */});
 }
}
