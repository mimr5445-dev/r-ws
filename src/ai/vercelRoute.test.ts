import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../../server/vercelApp';

test('Vercel: /api/ai/engines يعمل مع المسار الكامل', async () => {
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const res = await fetch(`${base}/api/ai/engines`);
    const body: any = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.keyless, true);
    // بدون ضبط متغيرات على الخادم: المهيّأ false لكن المسار صحيح
    assert.equal(body.shared.configured, Boolean(process.env.AI_SHARED_BASE_URL));
    const health: any = await (await fetch(`${base}/api/ai/health`)).json();
    assert.equal(health.ok, true);
    const missing = await fetch(`${base}/api/ai/nope`);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
