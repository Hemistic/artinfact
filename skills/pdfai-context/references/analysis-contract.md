## AI Outline Contract

Use `languagePolicy.outputLanguage` from the MCP result for all generated explanations and language metadata. The `zh` examples below are illustrative, not a Chinese-only requirement. Preserve verbatim quotations, immutable native chapter titles and LaTeX.

Select the contract from `pdf_ai_inspect.aiOutlineSource.outlineSource` before creating a candidate:

- `pdf-native`: Native PDF outline titles are immutable. Never translate, rename, remove, reorder, or replace them. Generate exactly one short `annotation` for every entry returned by `pdf_ai_inspect.nativeOutline`, including structural entries such as References when present. The MCP 预检器 supplies the canonical title, level, page, and ordering.
- `mineru-json`: The PDF has no native bookmarks. `pdf_ai_inspect.aiOutlineSource.entries` is the canonical navigable chapter tree extracted from MinerU JSON. Preserve every `id`, `parentID`, title, level, and order exactly. Generate exactly one short `annotation` for every entry, using its `id`; never invent, merge, remove, or substitute chapters. The MCP 预检器 binds all PDF positions.
- `none`: Do not write an outline. Ask the user to convert the document to Markdown/JSON first.

AI outlines and AI insights are independent, persistent data sets. Generating or regenerating one must never clear, replace, or weaken the other. Do not call `pdf_ai_clear` during a generation task. Before an outline-only write, record the current insight count from `read`; omit `aiInsights` and `aiInsightMeta` from every `pdf_ai_prepare` and `pdf_ai_write` payload, then verify those insights still exist after the write. Before an insights-only write, record the current outline state; omit `aiOutline` from every payload and never send `aiOutline: null`.

Pass this candidate shape to `pdf_ai_prepare`:

```json
{
  "aiOutline": {
    "language": "zh",
    "items": [
      {
        "nativeOutlineOrder": 1,
        "annotation": "Defines the research problem and the paper's central contribution.",
        "sourceBlockIndices": [4, 9, 10]
      }
    ]
  }
}
```

The candidate must include every native order exactly once. `pdf_ai_prepare` converts it to the portable `external-skill-v1` mode so the annotations survive PDF reloads. Do not use `pdf_ai_clear` or an empty `items` array as a substitute for a complete outline.

For a `mineru-json` source, use IDs instead of native orders:

```json
{
  "aiOutline": {
    "language": "zh",
    "items": [
      {
        "id": "mineru-section-1",
        "annotation": "概述本节的问题设定、方法思路和关键结论。"
      }
    ]
  }
}
```

The candidate must include every `pdf_ai_inspect.aiOutlineSource.entries[].id` exactly once. `pdf_ai_prepare` restores the canonical title, hierarchy, and clickable PDF position; never supply or infer a `nativeOutlineOrder` for this source.

## AI Insight Contract

Use one `innovation` record per independently claimed contribution and separate `evidence` records for important source-grounded findings. They are independent sets: neither kind requires a one-to-one counterpart. Set `aiInsightEvidenceFor` only when a direct relationship is explicit; otherwise omit it.

```json
{
  "aiInsights": [
    {
      "aiInsightKind": "innovation",
      "aiInsightKey": "symmetry-aware-loss",
      "text": "Symmetry-aware rotation loss",
      "comment": "Explains the new mechanism and why it resolves the stated ambiguity.",
      "quote": "A verbatim source excerpt of at least 18 characters.",
      "aiInsightSourceBlockId": "b-42"
    },
    {
      "aiInsightKind": "evidence",
      "aiInsightKey": "symmetry-aware-loss-e1",
      "aiInsightEvidenceRole": "result",
      "text": "A measured supporting result",
      "comment": "Reports a key source-grounded result.",
      "quote": "A different verbatim source excerpt of at least 18 characters.",
      "aiInsightSourceBlockIndex": 79
    }
  ]
}
```

Rules:

- Use a stable, readable ASCII `aiInsightKey`; evidence keys must also be unique.
- Keep `quote` verbatim from its selected MinerU text block. Do not use ellipses, paraphrases, citations, bibliography entries, figure captions, or table captions as evidence anchors.
- Cover claimed contributions and key findings across the abstract, introduction limitations/contributions, methods, training, data/evaluation, experiments, ablations, and conclusion. Prefer 6-12 non-duplicate records when the paper supports that many.
- Do not claim global novelty, priority, or state of the art without source support.
- Do not provide `position`, `pageLabel`, or `sortIndex`; `pdf_ai_prepare` owns all coordinate generation.
- Do not inject figures or tables into text insights unless the user explicitly asks for a separate figure/table workflow.

When writing insights, include matching metadata:

```json
{
  "aiInsightMeta": {
    "language": "zh",
    "status": "ready",
    "provider": "pdfai-context-skill",
    "promptVersion": "skill-v1",
    "innovationCount": 1,
    "evidenceCount": 1
  }
}
```

## Write Safety

- A write containing `aiInsights` replaces only prior AI-managed insights; it preserves user annotations and MinerU layout annotations.
- A write containing `aiOutline` replaces only AI outline annotations and preserves all AI insights. Omit `aiOutline` when updating insights alone, and omit `aiInsights` when updating the outline alone.
- Preserve only the requested fields returned by preflight in the final write payload. In an insights-only task, omit `aiOutline`; in an outline-only task, omit `aiInsights` and `aiInsightMeta`.
- Do not use `pdf_ai_clear`, `aiOutline: null`, an empty outline, or an empty insight array to reset the other analysis type while generating either result.
- Do not write anything when preflight is invalid, MinerU is missing, or the native outline cannot be inspected.

