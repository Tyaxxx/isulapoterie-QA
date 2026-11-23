# Isula Poterie — showcase website

Showcase website for the Isula Poterie studio (bowls, small dishes, plates and vases in stoneware and earthenware). It is a **static** site: HTML, CSS and JavaScript, with no database, no build step and nothing to install. The "Réalisations" gallery is built from the photos stored in folders.

The website itself is in French (it is written for French-speaking visitors). Everything else in this project (tools, folder names, documentation) is in English, except the photo category folders and photo file names, because they become the titles and captions visitors see.

## Updating the photos (no developer skills needed)

1. Copy the photo into `photo-sources/<category>/`, for example `photo-sources/02-plats/`.
2. Name it `NN-material.jpg`: `09-gres.jpg` becomes the 9th photo of the category, with the caption "Grès". The number sets the order; `faience` becomes "Faïence" and `gres` becomes "Grès".
3. Double-click **`update-photos.bat`** (at the project root). The window shows a summary, for example:
   ```
   42 photos: 1 corrected, 41 unchanged, 0 deleted. Comparison: photo-comparison.html
   4 categories, 42 photos — photos.js updated.
   ```
   "Warning" lines point to a name or a photo to check.
4. Open **`photo-comparison.html`** (double-click) to see each photo before / after correction.
5. Reload the website in the browser (F5).

To remove a photo, delete it from `photo-sources/` and run the `.bat` again: its copy disappears from the website. The full guide (categories, `title.txt`, order, formats) is in [`photo-sources/README.txt`](photo-sources/README.txt).

> Never edit `website/photos/` or `photos.js` by hand: they are rebuilt every time the `.bat` runs.

## Project layout

```
katia_isula_poterie/
  README.md                this file
  update-photos.bat        double-click after every photo change
  branding/                brand guide (README.md), logo/, textures/ (crackle masters)
  photo-comparison.html    generated: photos before / after (not versioned)
  photo-sources/           THE ORIGINAL PHOTOS: the only photo folder to edit
    README.txt             photo guide
    01-bols-coupelles/  02-plats/  03-vases/  04-autres-divers/
  tools/                   PowerShell scripts (not part of the website)
    correct-photos.ps1     photo correction + SETTINGS block
    PhotoCorrection.cs     correction engine (C#, compiled at run time)
    generate-photos.ps1    generates website/photos/photos.js
    .cache/                generated: record of photos already corrected (not versioned)
  website/                 THE PUBLISHED SITE (this whole folder, and only this folder)
    index.html
    assets/                css/, js/site.js, fonts/, images/
    photos/                generated: corrected copies + photos.js
  tests/                   automated tests (developers)
  archives/                zip archives, including the raw photos (not versioned)
  business-card/           business card: card.html + export-card.bat (export/ not versioned)
```

## Automatic photo correction

The photos were taken at different times and in different light: some are dark, some bluish, some too bright. `update-photos.bat` gives them all the same light:

- **same backdrop**: the paper, measured along the edges of the photo, becomes the same very light grey (235 out of 255), perfectly neutral;
- **true colours**: the correction is computed from the backdrop only, then applied to the whole photo. The ratios between the red, green and blue of the pieces do not change;
- **protected highlights**: glaze highlights are softened below pure white instead of being blown out;
- a gentle black point and soft contrast, identical for every photo.

The photos in `photo-sources/` are **never modified**. The corrected copies go to `website/photos/`, rotated according to the camera orientation and stripped of metadata (EXIF, phone GPS position). Transparent areas of a PNG are filled with white. Only new or changed photos are recomputed. A photo removed from the sources is removed from the website. If `photo-sources/` is missing or empty, or if the source and output folders overlap, the tool stops without deleting anything.

**Turning the correction off for one photo**: add `.no-correction` before the extension, for example `07-gres.no-correction.jpg`. It is published as is, under the name `07-gres.jpg`.

**Tuning the look**: at the top of `tools/correct-photos.ps1`, the `SETTINGS` block is commented. The main settings:

| Setting | Default | Effect |
|---|---|---|
| `BackdropTarget` | 235 | backdrop grey after correction (245 = whiter backdrop) |
| `Strength` | 1.0 | 0 = no correction, 1 = full correction |
| `WhiteBalance` | 1.0 | 0 = keep the backdrop tint, 1 = perfectly grey backdrop |
| `Contrast` | 0.10 | gentle contrast below the backdrop (0 = none, 0.3 = strong) |
| `GainMax` / `GainMin` | 4.0 / 0.7 | maximum brightening / darkening; beyond that, the photo is flagged |
| `HighlightMax` | 250 | soft ceiling for highlights (255 = pure white) |
| `Border` | 0.06 | width of the edge band where the backdrop is measured (at most 0.45) |
| `JpegQuality` | 90 | quality of the published JPEGs |

After a settings change, the next run recomputes every photo. Then check `photo-comparison.html`.

## Previewing the site locally

Double-click `website/index.html`: the site works straight from the disk.

For a preview identical to the web host, start a small server (Python installed) from the project root:

```
python -m http.server 8000 --directory website
```

then open http://localhost:8000.

### On a phone (same Wi-Fi)

1. Start the server above on the PC.
2. Find the PC's address: in a command prompt, type `ipconfig` and note the "IPv4 Address" of the Wi-Fi adapter (for example `192.168.1.20`).
3. On the phone, open `http://192.168.1.20:8000`.
4. If Windows asks whether to allow Python through the firewall, allow it on **private networks**. Without this, the phone cannot connect.

## Publishing on GitHub Pages

GitHub Pages only publishes the repository root or its `/docs` folder, not `website/`. Three options (option 2 is set up: `.github/workflows/pages.yml`):

1. **Rename `website/` to `docs/`** and choose "Deploy from a branch → /docs" in the Pages settings. Simplest, but the `website` paths in `tools/`, `tests/` and this README must then be updated.
2. **A GitHub Actions workflow** that publishes the `website/` folder on every push (`actions/upload-pages-artifact` with `path: website`). Nothing needs renaming.
3. **A separate repository** containing only the site (the contents of `website/`).

Note: `photo-sources/` (the originals) is not versioned, so it never ends up in a public repository.

## Files not versioned (`.gitignore`)

- `photo-sources/` (except its `README.txt`): the originals, which may contain EXIF data and the phone's GPS position;
- `archives/` and `business-card/export/`, plus `*.zip` and `*.psd`: heavy working files, outside the website;
- `photo-comparison.html` and `tools/.cache/`: generated on each PC and rebuilt on the next run;
- editor and system files (`.claude/`, `.vscode/`, `Thumbs.db`, `desktop.ini`…).

`website/photos/` and `photos.js` **are** versioned: a clone of the repository contains the site ready to publish, but not the originals.

## For developers

- **No build and no npm dependency.** The tools are Windows PowerShell 5.1 scripts. Their `.ps1`, `.bat` and `.cs` files stay **ASCII** (PowerShell 5.1 reads BOM-less `.ps1` files as ANSI); accented characters in output are built with `[char]0x00E9`. Generated files are written as UTF-8 without BOM.
- `tools/PhotoCorrection.cs` is compiled on every run by `Add-Type` with Windows' **C# 5** compiler: no `$"..."` interpolation, no `?.`, no `nameof`.
- The cache (`tools/.cache/state.json`) maps each published photo to the SHA-256 fingerprint of its source, the settings and the engine. Changing `PhotoCorrection.cs` or `SETTINGS` invalidates everything. `correct-photos.ps1 -All` forces a full recompute.
- Both scripts take paths as parameters (`-SourceDir`, `-OutputDir`, `-StateFile`, `-ComparisonFile`; `-PhotosDir`, `-OutFile`), which the tests use.
- The website code (CSS classes, JS identifiers, comments) is in English; visible text, `aria-label`s and the URL anchors (`#accueil`, `#realisations`, `#contacts`, `#contenu`, category ids from folder names) stay in French.

Tests (Node.js 20 or later, `node:test`, no dependency):

```
node --test tests/
```

`tests/generate-photos.test.mjs` tests the `photos.js` generator. `tests/correct-photos.test.mjs` tests the correction on synthetic images created by `tests/images.ps1`, then on the 42 real photos.
