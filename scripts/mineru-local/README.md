# Artinfact 本机 MinerU 处理器

Windows 和 macOS 用户首次点击环形菜单“布局解析”，如果未安装，会提示“需要下载 MinerU”。选择中国源（ModelScope）或美国／国际源（Hugging Face），再点击“下载并部署”。未选择来源或关闭提示均不会下载。按钮自动完成下载、独立环境部署及真实 PDF 测试，无需手动运行脚本。安装完成后返回菜单点击“布局解析”即可。

上述来源选择用于模型下载，不保证 CDN 的物理所在国家；安装工具和 Python 使用官方来源。插件只附带本目录的安装脚本及说明，不包含 MinerU 安装包、Python 环境或模型文件。也可在 Windows 中双击独立脚本 `Install-MinerU.cmd`；命令行指定下载源见下文。

脚本创建独立 Python 3.12 环境，安装固定版本 `mineru==4.0.10` 的基础依赖，下载 ONNX 小模型及 llama.cpp GGUF 模型，校验模型并实际解析测试 PDF。只有获得非空 Markdown 和有效结构 JSON 后才标记可用。无须预装 Python，不修改系统 Python，不提供另一套 GPU 安装。MinerU 基础包自动使用支持的显卡；Apple Silicon 会随官方基础包安装 Torch 依赖，Windows 基础安装不额外安装 Torch。

macOS 后台部署使用同一个 Node 运行时执行 `Install-MinerU.mjs`，不依赖 PowerShell。模型与环境仍位于工作目录，安装状态和就绪凭据与 Windows 相同。也可运行 `node Install-MinerU.mjs --workspace-dir "$HOME/Documents/Artinfact" --model-source huggingface`；标准输出应重定向到处理器目录的 `installer-bootstrap.log`，供插件读取安装详情。下载会使用继承的 `HTTPS_PROXY` 等环境变量。

默认路径是插件当前工作目录下的 `processors/mineru`，首次为当前用户“文档/Artinfact/processors/mineru”。环境和模型不位于插件安装目录。首次下载约 2 GB 模型，需要联网；解析使用本机模型，不上传 PDF、不需要 API Token。模型下载、安装及真实测试状态可以在设置中查看；安装日志保存在处理器目录。

可以在“本机 MinerU 设置”修改处理器目录并重新安装。修改路径不会搬移既有模型、工作区或 PDF。高级用户也可设置 `CODEX_MINERU_LOCAL_DIR`；该变量优先于界面设置。自定义处理器路径保存到当前工作目录 `.artinfact/mineru-local.json`；切换工作目录后，未设置自定义路径的工作目录使用自己的默认处理器路径。

```powershell
# 指定路径和下载源
.\Install-MinerU.ps1 -InstallDir 'D:\Artinfact-Processor\mineru' -ModelSource modelscope
# 用自己的 PDF 第一页做安装测试
.\Install-MinerU.ps1 -SamplePdf 'D:\Papers\sample.pdf'
# 重新安装依赖并完成模型检查和测试
.\Install-MinerU.ps1 -Repair
```

`ModelSource` 支持 `auto`、`modelscope`、`huggingface`。重复运行复用已下载模型。`DependenciesOnly` 仅用于开发诊断，不会标记处理器就绪。

打开 PDF 只加载已有批注和解析缓存。点击“布局解析”或“转化 Markdown”才开始本机 Standard 解析；两者共享同一次输出：Markdown、Middle JSON 2.0、图片、结构树、图表和公式框。Markdown 为内部图谱资料，不提供单独导出。重新解析保留旧结果到新解析成功，并保留手动批注和已编辑的布局框。多个 PDF 在当前处理进程中串行解析。

处理进度显示排队、解析、结构建立和完成；页数无法可靠获取时使用不确定进度，不估算百分比。失败可在菜单重试，日志位于文档 `mineru/runs/<任务编号>/mineru-process.log`。解析使用短临时目录，完成后删除临时副本；产物写回原工作区，避免 Windows 原生依赖的长路径限制。

官方文档：[安装](https://opendatalab.github.io/MinerU/quick_start/)、[输出格式](https://opendatalab.github.io/MinerU/reference/output_files/)。
