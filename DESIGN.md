# Spanner design system

Spanner should feel like engineering paper for agent work: warm, technical, trustworthy, and not magical.

## Principles

1. One obvious next action per screen.
2. Show agent state in plain English: what is running, where, and what changes next.
3. Prefer quiet surfaces over glow, gradients, and decoration.
4. Use status words with colors; never color alone.
5. Keep copy concrete: agents, repos, sandboxes, traces, diffs.

## Tokens

Use these names in CSS as `--ds-*` variables.

| Token | Value | Use |
|---|---:|---|
| `bg` | `#FAF8F3` | page background |
| `bg-soft` | `#EFEAD9` | subtle panels and hero wash |
| `surface` | `#FFFFFF` | cards, modal, nav chips |
| `surface-2` | `#EFEAD9` | raised card interiors |
| `text` | `#241A12` | primary text |
| `muted` | `#4B3A2D` | body copy, secondary links |
| `quiet` | `#78635A` | fine print, metadata |
| `line` | `rgba(31, 94, 156, .14)` | borders and dividers |
| `line-strong` | `rgba(31, 94, 156, .26)` | focused borders |
| `accent` | `#1F5E9C` | primary CTA and focus |
| `accent-soft` | `#DDEBF6` | selected/raised UI fill |
| `accent-ink` | `#FAF8F3` | text on accent |
| `success` | `#22C55E` | completed/ready state |
| `warning` | `#B7791F` | waiting/review state |
| `danger` | `#B42318` | failed/destructive state |

## Type

One family ships: `Inter Variable`, then `Inter`, `ui-sans-serif`, `system-ui`, `sans-serif`. `--mono` is only a semantic alias for chrome/code-like UI; it still resolves to Inter.

| Role | Token / style | Use |
|---|---|---|
| Body | `400 16px/1.55 var(--sans)` | Paragraphs, message text, descriptions, long reading. |
| UI | `500 13px/1.25 var(--sans)` | Menu rows, helper text, secondary dense UI. |
| Strong UI | `700 13px/1.2 var(--sans)` | Card titles, selected rows, important status text. |
| Labels/chrome | `700 11px/1 var(--mono)` | Eyebrows, pills, tiny metadata, control labels. |
| Display | `800`, tight line-height, negative tracking | Brand, page heroes, large section headings only. |

Avoid new font families. Avoid weights outside `400`, `500`, `700`, `800` unless a one-off marketing hero needs it.

## Spacing

- Base unit: `4px`.
- Shell width: `min(1040px, calc(100% - 40px))`.
- Mobile shell: `calc(100% - 28px)`.
- Hero padding: `clamp(70px, 12vw, 128px) 0 56px`.
- Section gap: `16px`.
- Card padding: `18px` small, `24px` large.
- Button height: `48px` minimum.

## Radius and shadow

- Controls: `6px`.
- Cards: `6px`.
- Modal: `12px`.
- Pills: `999px`.
- Shadow: keep subtle and paper-like, `0 2px 8px rgba(31,94,156,.08)` for cards and `0 24px 70px rgba(31,94,156,.10)` for modal only.

## Components

### Nav

- Brand left; product actions right.
- Secondary links are muted until hover.
- Sign-in is a compact outline button.

### Buttons

- Primary: accent fill, accent-ink text, bold.
- Secondary: transparent fill, accent text, line border.
- Disabled: `opacity: .55`, no pointer affordance.

### Cards

- `surface` fill, `line` border, `6px` radius.
- Use cards for capabilities or live previews only.
- Do not put cards inside cards unless the inner card is a status row.

### Status rows

- Left: status label.
- Right: state in a semantic color.
- Keep rows compact: `11px 0` with a top border.

### Modal

- Native `<dialog>`.
- Width: `min(480px, calc(100% - 28px))`.
- Backdrop: black overlay plus light blur.
- CTA spans full width.

## Landing page pattern

1. Nav with brand, sign-in, web app.
2. Split hero: copy and CTAs on the left, agent status preview on the right.
3. Capability strip.
4. Three cards: start, watch, review.
5. Install footer.
6. GitHub sign-in modal.

Keep the page visually identical to these tokens: cream paper, white cards, blueprint-blue borders, no radial glow, no gradient cards, no off-system borders.

## Copy rules

- Lead with: “The easiest way to build with agents.”
- Say “agents,” not “AI workers.”
- Say “review every diff,” not “ship automatically.”
- Avoid hype words: magical, revolutionary, autonomous, next-gen.
- Prefer verbs: start, watch, review, build.
