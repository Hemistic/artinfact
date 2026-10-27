import type { AnalysisStatus } from './mineru.js';
import { mineruProgress } from './mineru-progress.js';
import { mineruUpstreamStatus } from './mineru-upstream-status.js';
export function workspaceProgress(statuses: AnalysisStatus[]) {
  const items = statuses.map(s => ({ ...s, ...mineruProgress({ ...s, label: s.label || (s.upstreamState ? mineruUpstreamStatus({ state: s.upstreamState, progress: s.progress }).label : undefined) }) }));
  return { items, total: items.length, completed: items.filter(s => s.phase === 'completed').length, failed: items.filter(s => s.phase === 'failed').length,
    queued: items.filter(s => s.busy && s.upstreamState === 'pending').length, active: items.filter(s => s.busy).length, idle: items.filter(s => s.phase === 'idle').length };
}
