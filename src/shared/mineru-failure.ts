import type { AnalysisStatus } from './mineru.js';
export function mineruFailure(status?: AnalysisStatus) {
  const detail = status?.error || '请打开菜单重试';
  const parsingFailure = /parsing failed|parsing failure|解析失败/i.test(detail);
  const canRetryPipeline = status?.phase === 'failed' && status.modelVersion === 'vlm' && parsingFailure;
  const message = canRetryPipeline ? 'VLM 上游未能解析这份 PDF，可换用 Pipeline 兼容模式重试。' : parsingFailure ? '解析服务未能处理这份 PDF。可检查扫描件 OCR 设置，或稍后重试。' : detail;
  return { canRetryPipeline, message, detail };
}
