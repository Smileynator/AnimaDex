# Static build (Cloudflare Pages + R2)

A read-only copy of the gallery that needs no server: browsing, search and
filters run in the visitor's browser. The local Flask site is untouched and
keeps all its tools (admin, redo list, custom entries, dev mode, contact
form); none of those exist in the static build.

```
python -m animadex export-static
```

| Folder / file | What it is | Goes to |
|---|---|---|
| `dist/` | the whole site: HTML, JSON data, thumbnails, css/js | **Cloudflare Pages** |
| `r2/` | full-size images, named `<mode>/<id>.png` (hard links, no extra disk) | **R2 bucket** |
| `exclude.txt` | items to leave out (content pass) | read by the export |
| `site.toml` | your URLs and `skip_modes` (copy from `site.toml.example`) | read by the export |
| `static-data.js` | browser-side "API" that replaces Flask's `/api/...` | copied into `dist/static/` |

`dist/` and `r2/` are generated and git-ignored; re-run the export any time.
Re-running is incremental (unchanged thumbnails are not copied again).

## First-time setup

1. **Content pass.** List anything you don't want published in `exclude.txt`
   (`characters/<slug>`, `series/<copyright>`, ...; see the comments in the
   file). Note: series collage thumbnails are built from several characters,
   so after excluding a character, rebuild that series' collage locally.
2. **Cloudflare account + domain** (free account; the domain is the only cost).
3. **R2 bucket** for the images (dashboard -> R2 -> create bucket, e.g.
   `anima-img`). Enable public access via a custom domain such as
   `img.example.com` (dashboard -> bucket -> Settings -> Custom Domains).
   Add a CORS rule allowing `GET` so full images can open in the viewer.
4. **Settings:** copy `site.toml.example` to `site.toml` and fill in
   `site_url` and `img_base` (`https://img.example.com`).
5. **Export:** `python -m animadex export-static`.
6. **Upload images** (about 6 GB; one time, later runs only send changes):
   create an R2 API token, then with [rclone](https://rclone.org) configured
   for R2: `rclone copy static_site/r2 r2:anima-img --progress`
7. **Deploy the site:**
   `npx wrangler pages deploy static_site/dist --project-name animadex --branch main`
   (first run asks you to log in and creates the Pages project).
8. **Login in front (optional):** Zero Trust -> Access -> Applications ->
   Self-hosted, point it at the Pages domain, allow your e-mail list.
   Access can't cover the R2 domain unless you add it too; the image URLs are
   unguessable hashes, which is usually enough.

## Leaving whole datasets out

`skip_modes = ["characters", "artists", "backgrounds"]` in `site.toml` (or
`--skip-modes characters,artists`) publishes only the other datasets. Their
tabs, data, thumbnails and pages are dropped, and the landing page adapts.
Remove an entry and re-export + redeploy to publish that dataset.

## Day to day

Generate/add things locally as usual, then:

```
python -m animadex export-static
rclone copy static_site/r2 r2:anima-img
npx wrangler pages deploy static_site/dist --project-name animadex --branch main
```

## Limits to keep in mind (free plan)

- Pages: 20,000 files per deploy (currently ~8,500) and 25 MB per file.
- Without `img_base` the site is thumbnails-only (no "Full image" button).
- Items without a thumbnail yet are skipped, not shown as placeholders.
- "Random" order differs from the local site's for the same seed (it is
  derived from database row ids); everything else matches.

## When you change things

The static build shares `animadex/static/app.js`, `style.css` and the
templates with the local site (templates check `static_site`). Search and
facet logic exists twice: SQL in `animadex/db.py` for the local site and
`static_site/static-data.js` for the static one. Change one, change the other.
