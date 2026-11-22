/**
 * فحص سريع لمحرّكات الذكاء الاصطناعي المفتوحة المتاحة على الجهاز.
 * التشغيل:  npm run ai:check
 */
import { KNOWN_ENGINES, normalizeBaseUrl } from './aiGateway';
import process from 'node:process';

const envBase = normalizeBaseUrl(process.env.AI_BASE_URL ?? '');

async function listModels(baseUrl: string): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, { signal: controller.signal });
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

async function main() {
  const targets: { label: string; baseUrl: string }[] = [];
  if (envBase) targets.push({ label: 'AI_BASE_URL', baseUrl: envBase });
  for (const p of KNOWN_ENGINES) targets.push({ label: p.label, baseUrl: p.baseUrl });

  let found = 0;
  for (const t of targets) {
    const models = await listModels(t.baseUrl);
    if (models.length > 0) {
      found++;
      console.log(`✅ ${t.label.padEnd(16)} ${t.baseUrl}`);
      console.log(`   النماذج: ${models.slice(0, 8).join(', ')}${models.length > 8 ? ' …' : ''}`);
    } else {
      console.log(`—  ${t.label.padEnd(16)} ${t.baseUrl}  (غير متاح)`);
    }
  }

  if (found === 0) {
    console.log('\nلم يُعثر على محرّك يعمل. أسهل بداية بدون أي مفتاح:');
    console.log('  curl -fsSL https://ollama.com/install.sh | sh');
    console.log('  ollama serve &');
    console.log('  ollama pull qwen2.5:7b-instruct');
    console.log('ثم: npm run dev');
  } else {
    console.log('\nجاهز: شغّل npm run dev وافتح لوحة «ذكاء اصطناعي محلي» في الاستوديو.');
  }
}

void main();
