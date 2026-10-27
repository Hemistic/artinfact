---
name: wiki-lint
description: 检查本插件选定工作区 Wiki 的断链、孤立页、重复概念、元数据、证据和过期索引，按用户授权修复。
---

从用户取得 workspaceId；`wiki_lint` 读取图谱数量、missing、orphans 和 pages，结合 `wiki_read` 检查 frontmatter、sources、正文引用、同义概念、index/hot 和文档页码。图谱算法不能判断语义真实性，需要读实际来源。

文献页应关联真实 MinerU Markdown 和同一 documentId 的原 PDF。检查是否把 PDF/MD 重复当文献或重复引用同一图表；未完成转换的原文提取页面应报告为不符合摄入链路，修复时先保留并归档原页面，再按转换结果更新。

先列出可复现的问题和影响。仅检查时不修改；用户请求修复时，通过 `wiki_write`（最新 expectedRevision）修复明确的链接、补来源和索引，保留原文与用户笔记。不要删除页面、重写未知引用或在没有证据时合并概念。再次运行 wiki_lint、wiki_graph_build，报告已修复和待确认项。
