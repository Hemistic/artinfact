import type { AnalysisStatus } from './mineru.js';

// Keep the transport lifecycle compatible with saved jobs while showing the actual upstream state.
export function mineruUpstreamStatus(value: { state?: unknown; progress?: unknown }): Pick<AnalysisStatus, 'phase' | 'label' | 'upstreamState' | 'progress'> {
  const state = typeof value.state === 'string' ? value.state.trim().toLowerCase() : '';
  const progress = state === 'running' && value.progress && typeof value.progress === 'object'
    ? value.progress as AnalysisStatus['progress'] : undefined;
  const labels: Record<string, string> = {
    'waiting-file': 'MinerU 等待接收上传文件',
    uploading: 'MinerU 正在接收文件',
    pending: 'MinerU 云端排队中，尚未开始解析',
    running: 'MinerU 正在解析',
    converting: 'MinerU 正在生成 Markdown',
    done: '下载转换产物',
    failed: 'MinerU 云端解析失败',
  };
  return {
    phase: state === 'done' ? 'downloading' : 'parsing',
    label: labels[state] ?? '正在查询 MinerU 云端状态',
    upstreamState: state || undefined,
    progress,
  };
}
