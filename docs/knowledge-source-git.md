# 白板与图谱源码的 Git 同步

源码仓库为 `https://github.com/Hemistic/artinfact`，暂时为私人仓库，主分支为 `main`，初始导入基线为 0.13.52。安装缓存不是维护入口。

开发后提交源码。若向另一个 ArtInFact 项目同步白板、图谱、领域模型和 MCP 工具，请在接收项目的适配层保留它的 Markdown、侧栏、CLI、主题和性能修复。

```sh
npm run source:status
git add src scripts tests skills docs package.json package-lock.json
git commit -m "feat: update knowledge module"
```

ArtInFact 的 `electron/knowledge-map-source` 目录执行：

```sh
npm run source:pull -- --source /path/to/codex-work-layout --ref codex/plugin-source --check
npm run source:pull -- --source /path/to/codex-work-layout --ref codex/plugin-source
npm run build
npm test
```

同步读取 Git 已提交的文件；bundle 不包含工作区未提交的修改，即使源项目仍在开发也可以导出已提交版本。接收项目锁定完整 commit，三方合并适配补丁；冲突时停止且保留原代码，报告存于接收项目 `.source-sync-conflicts/`。两边项目各自保留最终发行控制。

离线传递到 Mac 或另一台开发机：

```sh
npm run source:bundle -- --output /path/to/knowledge-source.bundle
git clone --branch main /path/to/knowledge-source.bundle /path/to/plugin-source
```

后续 bundle 在该克隆中使用 `git fetch /path/to/knowledge-source.bundle main`，同步命令指定 `--ref FETCH_HEAD`。源码快照随 ArtInFact 提交；旧接收项目中 `source:pull` 的 `--ref` 也应改为实际提交或 `main`，不可假设历史分支存在。

本仓库保留构建所需的 vendor 源码与运行资产，以及第三方许可证。Git 不追踪生成的 dist、普通 npm 依赖、预览数据、本机配置、模型和用户工作区。bundle 仅包含已提交源码；它不是完整运行时安装包。完整安装包通过 `npm run package:github` 生成，见 [INSTALL.md](INSTALL.md)。
