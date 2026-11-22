// عميل بوابة الذكاء الاصطناعي مفتوح المصدر.
// لا مفاتيح API: كل الطلبات تذهب إلى /api/ai داخل نفس الخادم،
// والذي يتصل بدوره بمحرّك محلي (Ollama / llama.cpp / vLLM ...).

export interface AiEngine {
  id: string;
  label: string;
  baseUrl: string;
  online: boolean;
  models: string[];
  suggestedModel: string;
}

export interface AiEnginesResponse {
  keyless: boolean;
  engines: AiEngine[];
  checked: AiEngine[];
  defaults: { baseUrl: string; model: string };
  shared: {
    configured: boolean;
    usableFromPhone: boolean;
    baseUrl: string | null;
    model: string | null;
  };
}

/** قيمة خاصة تعني: استخدم محرّك الخادم المشترك (لا يحتاج الهاتف أي عنوان أو مفتاح) */
export const SHARED_ENGINE = 'server';

export interface AiScenarioRequest {
  baseUrl: string;
  model?: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiScenarioResponse {
  model: string;
  baseUrl: string;
  yaml: string;
  raw?: string;
  elapsedMs: number;
  keyless: boolean;
}

export class AiGatewayError extends Error {
  constructor(
    message: string,
    public readonly kind: 'offline' | 'engine' | 'bad-response' = 'engine'
  ) {
    super(message);
    this.name = 'AiGatewayError';
  }
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new AiGatewayError(`ردّ غير متوقّع من بوابة AI (HTTP ${res.status})`);
  }
}

/** هل بوابة AI مدمجة في هذا التشغيل؟ (وعملت معها خوادم dev/prod) */
export async function fetchAiEngines(signal?: AbortSignal): Promise<AiEnginesResponse> {
  let res: Response;
  try {
    res = await fetch('/api/ai/engines', { signal });
  } catch {
    throw new AiGatewayError('بوابة AI غير متاحة في هذا التشغيل — شغّل التطبيق عبر npm run dev', 'offline');
  }
  if (!res.ok) {
    throw new AiGatewayError('بوابة AI غير متاحة في هذا التشغيل — شغّل التطبيق عبر npm run dev', 'offline');
  }
  const data = await readJson(res);
  return {
    keyless: data.keyless !== false,
    engines: Array.isArray(data.engines) ? data.engines : [],
    checked: Array.isArray(data.checked) ? data.checked : [],
    defaults: data.defaults ?? { baseUrl: '', model: '' },
    shared: data.shared ?? { configured: false, usableFromPhone: false, baseUrl: null, model: null }
  };
}

export async function generateScenarioViaAi(
  req: AiScenarioRequest,
  signal?: AbortSignal
): Promise<AiScenarioResponse> {
  let res: Response;
  try {
    res = await fetch('/api/ai/scenario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new AiGatewayError('تعذّر الوصول إلى بوابة AI — تأكد أن التطبيق يعمل عبر npm run dev', 'offline');
  }
  const data = await readJson(res);
  if (!res.ok) throw new AiGatewayError(data?.error ?? `فشل التوليد (HTTP ${res.status})`);
  if (typeof data?.yaml !== 'string' || !data.yaml.trim()) {
    throw new AiGatewayError('لم يُنتج النموذج YAML صالحًا', 'bad-response');
  }
  return data as AiScenarioResponse;
}
