import { createHash } from 'node:crypto';

export async function uploadMineruPdf(url: string, bytes: Buffer) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('MinerU 上传地址无效');
  const response = await fetch(parsed, { method: 'PUT', body: new Uint8Array(bytes), redirect: 'error', signal: AbortSignal.timeout(Math.max(90000, Math.ceil(bytes.length / 1048576) * 15000)) });
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`上传 PDF 到 MinerU 失败（HTTP ${response.status}）`);
  const etag = response.headers.get('etag')?.replace(/^"|"$/g, '');
  const checksum = createHash('md5').update(bytes).digest('hex');
  if (etag && /^[a-f0-9]{32}$/i.test(etag) && etag.toLowerCase() !== checksum) throw new Error('MinerU 上传返回的文件校验值与 PDF 不一致');
  return { uploadedAt: new Date().toISOString(), uploadStatus: response.status, uploadedBytes: bytes.length };
}
