import {$prose} from '@milkdown/utils';
import {Plugin} from '@milkdown/prose/state';
import {isInTable,goToNextCell,addRowAfter,CellSelection,selectionCell,setCellAttr} from '@milkdown/prose/tables';
import type {EditorView} from '@milkdown/prose/view';
import {noteUiIcon} from './note-ui-icons.js';

// Handle table navigation before the general Markdown indent shortcut.
// ProseMirror supplies both the cell selection and row insertion commands.
export const noteTableKeyboard=$prose(()=>{
 let current:EditorView|undefined,disposed=false;
 const bar=document.createElement('div');bar.className='wb-note-table-toolbar';bar.contentEditable='false';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','表格列对齐');
 const label=document.createElement('span');label.textContent='列对齐';bar.append(label);
 const buttons=(['left','center','right'] as const).map((direction,index)=>{
  const title=['左对齐','居中','右对齐'][index],button=document.createElement('button');button.type='button';button.title=title;button.setAttribute('aria-label',title);button.innerHTML=noteUiIcon((['alignLeft','alignCenter','alignRight'] as const)[index],title);
  button.onclick=event=>{
   event.stopPropagation();if(!current?.editable||!isInTable(current.state))return;
   // Use the official column selection and cell attribute command. Restore the
   // text caret in the same transaction, so typing and undo remain predictable.
   const original=current.state.selection.getBookmark(),cell=selectionCell(current.state);
   const columnState=current.state.apply(current.state.tr.setSelection(CellSelection.colSelection(cell)));
   setCellAttr('alignment',direction)(columnState,tr=>{tr.setSelection(original.resolve(tr.doc));current!.dispatch(tr);});current.focus();refresh();
  };bar.append(button);return button;
 });
 bar.onpointerdown=event=>{event.preventDefault();event.stopPropagation();};
 const refresh=()=>{
  if(disposed||!current)return;
  if(!current.editable||!isInTable(current.state)||(!current.hasFocus()&&!bar.contains(document.activeElement))){bar.remove();return;}
  const cell=selectionCell(current.state),table=current.nodeDOM(cell.before(cell.depth-1));
  if(!(table instanceof HTMLElement)||!table.classList.contains('milkdown-table-block')){bar.remove();return;}
  if(bar.parentElement!==table)table.append(bar);
  const alignment=cell.nodeAfter?.attrs.alignment||'left';buttons.forEach((button,index)=>button.setAttribute('aria-pressed',String(alignment===['left','center','right'][index])));
 };
 return new Plugin({view(view){current=view;refresh();return{update(view){current=view;refresh();},destroy(){disposed=true;bar.remove();current=undefined;}};},props:{handleDOMEvents:{focus(){queueMicrotask(refresh);return false;},blur(){queueMicrotask(refresh);return false;},keydown(view,event){
 if(event.key!=='Tab'||event.altKey||event.ctrlKey||event.metaKey||!view.editable||!isInTable(view.state))return false;
 event.preventDefault();
 if(goToNextCell(event.shiftKey?-1:1)(view.state,view.dispatch))return true;
 if(!event.shiftKey&&addRowAfter(view.state,view.dispatch))goToNextCell(1)(view.state,view.dispatch);
 return true;
}}}});
});
