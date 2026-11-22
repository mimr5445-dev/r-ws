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
