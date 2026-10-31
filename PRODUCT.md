# Product

## Platform

web (a React app inside an Electron desktop window; Windows first, no mobile target)

## Stack

React 19, Vite, Tailwind 4, shadcn/ui with RTL, TanStack Router and Query. Chosen in the approved plan (`docs/PLAN.md`).

## Purpose

An offline-first desktop app that runs one shop's stock and sales: pharmacy, supermarket, clothing store or general retail. It runs on a single PC in the shop and needs no internet to sell.

## Users

- **Cashier:** stands at the counter, scanner in one hand, customer waiting. Needs speed, keyboard flow and no surprises.
- **Storekeeper:** receives goods, counts stock, checks expiry dates.
- **Owner or manager:** sits at the same PC after hours, reads what sold, what is short, who did what.

Most are not technical. They usually read Arabic first, and many use modest Windows PCs under bright fluorescent shop lighting.

## Mechanism

Every unit is recorded in an append-only movement ledger. A posted document is never edited, only reversed, so the numbers can always be explained. A business type is a preset of switches, not a separate product.

## Market

Egypt first: EGP, Egyptian tax registration fields, Arabic as the default language with English as a full alternative.

## Commercial model

Sold person to person by the developer. Each customer gets a copy and an activation serial with a fixed duration, issued from a developer-only web panel. Payments are handled manually, outside the product.

## Voice

Plain, direct and respectful Modern Standard Arabic that a shop worker reads without effort. Errors say what happened, why, and what to do next. No marketing language inside the app.

## Constraints

- Everything must work offline: fonts and assets are bundled, nothing loads from a CDN.
- Arabic and RTL are the primary layout; English and LTR must be equally complete.
- Barcodes, SKUs and codes stay left-to-right inside Arabic text.
- WCAG AA contrast, full keyboard operation.
- Customer data is never held hostage: viewing, export and backup always work.

## Undecided

Product name, logo and final brand.
