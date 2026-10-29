# Artinfact 中文说明

Artinfact 是一个本机 PDF 研究工作台，包含 PDF 阅读与批注、Milkdown Markdown 笔记、白板、知识图谱，以及供宿主 Agent 调用的本机 MCP 服务。

当前基线为 **0.13.52**，维护者 **Hemistic**，免费开源。本仓库公开提供插件、MCP 服务、源码和安装说明，无需邀请即可查看。首个安装包面向 **Windows x64**，需要 **Node.js 22 或更高版本**。

## 功能

- 原始 PDF 优先打开；阅读不依赖 MinerU 或 AI 处理完成。
- MinerU 按需在本机生成 Markdown、结构 JSON、图、表、公式和参考文献；素材进入“＋”资料库，由读者选择加入白板。
- 使用 Milkdown 编辑笔记，支持表格、数学公式、代码高亮、Mermaid、双链和目录。
- 白板卡片可编辑、调整尺寸、连线和加入背景分区；图谱展示研究关系。
- AI 大纲、洞察、图表与公式研读、参考文献深读等由用户主动触发，通过宿主 Agent 与 MCP 读原文并回写结果。
- 支持 Pages 关联，以及 Markdown＋资源、`.artinfact` 和 `.canvas`＋资源导出。

## 安装

从 [Releases](https://github.com/Hemistic/artinfact/releases) 下载 `artinfact-0.13.52-windows-x64.zip`，解压到固定位置。在 PowerShell 中执行：

```powershell
codex plugin marketplace add "C:\Tools\artinfact-0.13.52-windows-x64"
codex plugin add codex-work-layout@artinfact-local
```

路径替换为实际解压目录。重启桌面宿主并启用 Artinfact。首次可以使用包内合成示例 PDF 检查阅读功能。安装包已经包含编译后的界面、MCP、阅读器和必要运行库，不包含 Python 环境或模型权重。

GitHub 自动生成的 Source code ZIP 是源码，需要先构建：

```powershell
git clone https://github.com/Hemistic/artinfact.git
cd artinfact
npm ci
npm run build
npm run verify:runtime
npm run package:github
```

生成的完整包位于 `releases/`。完整步骤见 [INSTALL.md](INSTALL.md)，开发结构见 [DEVELOPMENT.md](DEVELOPMENT.md)，单独接入 MCP 见 [MCP.md](MCP.md)。宿主必须支持本机 stdio MCP；完整图形界面还依赖 MCP Apps 和相应宿主接口。

## 数据和许可证

仓库包含插件源码、MCP、构建脚本、第三方组件及许可证；不包含个人 PDF、笔记工作区、模型、账号凭据或客服邮件。请在升级前备份自己的工作区。

集成源码沿用现有发行声明中的 AGPL-3.0-or-later；第三方组件保留各自许可证。参见 [LICENSE](../LICENSE) 与 [NOTICE.md](../NOTICE.md)。

支持邮箱：**quinerlyrybicki@gmail.com**。GitHub 分发不代表已通过 OpenAI 插件目录审核。
