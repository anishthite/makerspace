# Workbench design system

Workbench should feel like engineering paper for agent work: warm, technical, trustworthy, and not magical.

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

- Font: `Inter`, then `ui-sans-serif`, `system-ui`, `sans-serif`.
- Hero: `clamp(54px, 9vw, 104px)`, line-height `.86`, letter-spacing `-.095em`, weight `800`.
- Body: `16px/1.5`.
- Lede: `clamp(19px, 2.4vw, 24px)`, line-height `1.35`.
- Labels: `11px`, lowercase, letter-spacing `.12em`, weight `700`.

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
