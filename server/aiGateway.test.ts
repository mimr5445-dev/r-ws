import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { createAiRouter, extractYaml, normalizeBaseUrl } from './aiGateway';

test('extractYaml يزيل كتلة الكود والشرح المحيط', () => {
  const raw = 'إليك السيناريو المطلوب:\n```yaml\nmeta:\n  title: حصار\n  map: world_live\ntimeline: []\n```\nملاحظة: يمكنك تعديل الإحداثيات.';
  const yaml = extractYaml(raw);
  assert.equal(yaml, 'meta:\n  title: حصار\n  map: world_live\ntimeline: []');
});

test('extractYaml يقتطع من meta: عندما لا توجد كتلة كود', () => {
  const raw = 'شرح قصير\nmeta:\n  title: x\n  map: world_live\n  duration_hint: "20s"\ntimeline: []';
  const yaml = extractYaml(raw);
  assert.ok(yaml.startsWith('meta:'));
  assert.ok(yaml.endsWith('timeline: []'));
});

test('extractYaml يقص المسافات الطرفية ويهمل الردّ الفارغ', () => {
  assert.equal(extractYaml('  ```\nmeta:\n  map: a\n```  '), 'meta:\n  map: a');
  assert.equal(extractYaml(''), '');
});

test('normalizeBaseUrl يضيف البروتوكول و/v1 عند الحاجة', () => {
  assert.equal(normalizeBaseUrl('127.0.0.1:11434'), 'http://127.0.0.1:11434/v1');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/v1');
  assert.equal(normalizeBaseUrl('https://api.example.com'), 'https://api.example.com/v1');
  assert.equal(normalizeBaseUrl(''), '');
});

test('بوابة AI: /engines يكتشف محرّكًا وهميًا و /scenario يعيد YAML مستخرجًا', async () => {
  const fake = express();
  fake.use(express.json());
  let captured: any = null;
  fake.get('/v1/models', (_req, res) => res.json({ data: [{ id: 'local-qwen' }] }));
  fake.post('/v1/chat/completions', (req, res) => {
    captured = req.body;
    res.json({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '```yaml\nmeta:\n  title: حصار بحري\n  map: world_live\ntimeline:\n  - at: "0s"\n    caption: { text: "بداية" }\n```'
          }
        }
      ]
    });
  });
  const fakeServer = await new Promise<http.Server>((resolve) => {
    const s = fake.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = fakeServer.address() as any;
  const fakeBase = `http://127.0.0.1:${addr.port}/v1`;

  const app = express();
  app.use('/api/ai', createAiRouter({ presets: [{ id: 'fake', label: 'Fake', baseUrl: fakeBase }] }));
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/ai`;

  try {
    const enginesRes = await fetch(`${base}/engines`);
    const engines: any = await enginesRes.json();
    assert.equal(enginesRes.status, 200);
    assert.equal(engines.keyless, true);
    assert.ok(engines.engines.some((e: any) => e.baseUrl === fakeBase));
    assert.deepEqual(engines.engines[0].models, ['local-qwen']);

    const genRes = await fetch(`${base}/scenario`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: fakeBase, system: 'أنت مخرج سيناريوهات', user: 'حصار بحري' })
    });
    const gen: any = await genRes.json();
    assert.equal(genRes.status, 200, JSON.stringify(gen));
    assert.equal(gen.model, 'local-qwen');
    assert.equal(gen.keyless, true);
    assert.ok(gen.yaml.startsWith('meta:'));
    assert.equal(captured.messages[0].content, 'أنت مخرج سيناريوهات');
    assert.equal(captured.stream, false);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => fakeServer.close(() => r()));
  }
});

test('بوابة AI: المحرّك المشترك يُستخدم من الهاتف دون كشف المفتاح', async () => {
  const fake = express();
  fake.use(express.json());
  const seenAuth: string[] = [];
  fake.get('/v1/models', (req, res) => {
    seenAuth.push(String(req.headers.authorization ?? ''));
    res.json({ data: [{ id: 'shared-model' }] });
  });
  fake.post('/v1/chat/completions', (req, res) => {
    seenAuth.push(String(req.headers.authorization ?? ''));
    res.json({ choices: [{ message: { content: '```yaml\nmeta:\n  map: world_live\ntimeline: []\n```' } }] });
  });
  const fakeServer = await new Promise<http.Server>((resolve) => {
    const s = fake.listen(0, '127.0.0.1', () => resolve(s));
  });
  const fakeBase = `http://127.0.0.1:${(fakeServer.address() as any).port}/v1`;

  const app = express();
  app.use(
    '/api/ai',
    createAiRouter({
      presets: [],
      sharedBaseUrl: fakeBase,
      sharedModel: 'shared-model',
      sharedApiKey: 'server-side-secret'
    })
  );
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/ai`;

  try {
    const engines: any = await (await fetch(`${base}/engines`)).json();
    assert.equal(engines.shared.configured, true);
    assert.equal(engines.shared.usableFromPhone, true);
    const shared = engines.engines.find((e: any) => e.id === 'shared');
    assert.ok(shared, 'المحرّك المشترك يجب أن يظهر كمتاح');
    assert.deepEqual(shared.models, ['shared-model']);
    // لا يجب أن يُسرَّب المفتاح إلى استجابة المتصفح
    assert.ok(!JSON.stringify(engines).includes('server-side-secret'));

    const genRes = await fetch(`${base}/scenario`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'server', system: 's', user: 'u' })
    });
    const gen: any = await genRes.json();
    assert.equal(genRes.status, 200, JSON.stringify(gen));
    assert.equal(gen.model, 'shared-model');
    assert.ok(gen.yaml.includes('world_live'));
    // المفتاح يُضاف على الخادم فقط
    assert.ok(seenAuth.every((h) => h === 'Bearer server-side-secret'));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => fakeServer.close(() => r()));
  }
});

test('بوابة AI: baseUrl=server بدون إعداد يعطي خطأ واضحًا', async () => {
  const app = express();
  app.use('/api/ai', createAiRouter({ presets: [] }));
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/ai`;
  try {
    const res = await fetch(`${base}/scenario`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'server', system: 's', user: 'u' })
    });
    const body: any = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.code, 'SHARED_NOT_CONFIGURED');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => server.close(() => r()));
  }
});
