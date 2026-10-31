# Design

Bilingual station signage for a shop's back office. A worker should always be able to read where they are, as they can on a metro platform. The tokens live in `packages/ui/src/theme.css`; this file records the decisions behind them.

## Scene

Bright fluorescent shop lighting, a modest Windows PC, a customer waiting. That forces a light default with strong ink. Dark mode exists for evening work, not as the identity.

## Colour

Restrained: neutrals plus one route blue.

| Role | Light | Use |
|---|---|---|
| `ground` | `#f3f5f7` | White enamel behind everything |
| `surface` | `#ffffff` | Tables, panels, inputs |
| `ink` | `#10213b` | Deep navy text |
| `route` | `#0b56c4` | Primary actions, the current stop, selection |
| `plate` | `#10213b` | The enamel sign beside pre-sign-in forms and above the rail |

Route blue means "live or actionable" and nothing else. Green, amber and red are reserved for state. Later modules each take one route colour for their stops; it never appears as decoration.

## Type

Readex Pro Variable, one family for Arabic and Latin, bundled so it works offline. Base size is 15px, with a fixed scale. Prices, quantities and dates use `.tabular`.

## Signature elements

- **The route:** navigation is a line with a stop for each screen. The current stop is filled and ringed.
- **Stops:** multi-step flows use the same line on the enamel plate, and document states will too (draft, posted, voided).
- **The sign:** every page opens with its name in the working language and, smaller, the other language.
- **The plate:** navy enamel on the inline-start side of every pre-sign-in screen, naming where you are.

Keep these quiet. They are wayfinding, not ornament: if a stop does not tell the user where they are or what state something is in, remove it.

## Direction and text

- Use logical properties only (`ms-`, `ps-`, `start-`, `border-e`).
- Directional icons flip with the language; forward points inline-end.
- Barcodes, usernames, codes and passwords stay `dir="ltr"`, wrapped in `<bdi>` inside Arabic text.

## Loading and feedback

| Situation | Treatment |
|---|---|
| First load of content | Skeleton shaped like the content, after 150ms |
| Save or submit | Spinner inside the button, which is disabled |
| Background refresh | Thin top bar, existing data stays visible |
| Field problem | Under the field; focus moves to the first one |
| Anything else that failed | Toast, or `ErrorState` with retry where data is missing |

Every data view goes through `QueryBoundary`, so loading, empty, error and data are always handled. Never use optimistic updates for stock or money.

## Components

Built in `packages/ui` in the shadcn manner on Radix primitives, with logical classes throughout. Selects are native on purpose: fast, keyboard-friendly and familiar. Dialogs are for focused tasks and confirmations, not for reading.

## Avoid

Stat-card dashboards with invented numbers, coloured side borders on cards, gradient text, and decorative motion. Transitions stay at 150 to 200ms and convey state only.
