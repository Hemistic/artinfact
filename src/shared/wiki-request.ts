type Call = (name: string, args: Record<string, unknown>) => Promise<any>;

export async function graphReadyDocuments(call: Call, workspaceId: string): Promise<string[]> {
  const inventory = await call('pdf_workspace_inventory', { workspaceId });
  const workspace = inventory.structuredContent?.workspace;
  if (workspace?.id !== workspaceId || !Array.isArray(workspace.documents)) throw new Error('工作区资料列表不匹配，请重新打开工作区');
  if (!workspace.documents.length) throw new Error('请先添加并转换 PDF');
  // Use the same app-visible readiness as the conversion menu. The agent reads Markdown after delivery.
  const result = await call('pdf_workspace_mineru_status', { workspaceId });
  const value = result._meta?.mineruWorkspaceStatus;
  if (value?.workspaceId !== workspaceId || !Array.isArray(value.statuses)) throw new Error('工作区转换状态不匹配，请刷新后重试');
  const ready = new Set(value.statuses.filter((s: any) => s.phase === 'completed'&&s.engine==='local').map((s: any) => s.documentId));
  const ids = workspace.documents.filter((d: any) => ready.has(d.id)).map((d: any) => d.id) as string[];
  if (!ids.length) throw new Error('此工作区没有本机 MinerU 标准 JSON，请先在布局解析菜单准备资料');
  return ids;
}
