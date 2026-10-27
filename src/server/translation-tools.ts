import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SelectionTranslationService, TranslationPreferencesStore, TranslationPreferencesSchema } from './selection-translation.js';

export function registerTranslationTools(server: McpServer, root: string) {
  const settings = new TranslationPreferencesStore(root), service = new SelectionTranslationService();
  const metadata = { ui: { visibility: ['app'] } };
  const attempt = async (action: () => Promise<Record<string, unknown>>) => {
    try { return { content: [], _meta: await action() }; }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : '翻译请求失败' }] }; }
  };
  server.registerTool('pdf_translation_preferences_read', { title: '读取选文翻译设置', description: '阅读器专用：读取本机划词划句翻译设置。', inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, _meta: metadata }, () => attempt(async () => ({ translationPreferences: await settings.read() })));
  server.registerTool('pdf_translation_preferences_update', { title: '保存选文翻译设置', description: '阅读器专用：保存自动翻译、Bing/Google 和目标语言。', inputSchema: { preferences: TranslationPreferencesSchema }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, _meta: metadata }, ({ preferences }) => attempt(async () => ({ translationPreferences: await settings.write(preferences) })));
  server.registerTool('pdf_selection_translate', { title: '翻译阅读器选文', description: '阅读器专用：将选中文字发送给用户选择的 Bing/Google 翻译服务；不上传 PDF，结果只返回阅读器浮窗。', inputSchema: { text: z.string().min(1).max(12000) }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }, _meta: metadata }, ({ text }) => attempt(async () => {
    const preferences = await settings.read(); if (!preferences.enabled) throw new Error('自动选文翻译已关闭');
    try { return { selectionTranslation: await service.translate(text, preferences) }; }
    catch { throw new Error(`${preferences.provider === 'bing' ? 'Bing' : 'Google'} 翻译暂时不可用。请重试，或在左上角对勾菜单 → 选文翻译中切换服务。`); }
  }));
}
