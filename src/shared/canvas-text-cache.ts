// Camera changes and physics frames do not change a label's font or wrapping.
export function canvasTextCache(ctx: CanvasRenderingContext2D) {
 const widths = new Map<string, number>(), wrapped = new Map<string, string[]>();
 function measure(text: string) {
  const key = ctx.font + '\0' + text; let width = widths.get(key);
  if (width === undefined) { width = ctx.measureText(text).width; if (widths.size >= 6000) widths.delete(widths.keys().next().value!); widths.set(key, width); }
  return width;
 }
 function wrap(label: string, maxWidth: number, lines = 2) {
  const key = JSON.stringify([ctx.font, label, maxWidth, lines]), cached = wrapped.get(key); if (cached) return cached;
  const result: string[] = []; let current = '';
  for (const character of label) { if (measure(current + character) > maxWidth && current) { result.push(current); current = character; } else current += character; }
  if (current) result.push(current);
  if (result.length > lines) { result.length = lines; let last = result[lines - 1]; while (measure(last + '…') > maxWidth && last) last = last.slice(0, -1); result[lines - 1] = last + '…'; }
  if (wrapped.size >= 2000) wrapped.delete(wrapped.keys().next().value!); wrapped.set(key, result); return result;
 }
 return { measure, wrap, clear() { widths.clear(); wrapped.clear(); } };
}
