import type { PdfDocument } from '../shared/pdf-selection.js';
import type { LayoutStatus } from '../shared/layout-status.js';

type Hooks = { current(): { document?: PdfDocument; ready: boolean }; call(name: string, args: Record<string, unknown>): Promise<any>; progress(status?: LayoutStatus): void; apply(annotations: object[]): Promise<void>; notice(message: string, error?: boolean): void };
export function installMineruLayout(hooks: Hooks) {
  let revision = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const submissions = new Map<string, Promise<any>>();
  async function start(restart = false, ensure = false) {
    const mine = ++revision; clearTimeout(timer); hooks.progress();
    if (restart) hooks.notice('');
    const doc = hooks.current().document; if (!doc?.workspaceId || !hooks.current().ready) return;
    const scope = { workspaceId: doc.workspaceId, documentId: doc.id };
    const current = () => { const value = hooks.current(); return mine === revision && value.ready && value.document?.workspaceId === scope.workspaceId && value.document.id === scope.documentId; };
    let applied = '';
    async function receive(status: LayoutStatus) {
      if (!current()) return;
      hooks.progress(status);
      const signature = status.token ?? `${status.figures}/${status.tables}/${status.equations}`;
      if (status.phase === 'completed' && signature !== applied) {
        const value = await hooks.call('pdf_workspace_layout_read', scope);
        if (current()) { await hooks.apply(value._meta.layoutAnnotations); applied = signature; }
      } else if (status.phase === 'failed') hooks.notice('本机版面识别失败：' + status.error, true);
      if (!current()) return;
      timer = setTimeout(() => void poll(), ['queued','running'].includes(status.phase) ? 1200 : 4000); timer.unref?.();
    }
    async function poll() {
      if (!current()) return;if(document.hidden){timer=setTimeout(()=>void poll(),4000);return;}
      try { await receive((await hooks.call('pdf_workspace_layout_status', scope))._meta.layoutStatus); }
      catch (error) { if (current()) hooks.notice('本机版面识别进度读取失败：' + (error instanceof Error ? error.message : String(error)), true); }
    }
    try {
      let request: Promise<any>;
      if (restart || ensure) {
        const key = JSON.stringify([scope.workspaceId, scope.documentId]);
        request = submissions.get(key)!;
        if (!request) {
          request = hooks.call('pdf_workspace_layout_start', { ...scope, restart }).finally(() => { if (submissions.get(key) === request) submissions.delete(key); });
          submissions.set(key, request);
        }
      } else request = hooks.call('pdf_workspace_layout_status', scope);
      await receive((await request)._meta.layoutStatus);
    }
    catch (error) { if (current()) { hooks.progress({ phase: 'failed', error: String(error), completedPages: 0, totalPages: 0, figures: 0, tables: 0, equations: 0, modelVersion: '' }); hooks.notice('本机版面识别未启动：' + (error instanceof Error ? error.message : String(error)), true); } }
  }
  return { changed: () => void start(), restart: () => start(true), ensure: () => start(false,true), async cached() { const doc=hooks.current().document;if(!doc?.workspaceId)return false;return (await hooks.call('pdf_workspace_layout_status',{workspaceId:doc.workspaceId,documentId:doc.id}))._meta.layoutStatus.phase==='completed'; }, stop() { revision++; clearTimeout(timer); } };
}
