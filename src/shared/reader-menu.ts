import type { AnalysisStatus } from './mineru.js';
import type { LayoutStatus } from './layout-status.js';
import { mineruProgress } from './mineru-progress.js';
export function readerAnalysisMenu(status?: AnalysisStatus, layout?: LayoutStatus) {
  const progress = mineruProgress(status);
  const segments = status?.segments;
  const detail = segments && segments.total > 0 ? ` · 已完成 ${segments.completed}/${segments.total} 段` : '';
  const stages = { receiving: '正在传输 PDF', creating: '准备转换', uploading: '上传 PDF', parsing: '正在转换', downloading: '获取 Markdown', indexing: '合并 Markdown' };
  const label = progress.busy && segments ? stages[status!.phase as keyof typeof stages] : progress.label;
  const statusLabel = !status ? '正在读取转化状态…' : status.phase === 'idle' ? '尚未转化 Markdown' : status.phase === 'completed' ? 'Markdown 转换成功' : label + detail;
  const local = layout?.modelVersion.startsWith('MinerU 本机');
  const layoutDetail = !layout ? '读取中' : layout.phase === 'completed' ? '已完成' : layout.phase === 'failed' ? '失败' : layout.phase === 'queued' ? '本机排队中' : layout.phase === 'running' ? local && !layout.completedPages ? '本机解析中' : `${layout.completedPages}/${layout.totalPages || '…'} 页` : '未解析';
  const layoutTitle = layout?.phase === 'completed' ? `图片 ${layout.figures} · 表格 ${layout.tables} · 公式 ${layout.equations} · 直接使用已有 JSON，不重新识别` : layout?.phase === 'failed' ? layout.error ?? '点击重试布局解析' : '优先读取已有 JSON；缺失时使用本机 MinerU 标准解析生成 Markdown 和 JSON';
  return { convertLabel: status?.phase === 'completed' ? '重新转换 Markdown' : '转化 Markdown', convertDisabled: !status || progress.busy, statusLabel, statusTitle: progress.label + detail, layoutLabel: '布局解析', layoutDetail, layoutTitle, layoutDisabled: !layout || ['queued', 'running'].includes(layout.phase) };
}
