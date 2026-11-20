import fs from 'node:fs';
import path from 'node:path';
import { generateCatalogMarkdown } from '../src/core/catalog';
import { DEMO_ACTORS, DEMO_MAPS } from '../src/packs/demoPacks';

const catalog = generateCatalogMarkdown(DEMO_MAPS, DEMO_ACTORS);
const header = `<!-- AUTO-GENERATED FILE — do not edit by hand. Run: npm run catalog -->
# فهرس الاستوديو (CATALOG)

> هذا الملف يوثّق **الخرائط والكيانات المدمجة** في الكود المصدري، لاستخدامه كمرجع
> عند كتابة السيناريوهات أو عند تغذية نموذج ذكاء اصطناعي خارجي.
>
> خريطتا \`world_live\` (العالم) و\`country_<iso3>\` (المحافظات) تُبنيان وقت التشغيل
> من GeoJSON، ولذلك لا تظهر مراسيهما هنا. افتح التطبيق ثم زر **«نسخ CATALOG.md»**
> للحصول على الفهرس الكامل للخريطة المفتوحة حاليًا.
>
> مواصفة اللغة الكاملة: [\`STUDIO_SPEC.md\`](../STUDIO_SPEC.md)

`;

fs.mkdirSync(path.resolve('docs'), { recursive: true });
const target = path.resolve('docs/CATALOG.md');
fs.writeFileSync(target, header + catalog + '\n', 'utf8');
console.log(`Wrote ${target} (${catalog.split('\n').length} lines)`);
