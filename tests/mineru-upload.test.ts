import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { uploadMineruPdf } from '../src/server/mineru-upload.ts';

test('raw PDF upload records acknowledged bytes and rejects failed HTTP or checksum mismatch', async () => {
  const bytes = Buffer.from('%PDF-1.7\noriginal bytes');
  const server = createServer(async (req, res) => {
    assert.equal(req.method, 'PUT'); assert.equal(req.headers.authorization, undefined); assert.equal(req.headers['content-type'], undefined);
    const received: Buffer[] = []; for await (const chunk of req) received.push(chunk); assert.deepEqual(Buffer.concat(received), bytes);
    if (req.url === '/failure') res.statusCode = 403;
    else res.setHeader('etag', `"${req.url === '/mismatch' ? 'a'.repeat(32) : createHash('md5').update(bytes).digest('hex')}"`);
    res.end();
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const receipt = await uploadMineruPdf(origin + '/ok', bytes); assert.equal(receipt.uploadedBytes, bytes.length); assert.equal(receipt.uploadStatus, 200); assert.ok(Number.isFinite(Date.parse(receipt.uploadedAt)));
    await assert.rejects(uploadMineruPdf(origin + '/failure', bytes), /HTTP 403/);
    await assert.rejects(uploadMineruPdf(origin + '/mismatch', bytes), /校验值/);
  } finally { await new Promise<void>(r => server.close(() => r())); }
});
