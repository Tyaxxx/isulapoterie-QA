# Isula Poterie — brand guide ("Atelier blanc" direction)

Source of truth for the brand. Extracted from the Claude Design canvas "Isula Poterie — Atelier blanc" (Nov 2026) so the canvas can be deleted. The website CSS ([`website/assets/css/style.css`](../website/assets/css/style.css)) implements these values.

## Logo

- **Mark**: an abstract shard / vertical blade. Single SVG path, `viewBox="0 0 820 2000"` (tall, ~0.41:1):
  ```svg
  <svg viewBox="0 0 820 2000"><path fill="#4ab0bf" fill-rule="evenodd" d="M711 0H820V1990L10 777L718 293ZM725 418L770 1785L103 777Z"/></svg>
  ```
  The same symbol is `#i-logo` in `website/index.html`; favicon in `website/assets/images/favicon.svg`.
- **Files** in [`logo/`](logo/): `mark-teal.svg` (on dark), `mark-dark.svg` (on light), `mark-light.svg` (on teal or photos), `icon-square.svg` (app icon: teal mark on a rounded dark square, same as the favicon).
- **Colour**: teal `#4ab0bf` on dark; dark `#1c1c21` on light.
- **Wordmark**: "Isula Poterie" in Almendra Bold. Stacked lock-up (business card): "Isula" Almendra Bold, large, tight line-height (0.85), with "POTERIE" below in Zalando 700, letter-spacing 0.22em. Horizontal lock-up: mark + "Isula Poterie" side by side, gap ~12px.
- Brand names are marked `translate="no"`.

## Colours

| Token | Hex | Use |
|---|---|---|
| `--dark` | `#1c1c21` | Ink, dark sections, header bar background |
| `--light` | `#ecebf0` | Page background, text on dark |
| `--teal` | `#4ab0bf` | Brand accent: logo, counters, active state on dark |
| `--teal-strong` | `#008896` | Underlines, active nav, focus ring on light, card stripe |
| `--teal-deep` | `#006f7a` | Link hover on light |
| `--teal-pale` | `#98cfdb` | Link hover / focus ring on dark |
| `--bar` | `#121216` | Viewer top bar |
| `--muted` | `#b9b9c4` | Secondary text on dark |
| `--footer` | `#55555f` | Footer text |
| lines | `rgba(28,28,33,.12–.3)` on light, `rgba(236,235,240,.14–.35)` on dark | Hairlines, outlined buttons |

## Typography

Font files: [`website/assets/fonts/`](../website/assets/fonts/).

| Role | Font | Example |
|---|---|---|
| Display / wordmark / signature | **Almendra Bold** (700) | "Isula Poterie" 84px, line-height 0.9; signature "Katia P." 26px preceded by a 48px rule |
| Section titles | **Zalando Sans SemiExpanded 200**, uppercase, +0.02em | "RÉALISATIONS" 64px |
| Hero headline | Zalando 200, −0.02em, line-height 1.04 | ~66px desktop |
| Subheads / categories / email link | Zalando 300 | 26–30px |
| Body / quotes | Zalando 400, italic for quotes, line-height 1.7 | 17px |
| Labels, nav, captions | Zalando 400, 12–13px, uppercase, letter-spacing 0.14–0.16em | "ACCUEIL", "GRÈS", hex labels |

## Texture: "craquelé"

Crackle-glaze pattern used as the background of every section — the brand signature.

- `.crk-dark`: `#1c1c21` + [`textures/crackle-dark.svg`](textures/crackle-dark.svg)
- `.crk-light`: `#ecebf0` + [`textures/crackle-light.svg`](textures/crackle-light.svg)
- Tile size 640px (300–320px for small surfaces like cards).
- Sections alternate light / dark (home light, works dark, contacts light; menu and viewer dark).
- The masters are in [`textures/`](textures/). The website uses its own copy in `website/assets/images/`, because only `website/` is published: after changing a texture here, copy it there too.
- Glaze photo for print: [`business-card/glaze.png`](../business-card/glaze.png).

## Components (look)

- **Nav**: uppercase 13px, +0.16em, padding 12px; active item underlined 1px `#008896`.
- **Email link**: Zalando 300, 30px, 2px `#008896` underline.
- **Round icon buttons**: 44–52px circles; outlined (`1px` line colour) or filled dark; thin stroke chevrons (1.5px). Primary action on dark = teal outline + teal icon.
- **Category chips**: pill (radius 999px), min-height 44px, 1px outline, count in teal 12px; active chip = teal outline.
- **Category heading**: mark (24px) + title (Zalando 300 26px) + hairline + number in teal.
- **Photo cards**: 4:3 `object-fit: cover`, caption below a hairline, uppercase 12px; selected = 2px teal outline, offset 6px.
- **Viewer (lightbox)**: crackle-dark background, `#121216` top bar with logo, image with deep shadow, caption "CATEGORY — MATERIAL" separated by a 24px teal line, thumbnail strip (inactive at 50% opacity, active 2px teal outline).
- No emoji, no gradients; icons are thin-stroke inline SVG.

## Motion: intro

The logo mark appears (scale .92→1), white crack lines are drawn on it, it shatters into 8 shards that fly outward, the dark crackle background fades in, "Isula Poterie" rises in, then the whole overlay lifts away (~4s total). Disabled under `prefers-reduced-motion`.

Timeline: mark in 0–0.7s · cracks drawn at 0.6s · shatter 1.05–2.15s (shards scale to 0.6, rotate ±14–49°, fade out) · background crackle fades in from scale 1.12, 1.05–2.55s · wordmark (Almendra Bold 88px, `#ecebf0`) rises 18px and fades in at 1.8s · overlay slides up (`translateY(-100%)`) at 3.1s over 0.9s.

## Business card

85×55 ratio. **Recto**: crackle-dark, teal mark + stacked wordmark, 6px `#008896` stripe at the bottom. **Verso**: crackle-light, diagonal glaze-photo panel on the left, small dark mark top right, "KATIA PERSECHINO" (Zalando 600, +0.14em), 56px teal rule, email and website in Zalando 300. Source and export: [`business-card/card.html`](../business-card/card.html) (see [`business-card/README.md`](../business-card/README.md)).

## Voice

French, first person, warm and modest (e.g. "Pas facile de parler de soi et de sa passion.", "J'aime le contact avec l'argile…"). Materials are named simply: Grès, Faïence. Categories: Bols - Coupelles · Plats · Vases · Autres - Divers.
