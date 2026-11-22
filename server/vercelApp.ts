/**
 * تطبيق Express جاهز للاستخدام كدالة Serverless على Vercel.
 * الملف api/ai/[...path].ts يعيد تصديره، فتصبح البوابة على /api/ai/* على Vercel
 * بنفس مسار التطوير المحلي — بدون تغيير أي شيء في الواجهة.
 *
 * على Vercel أضف متغيرات البيئة:
 *   AI_SHARED_BASE_URL = https://xxxx.hf.space/v1   (أو عنوان Ollama/vLLM خاصتك)
 *   AI_SHARED_MODEL    = Qwen/Qwen2.5-7B-Instruct
 *   AI_SHARED_API_KEY  = (اختياري، يبقى على الخادم فقط)
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { createAiRouter } from './aiGateway';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Vercel يمرر المسار الكامل (/api/ai/engines) بينما البوابة تتوقع (/engines)
app.use((req: Request, _res: Response, next: NextFunction) => {
  const match = req.url.match(/^\/api\/ai(\/.*)?$/);
  if (match) req.url = match[1] || '/';
  next();
});

app.use('/', createAiRouter());

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'مسار غير معروف داخل بوابة AI' });
});

export default app;
