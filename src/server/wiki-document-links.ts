export type DocumentBinding = { workspaceId: string; documentId: string; title: string; kind: 'mineru-markdown'; markdownPath: string; pdfPath: string; jsonPath?: string; format?: 'markdown-only' | 'structured'; segments?: Array<{ startPage: number; endPage: number }>; originalPdf: string; markdownSha256: string; structurePath?: string; layoutPath?: string };

// One document owns the Markdown used for research and the PDF used for original evidence.
export function collapseDocumentRepresentations(graph: any, bindings: DocumentBinding[]) {
  const owners = new Map<string, string>(); const documents = new Map<string, DocumentBinding>();
  for (const binding of bindings) {
    const page = `wiki/sources/${binding.documentId}.md`;
    const owner = graph.nodes.some((n: any) => n.id === page) ? page : binding.markdownPath;
    owners.set(binding.markdownPath, owner); owners.set(binding.pdfPath, owner); documents.set(owner, binding);
  }
  graph.nodes = graph.nodes.filter((n: any) => !(owners.has(n.id) && owners.get(n.id) !== n.id) && !(n.type === 'raw' && /\.pdf$/i.test(n.relativePath || n.id)));
  for (const node of graph.nodes) { node.degree = 0; if (documents.has(node.id)) { node.document = documents.get(node.id); if (node.type === 'raw') node.label = node.document.title; } }
  const ids = new Set(graph.nodes.map((n: any) => n.id)); const edges = new Map<string, any>();
  for (const edge of graph.edges) {
    const source = owners.get(edge.source) || edge.source, target = owners.get(edge.target) || edge.target;
    if (source === target || !ids.has(source) || !ids.has(target)) continue;
    const id = `${edge.relation}:${source}->${target}${edge.canvasPath ? '@' + edge.canvasPath : ''}`;
    const previous = edges.get(id); if (previous) previous.weight = Math.max(previous.weight, edge.weight);
    else edges.set(id, { ...edge, id, source, target });
  }
  graph.edges = [...edges.values()];
  const nodes = new Map<string, any>(graph.nodes.map((n: any) => [n.id, n]));
  for (const e of graph.edges) { nodes.get(e.source).degree += e.weight; nodes.get(e.target).degree += e.weight; }
  graph.rawSources = graph.rawSources.filter((s: any) => !owners.has(s.id) && !/\.pdf$/i.test(s.relativePath || s.id));
  graph.documents = bindings;
  Object.assign(graph.summary, { nodeCount: graph.nodes.length, edgeCount: graph.edges.length, rawSourceCount: graph.rawSources.length, documentCount: bindings.length });
  return graph;
}
