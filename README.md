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
- `incoming-rename.gs` — Google Apps Script for auto-renaming and organising media uploads (see "Drive media auto-organiser" below)

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

## Drive media auto-organiser

Files dropped into the public "incoming" Drive folder are auto-renamed and moved into dated subfolders by a Google Apps Script. This keeps the upload UX simple (caretakers just drop) while keeping the archive organised.

### Setup (one-time)

The folder IDs are already baked into `incoming-rename.gs`:

- `INCOMING_FOLDER_ID` = `1rVcjffMahZgunWBBHu5vXFo3gJUlTd_s` (the `incoming` folder, shared as "anyone with link → editor")
- `ARCHIVE_PARENT_ID` = `1y3jm0QCAe57wcfm8fttFUXLUr00CCP5D` (the project folder root, where dated daily subfolders live)

To install the script in Apps Script:

1. Open https://script.google.com → **New project**.
2. Replace the default code with the contents of `incoming-rename.gs`.
3. **Save** (Cmd-S; name the project "sukumo media organiser").
4. Click **Run** → function `renameNewUploads`. First run prompts for Drive permissions; approve.
5. **Triggers** (clock icon in left sidebar) → **Add Trigger**:
   - Function: `renameNewUploads`
   - Event source: Time-driven
   - Type: Minutes timer
   - Every 5 minutes
   - Save.

### What it does

Every 5 minutes the script:

1. Lists files in `incoming/`.
2. For each file not already prefixed with `YYYY-MM-DD_`:
   - Renames `IMG_2034.jpg` to `2026-05-06_14-30_IMG_2034.jpg` (using the upload time).
   - Finds or creates a subfolder under the project folder root named after the date (e.g. `2026-05-06`). The Pi pre-created 547 dated subfolders for the project's 1.5-year lifespan, so most days the script just picks an existing folder.
   - Moves the file into that subfolder.
3. Files already prefixed are left alone (idempotent, safe to re-run).

The Pi-side `drive_backup.py` uploads CSVs into the same dated subfolders, so each day's folder ends up holding everything for that date: sensor CSVs, diary CSVs, and the day's media uploads.

### Verifying

Drop a test file into the `incoming/` folder. Within 5 minutes:
- The file should disappear from `incoming/`.
- The dated folder for today (e.g. `2026-05-06`) under the project folder should contain the renamed file.
- The Apps Script execution log (View → Logs) shows what was processed.
