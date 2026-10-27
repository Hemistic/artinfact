import type { PdfDocument } from '../shared/pdf-selection.js';
import type { AnalysisStatus } from '../shared/mineru.js';
type Hooks = { current(): { document?: PdfDocument; ready: boolean }; call(name: string, args: Record<string, unknown>): Promise<any>; progress(status?: AnalysisStatus): void; refresh(): Promise<void>; notice(message: string, error?: boolean): void };
export function installMineruStatus(hooks: Hooks) {
  let revision = 0, status: AnalysisStatus | undefined, submitting = false, timer: ReturnType<typeof setTimeout> | undefined;
  async function poll() {
    clearTimeout(timer); const doc = hooks.current().document; if (!doc || !hooks.current().ready) return;if(document.hidden){timer=setTimeout(()=>void poll(),4000);return;} const mine = revision;
    try {
      const next = (await hooks.call('pdf_mineru_status', { workspaceId: doc.workspaceId, documentId: doc.id }))._meta.mineruStatus as AnalysisStatus;
      if (mine !== revision || submitting) return; const previous = status; status = next;if(JSON.stringify(previous)!==JSON.stringify(next))hooks.progress(next);
      if (next.phase === 'completed' && (previous?.phase !== 'completed' || previous.token !== next.token)) await hooks.refresh();
    } catch { /* Preserve reading and the last observed status during a transient failure. */ }
    finally { if (mine === revision) timer = setTimeout(() => void poll(), 4000); }
  }
  return {
    stop() { revision++; clearTimeout(timer); },
    changed() { revision++; clearTimeout(timer); status = undefined; hooks.progress(); void poll(); },
    async convert() {
      const doc = hooks.current().document;
      if (!doc?.workspaceId || !hooks.current().ready || submitting || !status || !['idle', 'completed', 'failed'].includes(status.phase)) return;
      const mine = revision; submitting = true; clearTimeout(timer);
      hooks.progress({ documentId: doc.id, phase: 'creating', engine: 'local', label: '正在准备本机标准解析' });
      try {
        const next = (await hooks.call('pdf_workspace_mineru_convert', { workspaceId: doc.workspaceId, documentId: doc.id }))._meta.mineruStatus as AnalysisStatus;
        if (mine === revision) { status = next; hooks.progress(next); }
      } catch (error) { if (mine === revision) { hooks.progress(status); hooks.notice('Markdown 转换未启动：' + (error instanceof Error ? error.message : String(error)), true); } }
      finally { submitting = false; void poll(); }
    }
  };
}
