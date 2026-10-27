import {commandsCtx,editorViewCtx,type Editor} from '@milkdown/core';
import {toggleStrongCommand,toggleEmphasisCommand,toggleInlineCodeCommand,wrapInHeadingCommand,turnIntoTextCommand,wrapInBulletListCommand,wrapInOrderedListCommand,wrapInBlockquoteCommand,createCodeBlockCommand,insertHrCommand} from '@milkdown/preset-commonmark';
import {toggleStrikethroughCommand,insertTableCommand} from '@milkdown/preset-gfm';
import {toggleLinkCommand} from '@milkdown/components/link-tooltip';
import {undoCommand,redoCommand} from '@milkdown/plugin-history';
import {useAIInstructionTooltipAPI} from '@milkdown/crepe/feature/ai';
import {AllSelection} from '@milkdown/prose/state';
import {insertNoteMath} from './note-ui.js';
export const noteMenuTools=[['bold','加粗'],['italic','斜体'],['strike','删除线'],['code','行内代码'],['h1','标题 1'],['h2','标题 2'],['h3','标题 3'],['paragraph','正文'],['bullet','无序列表'],['ordered','有序列表'],['quote','引用块'],['link','链接'],['table','表格'],['codeBlock','代码块'],['divider','分隔线'],['math','行内公式'],['mathBlock','公式块'],['undo','撤销编辑'],['redo','重做编辑']] as const;
export function runNoteMenuCommand(editor:Editor,name:string){editor.action(ctx=>{const view=ctx.get(editorViewCtx);if(!view.editable)return;
 const commands={bold:toggleStrongCommand,italic:toggleEmphasisCommand,strike:toggleStrikethroughCommand,code:toggleInlineCodeCommand,paragraph:turnIntoTextCommand,bullet:wrapInBulletListCommand,ordered:wrapInOrderedListCommand,quote:wrapInBlockquoteCommand,link:toggleLinkCommand,codeBlock:createCodeBlockCommand,divider:insertHrCommand,undo:undoCommand,redo:redoCommand};
 if(name==='math'||name==='mathBlock')insertNoteMath(ctx,name==='mathBlock');
 else if(/^h[1-6]$/.test(name))ctx.get(commandsCtx).call(wrapInHeadingCommand.key,Number(name.slice(1)));
 else if(name==='table')ctx.get(commandsCtx).call(insertTableCommand.key);
 else if(name==='ai'){if(view.state.selection.empty)view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));useAIInstructionTooltipAPI(ctx).show(view.state.selection.from,view.state.selection.to);return;}
 else {const command=commands[name as keyof typeof commands];if(command)ctx.get(commandsCtx).call(command.key);}
 view.focus();});}
