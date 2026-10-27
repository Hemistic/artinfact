---
name: wiki-save
description: 把用户确认的研究问答和结论保存到本插件选定工作区 Wiki，维护来源、双链、索引和知识图谱。
---

确定 workspaceId、需要保存的结论及证据；临时对话不自动存档。读 wiki/index.md、hot.md 和相关页，决定放在 questions/concepts/entities/sources/comparisons/decisions 的哪一类，复用已有语义页面以免重复。

文献依据必须来自已完成 MinerU 转换的 MD；PDF 通过 documentId/manifest 作为原文回跳定位入口。来源页的 sources 指向对应 markdownPath，同一文献只维护一页，PDF 与 MD 中的同一图表保留相同文档身份。新摄入只使用本机 MinerU 标准 JSON，旧轻量结果必须先重新解析；不编造页码或结构编号。

页面 frontmatter 至少有 title/type/sources；正文包含可独立理解的结论、原文支持、PDF 身份和页码、真实 `[[wiki/...]]` 双链、限制与尚未确定的问题。来源明确、事实与推断分开。用 `wiki_write` 写入，expectedRevision 必须来自最新 wiki_read；新建 null，冲突重新合并。

同步合并 index/hot/log，不覆盖其他用户条目，hot 保持简短。`wiki_graph_build` 重建图谱并读回新页面，最后给出保存位置和证据范围。
