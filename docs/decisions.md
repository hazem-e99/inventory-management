# سجل القرارات

الخطة الكاملة في [PLAN.md](PLAN.md). الملف ده بيسجل اللي اتأكدنا منه بالتجربة وأي تعديل على الخطة.

## Phase 0 — 2026-10-31

**اتثبت بالتجربة:**

- `better-sqlite3-multiple-ciphers` 13 بقى Node-API، فنفس الـ binary بيشتغل على Node 24 و Electron 45. مش محتاجين `@electron/rebuild` ولا `nativeBinding`.
- SQLite المشفر بيشتغل بوضع WAL، والمفتاح الغلط بيترفض عند الفتح.
- Kysely بيشغل نفس الـ repository والـ migration على SQLite و PGlite.
- الـ Installer بيتثبت ويشتغل مع Fuses و ASAR Integrity، و CSP مفعل، و Node مش ظاهر للواجهة.
- الداتا ما بتتمسحش عند إلغاء التثبيت (`deleteAppDataOnUninstall: false`).

**ملاحظات تقنية:**

- في Kysely 0.29 الـ `Migrator` بيتستورد من `kysely/migration`.
- Electron 45 مش بينزل الـ binary وقت التثبيت، فـ `postinstall` في الـ root بيشغل `install.js`.
- `electron` لازم يفضل برقم ثابت في `apps/desktop/package.json`، وإلا electron-builder بيرفض البناء.
- `synchronous = FULL` مقصودة، عشان الفاتورة المرحّلة تستحمل انقطاع الكهرباء.

## مؤجل

| البند | المرحلة | السبب |
|---|---|---|
| رفض `--remote-debugging-port` في النسخة المثبتة | Phase 8 | شغال حالياً، وأي برنامج على الجهاز يقدر يتحكم في الواجهة. الفحص الآلي للنسخة المثبتة بيعتمد عليه، فلازم يتغير معاه. |
| تجربة الـ Installer على ويندوز نظيف | Phase 8 | اتجرب على جهاز التطوير فقط. |
| أيقونة البرنامج واسمه النهائي | Phase 8 | الاسم لسه مؤقت. |
| توقيع الكود | Phase 8 | من غيره هيظهر تحذير SmartScreen. |
