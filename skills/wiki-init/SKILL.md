---
name: wiki-init
description: 为本插件选定工作区初始化原软件的持久 LLM Wiki 和知识图谱资料库，保留现有页面。
---

从用户或工作区图谱任务取得明确的 workspaceId，不根据当前终端 cwd 猜测。调用 `wiki_initialize`；原软件模板、目录和缺失文件会在该工作区的 `claude-obsidian-graph-vault` 中创建，已有内容不覆盖。

用 `wiki_list` 验证 wiki/{sources,concepts,entities,domains,questions,comparisons,references,decisions,canvases,meta}、index.md、hot.md、overview.md、log.md 和模板。用户有明确主题时用 `wiki_read` 读索引，再用 `wiki_write` 合并主题说明，保留 expectedRevision。初始化不等于完成语义知识图谱；需要 wiki-ingest 写入实际资料页及链接。
