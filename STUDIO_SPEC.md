# مواصفات لغة سيناريوهات الاستوديو — Studio Scenario DSL (v0.3)

اكتب ملفات `.scenario.yaml` بهذه البنية فقط. استخدم أسماء المراسي (`anchors`) والمناطق
(`zones`) والكيانات (`actors`) الموجودة في الفهرس المرفق. الفهرس المدمج متاح في
[`docs/CATALOG.md`](docs/CATALOG.md)، وللخريطة المفتوحة حاليًا استخدم زر **«نسخ CATALOG.md»**
داخل التطبيق (فهو يضم خريطة العالم والمحافظات المبنية وقت التشغيل).

> تعمل هذه المواصفات مع المُحقِّق الصارم (`src/core/validator.ts`) ومحرك التشغيل
> (`src/core/engine.ts`). أي ملف يخالفها يُرفض قبل التشغيل، ويظهر سبب الرفض بالعربية مع
> رقم الخطوة والحقل.

## الهيكل الأساسي

```yaml
meta:
  title: "اسم السيناريو"
  map: geopolitics_strait      # معرّف خريطة موجود في السجل
  duration_hint: 18s           # اختياري — مدة موجبة أكبر من صفر، تمدّ شريط الزمن
timeline:
  - at: "0s"                   # أو after: "<entity_id>.arrived"
```

- `meta.map` إلزامي ويجب أن تكون الخريطة موجودة في السجل.
- `timeline` قائمة خطوات، وكل خطوة كائن يحمل **إما** `at` **أو** `after` — لا الاثنين معًا.
  - `at`: رقم غير سالب بصيغة `0s` أو `"2.5s"` (ويُقبل الرقم المجرد أيضًا). الصيغ غير الصالحة
    مثل `-1s` أو `5ms` أو `12abc` مرفوضة.
  - `after`: محفّز نصي بصيغة `"<entity_id>.arrived"` أو `"<entity_id>.built"`، ويجب أن يكون
    الكيان قابلًا للوصول من الخطوة الحالية (لا دورات مغلقة ولا فروع غير متقاطعة).
    - `.arrived`: لوصول وحدة متحركة إلى وجهتها بعد `move` (أو طلعة جوية). لا يُقبل للوحدات
      الثابتة أو المنشآت.
    - `.built`: لاكتمال بناء منشأة أُنشئت بأمر `construct` (يُطلق مرة واحدة عند 100%).
- كل خطوة تُنفَّذ مرة واحدة فقط، والترتيب في القائمة لا يعني الترتيب الزمني؛ الترتيب الزمني
  يُستنتج من `at` ومن سلاسل `after`.
- إن كان المحفز `after` غير قابل للوصول فالمُحقِّق يرفضه بدل تعليق المحرك.
- كل موضع (`focus`, `at`, `to`, `from`) يقبل **اسم مرساة** أو **إحداثيات حرة**
  `{ x: 100, y: 200 }`، ويجب أن تقع الإحداثيات داخل حدود الخريطة
  `[0..map.width] × [0..map.height]`.

## الأوامر المتاحة داخل كل خطوة

| الأمر | البنية | ملاحظات |
|---|---|---|
| `camera` | `{ focus, zoom?, duration? }` | `zoom` بين 0.25 و4 (الافتراضي 1.4)، و`duration` غير سالب |
| `caption` | `{ text }` | يبقى حتى يُستبدل بنص آخر |
| `sound` | `"build_complete" \| "alert_ping" \| "move_order" \| "spawn_pop" \| "jet_takeoff" \| "missile_launch" \| "explosion" \| "ship_horn"` | مؤثرات مُولَّدة بـ Web Audio |
| `spawn` | `[{ id, actor, at, faction?, scale? }]` | `faction`: blue/red/neutral، `scale`: 0.2–4 |
| `move` | `{ entity, to }` | يُحسب مسار A\* حسب نطاق الكيان |
| `resize` | `{ entity, scale }` | تغيير حجم وحدة قائمة، `scale`: 0.2–4 |
| `construct` | `{ id?, actor, at, faction?, duration?, scale? }` | بناء تدريجي (الافتراضي 2s)، `duration` موجب، `scale`: 0.2–4 |
| `remove` | `{ entity }` | يحذف الكيان وبطاقاته المرتبطة |
| `strike` | `{ attacker?, mode: "airstrike" \| "missile", from?, to, radius?, color? }` | `radius` موجب، طلعة جوية أو صاروخ بالستي |
| `draw_arrow` | `{ id, from, to, color?, dashed?, duration? }` | `id` مطلوب، الافتراضي أحمر متقطع 1.5s، `duration` موجب |
| `zone` | `{ id, color, opacity?, duration? }` | `id` يجب أن تكون منطقة معرّفة مسبقًا في الخريطة، `opacity` بين 0 و1، `duration` موجب |
| `callout` | `{ id, target, text, color?, duration? }` | `target` كيان أو مرساة؛ بلا `duration` يبقى دائمًا |
| `pulse` | `{ at, color?, radius? }` | `radius` موجب؛ موجة تنبيه متوسعة |

## قواعد التحقق (Validator)

- `meta.map` إلزامي ويجب أن تكون الخريطة موجودة، و`meta.duration_hint` (إن وُجد) مدة موجبة.
- `timeline` يجب أن تكون قائمة، وكل خطوة كائنًا يحمل `at` أو `after` (حصريًا).
- `at` و`after` يُمنع الجمع بينهما في نفس الخطوة، والخطوة بلا أي منهما مرفوضة.
- `after` يجب أن يكون `"<entityId>.arrived"` أو `"<entityId>.built"` لكيان أُنشئ في خطوة
  سابقة، مع إثبات إمكانية الوصول (بما في ذلك عبر الفروع والمحفزات المتقاطعة).
- معرّفات الوحدات (`spawn[].id`, `construct.id`) يجب أن تكون غير فارغة، بدون مسافات أو نقاط،
  وفريدة عبر كامل السيناريو (لا يُسمح بإعادة استخدام معرّف مكرر أو استخدام وحدة بعد `remove`).
- لا تُستخدم مراسي/مناطق/كيانات غير معرّفة. عند الخطأ الإملائي يقترح المُحقِّق أقرب اسم.
- `faction` من القيم الثلاث فقط، و`sound` من القيم الثماني فقط، و`strike.mode` من القيمتين.
- الحدود الرقمية: `camera.zoom` 0.25–4، `zone.opacity` 0–1، `scale` 0.2–4،
  و`radius` موجب ولا يتجاوز ضعف أكبر بُعد في الخريطة.
- `move` و`resize` و`remove` و`strike.attacker` و`callout.target` يجب أن تشير إلى كيان
  أُنشئ مسبقًا، وألا تُستخدم بعد إزالته (بما في ذلك في نفس الخطوة التي تُحذف فيها).
- جميع الأوقات تُقرأ بشكل صارم؛ القيم السالبة أو الصيغ غير المعروفة تُرفض ولا تُقصَّص بصمت.
- `scale` يُقصّ تشغيليًا عند 0.2–4 في المحرك حتى لو حُمِّل ملف غير صالح وقت التشغيل.

## مثال كامل

```yaml
meta:
  title: "أزمة الممر البحري"
  map: geopolitics_strait
  duration_hint: 14s

timeline:
  - at: "0s"
    camera: { focus: port_south, zoom: 1.25, duration: 1s }
    caption: { text: "انطلاق الدورية البحرية" }
    spawn:
      - { id: patrol_1, actor: naval_corvette, at: port_south, faction: blue }
      - { id: radar_1, actor: radar_outpost, at: coast_point_1, faction: blue }

  - at: "1.2s"
    move: { entity: patrol_1, to: strait_gate }
    callout: { id: c_patrol, target: patrol_1, text: "دورية بحرية", color: "#38bdf8", duration: 6s }
    draw_arrow: { id: route_sea, from: port_south, to: strait_gate, color: "#38bdf8", duration: 2s }

  - after: "patrol_1.arrived"
    camera: { focus: strait_gate, zoom: 1.55, duration: 1.4s }
    sound: alert_ping
    pulse: { at: strait_gate, color: "#ef4444", radius: 95 }
    zone: { id: corridor_south, color: "#ef4444", opacity: 0.35, duration: 1.5s }
    strike: { mode: missile, from: { x: 240, y: 620 }, to: strait_gate, radius: 70 }
```

## ملاحظات سلوكية

- `zone` لا تُنشئ منطقة جديدة؛ لتلوين منطقة يجب أن تكون ضمن `zones` في الخريطة.
- `callout` المرتبط بكيان يُحذف تلقائيًا عند حذف الكيان أو تدميره.
- الضربة الجوية تتطلب كيانًا جوّيًا كـ`attacker`، وإلا تُعامل كقنبلة/صاروخ من نقطة `from`.
- الانفجار يدمّر الكيانات غير الجوية المعادية/المحايدة ضمن نصف القطر، ولا يصيب حلفاء المهاجم.
- الكيانات الجوية التي تحلّق فوق 0.35 لا تتأثر بالانفجارات الأرضية.
- الخطوات المعتمدة على `after` تُمدّ شريط الزمن تلقائيًا (+15 ثانية) لإتاحة وصول الوحدة
  وتنفيذ الخطوة التابعة.

## الخرائط المدمجة

| المعرّف | النوع | الأبعاد | ملاحظة |
|---|---|---|---|
| `geopolitics_strait` | geopolitical | 1200×800 | ممر بحري وشبه جزيرة وأرصفة |
| `tactical_valley` | tactical | 1200×800 | نهر بجسر واحد + جبل عائق |
| `world_live` | geopolitical | 1920×1080 | عالم حقيقي، يُبنى وقت التشغيل |
| `country_<iso3>` | geopolitical | 1200×800 | محافظات دولة، تُبنى عند الطلب |
