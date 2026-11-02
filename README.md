# Inventory

برنامج Desktop لإدارة المخزون والمبيعات، بالعربي والإنجليزي، يعمل من غير إنترنت.

- [الخطة الكاملة](docs/PLAN.md)
- [سجل القرارات](docs/decisions.md)
- [قائمة القبول قبل أول عميل](docs/acceptance.md)
- [تشغيل سيرفر التراخيص والتحديثات](docs/license-server.md)
- [سجل الإصدارات](CHANGELOG.md)
- [حقائق المنتج](PRODUCT.md)
- [نظام التصميم](DESIGN.md)

## المتطلبات

Node 24 و pnpm 9. الأوامر التالية من جذر المشروع.

```bash
pnpm install
```

```bash
pnpm dev
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm test:e2e
```

```bash
pnpm bench
```

```bash
pnpm dist
```

الـ Installer بيطلع في `apps/desktop/release`، والأمر محتاج مفاتيح الإصدار: راجع [تشغيل سيرفر التراخيص](docs/license-server.md).

## نسخة تجريبية بداتا جاهزة

صيدلية وهمية فيها 90 يوم نشاط، في فولدر `.demo-data` منفصل عن بياناتك:

```bash
pnpm demo
```

الدخول: `demo` وكلمة المرور `Demo12345`. لإعادة بنائها من الصفر:

```bash
pnpm demo --reset
```

ولإعادة تصوير كل الشاشات في فولدر `سكرين شوت`:

```bash
pnpm --filter @inv/desktop build
```

```bash
pnpm --filter @inv/desktop screens
```
