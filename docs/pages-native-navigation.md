# Pages 原生导航

当前 UI 的卡片、已关联笔记条目与关联工具栏共用 openPage(pageId)。公共 MCP Apps SDK 发送：

```ts
await app.openLink({ url: `codex://space/${pageId}` }, { timeout: 15000 });
```

pageId 必须严格匹配 page_[a-f0-9]{32}。不会把正文、标题或缓存指令用于导航，不发送聊天消息，不自动回退到 Agent、HTTPS 链接或 Markdown 快照。

## 宿主证据与适用边界

在 Windows 桌面 App 26.930.4958.0 的随包静态源代码中核对了完整链路：

- mcp-sandbox-rpc 的链接 schema 明确允许 https / codex / codex-dev 协议。
- widget 的 open-link 处理在验证后将链接交给桌面链接打开接口。
- 主进程的链接打开接口优先交给 queueCodexDeepLinkUrl；有效深链接先于浏览器目标设置处理。
- bootstrap 的 space 路由读取路径中的页面 ID，拒绝 credentials、port、query、hash，生成 /space/<pageId>。
- 主进程的 spacePage 分支将该路径交给主窗口 navigateToRoute。

这里只读取了静态文件，没有调用 App 私有 IPC、修改宿主文件或降低隔离策略。插件运行时只依赖公共 MCP Apps SDK。公开插件文档描述 openLink 为宿主链接接口，未承诺所有宿主支持原生 Pages；本实现依据当前桌面版本，其他宿主拒绝时明确报错。

## 验证

pages-host-bridge.test.ts 使用安装的 App、AppBridge 与 SDK InMemoryTransport，验证 ui/open-link 原样收到 codex://space/<pageId>，ui/message 调用数为零，拒绝结果向 UI 报错。它是协议往返验证，不是原生画面验证。

网页预览调用独立 /preview/page-open，只记录 last-page-open.json，不打开操作系统协议，不提交模型请求。原生 App 的实际页面显示仍须通过 App 界面验证。

创建、关联或刷新云端内容仍由现有 Pages 同步流程完成；直接打开不需要读取正文或执行 skill。
