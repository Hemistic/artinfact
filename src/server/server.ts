import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { OpenAIExtensions, type OpenAIUiResourceMetadata } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { relative, resolve, isAbsolute, sep } from 'node:path';
import { realpath } from 'node:fs/promises';
import { snapshot, saveProfile, deleteProfile, loadStore, buildPlan, resolveWorkspace } from '../shared/layout.js';
import { ProfileSchema, friendlyError } from '../shared/profile.js';
import { PLUGIN_VERSION } from '../shared/version.js';
import { registerPdfTools, type PdfServerOptions } from './pdf-tools.js';
import type { WorkspaceSettings } from './workspace-settings.js';
import { artinfactNavigationIcons } from './navigation-icon.js';

export const RESOURCE = 'ui://codex-work-layout/sidebar';
export const PANEL_RESOURCE = 'ui://codex-work-layout/panel';
const icons = artinfactNavigationIcons;

export function createLayoutServer(options: { workspace: string; pluginRoot?: string; html: string; pdf?: PdfServerOptions; workspaceSettings?: WorkspaceSettings }) {
  const server = new McpServer({ name: 'codex-work-layout', version: PLUGIN_VERSION, title: 'Artinfact', icons });
  new OpenAIExtensions(server);
  if (options.pdf) registerPdfTools(server, options.pdf);
  const workspace = z.string().min(1).max(4000).optional().describe('真正的项目绝对路径；从插件目录启动时需先选择项目');
  function isPluginLocation(value: string, pluginRoot = options.pluginRoot) {
    if (/\/\.codex\/plugins\/cache(?:\/|$)/i.test(value.replaceAll('\\', '/'))) return true;
    if (!pluginRoot) return false;
    const path = relative(resolve(pluginRoot), resolve(value));
    return path === '' || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path));
  }
  const initialWorkspace = options.workspace && !isPluginLocation(options.workspace) ? options.workspace : '';
  async function folder(value?: string) {
    const path = value ?? options.workspaceSettings?.read().workspace ?? initialWorkspace;
    if (!path) throw new Error('请先选择真正的项目目录，再保存或打开面板');
    const root = await resolveWorkspace(path);
    const canonical = await realpath(root);
    if (isPluginLocation(canonical, options.pluginRoot ? await realpath(options.pluginRoot) : undefined)) throw new Error('这是插件目录，请选择真正的项目目录');
    return root;
  }
  async function read(value?: string) {
    if (!value && !initialWorkspace && !options.workspaceSettings?.read().workspace) return { workspace: '', storePath: '', profiles: [], suggestedFile: '' };
    return snapshot(await folder(value));
  }
  async function response(action: () => Promise<object>) {
    try {
      const result = await action();
      return { content: [{ type: 'text' as const, text: JSON.stringify(result), annotations: { audience: ['assistant' as const] } }], structuredContent: result as Record<string, unknown> };
    } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: friendlyError(error) }] }; }
  }
  if (options.workspaceSettings) {
    const settings = options.workspaceSettings;
    server.registerTool('layout_workspace_read', { description: '读取用户自己的默认工作目录设置。', inputSchema: {}, _meta: { ui: { visibility: ['app'] } }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }, () => response(async () => settings.read()));
    server.registerTool('layout_workspace_update', { description: '用户在插件设置中保存已有文件夹，立即作为插件默认目录，并在下次启动恢复；不移动 PDF 存档或 Codex 聊天。', inputSchema: { workspace: z.string().min(1).max(4000) }, _meta: { ui: { visibility: ['app'] } }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }, args => response(async () => { const root = await folder(args.workspace); const value = await settings.set(root); process.chdir(root); return value; }));
  }
  for (const [name, uri, surface] of [['work-layout-sidebar', RESOURCE, 'sidebar'], ['work-layout-panel', PANEL_RESOURCE, 'conversation']] as const) {
    registerAppResource(server, name, uri, {}, async () => ({ contents: [{
    uri, mimeType: RESOURCE_MIME_TYPE, text: options.html.replace('<html ', () => `<html data-surface="${surface}" `),
    _meta: {
      ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: surface === 'conversation' },
      'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['fullscreen'] } satisfies OpenAIUiResourceMetadata,
    },
    }] }));
  }
  registerAppTool(server, 'layout_open', {
    title: '工作布局', description: '兼容旧版布局预设；统一的应用入口为 pdf_sidebar（Artinfact 工作区）。',
    inputSchema: { workspace }, ...{ icons },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: RESOURCE, visibility: ['app'] },
    },
  }, async args => response(() => read(args.workspace)));
  registerAppTool(server, 'layout_panel', {
    title: '工作布局配置', description: '兼容旧版布局配置，不再注册独立应用入口；打开 Artinfact 使用 pdf_open 或 pdf_sidebar。',
    inputSchema: { workspace }, ...{ icons },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: PANEL_RESOURCE, visibility: ['app'] },
    },
  }, async args => response(() => read(args.workspace)));
  server.registerTool('layout_list', {
    title: '列出工作布局', description: '读取项目的已保存布局，不打开面板。', inputSchema: { workspace },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } },
  }, args => response(() => read(args.workspace)));
  server.registerTool('layout_save', {
    title: '保存工作布局', description: '保存或更新一个命名布局，保留同项目其他预设，兼容旧版 JSON。',
    inputSchema: { workspace, profile: ProfileSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } },
  }, args => response(async () => saveProfile(await folder(args.workspace), args.profile)));
  server.registerTool('layout_delete', {
    title: '删除布局预设', description: '仅在用户要求或点击删除时，删除指定命名布局，不关闭面板。',
    inputSchema: { workspace, name: z.string().min(1).max(80) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } },
  }, args => response(async () => deleteProfile(await folder(args.workspace), args.name)));
  server.registerTool('layout_plan', {
    title: '校验布局', description: '校验未保存或命名布局，返回逐项 open_in_codex 调用计划；不执行布局。',
    inputSchema: { workspace, profile: ProfileSchema.optional(), name: z.string().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } },
  }, args => response(async () => {
    const root = await folder(args.workspace);
    const profile = args.profile ?? (args.name ? (await loadStore(root)).profiles[args.name] : undefined);
    if (!profile) throw new Error('请提供 profile 或存在的布局名称');
    return buildPlan(root, profile);
  }));
  return server;
}
