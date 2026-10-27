export function isTransportClosed(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /transport closed|connection (?:closed|lost)|not connected/i.test(message);
}
// Only replay reads and idempotent writes. Sending a research request is never replayed here.
export async function callWithTransportRetry<T>(name: string, action: () => Promise<T>, wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (!isTransportClosed(error) || !/^(?:pdf_(?:state_(?:read|update)|runtime_read|document_read|ai_(?:read|inspect|brief|task_delivery))|.*_(?:read|list|inventory|status))$/.test(name)) throw error;
    await wait(500);
    return action();
  }
}
