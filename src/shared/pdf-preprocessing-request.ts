import {wikiTaskPrompt} from './research-prompts.js';
export function pdfPreprocessingPrompt(workspaceId:string,documentIds:string[],_taskId?:string,graph=false){
 if(!graph)return '';
 return `用户主动点击了 Artinfact 的“AI 洞察图谱”。workspaceId=${workspaceId}，documentIds=${JSON.stringify(documentIds)}。只有本次明确请求的洞察与图谱需要 AI。
PDF 基础卡片已由本机自动生成；不要启动逐条 Agent 预处理，不用对每个图表、公式、章节或已有批注重复生成摘要。已有手写内容、AI 洞察和用户布局保留。可读 whiteboard_pdf_preprocess_results 复用已有有效说明，原文仍需按本次分析目的实际阅读、核实；新判断使用真实来源。
${wikiTaskPrompt(workspaceId,documentIds)}
`;
}
