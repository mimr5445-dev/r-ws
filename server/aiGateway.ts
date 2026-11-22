/**
 * بوابة الذكاء الاصطناعي مفتوح المصدر (Open-Source AI Gateway)
 * --------------------------------------------------------------
 * خادم وسيط صغير يعمل بجانب الواجهة، لا يحتوي على أي مفتاح سري.
 * يتحدث مع أي محرّك نماذج مفتوح المصدر يوفّر واجهة متوافقة مع OpenAI:
 *   - Ollama                (http://127.0.0.1:11434/v1)
 *   - llama.cpp server      (http://127.0.0.1:8080/v1)
 *   - vLLM / LM Studio / TGI / SGLang / text-generation-webui ...
 *
 * المزايا:
 *   - لا مفاتيح API إطلاقًا (المفتاح اختياري فقط لمحرّكات محمية).
 *   - يفحص تلقائيًا المحرّكات المتاحة على المنافذ الشائعة عند الإقلاع.
 *   - يضغط برومبت السيناريو (الفهرس + القواعد) ويجبر النموذج على YAML فقط.
 *   - يستخرج كتلة YAML من ردود النماذج الصغيرة (التي قد تضيف شرحًا أو ```).
 */
import express, { type Request, type Response } from 'express';

export interface EnginePreset {
  id: string;
  label: string;
  baseUrl: string;
  model?: string;
}

export interface GatewayOptions {
  /** محرّكات معروفة يمكن فحصها عند الإقلاع */
  presets?: EnginePreset[];
  /** عنوان المحرّك الافتراضي (يأتي من متغير البيئة AI_BASE_URL) */
  defaultBaseUrl?: string;
  /** اسم النموذج الافتراضي (AI_MODEL) */
  defaultModel?: string;
  /** مهلة الاتصال بمحرّك النموذج بالمللي ثانية */
  timeoutMs?: number;
  /**
   * محرّك مشترك يعيش على الخادم (مثل خدمة Ollama مستضافة) ويُستخدم من الهاتف.
   * المتصفح لا يحتاج عنوانه ولا مفتاحه: يكفي أن يرسل baseUrl = "server".
   */
  sharedBaseUrl?: string;
  sharedModel?: string;
  /** اختياري: مفتاح المحرّك المشترك يبقى على الخادم فقط ولا يُرسل للمتصفح */
  sharedApiKey?: string;
}

const CHAT_COMPLETIONS_PATH = '/chat/completions';

export const KNOWN_ENGINES: EnginePreset[] = [
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b-instruct' },
  { id: 'llamacpp', label: 'llama.cpp server', baseUrl: 'http://127.0.0.1:8080/v1', model: 'local' },
  { id: 'vllm', label: 'vLLM', baseUrl: 'http://127.0.0.1:8000/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
  { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-model' }
];

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** يجعل عنوان المحرّك ينتهي بـ /v1 حتى تعمل كل المكتبات بنفس الطريقة */
export function normalizeBaseUrl(raw: string): string {
  let url = trimSlash((raw || '').trim());
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (!/\/v\d+$/i.test(url)) url = `${url}/v1`;
  return url;
}

/**
 * استخراج YAML من ردّ نصي قد يكون محاطًا بشرح أو بكتلة كود.
 * النماذج الصغيرة غالبًا تكتب: "إليك السيناريو:\n```yaml ... ```".
 */
export function extractYaml(raw: string): string {
  if (!raw) return '';
  const text = raw.replace(/\r\n/g, '\n').trim();

  const fenced = text.match(/```(?:ya?ml)?\s*\n([\s\S]*?)```/i);
  let body = fenced ? fenced[1] : text;
  if (!fenced) {
    // لا كتلة كود: اقتطع من أول مفتاح meta: إلى آخر سطر ذي معنى
    const start = body.search(/^\s*meta\s*:/m);
    if (start > 0) body = body.slice(start);
  }

  const lines = body.split('\n');
  // احذف أي شرح لاحق بعد نهاية الـ YAML (سطور تبدأ بكلام عربي أو بشرح)
  const kept: string[] = [];
  for (const line of lines) {
    if (/^(?:ملاحظة|شرح|هذا|تم|Note:|Explanation:)/i.test(line.trim()) && kept.length > 0) break;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** يزيل الحقول التي ترفضها بعض المحرّكات (مثل response_format) عند فشلها */
function buildPayload(model: string, messages: unknown[], options: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature: typeof options.temperature === 'number' ? options.temperature : 0.25,
    top_p: 0.9,
    max_tokens: typeof options.maxTokens === 'number' ? options.maxTokens : 2400,
    stream: false
  };
  if (options.jsonMode) payload.response_format = { type: 'json_object' };
  return payload;
}

async function chatOnce(
  baseUrl: string,
  apiKey: string,
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${normalizeBaseUrl(baseUrl)}${CHAT_COMPLETIONS_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`المحرّك ردّ بالرمز ${res.status}: ${text.slice(0, 400)}`);
    }
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('ردّ المحرّك ليس JSON صالحًا — تأكد أن العنوان هو /v1 لمحرّك متوافق مع OpenAI');
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('ردّ المحرّك فارغ (choices[0].message.content غير موجود)');
    }
    return content;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`انتهت المهلة (${Math.round(timeoutMs / 1000)} ثانية) قبل ردّ المحرّك`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function listModels(baseUrl: string, apiKey: string, timeoutMs: number): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, { headers, signal: controller.signal });
    if (!res.ok) return [];
    const data: any = await res.json();
    const list: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return list.map((m) => String(m?.id ?? m?.name ?? '')).filter(Boolean);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function createAiRouter(options: GatewayOptions = {}) {
  const presets = options.presets ?? KNOWN_ENGINES;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const envBaseUrl = normalizeBaseUrl(options.defaultBaseUrl ?? process.env.AI_BASE_URL ?? '');
  const envModel = options.defaultModel ?? process.env.AI_MODEL ?? '';
  const envKey = process.env.AI_API_KEY ?? '';
  const sharedBaseUrl = normalizeBaseUrl(options.sharedBaseUrl ?? process.env.AI_SHARED_BASE_URL ?? '');
  const sharedModel = options.sharedModel ?? process.env.AI_SHARED_MODEL ?? '';
  const sharedKey = options.sharedApiKey ?? process.env.AI_SHARED_API_KEY ?? '';

  /**
   * يحوّل "server" إلى عنوان المحرّك المشترك المهيّأ في بيئة الخادم.
   * هذا ما يسمح باستخدام الذكاء الاصطناعي من الهاتف: كل شيء يحدث على الخادم.
   */
  const resolveBaseUrl = (raw: unknown): string => {
    const value = String(raw ?? '').trim();
    if (value === 'server' || value === 'shared') return sharedBaseUrl;
    return normalizeBaseUrl(value || envBaseUrl);
  };

  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  /** حالة المحرّكات: نفحص المحرّك المهيّأ بالبيئة + المنافذ الشائعة */
  router.get('/engines', async (_req: Request, res: Response) => {
    const candidates: EnginePreset[] = [];
    if (sharedBaseUrl) {
      candidates.push({ id: 'shared', label: 'محرّك الخادم المشترك (للهاتف)', baseUrl: sharedBaseUrl, model: sharedModel });
    }
    if (envBaseUrl && envBaseUrl !== sharedBaseUrl) {
      candidates.push({ id: 'env', label: 'المحرّك المهيّأ في البيئة', baseUrl: envBaseUrl, model: envModel });
    }
    for (const p of presets) {
      if (envBaseUrl && normalizeBaseUrl(p.baseUrl) === envBaseUrl) continue;
      if (sharedBaseUrl && normalizeBaseUrl(p.baseUrl) === sharedBaseUrl) continue;
      candidates.push(p);
    }

    const results = await Promise.all(
      candidates.map(async (p) => {
        const key = p.id === 'env' ? envKey : p.id === 'shared' ? sharedKey : '';
        const models = await listModels(p.baseUrl, key, p.id === 'shared' ? 6000 : 2500);
        return {
          id: p.id,
          label: p.label,
          baseUrl: normalizeBaseUrl(p.baseUrl),
          online: models.length > 0,
          models,
          suggestedModel: p.model ?? models[0] ?? ''
        };
      })
    );

    res.json({
      keyless: true,
      engines: results.filter((r) => r.online),
      checked: results,
      defaults: { baseUrl: sharedBaseUrl || envBaseUrl, model: sharedModel || envModel },
      shared: {
        configured: Boolean(sharedBaseUrl),
        usableFromPhone: Boolean(sharedBaseUrl),
        baseUrl: sharedBaseUrl || null,
        model: sharedModel || null
      }
    });
  });

  /** جرد النماذج لمحرّك معيّن */
  router.post('/models', async (req: Request, res: Response) => {
    const rawBase = String(req.body?.baseUrl ?? '');
    const baseUrl = resolveBaseUrl(rawBase);
    if (!baseUrl) return res.status(400).json({ error: 'baseUrl مطلوب' });
    const key = rawBase === 'server' || rawBase === 'shared' ? sharedKey : String(req.body?.apiKey ?? envKey);
    const models = await listModels(baseUrl, key, 8000);
    res.json({ baseUrl, models });
  });

  /** توليد كود سيناريو YAML من وصف عربي/إنجليزي */
  router.post('/scenario', async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const rawBase = String(body.baseUrl ?? '');
    const isShared = rawBase === 'server' || rawBase === 'shared';
    const baseUrl = resolveBaseUrl(rawBase);
    if (!baseUrl) {
      return res.status(400).json({
        error: isShared
          ? 'لم يُضبط محرّك الخادم المشترك. اضبط AI_SHARED_BASE_URL في بيئة الخادم (أو AI_BASE_URL).'
          : 'لم يتم تحديد عنوان المحرّك. شغّل Ollama مثلًا (ollama serve) أو اضبط AI_BASE_URL.',
        code: isShared ? 'SHARED_NOT_CONFIGURED' : 'NO_ENGINE'
      });
    }
    const system: string = body.system;
    const user: string = body.user;
    if (!system || !user) {
      return res.status(400).json({ error: 'system و user مطلوبان لتوليد السيناريو' });
    }
    const apiKey = isShared ? sharedKey : String(body.apiKey ?? envKey ?? '');

    let model = String(body.model ?? (isShared ? sharedModel : envModel) ?? '').trim();
    if (!model) {
      const models = await listModels(baseUrl, apiKey, 8000);
      model = models[0] ?? '';
    }
    if (!model) {
      return res.status(400).json({ error: 'لا يوجد نموذج متاح على هذا المحرّك. حمّل نموذجًا أولًا (مثال: ollama pull qwen2.5:7b-instruct).' });
    }

    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ];
    const opts = { temperature: body.temperature, maxTokens: body.maxTokens, jsonMode: false };

    const started = Date.now();
    let attemptModel = model;
    let content: string;
    try {
      try {
        content = await chatOnce(baseUrl, apiKey, buildPayload(attemptModel, messages, opts), timeoutMs);
      } catch (firstErr) {
        // بعض المحرّكات ترفض max_tokens/flags — نعيد بمحاولة مبسطة قبل الاستسلام
        const simplified = { model: attemptModel, messages, temperature: 0.25, stream: false };
        try {
          content = await chatOnce(baseUrl, apiKey, simplified, timeoutMs);
        } catch {
          throw firstErr;
        }
      }
    } catch (err) {
      return res.status(502).json({ error: (err as Error).message, model: attemptModel });
    }

    const yaml = extractYaml(content);
    if (!yaml) {
      return res.status(502).json({ error: 'لم يُنتج النموذج أي YAML قابل للاستخدام', raw: content.slice(0, 2000) });
    }

    res.json({
      model: attemptModel,
      baseUrl,
      yaml,
      raw: content.slice(0, 8000),
      elapsedMs: Date.now() - started,
      keyless: !apiKey
    });
  });

  /** فحص صحة + ملخص الاستخدام */
  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      keyless: true,
      defaultBaseUrl: envBaseUrl || null,
      defaultModel: envModel || null,
      sharedConfigured: Boolean(sharedBaseUrl),
      timeoutMs
    });
  });

  return router;
}
