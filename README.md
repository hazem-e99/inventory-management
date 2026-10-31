# Inventory

برنامج Desktop لإدارة المخزون والمبيعات، بالعربي والإنجليزي، يعمل من غير إنترنت.

- [الخطة الكاملة](docs/PLAN.md)
- [سجل القرارات](docs/decisions.md)

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
pnpm dist
```

الـ Installer بيطلع في `apps/desktop/release`.
