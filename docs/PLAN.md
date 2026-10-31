# خطة تطبيق إدارة المخزون (Desktop) — صيدليات، سوبر ماركت، ملابس، وأي نشاط تجاري

> الاسم مؤقت لحد ما تختار اسم المنتج. كل الأرقام والإصدارات والمسارات المذكورة اتراجعت بتاريخ 2026-10-31.

## 1. السياق

الفولدر فاضي، فده مشروع جديد من الصفر. الهدف برنامج Desktop كامل لإدارة المخزون والمبيعات، بالعربي والإنجليزي، ينفع لأي نشاط، ويشتغل من غير إنترنت.

**قراراتك اللي الخطة مبنية عليها:**

- جهاز واحد لكل محل، ومفيش SaaS متعدد العملاء ولا مزامنة كلاود.
- كل عميل بياخد نسخة من البرنامج وسيريال تفعيل.
- لوحة ويب Super Admin ليك إنت بس، تصدر منها السيريالات بمدة بالأيام أو الأسابيع أو الشهور أو السنين.
- المدفوعات يدوية خارج النظام.
- مصر هي السوق الأول.
- الداتابيز محلية دلوقتي، ولازم يفضل الانتقال لـ Postgres ممكن.

**افتراض محتاج تأكيدك:** فهمت "هعمله سيرفر تفعيل" على إنه **سيرفر تراخيص مركزي واحد** بتديره إنت ويخدم كل العملاء، مش سيرفر منفصل لكل عميل.

---

## 2. القرارات التقنية

| الطبقة | القرار | السبب |
|---|---|---|
| Desktop | **Electron 45** + electron-vite + electron-builder | Node موجود جواه، فمش محتاجين نغلف sidecar زي Tauri. وChromium الثابت بيدي نفس عرض RTL والطباعة على كل الأجهزة. التكلفة: حجم أكبر من Tauri. |
| Frontend | **React 19 + Vite 8 + TypeScript strict** | طلبك، وبدون SSR لأنه تطبيق Desktop. |
| Routing و Data | **TanStack Router + Query + Table + Virtual** | Routes و search params بأنواع كاملة، وكاش، وقوايم كبيرة مـ virtualized. |
| Forms | **React Hook Form + Zod 4** | نفس الـ schemas في الفورم والـ API. |
| UI | **shadcn/ui + Tailwind 4** بوضع `rtl: true` | RTL رسمي من يناير 2026. Calendar و Pagination و Sidebar محتاجين تعديل يدوي حسب الـ docs. |
| i18n | **i18next + react-i18next** | ترجمة بمفاتيح مكتوبة بأنواعها، مع `Intl` للأرقام والتواريخ. |
| Backend | **Hono + @hono/zod-openapi** في `utilityProcess` | خفيف، بأنواع مشتركة مع الـ frontend، ويولد OpenAPI. بيفضل نفس الكود لو اتنقل لسيرفر. |
| الاتصال | HTTP على `127.0.0.1` بمنفذ عشوائي و token لكل تشغيلة | نفس طريقة الاتصال لو الباك إند اتنقل بعدين، فمش هنعيد كتابة الـ client. |
| DB المحلية | **SQLite (WAL) عبر better-sqlite3-multiple-ciphers** | أكتر خيار مجرب محلياً، وفيه تشفير للملف. |
| طبقة البيانات | **Kysely** مع Repositories وطبقة migrations | **ده قرار الانتقال لـ Postgres.** Kysely فيه dialect جاهز لـ SQLite و Postgres و PGlite، والـ API بتاعه async في كله. |
| الدخول المحلي | Argon2id + جلسات في الداتابيز + PIN للكاشير | جهاز واحد، فمش محتاجين auth framework كامل. |
| سيرفر التراخيص | Hono + Kysely + Postgres + **Better Auth** مع 2FA | لوحة أدمن صغيرة، وتعتمد على نفس الـ stack. |

**ليه مش Drizzle ولا PGlite؟**

- **Drizzle:** الـ schema منفصل لكل dialect (`sqliteTable` و `pgTable`)، وترانزاكشنز `better-sqlite3` متزامنة بعكس Postgres. يعني الانتقال بعدين هيبقى إعادة كتابة لطبقة البيانات.
- **PGlite كقاعدة أساسية:** الـ README بتاعه لسه بيقول Alpha، وما فيهوش ضمانات لسلامة البيانات. مش مقبول لبيانات محل حقيقي، لكن هنستخدمه في **الاختبارات فقط**.

### قواعد تضمن الانتقال لـ Postgres

الوعد ده مش هيتساب كلام: **نفس اختبارات الـ repositories هتشتغل على SQLite و PGlite في كل CI**، فأي كسر في التوافق يظهر فوراً.

- كل الجداول بـ `id` من نوع **UUIDv7** نصي.
- الفلوس أعداد صحيحة بالقرش، والكميات أعداد صحيحة بالـ milli (`1.250 كجم = 1250`)، مفيش floats نهائياً.
- الوقت بصيغة epoch ms بـ `bigint`، مع `business_date` نصي للتقارير اليومية.
- أي SQL خاص بـ dialect (زي FTS5) بيتعزل ورا port واحد.
- أكواد أخطاء الداتابيز بتتترجم في mapper واحد لكل dialect.

---

## 3. المعمارية

**Modular Monolith** مع حدود واضحة بين الموديولات، في pnpm workspace:

```text
apps/
  desktop/          Electron main + preload (نوافذ، طباعة، تحديثات، safeStorage)
  web/              React SPA (الـ renderer)
  api/              Hono API، بيشتغل جوه utilityProcess
  license-server/   سيرفر التراخيص + API
  license-admin/    لوحة Super Admin (React)
packages/
  contracts/        Zod schemas، أنواع الـ API، أكواد الأخطاء
  domain/           قواعد العمل الخالصة: مخزون، تكلفة، FEFO، تسعير، بدون I/O
  db/               Kysely، migrations، repositories، dialects
  ui/               مكونات shadcn المشتركة والـ design tokens
  i18n/             ar.json و en.json والأنواع
  license-core/     صيغة التوكن والتحقق بـ Ed25519
```

**اتجاه الاعتماد:** `web → contracts`، و `api → domain + db + contracts`، و `domain` مش بيعتمد على أي حاجة خارجية. أي موديول بيكلم موديول تاني عن طريق service interface، مش عن طريق جداوله مباشرة. الحدود دي هتتفرض بـ lint rule.

---

## 4. نموذج البيانات والعلاقات

| المجال | الجداول الأساسية |
|---|---|
| النظام | `settings`, `users`, `roles`, `role_permissions`, `sessions`, `audit_log`, `document_sequences`, `license_state`, `outbox` |
| الكتالوج | `categories` (شجرة), `brands`, `units`, `products`, `product_variants`, `barcodes`, `unit_conversions`, `attribute_definitions`, `variant_attribute_values`, `price_lists`, `variant_prices`, `tax_rates` |
| المخزون | `warehouses`, `lots`, `serials`, `stock_movements`, `stock_balances`, `adjustments`, `transfers`, `stock_counts` (مع سطور كل مستند) |
| المشتريات | `suppliers`, `purchase_orders`, `goods_receipts`, `purchase_invoices`, `purchase_returns`, `supplier_payments` |
| المبيعات | `customers`, `sales`, `sale_lines`, `sale_line_lots`, `sale_payments`, `sale_returns`, `shifts`, `cash_movements` |

**القواعد الحاكمة للعلاقات والبيانات:**

1. **`stock_movements` جدول append-only هو مصدر الحقيقة.** `stock_balances` بيتحدث في نفس الترانزاكشن، ومينفعش تعديله من أي مكان تاني.
2. **كل منتج له variant واحد على الأقل**، فالمنتج البسيط والملابس (مقاس × لون) بيمشوا في نفس المسار.
3. **المستندات ليها حالات `draft → posted → voided`.** المستند المرحّل مش بيتعدل، والإلغاء بيتم بقيد عكسي.
4. **البيانات الأساسية مش بتتمسح لو مرتبطة.** الـ FK بوضع `RESTRICT` مع Archive بدل الحذف، والـ `CASCADE` فقط من مسودة إلى سطورها.
5. **التكلفة Moving Weighted Average في v1**، وصرف الدُفعات بـ **FEFO** تلقائياً مع إمكانية الاختيار اليدوي.
6. **الرصيد السالب ممنوع افتراضياً**، وبيتفتح بصلاحية وإعداد.
7. **الأرقام التسلسلية بدون فراغات** من `document_sequences` جوه الترانزاكشن.
8. **الضمان على مستوى الداتابيز:** `CHECK` و `UNIQUE` و `FOREIGN KEY`، مش في الكود بس.

---

## 5. الفيتشرز

**الأساس المشترك**

- معالج بداية يسأل عن النشاط، إعداد المحل، إنشاء المالك، و**كود استرجاع** مرة واحدة.
- مستخدمين وأدوار وصلاحيات، وسجل مراجعة لكل عملية حساسة.
- نسخ احتياطي تلقائي ويدوي واستعادة، وثيم فاتح وداكن.

**الكتالوج**

- منتجات و variants، أكتر من باركود للمنتج، وحدات وتحويلاتها (كرتونة ← علبة ← شريط)، قوائم أسعار، ضرايب، صور.
- حقول مخصصة، واستيراد وتصدير Excel/CSV مع تقرير أخطاء لكل صف، وطباعة ملصقات باركود.

**المخزون**

- مخازن متعددة، دُفعات وصلاحية، أرقام مسلسلة اختيارية.
- حركة مخزون كاملة لكل صنف، تسويات بأسباب، تحويلات، جرد كلي وجزئي.
- حد إعادة الطلب، تنبيهات النقص والصلاحية، واقتراحات طلب شراء.

**المشتريات والموردين**

- أوامر شراء، استلام جزئي، فواتير، مرتجعات، رصيد ومدفوعات وكشف حساب المورد.

**المبيعات و POS**

- شاشة كاشير سريعة بالكيبورد والباركود، تعليق الفواتير، خصومات بصلاحيات، دفع مختلط (كاش، كارت، محفظة، آجل).
- مرتجعات مرتبطة بالفاتورة، عملاء وحساباتهم، ورديات وعهدة كاش، طباعة إيصال حراري وفاتورة A4.

**التقارير والـ Dashboard**

- قيمة المخزون، الحركة، الربحية، الراكد، ABC، قرب الانتهاء، المبيعات، الموردين، الورديات.
- تصدير PDF و Excel، وكلها تدعم العربية و RTL.

**ملفات النشاط (Presets)** هي إعدادات وفيتشر فلاجز، مش كود منفصل لكل نشاط:

| النشاط | اللي بيتفعل |
|---|---|
| صيدلية | دُفعة وصلاحية إجباريين، FEFO، الاسم العلمي وبحث البدائل، علبة وشريط، علامة "بروشتة" |
| سوبر ماركت | كميات كسرية، باركود الميزان EAN-13، مفاتيح سريعة |
| ملابس | مصفوفة مقاس × لون، موسم، طباعة ملصقات بالجملة |
| عام وإلكترونيات | أرقام مسلسلة وضمان |

---

## 6. سيرفر التراخيص ولوحة Super Admin

**اللوحة (ليك إنت فقط):** دخول بإيميل وباسورد و **TOTP إجباري**، ومفيش تسجيل عام.

- **الرئيسية:** نشط، ينتهي خلال 7 أو 30 يوم، منتهي.
- **العملاء:** الاسم، التليفون، النشاط، الملاحظات.
- **إصدار سيريال:** رقم + وحدة (`يوم`، `أسبوع`، `شهر`، `سنة`).
- **صفحة الترخيص:** تمديد، إيقاف، إلغاء، فك الربط بالجهاز، سجل النشاط.
- **تسجيل المدفوعات اليدوية:** المبلغ، التاريخ، الطريقة (إنستاباي، فودافون كاش، كاش)، ملاحظة.
- سجل مراجعة لكل عمليات الأدمن.

**دورة التفعيل:**

1. بتصدر السيريال وبيظهر **مرة واحدة**. بيتخزن كـ HMAC فقط، ولو ضاع تعمل له Reissue.
2. **المدة بتبدأ من أول تفعيل**، مش من تاريخ الإصدار.
3. البرنامج بيبعت السيريال وبصمة الجهاز، والسيرفر بيرد بتوكن موقّع بـ **Ed25519**، والمفتاح العام مدمج في البرنامج.
4. التحقق بيتم **أوفلاين**. لما النت يكون متاح البرنامج بيعمل check-in يجيب التمديد أو الإيقاف.
5. **التجديد بيتحسب من `max(الآن، تاريخ الانتهاء)`**، فالتجديد المبكر ما بيضيعش أيام.
6. **كود تفعيل أوفلاين:** تقدر تطلّع توكن موقّع لبصمة جهاز معين، لعميل ما عندوش نت.

**لما الترخيص ينتهي:** فترة سماح 7 أيام، بعدها البرنامج يبقى **قراءة فقط**. البيع والتعديل بيقفوا، لكن العرض والتقارير والتصدير والنسخ الاحتياطي بيفضلوا شغالين. **بيانات العميل عمرها ما تتحجز.**

**الحماية:** Rate limit على التفعيل، HTTPS فقط، كشف الرجوع بساعة الجهاز عن طريق آخر وقت متسجل. وبشكل صريح: أي حماية على جهاز العميل ممكن تتكسر من شخص مصمم. الهدف نخلي الكسر صعب، مش مستحيل، و Electron Fuses و ASAR integrity جزء من ده.

**الاستضافة:** VPS صغير عليه Docker Compose (الخدمة + Postgres + Caddy للـ TLS)، ونفس السيرفر بيستضيف ملفات التحديثات.

---

## 7. الفاليديشن ورسايل الأخطاء

**أربع طبقات:**

1. **الفورم:** نفس Zod schema من `contracts`، على الـ blur وعند الحفظ.
2. **الـ API:** بيتحقق تاني دايماً، وهو المرجع.
3. **Domain:** قواعد العمل، زي "الكمية أكبر من المتاح" و "الدُفعة منتهية".
4. **الداتابيز:** `CHECK` و `UNIQUE` و `FK`.

**شكل الخطأ موحد، والسيرفر مش بيبعت نص مترجم:**

```json
{ "code": "STOCK_INSUFFICIENT", "status": 409, "params": { "available": 5, "requested": 8 }, "fields": { "lines.0.qty": ["QTY_EXCEEDS_STOCK"] }, "traceId": "..." }
```

- الـ frontend بيحول `code + params` لرسالة عربية أو إنجليزية، و**اختبار بيفشل لو أي كود ناقص ترجمة في أي لغة**.
- كل رسالة بتقول: إيه اللي حصل، وليه، وتعمل إيه. مثال: *"مش ممكن حذف التصنيف، مرتبط بـ 12 منتج. انقل المنتجات أو أرشف التصنيف."*
- أخطاء الحقول تحت الحقل، مع التركيز على أول حقل غلط، والتوست للأخطاء العامة فقط.
- إدخال المستخدم ما بيضيعش عند الخطأ، وفيه تحذير قبل الخروج من فورم فيه تعديلات، ورسالة تأكيد للعمليات الخطرة.
- `traceId` بيظهر في الأخطاء غير المتوقعة، مع زر نسخ بيانات الدعم.

---

## 8. السرعة والتحميل

**أهداف قابلة للقياس على جهاز ضعيف (4GB RAM)، بقاعدة 100 ألف منتج و 1 مليون حركة:**

| المقياس | الهدف |
|---|---|
| فتح البرنامج حتى شاشة قابلة للاستخدام | أقل من 3 ثواني |
| مسح باركود في POS حتى ظهور السطر | أقل من 100ms (p95) |
| بحث المنتجات | أقل من 150ms (p95) |
| فتح صفحة قايمة | أقل من 300ms |

**كيف هنحققها:**

- Keyset pagination وفهارس مبنية على الاستعلامات الفعلية، و virtualization لأي قايمة طويلة.
- `search_text` عربي مطبّع مع FTS5: توحيد `أ إ آ → ا`، و `ة → ه`، و `ى → ي`، وإزالة التشكيل.
- Code splitting لكل route، و preload عند الـ hover، و `keepPreviousData` عند تغيير الصفحات.
- التقارير الثقيلة في worker منفصل عشان ما تعطلش الكاشير.

**سياسة حالات التحميل (كل مكون بيانات ليه 4 حالات: تحميل، فاضي، خطأ، بيانات، عبر `<QueryBoundary>`):**

| الموقف | المستخدم |
|---|---|
| أول تحميل لمحتوى | **Skeleton** بنفس شكل المحتوى، بعد تأخير 150ms لمنع الوميض |
| عملية حفظ أو إرسال | **Spinner داخل الزرار**، مع تعطيله لمنع التكرار |
| تحديث في الخلفية أو تغيير صفحة | شريط رفيع أعلى الصفحة، والبيانات القديمة ظاهرة |
| مهمة طويلة (استيراد، نسخ احتياطي) | شريط تقدم حقيقي مع إمكانية الإلغاء |

**Optimistic updates** للإعدادات البسيطة فقط، ومش للمخزون أو الفلوس أبداً.

---

## 9. العربية و RTL

- `dir` و `lang` بيتغيروا وقت التشغيل من غير إعادة تشغيل.
- خطوط **مضمنة داخل البرنامج** عشان يشتغل أوفلاين، مع `tabular-nums` للأرقام في الجداول.
- الباركود و SKU والأكواد في `<bdi dir="ltr">` عشان ما تتلخبطش جوه نص عربي.
- خيار أرقام لاتينية أو هندية، والافتراضي لاتيني.
- الطباعة الحرارية بتتم من **HTML عبر `webContents.print`**، مش ESC/POS خام، عشان تشكيل الحروف العربية يطلع صح.

---

## 10. الأمان

- `contextIsolation` و `sandbox` مفعلين، `nodeIntegration` مقفول، و CSP صارم.
- Preload يعرض API محدود جداً، مع Electron Fuses و ASAR integrity.
- الـ API على loopback فقط، مع token لكل تشغيلة وفحص Origin.
- تشفير ملف الداتابيز، والمفتاح محمي بـ `safeStorage` (DPAPI).
- **النسخ الاحتياطية مشفرة بكود الاسترجاع، مش بمفتاح الجهاز**، عشان تترجع على جهاز جديد لو الويندوز باظ.
- RBAC على الـ API، مش في الواجهة بس، وكل الاستعلامات parameterized.
- قفل بعد محاولات دخول فاشلة، و `pnpm audit` في CI.

---

## 11. الجاهزية للضريبة المصرية

ربط الإيصال الإلكتروني مع مصلحة الضرايب **مش جزء من v1**، لكن التصميم جاهز له:

- `FiscalPort` مع `NoopFiscalAdapter`، و `ETAAdapter` يتضاف بعدين.
- حقول الرقم الضريبي وكود الفرع والنشاط، و `fiscal_status` و `fiscal_uuid` على الفاتورة، وجدول `outbox` للإرسال.

**تنبيه:** المصادر المتاحة بتقول إن الإيصال بيتبعت ويتحقق منه قبل تسليمه للعميل، يعني محتاج نت وقت البيع. والمصادر مختلفة في التواريخ، والإلزام بيتحدد لكل ممول على حدة. لازم تتأكد من وضع كل عميل مع المصلحة أو محاسبه قبل ما تبيعله.

---

## 12. مراحل التنفيذ

| # | المرحلة | التسليم | معيار الإنهاء |
|---|---|---|---|
| 0 | **Spike وتأسيس** | Monorepo و CI، وإثبات Electron 45 + SQLite المشفر + `utilityProcess` + Kysely | Installer يشتغل على ويندوز نظيف ويكتب ويقرأ من داتابيز مشفرة |
| 1 | **منصة البرنامج** | Migrations، إطار الأخطاء، دخول وصلاحيات، سجل مراجعة، Shell بالعربي والإنجليزي، Design System، Onboarding، نسخ احتياطي | دخول، تبديل لغة، نسخة واسترجاعها، واختبارات الـ DB على الاتنين |
| 2 | **الكتالوج** | منتجات و variants ووحدات وباركود وأسعار واستيراد وملصقات | استيراد 10 آلاف صف بتقرير أخطاء واضح |
| 3 | **محرك المخزون** | الحركات، الدُفعات، FEFO، التسويات، التحويلات، الجرد | اختبارات الخصائص تثبت إن مجموع الحركات = الأرصدة دايماً |
| 4 | **المشتريات والموردين** | دورة الشراء الكاملة وكشف الحساب | الاستلام يأثر صح على المخزون والتكلفة والرصيد |
| 5 | **المبيعات و POS** | الكاشير، الدفع، المرتجعات، الورديات، الطباعة | بيع كامل بالباركود من غير ماوس، وتحقق أهداف السرعة |
| 6 | **التقارير والتنبيهات** | Dashboard والتقارير والتصدير | أرقام التقارير تطابق الحركات |
| 7 | **التراخيص والأدمن** | السيرفر، اللوحة، التفعيل، وضع القراءة فقط | سيريال يتفعل، يتمدد، ويتوقف من اللوحة |
| 8 | **التقسية والإطلاق** | Security و a11y وأداء، التحديث التلقائي، دليل الاستخدام، تجربة مع عميل فعلي | كل معايير القسم 14 ناجحة |
| 9 | **بعد v1** | ETA، شبكة محلية، Postgres أو كلاود | تتحدد بعد تجربة أول عملاء |

**قرارات تصميم بدري في Phase 0 لو الـ Spike فشل:**

- لو التشفير فشل مع Electron 45، هنستخدم `better-sqlite3` العادي ونكتفي بتشفير النسخ الاحتياطية.
- لو TypeScript 7 كسر أي أداة، هنستخدم آخر نسخة 5.x شغالة مع الأدوات.
- `exceljs` آخر تحديث له ديسمبر 2024، فهيتعزل ورا adapter عشان يتبدل بسهولة.

---

## 13. الريبوز المرجعية

**تنبيه قانوني:** الريبوز بترخيص GPL أو AGPL للدراسة والأفكار فقط. **ما تنسخش منها كود** لأن برنامجك تجاري مغلق. MIT مسموح بشرط الاحتفاظ بنص الترخيص، وراجع ترخيص Medusa لأن جزء Enterprise منه مستثنى.

| الريبو | النجوم | الترخيص | تتعلم منه إيه |
|---|---|---:|---|
| [frappe/erpnext](https://github.com/frappe/erpnext) | 40.8k | GPL-3.0 | **أقوى مرجع للمخزون:** `erpnext/stock/stock_ledger.py` و `doctype/stock_reconciliation` و `doctype/batch` |
| [actualbudget/actual](https://github.com/actualbudget/actual) | 29.9k | MIT | **أقرب مرجع للشكل:** Electron + better-sqlite3 + `@electron/rebuild`، في `packages/desktop-electron` |
| [inventree/InvenTree](https://github.com/inventree/InvenTree) | 7.8k | MIT | نموذج المخزون في `src/backend/InvenTree/stock/models.py`، وواجهة React في `src/frontend` |
| [bigcapitalhq/bigcapital](https://github.com/bigcapitalhq/bigcapital) | 4.0k | AGPL-3.0 | تطبيق TypeScript حقيقي فيه مخزون وحسابات، `packages/server` و `packages/webapp` |
| [openboxes/openboxes](https://github.com/openboxes/openboxes) | 920 | EPL-1.0 | دُفعات وصلاحية في سياق صحي، مفيد للصيدليات: `grails-app/domain/org/pih/warehouse/inventory` |
| [medusajs/medusa](https://github.com/medusajs/medusa) | 37.0k | MIT (عدا Enterprise) | حدود موديول المخزون والحجوزات: `packages/modules/inventory` |
| [twentyhq/twenty](https://github.com/twentyhq/twenty) | 60.2k | AGPL-3.0 | تنظيم Monorepo كبير بـ TypeScript و React |
| [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) | 16.3k | MIT | Shell لوحة تحكم بـ Vite و shadcn |
| [sadmann7/tablecn](https://github.com/sadmann7/tablecn) | 6.4k | MIT | جداول متقدمة بفلترة وترتيب |

**ملاحظة:** [frappe/books](https://github.com/frappe/books) كان مرجع قريب جداً (محاسبة Desktop أوفلاين)، لكنه **Archived** ومتروك، فمش هنعتمد عليه.

---

## 14. التحقق النهائي

**الاختبارات المستمرة:**

```bash
pnpm test
```

```bash
pnpm test:db
```

```bash
pnpm test:e2e
```

```bash
pnpm bench
```

- `test:db`: نفس الاختبارات على SQLite و PGlite.
- `test:e2e`: Playwright على البرنامج المبني فعلياً، بالعربي والإنجليزي.
- `bench`: أهداف القسم 8 على داتا 100 ألف منتج، ويفشل الـ CI لو اتكسرت.

**سيناريو القبول الكامل على ويندوز نظيف:**

1. تثبيت البرنامج، ثم إصدار سيريال 7 أيام من اللوحة وتفعيله.
2. Onboarding كصيدلية، وإضافة صنف بدُفعتين مختلفتين في الصلاحية.
3. أمر شراء، استلام جزئي، فاتورة مورد.
4. بيع بالباركود، والتأكد إن FEFO صرف الدُفعة الأقرب، وطباعة إيصال عربي.
5. مرتجع، جرد، تسوية، ثم التأكد إن التقارير تطابق الحركات بالضبط.
6. قطع النت، والتأكد إن البرنامج شغال عادي.
7. نسخة احتياطية واسترجاعها على جهاز تاني بكود الاسترجاع.
8. تجربة خطأ مقصود في كل فورم رئيسي، والتأكد من الرسالة باللغتين.
9. إيقاف الترخيص من اللوحة، والتأكد من وضع القراءة فقط وإن التصدير شغال.
10. تمديد الترخيص، والتأكد إن البرنامج رجع يبيع بعد الـ check-in.

---

## 15. الـ Skills المناسبة لكل مجال

| المجال | الـ Skills | تُستخدم في |
|---|---|---|
| **المعمارية** | `engineering-skills:senior-architect`, `clean-architecture`, `domain-driven-design-distilled`, `domain-modeling`, `a-philosophy-of-software-design`, `improve-architecture` | Phase 0، ومراجعة حدود الموديولات |
| **البيانات** | `engineering-advanced-skills:database-designer`, `engineering-advanced-skills:database-schema-designer`, `designing-data-intensive-applications`, `patterns-of-enterprise-application-architecture`, `engineering-advanced-skills:migration-architect` | Phase 1 و 3 و 9 |
| **الـ API والباك إند** | `engineering-skills:senior-backend`, `engineering-advanced-skills:api-design-reviewer`, `engineering-advanced-skills:api-test-suite-builder` | كل موديول |
| **الواجهة** | `impeccable`, `ui-ux-pro-max`, `design-system`, `ui-styling`, `anthropic-skills:frontend-design`, `engineering-skills:senior-frontend`, `dataviz` | Design System، POS، Dashboard |
| **الوصولية** | `a11y-audit:a11y-audit` | نهاية كل مرحلة واجهة، و Phase 8 |
| **الأمان** | `security-guidance:security-guidance`, `engineering-skills:senior-security`, `engineering-skills:senior-secops`, `security-review`, `engineering-skills:security-pen-testing`, `engineering-advanced-skills:env-secrets-manager`, `engineering-advanced-skills:dependency-auditor` | Phase 1 و 7 و 8 |
| **الأداء** | `engineering-advanced-skills:performance-profiler`, `engineering-advanced-skills:sql-database-assistant` | Phase 3 و 5 و 8 |
| **الجودة** | `tdd`, `engineering-skills:senior-qa`, `pw:pw-init`, `pw:generate`, `pw:pw-review`, `code-review`, `karpathy-coder:karpathy-check`, `zero-hallucination-coder:zero-hallucination-coder`, `deslop` | طول المشروع |
| **الإطلاق** | `engineering-advanced-skills:ci-cd-pipeline-builder`, `engineering-advanced-skills:ship-gate`, `engineering-advanced-skills:changelog-generator`, `engineering-advanced-skills:observability-designer`, `release-it`, `docker-development:docker-development` | Phase 0 و 7 و 8 |
| **المنتج والتسعير** | `product-skills:product-manager-toolkit`, `product-skills:competitive-teardown`, `commercial-skills:pricing-strategist` | قبل Phase 2، وقبل عرضه على العملاء |

---

## 16. قبل البدء

1. **انقل المشروع خارج OneDrive**، مثلاً `C:\dev\inventory-management`. مزامنة `node_modules` والملفات المقفولة هتعمل مشاكل في البناء.
2. **Python مش راجع نسخة على الجهاز**، وبعض الـ skills ممكن تحتاجه لتشغيل سكريبتاتها.
3. **توقيع الكود:** من غير شهادة Windows هيظهر تحذير SmartScreen للعملاء. البرنامج هيشتغل، لكن قرار الشراء هيتاخد في Phase 8.
4. **اسم المنتج** محتاج يتحدد قبل Phase 8 عشان التغليف والهوية.
