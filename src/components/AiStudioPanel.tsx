import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Wand2,
  Zap
} from 'lucide-react';
import {
  AiEngine,
  AiGatewayError,
  fetchAiEngines,
  generateScenarioViaAi
} from '../ai/aiClient';
import { buildRepairUserMessage, checkGeneratedScenario, prepareAiPrompt } from '../ai/scenarioAssist';
import { ActorPack, MapPack } from '../core/types';

interface AiStudioPanelProps {
  maps: Record<string, MapPack>;
  actors: Record<string, ActorPack>;
  activeMapId: string;
  aiTopic: string;
  onChangeAiTopic: (val: string) => void;
  /** يُستدعى عند قبول النموذج للـ YAML بعد التحقق المحلي */
  onApplyGeneratedYaml: (yamlText: string) => void;
  onCopyAiPrompt: () => void;
  onCopyCatalog: () => void;
  onOpenSpec: () => void;
  setStatusNotice: (msg: string | null) => void;
}

const ENGINE_HINT =
  'شغّل محرّكًا محليًا مفتوح المصدر ثم أعد الفحص:  ollama serve && ollama pull qwen2.5:7b-instruct';

export function AiStudioPanel({
  maps,
  actors,
  activeMapId,
  aiTopic,
  onChangeAiTopic,
  onApplyGeneratedYaml,
  onCopyAiPrompt,
  onCopyCatalog,
  onOpenSpec,
  setStatusNotice
}: AiStudioPanelProps) {
  const [gatewayState, setGatewayState] = useState<'idle' | 'loading' | 'offline' | 'online'>('idle');
  const [engines, setEngines] = useState<AiEngine[]>([]);
  const [checked, setChecked] = useState<AiEngine[]>([]);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scan = useCallback(async () => {
    setGatewayState('loading');
    setErrorMsg(null);
    try {
      const data = await fetchAiEngines();
      setEngines(data.engines);
      setChecked(data.checked);
      const first = data.engines[0];
      setBaseUrl((prev) => prev || first?.baseUrl || data.defaults.baseUrl || '');
      setModel((prev) => prev || first?.suggestedModel || data.defaults.model || '');
      setGatewayState('online');
    } catch (err) {
      setGatewayState('offline');
      setErrorMsg((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const activeEngine = useMemo(
    () => engines.find((e) => e.baseUrl === baseUrl) ?? null,
    [engines, baseUrl]
  );
  const modelOptions = activeEngine?.models ?? [];

  const generate = async () => {
    if (busy) return;
    setErrorMsg(null);
    setIssues([]);
    setSyntaxError(null);
    setGenerated('');
    setBusy(true);
    setStatusNotice(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const prompt = prepareAiPrompt(maps, actors, aiTopic, activeMapId);

    try {
      let result = await generateScenarioViaAi(
        { baseUrl, model, system: prompt.system, user: prompt.user },
        controller.signal
      );

      let check = checkGeneratedScenario(result.yaml, maps, actors);

      // محاولة إصلاح واحدة فقط عند رفض المحقق المحلي (يوفّر زمن النماذج الصغيرة)
      if (!check.ok) {
        const repairUser = buildRepairUserMessage(prompt.user, check.issues, check.syntaxError);
        result = await generateScenarioViaAi(
          { baseUrl, model: result.model || model, system: prompt.system, user: repairUser },
          controller.signal
        );
        check = checkGeneratedScenario(result.yaml, maps, actors);
      }

      setGenerated(result.yaml);
      setModel(result.model);
      setMeta(`${result.model} · ${(result.elapsedMs / 1000).toFixed(1)}s · ${result.keyless ? 'بدون مفتاح' : 'مفتاح محلي'}`);

      if (check.ok) {
        setIssues([]);
        setSyntaxError(null);
        onApplyGeneratedYaml(result.yaml);
        setStatusNotice('تم توليد السيناريو بالذكاء الاصطناعي المحلي وتطبيقه بعد التحقق');
      } else {
        setIssues(check.issues);
        setSyntaxError(check.syntaxError);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setErrorMsg('تم إلغاء التوليد');
      } else if (err instanceof AiGatewayError) {
        setErrorMsg(err.message);
        if (err.kind === 'offline') setGatewayState('offline');
      } else {
        setErrorMsg((err as Error).message);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  const statusDot =
    gatewayState === 'online'
      ? 'bg-emerald-500'
      : gatewayState === 'loading'
        ? 'bg-amber-400 animate-pulse'
        : 'bg-red-500';

  return (
    <section
      id="aiStudioPanel"
      aria-label="مساعد الذكاء الاصطناعي مفتوح المصدر"
      className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
          <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" />
          <span>ذكاء اصطناعي محلي (مفتوح المصدر)</span>
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusDot}`} aria-hidden="true" />
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void scan()}
            disabled={gatewayState === 'loading'}
            aria-label="إعادة فحص محرّكات الذكاء الاصطناعي"
            title="إعادة فحص المحرّكات المحلية"
            className="p-1 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800 disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${gatewayState === 'loading' ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onOpenSpec}
            className="px-1.5 py-1 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded"
          >
            دليل DSL
          </button>
        </div>
      </div>

      {gatewayState === 'offline' && (
        <div className="flex items-start gap-1.5 rounded-md border border-amber-600/60 bg-amber-950/40 p-2 text-[11px] leading-4 text-amber-200">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p>{errorMsg ?? 'بوابة AI غير متاحة.'}</p>
            <p className="text-amber-100/80">
              بوابة الذكاء الاصطناعي تعمل داخل الخادم المحلي. شغّل التطبيق بـ <code dir="ltr">npm run dev</code> (وليس
              معاينة ثابتة). وإن استخدمت معاينة ثابتة، انسخ البرومبت يدويًا.
            </p>
            <button
              type="button"
              onClick={onCopyAiPrompt}
              className="px-2 py-0.5 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded"
            >
              نسخ البرومبت + الفهرس
            </button>
          </div>
        </div>
      )}

      {gatewayState === 'online' && engines.length === 0 && (
        <div className="rounded-md border border-slate-700 bg-slate-900/70 p-2 text-[11px] leading-4 text-slate-300 space-y-1">
          <p className="inline-flex items-center gap-1 font-medium text-slate-200">
            <Cpu className="w-3.5 h-3.5 text-sky-400" />
            <span>لم يُعثر على محرّك محلي يعمل بعد</span>
          </p>
          <p dir="ltr" className="font-mono text-[10px] bg-slate-950 border border-slate-800 rounded p-1.5 overflow-x-auto">
            {ENGINE_HINT}
          </p>
          <p className="text-slate-400">
            فُحصت المنافذ: {checked.map((c) => `${c.label} (${c.baseUrl.replace(/^https?:\/\//, '')})`).join(' · ') || '—'}
          </p>
          <p className="text-slate-400">
            تستطيع أيضًا كتابة عنوان أي محرّك متوافق مع OpenAI في الأسفل ثم إعادة الفحص. المفتاح غير مطلوب.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-1.5">
        <label className="block text-[10px] text-slate-400" htmlFor="aiBaseUrl">
          عنوان المحرّك (OpenAI-compatible، بدون مفتاح)
          <div className="mt-1 flex items-center gap-1.5">
            <input
              id="aiBaseUrl"
              dir="ltr"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://127.0.0.1:11434/v1"
              className="flex-1 min-w-0 bg-slate-900 text-slate-100 border border-slate-700 rounded px-2 py-1 text-[11px] font-mono focus:outline-none focus:border-sky-400"
            />
            {engines.length > 0 && (
              <select
                aria-label="محرّك مكتشف"
                value={baseUrl}
                onChange={(e) => {
                  const picked = engines.find((x) => x.baseUrl === e.target.value);
                  setBaseUrl(e.target.value);
                  setModel(picked?.suggestedModel ?? picked?.models[0] ?? '');
                }}
                className="bg-slate-900 text-slate-200 border border-slate-700 rounded px-1.5 py-1 text-[11px] max-w-[110px] shrink-0"
              >
                {engines.map((e) => (
                  <option key={e.baseUrl} value={e.baseUrl}>
                    {e.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </label>

        <label className="block text-[10px] text-slate-400" htmlFor="aiModel">
          النموذج
          <input
            id="aiModel"
            dir="ltr"
            list="aiModelOptions"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="qwen2.5:7b-instruct"
            className="mt-1 w-full bg-slate-900 text-slate-100 border border-slate-700 rounded px-2 py-1 text-[11px] font-mono focus:outline-none focus:border-sky-400"
          />
          <datalist id="aiModelOptions">
            {modelOptions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>

        <label className="block text-[10px] text-slate-400" htmlFor="aiTopicInput">
          وصف السيناريو المطلوب
          <textarea
            id="aiTopicInput"
            value={aiTopic}
            onChange={(e) => onChangeAiTopic(e.target.value)}
            rows={2}
            placeholder="مثال: حصار بحري على مضيق، إنذار، ثم تحرّك سفن وغطاء جوي مع تعليق عربي"
            className="mt-1 w-full bg-slate-900 text-slate-100 border border-slate-700 rounded px-2 py-1 text-[11px] leading-4 resize-y focus:outline-none focus:border-sky-400"
          />
        </label>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          id="aiGenerateBtn"
          onClick={() => void generate()}
          disabled={busy || !baseUrl.trim()}
          className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 text-white border border-fuchsia-400 rounded-md whitespace-nowrap transition-colors"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
          <span>{busy ? 'جارٍ التوليد...' : 'ولّد سيناريو وطبّقه'}</span>
        </button>
        {busy ? (
          <button
            type="button"
            onClick={cancel}
            className="px-2 py-1.5 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-md"
          >
            إلغاء
          </button>
        ) : (
          <button
            type="button"
            onClick={onCopyAiPrompt}
            title="نسخ البرومبت + الفهرس لاستخدامه في أي نموذج خارجي مجاني"
            className="px-2 py-1.5 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-md whitespace-nowrap"
          >
            نسخ البرومبت
          </button>
        )}
      </div>

      {meta && <p className="text-[10px] text-slate-500 font-mono truncate" dir="ltr">{meta}</p>}

      {errorMsg && gatewayState !== 'offline' && (
        <div role="alert" className="rounded-md border border-red-600/70 bg-red-950/50 p-2 text-[11px] leading-4 text-red-200">
          {errorMsg}
        </div>
      )}

      {(syntaxError || issues.length > 0) && (
        <div role="alert" className="rounded-md border border-amber-600/70 bg-amber-950/40 p-2 text-[11px] leading-4 text-amber-100 space-y-1">
          <p className="font-semibold">المخرج لم يجتز محقق الاستوديو (لم يُطبّق):</p>
          {syntaxError && (
            <pre dir="ltr" className="font-mono text-[10px] whitespace-pre-wrap">{syntaxError}</pre>
          )}
          {issues.slice(0, 8).map((issue, i) => (
            <div key={i}>• {issue}</div>
          ))}
          {issues.length > 8 && <div className="text-amber-200/80">… و{issues.length - 8} ملاحظة أخرى</div>}
          <div className="flex gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() => void generate()}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded disabled:opacity-40"
            >
              <Zap className="w-3 h-3" /> إعادة المحاولة
            </button>
            <button
              type="button"
              onClick={() => onApplyGeneratedYaml(generated)}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded"
            >
              <ArrowUpRight className="w-3 h-3" /> ضعه في المحرر فقط
            </button>
          </div>
        </div>
      )}

      {generated && issues.length === 0 && !syntaxError && (
        <div className="rounded-md border border-emerald-700/60 bg-emerald-950/30 p-2 text-[11px] text-emerald-200 space-y-1">
          <p className="inline-flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>اجتاز التحقق المحلي وتم تطبيقه</span>
          </p>
          <details>
            <summary className="cursor-pointer text-emerald-300/90 text-[10px] inline-flex items-center gap-1">
              <Play className="w-3 h-3" /> عرض YAML المولّد
            </summary>
            <pre dir="ltr" className="mt-1 max-h-40 overflow-auto bg-slate-950 border border-slate-800 rounded p-1.5 font-mono text-[10px] text-cyan-200 whitespace-pre">
              {generated}
            </pre>
          </details>
        </div>
      )}

      <p className="text-[10px] text-slate-500 leading-4">
        كل شيء محلي: البوابة <code dir="ltr">/api/ai</code> تتصل بمحرّكك المفتوح (Ollama / llama.cpp / vLLM) دون أي
        مفتاح، ويُطبَّق المخرج فقط بعد اجتيازه محقق المحرّك الحتمي.{' '}
        <button type="button" onClick={onCopyCatalog} className="text-sky-400 hover:underline">
          نسخ الفهرس
        </button>
      </p>
    </section>
  );
}
