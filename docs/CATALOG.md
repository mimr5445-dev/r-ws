<!-- AUTO-GENERATED FILE — do not edit by hand. Run: npm run catalog -->
# فهرس الاستوديو (CATALOG)

> هذا الملف يوثّق **الخرائط والكيانات المدمجة** في الكود المصدري، لاستخدامه كمرجع
> عند كتابة السيناريوهات أو عند تغذية نموذج ذكاء اصطناعي خارجي.
>
> خريطتا `world_live` (العالم) و`country_<iso3>` (المحافظات) تُبنيان وقت التشغيل
> من GeoJSON، ولذلك لا تظهر مراسيهما هنا. افتح التطبيق ثم زر **«نسخ CATALOG.md»**
> للحصول على الفهرس الكامل للخريطة المفتوحة حاليًا.
>
> مواصفة اللغة الكاملة: [`STUDIO_SPEC.md`](../STUDIO_SPEC.md)

# Studio Auto-Generated Catalog (CATALOG.md)

## الخرائط المتاحة (`meta.map`)
### - `geopolitics_strait` (خريطة سياسية: المضيق البحري) [geopolitical]
  - **Anchors:** `capital_north` (العاصمة)، `peninsula_center` (وسط الجزيرة)، `coast_point_1` (نقطة المراقبة)، `port_south` (الميناء الغربي)، `strait_gate` (بوابة المضيق)، `port_east` (الميناء الشرقي)
  - **Zones:** `corridor_south` (ممر المضيق)، `north_sector` (الإقليم الشمالي)
### - `tactical_valley` (خريطة ميدان: الوادي والجسر) [tactical]
  - **Anchors:** `base_blue` (القاعدة الغربية)، `bridge_mid` (الجسر الأوسط)، `outpost_site` (موقع الإمداد)، `hill_east` (المرتفع الشرقي)، `north_flank` (الجناح الشمالي)
  - **Zones:** `east_sector` (القطاع الشرقي)

## الكيانات والأدوات المتاحة (`actors`)
- `diplomat_person`: مبعوث / شخصية (النوع: person، النطاق: land)
- `infantry_squad`: فصيل مشاة (النوع: person، النطاق: land)
- `heavy_tank`: دبابة قتال ثقيلة (النوع: vehicle، النطاق: land)
- `ballistic_launcher`: منظومة صواريخ بالستية (النوع: vehicle، النطاق: land)
- `fighter_jet`: مقاتلة حربية (النوع: air، النطاق: air)
- `stealth_bomber`: قاذفة استراتيجية (النوع: air، النطاق: air)
- `attack_heli`: مروحية هجومية (النوع: air، النطاق: air)
- `naval_corvette`: فرقاطة بحرية (النوع: ship، النطاق: sea)
- `destroyer_ship`: مدمرة صواريخ (النوع: ship، النطاق: sea)
- `aircraft_carrier`: حاملة طائرات (النوع: ship، النطاق: sea)
- `military_base`: قاعدة عسكرية (النوع: building، النطاق: land)
- `oil_facility`: منشأة نفطية (النوع: building، النطاق: land)
- `radar_outpost`: محطة رادار (النوع: building، النطاق: land)
- `supply_depot`: مستودع إمداد (النوع: building، النطاق: land)
