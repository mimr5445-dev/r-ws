# RW-Style Visual Scenario Studio

**استوديو سيناريوهات بصرية تفاعلي** يعمل بالكامل في المتصفح: محرك حتمي بسرعة **30 TPS**،
ملاحة **A\*** حقيقية على شبكة يابسة/بحر، خرائط عالمية من GeoJSON، تحرير سيناريوهات YAML حي،
تسجيل الحركات بالفأرة، وتصدير **فيديو WebM** بصوت مُولَّد.

> **لا خادم، لا حساب، لا تتبّع.** كل الخرائط والسيناريوهات والكيانات تُحفظ محليًا في
> **IndexedDB** داخل متصفحك.
>
> الإصدار الحالي: **0.3.0** — راجع [`CHANGELOG.md`](CHANGELOG.md).

---

## المحتويات

- [المزايا](#المزايا)
- [البدء السريع](#البدء-السريع)
- [الأوامر](#الأوامر)
- [المعمارية](#المعمارية)
- [بنية المشروع](#بنية-المشروع)
- [لغة السيناريو](#لغة-السيناريو)
- [اختصارات لوحة المفاتيح](#اختصارات-لوحة-المفاتيح)
- [التخزين والخصوصية](#التخزين-والخصوصية)
- [الأمان](#الأمان)
- [الاختبارات والجودة](#الاختبارات-والجودة)
- [النشر](#النشر)
- [خريطة الطريق](#خريطة-الطريق)
- [سجل التغييرات](CHANGELOG.md)

---

## المزايا

### محاكاة حتمية
- محرك مستقل عن العرض يعمل بـ 30 خطوة/ثانية مع **استيفاء بصري** لحركة سلسة.
- سحب شريط الزمن (`seekToTick`) يعيد بناء الحالة من الصفر — نفس النتيجة دائمًا،
  وليس مجرد «تراجع».
- أوامر مؤجّلة في طابور، وتنفيذ مرة واحدة لكل خطوة زمنية.

### ملاحة وخرائط
- A\* مخصّص (MinHeap) على 8 اتجاهات، بمنع قص الزوايا وغرامة ساحلية للسفن.
- تمهيد مسار بخط الرؤية (line-of-sight smoothing) بهامش أمان جانبي.
- خلايا **قناة/جسر** مزدوجة (السويس وبنما) يعبرها البر والبحر.
- خريطة عالم حقيقية من `world-atlas` + إسقاط Natural Earth، ونقر مزدوج للدخول إلى
  محافظات أي دولة (geoBoundaries ADM1) مع تخزين مؤقت دائم.
- تلوين الدول/المحافظات وتحريك الوحدات فوقها مباشرة.

### وحدات وتأثيرات
- 14 كيانًا مدمجًا (مشاة، دبابات، سفن، حاملة طائرات، مقاتلات، مروحيات، منشآت)
  مع 7 قوالب وراثة، وكلها SVG مضمّن.
- ارتفاعات الطائرات، الميلان، الظل، الروتور، زبد البحر، الغبار، الدخان.
- صواريخ بالستية وقنابل موجهة بمسارات قوسية، انفجارات متعددة الطبقات، اهتزاز كاميرا،
  وفوهات تختفي تدريجيًا.
- 8 مؤثرات صوتية مُولَّدة بـ **Web Audio** مع سلسلة gain + limiter لمنع التشويش.

### تأليف وإخراج
- محرر YAML مباشر مع تحقق فوري واقتراح تصحيح أسماء المراسي.
- **مسجل حركات حي**: كل نقرة أو تحريك أو بناء أو تلوين يُحوَّل إلى YAML بتوقيته.
- صانع حزم: رفع خريطة، رسم مراسٍ ومناطق، فرشاة شبكة ملاحة، إضافة كيان بصورته.
- تصدير/استيراد `*.pack.yaml`، وتصدير `CATALOG.md` وبرومبت جاهز لأي نموذج AI خارجي.
- تسجيل WebM (فيديو + صوت) مع إخفاء أدوات التحرير تلقائيًا.
- واجهة عربية RTL كاملة، متجاوبة، وبدعم لوحة مفاتيح.

---

## البدء السريع

```bash
# 1) تثبيت الاعتماديات
npm install        # أو: bun install

# 2) تشغيل بيئة التطوير
npm run dev        # http://localhost:3000

# 3) التحقق الكامل (أنواع + اختبارات + بناء)
npm run verify
```

المتطلبات: **Node.js ≥ 20** (أو Bun)، ومتصفح حديث يدعم WebGL وIndexedDB.
لا تحتاج أي مفاتيح API أو ملف `.env`.

### أوامر أخرى

| الأمر | الوصف |
|---|---|
| `npm run build` | بناء إنتاجي إلى `dist/` |
| `npm run preview` | معاينة البناء على المنفذ 3000 |
| `npm run typecheck` / `npm run lint` | فحص TypeScript بلا إخراج |
| `npm test` | 31 اختبارًا (23 للنواة + 8 لمخطط الحزم) |
| `npm run catalog` | توليد `docs/CATALOG.md` من الخرائط والكيانات المدمجة |
| `npm run clean` | حذف `dist/` |

---

## المعمارية

```
YAML / نقرات المستخدم
        │
        ▼
   validator.ts ──── (أخطاء + اقتراحات)
        │
        ▼
   StudioEngine (30 TPS، حتمي، بلا DOM)
     ├── A* pathfinding
     ├── الطلبات: spawn / move / construct / resize / remove / strike
     └── الحالة: كيانات، مقذوفات، انفجارات، مناطق، أسهم، بطاقات
        │
        ├──▶ StudioRenderer (PixiJS/WebGL) ──▶ canvas ──▶ WebM
        ├──▶ SoundSynth (Web Audio) ──▶ مكبر الصوت + مسار التسجيل
        └──▶ ActionRecorder ──▶ YAML ──▶ IndexedDB
```

**أهم قرار معماري:** المحرك لا يستورد أي شيء من PixiJS أو React. لذلك يعمل في Node
للاختبارات، ويجعل الرجوع الزمني حتميًا، ويفصل قواعد اللعبة عن العرض.

التفاصيل الكاملة (طبقات العرض، الخوارزميات، الحالات، القيود) في
[`docs/PROJECT_OVERVIEW_AR.md`](docs/PROJECT_OVERVIEW_AR.md).

---

## بنية المشروع

```
src/
├── core/                 # النواة الحتمية — بلا DOM
│   ├── types.ts          # كل العقود والأنواع
│   ├── constants.ts      # حدود مشتركة (المقياس، الزوم، الأصوات، الفصائل)
│   ├── engine.ts         # المحرك وطابور الأوامر والـ timeline
│   ├── pathfinding.ts    # A* + تمهيد المسار + خط الرؤية
│   ├── validator.ts      # تحقق YAML + اقتراحات التصحيح
│   ├── actionRecorder.ts # تسجيل الحركات → YAML
│   └── catalog.ts        # فهرس + برومبت AI
├── packs/                # الخرائط والكيانات المدمجة + السجل + مخطط الأمان
├── maps/worldGeoEngine.ts# العالم والمحافظات من TopoJSON/GeoJSON
├── renderer/             # PixiJS + Web Audio
├── storage/studioDb.ts   # IndexedDB
├── components/           # الواجهة (شريط جانبي، صانع حزم، دليل، حاجز أخطاء)
├── scenarios/            # 4 سيناريوهات جاهزة
├── App.tsx               # التنسيق، الدورة، الحالة، المعالجات
└── main.tsx
docs/
├── CATALOG.md            # فهرس مُولَّد
└── PROJECT_OVERVIEW_AR.md# تحليل معماري موسّع
scripts/generate-catalog.ts
```

---

## لغة السيناريو

```yaml
meta:
  title: "أزمة المضيق"
  map: geopolitics_strait
  duration_hint: 14s

timeline:
  - at: "0s"
    camera: { focus: port_south, zoom: 1.25, duration: "1s" }
    caption: { text: "انطلاق الدورية" }
    spawn:
      - { id: patrol_1, actor: naval_corvette, at: port_south, faction: blue }

  - at: "1.2s"
    move: { entity: patrol_1, to: strait_gate }
    callout: { id: c1, target: patrol_1, text: "دورية بحرية", duration: "6s" }

  - after: patrol_1.arrived
    sound: alert_ping
    pulse: { at: strait_gate, color: "#ef4444", radius: 95 }
    zone: { id: corridor_south, color: "#ef4444", opacity: 0.35 }
```

المرجع الكامل: [`STUDIO_SPEC.md`](STUDIO_SPEC.md) — والفهرس: [`docs/CATALOG.md`](docs/CATALOG.md).

---

## اختصارات لوحة المفاتيح

| الاختصار | الإجراء |
|---|---|
| `Space` | تشغيل / إيقاف مؤقت |
| `R` | إعادة السيناريو من البداية |
| `Esc` | إلغاء التحديد وأوضاع الرسم |
| `?` | فتح/إغلاق دليل YAML |
| عجلة الفأرة | تقريب/تصغير |
| سحب الفأرة | تحريك الكاميرا |
| `Shift` + سحب | فرشاة شبكة الملاحة (في تبويب صانع الحزم) |

---

## التخزين والخصوصية

| المخزن | المحتوى |
|---|---|
| `maps` | خرائط مخصصة وخرائط المحافظات |
| `actors` | كيانات مخصصة |
| `scenarios` | السيناريوهات (جاهزة/مسجلة/مكتوبة) |
| `settings` | آخر خريطة، آخر سيناريو، حجم الوحدات، السيناريوهات الجاهزة المحذوفة |

- دوال `hitTest` لا تُخزَّن، ويُعاد بناؤها من مضلعات المناطق عند التحميل.
- لا تُرسل أي بيانات إلى خادم. الشبكة تُستخدم فقط لجلب حدود المحافظات من
  geoBoundaries (مع تخزين مؤقت وبديل محلي).
- مسح بيانات الموقع في المتصفح يحذف الأعمال — صدّر الحزم والسيناريوهات للاحتفاظ بنسخة.

---

## الأمان

- استيراد الحزم يخضع لتحقق بنيوي كامل (`packSchema.ts`) قبل الكتابة في IndexedDB.
- `isSafeAssetUrl` يرفض `http(s)://` و`//host` و`javascript:`، ويسمح فقط بـ SVG مضمّن،
  `data:image/`، `blob:`، والمسارات النسبية — فلا تستطيع حزمة مستوردة جلب موارد خارجية.
- أبعاد الشبكة وقيم الخلايا والمناطق والمراسي تُتحقق منها قبل القبول.
- تُضاف رؤوس أمان (CSP، nosniff، referrer-policy، permissions-policy) عند النشر على Vercel
  عبر `vercel.json`.

---

## الاختبارات والجودة

- **31 اختبارًا** تغطي: A\* البحري/البري، الجسور والجبال، أخطاء المُحقِّق واقتراحاته،
  حتمية `seekToTick`، البطاقات والنبضات والحذف، تصدير الحزم والفهرس، المسارات المستحيلة،
  تصحيح اتجاه GeoJSON، دورة تسجيل YAML، إعادة بناء `hitTest`، الطلعات الجوية والعودة
  والهبوط، عدم صعود السفن لليابسة، واستقلال مقاييس الوحدات، وتشديدات P0 الأمنية
  (تطهير SVG، المعرّفات المكررة، دورة حياة الكيانات، الحدود الرقمية، ورفض مفاتيح التلوث).
- `tsc --noEmit` صارم بلا أخطاء.
- بناء إنتاجي مع تقسيم حزم (`vendor-pixi`, `vendor-geo`, `vendor-react`).
- CI على GitHub Actions: تثبيت + فحص أنواع + اختبارات + بناء لكل Push/PR.

```bash
npm run verify
```

---

## النشر

المشروع موقع ثابت (Vite) ولا يحتاج خادمًا:

```bash
npm run build
# انشر محتوى dist/ على أي استضافة ثابتة
```

**Vercel** جاهز عبر `vercel.json` (إطار Vite، إعادة توجيه SPA، رؤوس أمان وتخزين مؤقت).
اربط المستودع ثم اضغط Deploy — لا حاجة لمتغيرات بيئة.

---

## خريطة الطريق

- [ ] E2E (Playwright) للتدفقات الحرجة: تحميل سيناريو، نشر وحدة، تسجيل، تصدير.
- [ ] شروط وتكرار في DSL (`if`, `loop`, `wait`) لسيناريوهات أطول.
- [ ] إنشاء مناطق من YAML مباشرة (مضلع داخل الخطوة).
- [ ] تصدير/استيراد قاعدة البيانات كاملة كملف واحد.
- [ ] تصدير فيديو بدقة اختيارية وWebCodecs عند توفره.
- [ ] وضع مقارنة/طبقات زمنية للسيناريوهات الطويلة.

---

## الترخيص

لم يُحدَّد ترخيص رسمي لهذا المستودع بعد. أضف `LICENSE` قبل إعادة التوزيع.

---

<details>
<summary><strong>English summary</strong></summary>

A browser-only, deterministic 30 TPS tactical/geopolitical scenario studio.
Author scenarios in YAML (or record mouse actions), replay them deterministically,
scrub the timeline, and export the result as WebM with synthesized audio.

Highlights: custom A\* pathfinding with line-of-sight smoothing, real-world GeoJSON
maps with country drill-down, 14 built-in SVG units, PixiJS procedural effects,
Web Audio synthesis, IndexedDB persistence, YAML validation with typo suggestions,
pack import/export with strict asset-URL allow-listing, 19 core tests, and CI.

```bash
npm install && npm run dev   # http://localhost:3000
npm run verify               # typecheck + tests + production build
```

No API keys, no backend, no tracking. See `STUDIO_SPEC.md` for the DSL and
`docs/PROJECT_OVERVIEW_AR.md` for a deep architectural analysis.

</details>
