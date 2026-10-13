# HadirOps Design System (Master)

Shared visual language with IEMS (`Javanian/IEMS`, `design-system/iems/MASTER.md`). Version 2
(Oct 2026) follows the IEMS redesign: Soft UI Evolution on a cool slate canvas, a deep
navy sidebar, and one blue action color. HadirOps applies the same tokens to an attendance product
used by admins on desktop and by employees on phones.

## Style

- White cards with a hairline border (`border-slate-200/80`), 16px radius, two-layer soft shadow
  (`shadow-soft`, hover `shadow-lift`). Tailwind's `shadow-sm/md/lg` are redefined to match.
- Navy chrome (`bg-chrome`, `#0B1220`) for the sidebar and the login brand panel. The active nav item
  is a solid blue pill with `shadow-glow`.
- Top bar is translucent (`bg-white/75 backdrop-blur-md`); dialogs sit on `bg-slate-950/50` with blur.
- Page titles are ink (`text-text-primary`, bold, tight tracking), never brand blue, so blue always
  means "you can act on this".

## Color

| Role | Web token | Mobile token | Value |
| --- | --- | --- | --- |
| Page canvas | `bg-surface` | `colors.canvas` | `#F4F6FA` web, `#F8FAFC` mobile |
| Card | `bg-white` | `colors.white` | `#FFFFFF` |
| Primary text | `text-text-primary` | `colors.ink` | `#0F172A` |
| Secondary text | `text-text-secondary` | `colors.textMuted` | `#475569` / `#64748B` |
| Border | `border-divider` | `colors.border` | `#E2E8F0` |
| Chrome (sidebar, login brand panel, table headers) | `bg-chrome` / `bg-slate-800` | | `#0B1220` / `#1E293B` |
| Action | `bg-brand` | `colors.action` | `#2563EB`, white text 5.2:1 |
| Action hover / pressed | `bg-brand-dark` | `colors.actionPressed` | `#1D4ED8` |
| Focus ring | `--ring`, `:focus-visible` | | `#3B82F6` |
| On time | emerald | `colors.success` | `#059669` |
| Late | amber | `colors.warning` | `#D97706` |
| Out of radius, destructive | red | `colors.danger` | `#DC2626` |
| Overtime | violet | `colors.overtime` | `#7C3AED` |

Web: Tailwind tokens in `web/tailwind.config.ts` and shadcn CSS variables in `web/src/index.css`.
Mobile: `mobile/src/theme/colors.ts`; screens import tokens instead of hex values.

The previous orange call-to-action is gone: every primary action is blue, and amber only marks
lateness and warnings, so a color never means two things.

## Typography

Plus Jakarta Sans (variable) for UI text, Fira Code for employee IDs and codes, bundled with
`@fontsource` on the web. Numeric columns use `tabular-nums`. The mobile app keeps the platform font.

## Interaction

- Visible `:focus-visible` ring on every control; `prefers-reduced-motion` respected.
- Status badges always carry a text label next to their color.
- Tables scroll inside their card on narrow screens.
