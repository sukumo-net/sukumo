# Sukumo Vat Monitor — public landing page

Static landing page hosted on GitHub Pages. Contains:

- Live dashboard image (pulled from Drive when the Pi syncs)
- Recipe (the 30L vat process)
- Manual (how to submit diary entries)
- Build/sonification reference (OSC schema, examples)
- Links to the Google Form (submit), Google Sheet (view past entries), Drive folder (media + CSVs)

## Files

- `index.html` — single-page site
- `style.css` — Inconsolata-based, matches the Pi e-ink dashboard aesthetic
- `dashboard-placeholder.png` — fallback image; replaced at runtime by Pi-uploaded `dashboard.png`

## First-time deploy to GitHub Pages

1. Create a new GitHub repo named `sukumo` under your account (e.g. `sukumo-net/sukumo`).
2. Initialise locally and push the contents of this folder to the repo's `main` branch.
3. On GitHub: **Settings → Pages**.
4. **Source**: Deploy from a branch.
5. **Branch**: `main` / `/ (root)`.
6. Save. The site is live at `https://<username>.github.io/sukumo/` within a minute.

```bash
cd /Users/cat/Desktop/sukumo-monitor/site
git init
git add .
git commit -m "Initial public landing page"
git branch -M main
git remote add origin https://github.com/sukumo-net/sukumo.git
git push -u origin main
```

## Updating

Edit `index.html` locally, commit, push:

```bash
git add index.html
git commit -m "Update landing page"
git push
```

GitHub Pages rebuilds in ~30s.

## Placeholders to replace

`index.html` contains four placeholders that must be set after the Google content is created:

- `REPLACE_WITH_FORM_URL` — the public link to the Google Form (3 occurrences: contribute card, manual section step 1, manual subheader)
- `REPLACE_WITH_SHEET_URL` — the public link to the Google Sheet (2 occurrences: contribute card, data card)
- `REPLACE_WITH_DRIVE_FOLDER_URL` — the public link to the Drive folder (3 occurrences: contribute, data sensor csvs, data media folder)
- `dashboard-placeholder.png` (img src) — the public Drive URL for the live dashboard image

For the dashboard image, use the public Drive direct-image format:

```
https://drive.google.com/uc?export=view&id=YOUR_FILE_ID
```

The file ID is the long string in the Drive URL when you open the image.

## Pi-side companion

The Pi runs the sensor logger, dashboard renderer, OSC broadcaster, and:

- Uploads `dashboard.png` to Drive periodically (replaces the placeholder image on this site).
- Pulls new Form responses from the Google Sheet into its local diary CSV when it has internet.

Pi-side code lives in `../pi/`. See `../docs/MAINTENANCE.md` for deployment.

## Style notes

- Inconsolata mono via Google Fonts CDN (loaded in `<head>`).
- Single-page with anchor navigation. Sticky header.
- Same `style.css` palette as the Pi-side templates: indigo accent (`#1c2638`), grey-blue paper (`#eef1f4`), near-black ink (`#111`).
- Section markers (`// recipe`, `// data`, etc.) match the e-ink display labels.
