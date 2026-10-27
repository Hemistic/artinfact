export function renderGraphDocument(template: string, graph: unknown, title: string) {
  const escaped = title.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const data = JSON.stringify({ ...(graph as object), title }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return template.replace('<!--GRAPH_TITLE-->', () => escaped).replace('<!--GRAPH_DATA-->', () => data);
}
