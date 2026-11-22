// أدوات مساعدة لربط مخرجات النموذج المفتوح بمحرّك التحقق الحتمي في الاستوديو.
import * as yaml from 'js-yaml';
import { buildAiScenarioPrompt } from '../core/catalog';
import { ActorPack, MapPack, ScenarioFile } from '../core/types';
import { validateScenario } from '../core/validator';

export interface PreparedAiPrompt {
  system: string;
  user: string;
}

/**
 * يبني رسالتَي النظام والمستخدم من نفس برومبت الفهرس المستخدم في "نسخ البرومبت"،
 * مع تقييد صريح: YAML فقط، والخرائط والكيانات من الفهرس، وخريطة افتراضية محددة.
 */
export function prepareAiPrompt(
  maps: Record<string, MapPack>,
  actors: Record<string, ActorPack>,
  topic: string,
  preferredMapId: string
): PreparedAiPrompt {
  const cleanTopic = topic.trim();
  const base = buildAiScenarioPrompt(maps, actors, cleanTopic || 'سيناريو تكتيكي قصير');
  const map = maps[preferredMapId];
  const mapLine = map
    ? `استخدم الخريطة \`${map.id}\` (${map.title}) في meta.map إلا إذا طلب المستخدم خريطة أخرى بالاسم من الفهرس.`
    : 'اختر خريطة موجودة في الفهرس في meta.map.';

  const system = [
    'أنت مخرج سيناريوهات في استوديو محاكاة حتمي. تُخرج ملف YAML واحدًا فقط، بلا أي شرح قبله أو بعده.',
    'كل الأسماء (الخرائط، المراسي، المناطق، الكيانات) يجب أن تأتي حرفيًا من الفهرس المرفق؛ لا تخترع أسماء.',
    'كل خطوة في timeline تحتوي إما at بمدة مثل "3s" أو after مثل "tank1.arrived"، ولا تجمع بينهما.',
    'المعرّفات التي تُولّدها (spawn.id / construct.id) فريدة، بلا مسافات ولا نقاط، بالإنجليزية والأرقام والشرطة السفلية.'
  ].join('\n');

  const user = [
    `الموضوع المطلوب: "${cleanTopic}"`,
    mapLine,
    'أخرج الكود بين سطرَي ```yaml و ``` فقط ليكون قابلًا للنسخ.',
    '',
    base
  ].join('\n');

  return { system, user };
}

export interface ScenarioCheck {
  ok: boolean;
  scenario?: ScenarioFile;
  issues: string[];
  syntaxError: string | null;
}

function stripFence(text: string): string {
  const m = text.match(/```(?:ya?ml)?\s*\n([\s\S]*?)```/i);
  return (m ? m[1] : text).trim();
}

/**
 * تحقّق محلي كامل (نفس محقق الاستوديو) قبل تطبيق أي مخرج من النموذج.
 * هذا يمنع النموذج من كسر المحرّك أو حقن أسماء غير موجودة.
 */
export function checkGeneratedScenario(
  rawYaml: string,
  maps: Record<string, MapPack>,
  actors: Record<string, ActorPack>
): ScenarioCheck {
  const body = stripFence(rawYaml);
  if (!body) return { ok: false, issues: ['الملف فارغ'], syntaxError: null };

  let parsed: unknown;
  try {
    parsed = yaml.load(body);
  } catch (err) {
    return { ok: false, issues: [], syntaxError: (err as Error).message };
  }

  const scenario = parsed as ScenarioFile;
  const map = maps[scenario?.meta?.map];
  const found = validateScenario(scenario, map, actors);
  return {
    ok: found.length === 0,
    scenario,
    issues: found.map((i) => (i.stepIndex >= 0 ? `خطوة ${i.stepIndex + 1} · [${i.field}] ${i.message}` : `[${i.field}] ${i.message}`)),
    syntaxError: null
  };
}

/** رسالة تصحيح تُرسل للنموذج في محاولة إصلاح ثانية */
export function buildRepairUserMessage(original: string, issues: string[], syntaxError: string | null): string {
  const problems = syntaxError ? [`خطأ صياغة YAML: ${syntaxError}`] : issues.slice(0, 12);
  return [
    original,
    '',
    'المحاولة السابقة رفضها محقق الاستوديو. أعد كتابة الملف كاملًا مع إصلاح هذه الأخطاء فقط، وأخرج YAML فقط:',
    ...problems.map((p) => `- ${p}`)
  ].join('\n');
}
