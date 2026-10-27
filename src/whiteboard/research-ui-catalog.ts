import {cardActions,cardActionInstructions} from './card-actions.js';
import type {BoardNode} from './whiteboard-domain.js';
import {referenceResearchPresets,type ResearchPreset} from '../shared/research-ui.js';
export function cardResearchPresets(node:BoardNode,source?:{category?:string}):ResearchPreset[]{
 if(node.referenceCard||source?.category==='reference')return referenceResearchPresets;
 const items:ResearchPreset[]=cardActions(node,source).map(action=>({id:action.id,label:action.label,instruction:cardActionInstructions(action.id),output:action.id==='derive_formula'?'独立 Markdown 推导卡片':source?.category==='formula'||node.presentation?.type==='formula'?'上方 Markdown 解释 · 下方原式图片':['figure','table'].includes(source?.category??'')||node.kind==='image'?'上方 Markdown 说明 · 下方原图':'当前卡片或关联研读笔记'}));
 if(source?.category==='table')items.push({id:'recognize_table',label:'识别为 Markdown 表格',instruction:'识别原表格的表头、数值、单位和脚注，上方显示 Markdown 表格，下方保留原表图片，无法确认的数值标记待核对。',output:'上方 Markdown 表格 · 下方原表图片'});
 if(['figure','table'].includes(source?.category??'')||node.kind==='image')items.push({id:'draw_explanation',label:'生成解释图片',instruction:'结合原图和论文上下文，生成一张解释机制或结果的图片，保留原图并标明补充推断。',output:'关联的解释图片卡片'});
 if(node.kind==='note'&&!source?.category)items.push({id:'rewrite',label:'AI 改写笔记',instruction:'改写当前笔记，使论述清楚、连贯，保留原意、引用、公式与证据边界。',output:'当前 Markdown 笔记'});
 return items;
}
