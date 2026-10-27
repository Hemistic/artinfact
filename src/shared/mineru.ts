export type PageMetric = { width: number; height: number };
export type StructureNode = { id: string; type: string; title: string; text: string; level: number; citationNumbers?: string[]; children: StructureNode[]; meta: Record<string, unknown> };
export type StructureTree = { title: string; root: StructureNode; references: Record<string, string>; stats: Record<string, number> };
export type AnalysisPhase = 'receiving' | 'creating' | 'uploading' | 'parsing' | 'downloading' | 'indexing' | 'completed' | 'failed' | 'idle';
export type AnalysisStatus = { documentId: string; token?: string; phase: AnalysisPhase; label?: string; batchId?: string; taskId?: string; engine?: 'lightweight' | 'precision' | 'local'; segments?: { completed: number; total: number; startPage?: number; endPage?: number }; upstreamState?: string; upstreamCheckedAt?: string; upstreamStateSince?: string; submittedAt?: string; uploadedAt?: string; uploadStatus?: number; uploadedBytes?: number; warning?: string; updatedAt?: string; modelVersion?: 'vlm' | 'pipeline'; progress?: { extractedPages?: number; totalPages?: number; percent?: number; step?: string }; figures?: number; tables?: number; stats?: Record<string, number>; error?: string };
export type ContextContent = { type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string };
export type NodeContext = { content: ContextContent[]; structuredContent: Record<string, unknown> };

