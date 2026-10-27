export const PDF_FEATURES = { aiAnalysis: true, markdownExport: false };
export const AI_PAUSED_MESSAGE = 'AI 大纲和 AI 洞察暂未开放，等待恢复完整 PDF 结构解析。';
export function requirePdfAi() { if (!PDF_FEATURES.aiAnalysis) throw new Error(AI_PAUSED_MESSAGE); }
