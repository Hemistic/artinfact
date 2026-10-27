export type LightPdfPart = { startPage: number; endPage: number; bytes: Buffer };
export const LIGHT_LIMITS = { maxPages: 20, maxBytes: 10 * 1024 * 1024 };

export async function partitionLightPdf(bytes: Buffer, pages: number, extract: (startPage: number, endPage: number) => Promise<Buffer>, limits = LIGHT_LIMITS): Promise<LightPdfPart[]> {
  if (!Number.isSafeInteger(pages) || pages < 1) throw new Error('PDF 页数无效');
  if (pages <= limits.maxPages && bytes.length <= limits.maxBytes) return [{ startPage: 1, endPage: pages, bytes }];
  const parts: LightPdfPart[] = [];
  async function take(startPage: number, endPage: number) {
    const data = await extract(startPage, endPage);
    if (data.length <= limits.maxBytes) { parts.push({ startPage, endPage, bytes: data }); return; }
    if (startPage === endPage) throw new Error(`PDF 第 ${startPage} 页拆分后大小仍超过轻量接口的 10 MB 上限，请压缩该页后重试。`);
    const middle = Math.floor((startPage + endPage) / 2);
    await take(startPage, middle); await take(middle + 1, endPage);
  }
  for (let first = 1; first <= pages; first += limits.maxPages) await take(first, Math.min(pages, first + limits.maxPages - 1));
  return parts;
}

export function mergeLightMarkdown(parts: Array<{ startPage: number; endPage: number; text: string }>) {
  let next = 1;
  return parts.map(part => {
    if (part.startPage !== next || part.endPage < part.startPage) throw new Error('Markdown 分段缺页或顺序错误');
    if (!part.text.trim()) throw new Error('Markdown 分段内容为空');
    next = part.endPage + 1;
    return `<!-- PDF pages ${part.startPage}-${part.endPage}; source: MinerU Agent lightweight -->\n\n${part.text.trim()}`;
  }).join('\n\n') + '\n';
}
