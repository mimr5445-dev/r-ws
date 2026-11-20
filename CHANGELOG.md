# Changelog

جميع التغييرات المهمة في هذا المشروع موثّقة هنا.
التنسيق مستوحى من [Keep a Changelog](https://keepachangelog.com/) و[SemVer](https://semver.org/).

## [0.3.0] — 2026-11-16

### Added
- `README.md` شامل: المزايا، البدء السريع، المعمارية، الاختصارات، الأمان، النشر.
- `docs/CATALOG.md` وسكربت `npm run catalog` لتوليد فهرس الخرائط والكيانات.
- CI على GitHub Actions (`typecheck` + `test` + `build`).
- `vercel.json` جاهز للنشر مع CSP ورؤوس أمان وتخزين مؤقت.
- حاجز أخطاء React (`ErrorBoundary`) يعرض شاشة عربية بدل صفحة بيضاء.
- اختصارات لوحة مفاتيح: `Space` تشغيل/إيقاف، `R` إعادة، `?` دليل YAML.
- `src/core/constants.ts` كمصدر واحد لحدود المقياس والزوم والأصوات والفصائل.
- `CHANGELOG.md`، `.editorconfig`، `public/robots.txt`، وأيقونة SVG مضمّنة.
- سلسلة صوت رئيسية (gain + limiter) لمنع تشويش تسجيل WebM عند الانفجارات المتكررة.

### Changed
- تحديث `STUDIO_SPEC.md` إلى v0.3: `resize`، `strike`، الأصوات الثمانية، وقواعد التحقق.
- توحيد حدود `scale` بين المحرك والمُحقِّق والواجهة (0.2–4) عبر `src/core/constants.ts`،
  بما يتوافق مع حدود v0.2 المشددة على `main`.
- تحميل `dist/` وبناء الإنتاج عبر `npm run verify`.
- إعادة تنظيم `package.json`: نقل أنواع `@types/*` إلى devDependencies،
  وإضافة `typecheck` و`verify` و`catalog`، ورفع الإصدار إلى 0.3.0.

### Fixed
- استيعاب كامل لحزمة تقوية P0 الموجودة على `main` (تطهير SVG، معرّفات فريدة، دورة حياة
  الكيانات، توقيت صارم، حدود الخريطة، ورفض مفاتيح prototype pollution) دون أي تراجع عنها.
- حذف السيناريوهات الجاهزة أصبح دائمًا: تُسجَّل المعرّفات المحذوفة في
  `deletedPresetIds` ولا تُعاد زراعتها عند تحديث الصفحة.
- منح خطوات `after: "<id>.arrived"` مساحة إضافية في شريط الزمن (15 ثانية)
  حتى يمكن السحب إلى ما بعد لحظة الوصول.
- التقاط فشل تهيئة WebGL/IndexedDB أثناء الإقلاع وعرض رسالة عربية بدل رفض غير معالج.
- تسريع وضع محرر شبكة الملاحة: تُبنى طبقة الشبكة مرة واحدة بدل إعادة رسم
  عشرات الآلاف من المربعات كل إطار، مع رسم مسودة المنطقة في طبقة مستقلة.
- قصّ زوم الكاميرا عند القيم المسموحة أيضًا في أهداف السيناريو و`syncCameraImmediate`.
- إخفاء بطاقات `callout` أثناء تصدير الفيديو (إخراج سينمائي أنظف).
- إزالة دالة `actIdFallback` عديمة الفائدة، وضمان ثبات معرّف الخريطة عند بدء التسجيل.
- تحسين تباين الأيقونة والوصف في `index.html` وإضافة `noscript`.

### Removed
- اعتماديات غير مستخدمة: `express`, `dotenv`, `@google/genai`, `motion`,
  `autoprefixer`, `esbuild`, `@types/express`.
- ملف `.env.example` (التطبيق لا يحتاج أي أسرار).
- ملفات `public/assets/aistudio/` النصية غير المرجعية (تبقى في تاريخ Git).
- ادعاء `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` من `metadata.json`.
