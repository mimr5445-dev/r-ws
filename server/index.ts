/**
 * خادم الاستوديو + بوابة الذكاء الاصطناعي مفتوح المصدر
 * ----------------------------------------------------
 * أمر التشغيل:  npm run dev     (واجهة Vite + /api/ai على نفس المنفذ)
 *              npm run start   (نسخة إنتاج من مجلد dist)
 *
 * لا يحتاج أي مفتاح API. كل ما يلزم هو تشغيل محرّك مفتوح المصدر محليًا، مثل:
 *   ollama serve && ollama pull qwen2.5:7b-instruct
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import express from 'express';
import { createAiRouter } from './aiGateway';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';
const ROOT = process.cwd();

async function main() {
  const app = express();
  app.disable('x-powered-by');

  // بوابة الذكاء الاصطناعي المفتوح (بدون مفاتيح)
  app.use('/api/ai', createAiRouter());
  app.get('/api/health', (_req, res) => res.json({ ok: true, mode: isProd ? 'production' : 'development' }));

  const server = http.createServer(app);

  if (!isProd) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: ROOT,
      appType: 'spa',
      server: { middlewareMode: { server }, hmr: { server }, allowedHosts: true }
    });
    app.use(vite.middlewares);
    console.log(`[studio] dev server: http://${HOST}:${PORT}`);
    console.log('[studio] AI gateway: /api/ai  (بدون مفاتيح — Ollama/llama.cpp/vLLM)');
  } else {
    const distDir = path.join(ROOT, 'dist');
    if (!fs.existsSync(distDir)) {
      console.error('[studio] مجلد dist غير موجود. نفّذ: npm run build');
      process.exit(1);
    }
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
    console.log(`[studio] production server: http://${HOST}:${PORT}`);
  }

  const baseUrl = normalizeEnvBase();
  if (baseUrl) console.log(`[studio] AI engine: ${baseUrl} (model: ${process.env.AI_MODEL ?? 'auto'})`);
  else console.log('[studio] لم يُضبط AI_BASE_URL — سيتم فحص المحرّكات المحلية تلقائيًا من /api/ai/engines');

  server.listen(PORT, HOST);
}

function normalizeEnvBase(): string {
  const raw = (process.env.AI_BASE_URL ?? '').trim();
  if (!raw) return '';
  const withProto = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return /\/v\d+$/i.test(withProto) ? withProto.replace(/\/+$/, '') : `${withProto.replace(/\/+$/, '')}/v1`;
}

main().catch((err) => {
  console.error('[studio] فشل الإقلاع:', err);
  process.exit(1);
});
