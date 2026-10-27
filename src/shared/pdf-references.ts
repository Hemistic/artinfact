// Ported from pdf-ai/electron/main.js reference indexing and citation resolution.
export type SelectionReferences = { citationTexts: string[]; citationNumbers: string[]; missingCitationNumbers: string[] };
export function extractCitationNumbers(text: string): string[] {
  const numbers = new Set<string>();
  const addRange = (a: string, b: string) => { const start = Number(a), end = Number(b); if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || end - start > 100) return; for (let n = start; n <= end && numbers.size < 120; n++) numbers.add(String(n)); };
  const regex = /\[\s*(\d+)\s*\]\s*[-–—]\s*\[\s*(\d+)\s*\]|[\[(（]((?:\d+\s*(?:[-–—]\s*\d+)?)(?:\s*[,，;；]\s*\d+\s*(?:[-–—]\s*\d+)?)*)[\])）]/gu;
  for (const match of text.slice(0, 24000).matchAll(regex)) {
    if (match[1] && match[2]) addRange(match[1], match[2]);
    else for (const part of (match[3] ?? '').split(/[,，;；]/)) { const range = part.trim().match(/^(\d+)\s*[-–—]\s*(\d+)$/); if (range) addRange(range[1], range[2]); else if (numbers.size < 120) numbers.add(part.trim()); }
    if (numbers.size >= 120) break;
  }
  return [...numbers];
}
export function buildReferenceIndex(parsed: unknown): Map<string, string> {
  const index = new Map<string, string>(); let count = 0;
  const add = (value: string) => { const text = value.replace(/\s+/g, ' ').trim().slice(0, 20000); const match = text.match(/^(?:\[(\d+)\]|(\d+)[.)])\s*(.+)$/); if (match && index.size < 20000) { const number = match[1] || match[2]; index.set(number, `[${number}] ${match[3]}`); } };
  const fragments = (value: unknown, out: string[] = [], depth = 0): string[] => {
    if (!value || depth > 32 || out.length >= 50000) return out;
    if (typeof value === 'string') { out.push(value.slice(0, 20000)); return out; }
    if (Array.isArray(value)) { for (const item of value) { if (out.length >= 50000) break; fragments(item, out, depth + 1); } }
    else if (typeof value === 'object') { const obj = value as Record<string, unknown>; for (const key of ['content', 'text', 'title']) if (typeof obj[key] === 'string' && out.length < 50000) out.push(obj[key].slice(0, 20000)); for (const item of Object.values(obj)) if (item && typeof item === 'object') fragments(item, out, depth + 1); }
    return out;
  };
  const walk = (value: unknown, depth: number) => {
    if (!value || depth > 32 || ++count > 50000) return;
    if (typeof value === 'string') { add(value); return; }
    if (Array.isArray(value)) { for (const item of value) { if (count > 50000) break; walk(item, depth + 1); } return; }
    if (typeof value === 'object') { const obj = value as Record<string, unknown>; if (obj.type === 'list' && obj.content && typeof obj.content === 'object') { const items = (obj.content as Record<string, unknown>).list_items; if (Array.isArray(items)) for (const item of items.slice(0, 20000)) add(fragments(item).join(' ')); } for (const key of ['content', 'text', 'title']) if (typeof obj[key] === 'string') add(obj[key]); for (const item of Object.values(obj)) if (item && typeof item === 'object') walk(item, depth + 1); }
  };
  walk(parsed, 0); return index;
}
export function resolveReferences(text: string, index: Map<string, string>, readerTexts: string[] = [], readerNumbers: string[] = []): SelectionReferences {
  const citationNumbers = [...new Set([...extractCitationNumbers(text), ...readerNumbers.filter(n => /^\d+$/.test(n))])].slice(0, 120);
  const selected = new Map<string, string>(); const found = new Set<string>();
  for (const raw of readerTexts.slice(0, 120)) { const value = raw.replace(/\s+/g, ' ').trim().slice(0, 20000); if (!value) continue; const number = value.match(/^\[(\d+)\]/)?.[1]; if (number) found.add(number); selected.set(number ?? value.toLowerCase(), value); }
  for (const number of citationNumbers) { const value = index.get(number); if (value) { found.add(number); if (!selected.has(number)) selected.set(number, value); } }
  let characters = 0;
  const citationTexts = [...selected.values()].slice(0, 120).filter(value => { characters += value.length; return characters <= 96000; });
  return { citationTexts, citationNumbers, missingCitationNumbers: citationNumbers.filter(n => !found.has(n)) };
}
