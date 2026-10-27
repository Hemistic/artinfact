export type ResearchDelivery = { mode: 'sent' | 'draft' | 'manual'; reason?: string };
type Sender = (text: string) => Promise<{ isError?: boolean } | undefined>;
export async function deliverResearchMessage(text: string, bridge: { send?: Sender; draft?: Sender }): Promise<ResearchDelivery> {
  let reason = '当前视图没有可用的聊天消息接口';
  for (const mode of ['sent', 'draft'] as const) {
    const action = mode === 'sent' ? bridge.send : bridge.draft;
    if (!action) continue;
    try {
      const result = await action(text);
      if (!result || result.isError) throw new Error('宿主没有接受分析任务');
      return { mode, ...(mode === 'draft' ? { reason } : {}) };
    } catch (error) { reason = error instanceof Error ? error.message : String(error); }
  }
  return { mode: 'manual', reason };
}
export function researchJobBusy(job?: { status?: string; delivery?: string; createdAt?: string }) {
  return job?.status === 'queued' && (!job.delivery || job.delivery === 'sent')
    && Date.now() - Date.parse(job.createdAt ?? '') < 20 * 60000;
}
