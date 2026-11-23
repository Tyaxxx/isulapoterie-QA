# Business card

85 × 55 mm, "Atelier blanc" design (see [`branding/README.md`](../branding/README.md)).

## Edit

Open `card.html` in a text editor:
- **Text** (name, email, website): the lines marked `EDIT` near the end of the file.
- **Colours**: the variables at the top of `<style>` (`:root`).

Double-click `card.html` to preview it in the browser. The dashed line is where the card is cut. The lighter band outside it is the 3 mm bleed, printed and then cut off: keep text inside the dashed line.

## Export

Double-click **`export-card.bat`**. It writes to `export/`:

| File | Use |
|---|---|
| `card-front.png`, `card-back.png` | The two sides of the card, without bleed, 2550 × 1650 px (about 760 dpi at 85 × 55 mm). |

Needs Edge, Chrome or Brave installed. `export/` is rebuilt on every run and is not versioned.

## Files used

- Fonts: `website/assets/fonts/`
- Crackle textures: `branding/textures/`
- Glaze photo on the back: `glaze.png` (this folder)
