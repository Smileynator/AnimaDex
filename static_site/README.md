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
| `r2/` | full-size images, named `<mode>/<id>.png` (hard links, no extra disk) | **R2 bucket** (`upload_r2.py`) |
| `exclude.txt` | items to leave out (content pass) | read by the export |
| `site.toml` | your URLs and `skip_modes` (copy from `site.toml.example`) | read by the export |
| `static-data.js` | browser-side "API" that replaces Flask's `/api/...` | copied into `dist/static/` |

`dist/` and `r2/` are generated and git-ignored; re-run the export any time.
Re-running is incremental (unchanged thumbnails are not copied again).

## First-time setup

1. **Cloudflare account** (free). The site gets a free `<name>.pages.dev`
   address; a custom domain is optional.
2. **R2** needs a payment method on file even on the free plan (10 GB free).
   Create a bucket, then enable its public `r2.dev` address:
   `npx wrangler r2 bucket dev-url enable <bucket> -y`
3. **Settings:** copy `site.toml.example` to `site.toml`; set `img_base` to the
   bucket's public URL (no trailing slash) and `skip_modes` if you want to
   hold datasets back.
4. **Export:** `python -m animadex export-static`
5. **Upload images:** `python static_site/upload_r2.py` (first time `npx
   wrangler login`; later runs send only new or regenerated images).
6. **Deploy:**
   `npx wrangler pages deploy static_site/dist --project-name animadex --branch main`
   (create the project once with `npx wrangler pages project create animadex
   --production-branch main --force`).
7. **Optional content filter:** list items to leave out in `exclude.txt`.
   Series collage thumbnails are built from several characters, so rebuild a
   series' collage locally after excluding one of its characters.

## Leaving whole datasets out

`skip_modes = ["characters", "artists", "backgrounds"]` in `site.toml` (or
`--skip-modes characters,artists`) publishes only the other datasets. Their
tabs, data, thumbnails and pages are dropped, and the landing page adapts.
Remove an entry and re-export + redeploy to publish that dataset.

## Day to day

Generate/add things locally as usual, then:

```
python -m animadex export-static
python static_site/upload_r2.py
npx wrangler pages deploy static_site/dist --project-name animadex --branch main
```

## Limits to keep in mind (free plan)

- Pages: 20,000 files per deploy and 25 MB per file.
- Without `img_base` the site is thumbnails-only (no "Full image" button).
- Items without a thumbnail yet are skipped, not shown as placeholders.
- "Random" order differs from the local site's for the same seed (it is
  derived from database row ids); everything else matches.

## When you change things

The static build shares `animadex/static/app.js`, `style.css` and the
templates with the local site (templates check `static_site`). Search and
facet logic exists twice: SQL in `animadex/db.py` for the local site and
`static_site/static-data.js` for the static one. Change one, change the other.
