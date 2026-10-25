"""Static export: turn the local gallery into a folder of plain files.

    python -m animadex export-static

writes `static_site/dist/` (deploy that to Cloudflare Pages) and
`static_site/r2/` (upload that to an R2 bucket). Nothing here touches the
live database or the Flask routes -- it only reads.

What goes where
    dist/index.html           landing page (fixed collage)
    dist/gallery/index.html   the gallery shell (same app.js as local)
    dist/c/<slug>/            per-character pages
    dist/data/<mode>.<h>.json one compact, content-hashed JSON per dataset
    dist/thumbs/<mode>/<id>.webp
    dist/static/              css/js shared with the local site
    r2/<mode>/<id>.png        full-size images (hard links when possible)

Browsing in the static build is done client-side by
`static_site/static-data.js`, which answers the same `/api/...` calls the
local frontend makes, from those JSON files.

Local-only things (admin, contact form, redo list, custom entries, dev
tools) are simply not rendered -- the templates drop them when they get
`static_site=True`.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import random
import re
import shutil
import tomllib
from pathlib import Path

from .. import db
from ..config import REPO_ROOT, Config
from ..images import (copyright_thumb_filename, full_path, thumb_path)
from ..routes.pages import _format_count, TAG_LIMIT, TAGS_PREVIEW_N

ROOT = Path(REPO_ROOT) / 'static_site'
SETTINGS_FILE = ROOT / 'site.toml'
EXCLUDE_FILE = ROOT / 'exclude.txt'
ADAPTER_JS = ROOT / 'static-data.js'

MODES = ('characters', 'artists', *db.KINDS)


# --- small helpers -------------------------------------------------------

def _fid(mode: str, slug: str) -> str:
    """Opaque, filesystem- and URL-safe id for an item's files."""
    return hashlib.sha1(f'{mode}/{slug}'.encode('utf-8')).hexdigest()[:12]


def _write(path: Path, data: str | bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, str):
        data = data.encode('utf-8')
    path.write_bytes(data)


def _unchanged(src: str, dst: Path) -> bool:
    try:
        s, d = os.stat(src), dst.stat()
    except FileNotFoundError:
        return False
    return d.st_size == s.st_size and d.st_mtime >= s.st_mtime


def _copy(src: str, dst: Path) -> None:
    if _unchanged(src, dst):
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def _link(src: str, dst: Path) -> None:
    """Hard-link (free on the same drive); fall back to a copy."""
    if _unchanged(src, dst):
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.unlink()
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def _prune(folder: Path, keep: set[str]) -> int:
    n = 0
    if folder.is_dir():
        for f in folder.iterdir():
            if f.is_file() and f.name not in keep:
                f.unlink()
                n += 1
    return n


def _page_slug(slug: str, taken: set[str]) -> str:
    base = re.sub(r'[^A-Za-z0-9._()-]+', '-', slug).strip('-.') or 'x'
    out = base
    if out.lower() in taken:
        out = f'{base}-{hashlib.sha1(slug.encode()).hexdigest()[:6]}'
    taken.add(out.lower())
    return out


def load_settings() -> dict:
    if SETTINGS_FILE.is_file():
        with open(SETTINGS_FILE, 'rb') as f:
            return tomllib.load(f)
    return {}


def load_excludes(path: Path = EXCLUDE_FILE) -> tuple[set, set]:
    """Return ({(mode, slug)}, {copyright slug}). Lines: `mode/slug` or
    `series/<copyright slug>`; `#` starts a comment."""
    items, series = set(), set()
    if not path.is_file():
        return items, series
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.split('#', 1)[0].strip()
        if not line or '/' not in line:
            continue
        head, slug = line.split('/', 1)
        head, slug = head.strip().lower(), slug.strip()
        if head == 'series':
            series.add(slug)
        elif head in MODES:
            items.add((head, slug))
    return items, series


# --- reading the database ------------------------------------------------

def _rows(conn, mode: str):
    if mode == 'characters':
        return conn.execute(
            'SELECT character AS slug, name, copyright, copyright_name, '
            'trigger, core_tags, count, url, thumbname, imgname, '
            'image_version, custom FROM characters ORDER BY rowid')
    if mode == 'artists':
        return conn.execute(
            'SELECT artist AS slug, name, trigger, count, url, score, '
            'thumbname, imgname, image_version, custom '
            'FROM artists ORDER BY rowid')
    return conn.execute(
        f'SELECT slug, name, tags, ord, thumbname, imgname, image_version, '
        f'custom FROM {mode} ORDER BY rowid')


def _category_map(conn, mode: str):
    """-> (ordered category names, {slug: [names]})"""
    if mode == 'artists':
        names = [r[0] for r in conn.execute(
            'SELECT name FROM categories ORDER BY name')]
        pairs = conn.execute(
            'SELECT artist, category FROM artist_categories')
    elif mode in db.KINDS:
        names = sorted({r[0] for r in conn.execute(
            f'SELECT category FROM {mode}_categories')})
        pairs = conn.execute(f'SELECT slug, category FROM {mode}_categories')
    else:
        return [], {}
    per = {}
    for slug, cat in pairs:
        per.setdefault(slug, []).append(cat)
        if cat not in names:
            names.append(cat)
    return names, per


# --- the export ----------------------------------------------------------

class Export:
    def __init__(self, cfg: Config, *, out: Path, r2: Path, site_url='',
                 img_base='', contact_email='', full_images=True,
                 pages=True, exclude=None):
        self.cfg = cfg
        self.out = out
        self.r2 = r2
        self.site_url = site_url.rstrip('/')
        self.img_base = img_base.rstrip('/')
        self.contact_email = contact_email
        self.full_images = full_images
        self.pages = pages
        self.ex_items, self.ex_series = exclude or (set(), set())
        self.stats: dict[str, dict] = {}
        self.char_rows: list[dict] = []     # for pages + landing + sitemap

    # -- per-dataset ------------------------------------------------------
    def _asset(self, mode, row):
        """Copy the thumb (+ link the full image). -> (file id, ext) or
        None when the item has no thumbnail yet."""
        thumb = thumb_path(self.cfg, mode, row['thumbname'])
        if not os.path.isfile(thumb):
            return None
        fid = _fid(mode, row['slug'])
        _copy(thumb, self.out / 'thumbs' / mode / f'{fid}.webp')
        ext = ''
        if self.full_images:
            full = full_path(self.cfg, mode, row['imgname'])
            if os.path.isfile(full):
                ext = os.path.splitext(row['imgname'])[1].lstrip('.') or 'png'
                _link(full, self.r2 / mode / f'{fid}.{ext}')
        return fid, ext

    def dataset(self, conn, mode):
        names, per_cat = _category_map(conn, mode)
        cat_idx = {n: i for i, n in enumerate(names)}
        traits, trait_idx, per_trait = [], {}, {}
        if mode == 'characters':
            for r in conn.execute('SELECT character, facet, value, label '
                                  'FROM traits ORDER BY facet, value'):
                key = (r['facet'], r['value'], r['label'])
                if key not in trait_idx:
                    trait_idx[key] = len(traits)
                    traits.append(list(key))
                per_trait.setdefault(r['character'], []).append(
                    trait_idx[key])

        rows, keep, skipped, excluded = [], set(), 0, 0
        for r in _rows(conn, mode):
            slug = r['slug']
            if (mode, slug) in self.ex_items or (
                    mode == 'characters'
                    and r['copyright'] in self.ex_series):
                excluded += 1
                continue
            asset = self._asset(mode, r)
            if asset is None:
                skipped += 1
                continue
            fid, ext = asset
            keep.add(f'{fid}.webp')
            v, custom = int(r['image_version'] or 0), int(r['custom'] or 0)
            cats = [cat_idx[c] for c in per_cat.get(slug, [])]
            if mode == 'characters':
                rows.append([slug, r['name'], r['copyright'],
                             r['copyright_name'], r['trigger'],
                             r['core_tags'] or '', int(r['count'] or 0),
                             r['url'] or '', fid, v, ext, custom,
                             per_trait.get(slug, [])])
                self.char_rows.append(dict(r) | {'fid': fid, 'ext': ext})
            elif mode == 'artists':
                rows.append([slug, r['name'], r['trigger'],
                             int(r['count'] or 0), r['url'] or '',
                             r['score'], fid, v, ext, custom, cats])
            else:
                rows.append([slug, r['name'], r['tags'] or '', r['ord'],
                             fid, v, ext, custom, cats])

        shard = {'mode': mode, 'rows': rows}
        if mode == 'characters':
            shard['traits'] = traits
            shard['copyrights'] = self._copyright_thumbs(conn, rows)
            keep_cp = {f'{c[1]}.webp' for c in shard['copyrights']}
            _prune(self.out / 'thumbs' / 'copyrights', keep_cp)
        else:
            shard['categories'] = names
        _prune(self.out / 'thumbs' / mode, keep)
        self.stats[mode] = {'exported': len(rows), 'no_thumb': skipped,
                            'excluded': excluded}
        return shard

    def _copyright_thumbs(self, conn, rows):
        """[[copyright slug, file id, version]] for the series that have a
        collage and still have at least one exported character."""
        live = {r[2] for r in rows}
        out = []
        for slug in sorted(live):
            src = thumb_path(self.cfg, 'copyrights',
                             copyright_thumb_filename(slug))
            if not os.path.isfile(src):
                continue
            fid = _fid('copyrights', slug)
            _copy(src, self.out / 'thumbs' / 'copyrights' / f'{fid}.webp')
            out.append([slug, fid, db.copyright_version(
                conn, copyright_thumb_filename(slug))])
        return out

    # -- orchestration ----------------------------------------------------
    def run(self, app) -> dict:
        for sub in ('data', 'c', 'gallery', 'static'):
            shutil.rmtree(self.out / sub, ignore_errors=True)
        conn = db.connect_ro(self.cfg.paths.database)
        try:
            manifest = {'page_size': self.cfg.gallery.page_size,
                        'img_base': self.img_base, 'shards': {}}
            for mode in MODES:
                shard = self.dataset(conn, mode)
                blob = json.dumps(shard, ensure_ascii=False,
                                  separators=(',', ':'))
                h = hashlib.sha1(blob.encode('utf-8')).hexdigest()[:10]
                _write(self.out / 'data' / f'{mode}.{h}.json', blob)
                manifest['shards'][mode] = f'/data/{mode}.{h}.json'
            counts = (len(self.char_rows),
                      self.stats['artists']['exported'])
            self._static_files()
            self._pages(app, conn, manifest, counts)
        finally:
            conn.close()
        self._extras()
        return self.stats

    def _static_files(self):
        src = Path(__file__).resolve().parents[1] / 'static'
        shutil.copytree(src, self.out / 'static',
                        ignore=shutil.ignore_patterns('redo.js'))
        if not ADAPTER_JS.is_file():
            raise SystemExit(f'missing {ADAPTER_JS}')
        shutil.copy2(ADAPTER_JS, self.out / 'static' / 'static-data.js')

    def _pages(self, app, conn, manifest, counts):
        from flask import render_template
        site = self.site_url
        with app.test_request_context('/'):
            _write(self.out / 'gallery' / 'index.html', render_template(
                'index.html', static_site=True, dev=False,
                static_data=manifest, contact_email=self.contact_email))
            _write(self.out / 'index.html', render_template(
                'landing.html', static_site=True, gallery_url='/gallery/',
                site_url=site or None, collage=self._collage(),
                char_count=_format_count(counts[0]),
                artist_count=_format_count(counts[1])))
            if not self.pages:
                return
            taken: set[str] = set()
            self.page_urls = []
            for r in sorted(self.char_rows, key=lambda r: -(r['count'] or 0)):
                slug = r['slug']
                folder = _page_slug(slug, taken)
                tags = [t.strip() for t in (r['core_tags'] or '').split(',')
                        if t.strip()][:TAG_LIMIT]
                thumb = self._thumb_url('characters', r)
                full = (self._img_url('characters', r) or thumb)
                page_url = f'{site}/c/{folder}/'
                row = dict(r, character=slug)
                _write(self.out / 'c' / folder / 'index.html',
                       render_template(
                           'character.html', static_site=True, c=row,
                           tags=tags, tag_count=len(tags),
                           tags_preview=', '.join(tags[:TAGS_PREVIEW_N]),
                           loras=[], thumb_url=site + thumb,
                           img_url=full if full.startswith('http')
                           else site + full,
                           count_fmt=f"{int(r['count'] or 0):,}",
                           site_origin=site, page_url=page_url,
                           gallery_url='/gallery/'))
                self.page_urls.append((page_url, r['image_version']))

    # -- url builders (mirror static-data.js) -----------------------------
    @staticmethod
    def _v(version):
        v = int(version or 0)
        return f'?v={v}' if v else ''

    def _thumb_url(self, mode, r):
        return f'/thumbs/{mode}/{r["fid"]}.webp{self._v(r["image_version"])}'

    def _img_url(self, mode, r):
        if not (self.img_base and r['ext']):
            return ''
        return (f'{self.img_base}/{mode}/{r["fid"]}.{r["ext"]}'
                f'{self._v(r["image_version"])}')

    def _collage(self, n_char=14, n_artist=6):
        rng = random.Random(7)
        top = sorted(self.char_rows, key=lambda r: -(r['count'] or 0))[:300]
        pool = [('characters', r) for r in rng.sample(top, min(n_char,
                                                               len(top)))]
        items = []
        for mode, r in pool:
            blur = 0.0 if rng.random() < 0.45 else round(
                rng.uniform(1.5, 5), 1)
            items.append({
                'url': self._thumb_url(mode, r),
                'top': round(rng.uniform(-4, 88), 1),
                'left': round(rng.uniform(-5, 92), 1),
                'w': rng.randint(110, 230),
                'opacity': round(rng.uniform(0.22, 0.5), 2),
                'blur': blur, 'rotate': rng.randint(-6, 6)})
        rng.shuffle(items)
        return items

    def _extras(self):
        _write(self.out / '_headers',
               '/data/*\n  Cache-Control: public, max-age=31536000, '
               'immutable\n'
               '/thumbs/*\n  Cache-Control: public, max-age=31536000, '
               'immutable\n'
               '/static/*\n  Cache-Control: public, max-age=3600\n')
        _write(self.out / 'robots.txt', 'User-agent: *\nAllow: /\n'
               + (f'Sitemap: {self.site_url}/sitemap.xml\n'
                  if self.site_url else ''))
        if self.site_url and getattr(self, 'page_urls', None):
            body = ['<?xml version="1.0" encoding="UTF-8"?>',
                    '<urlset xmlns="http://www.sitemaps.org/schemas/'
                    'sitemap/0.9">',
                    f'  <url><loc>{self.site_url}/</loc></url>']
            for loc, v in self.page_urls:
                last = (f'<lastmod>{dt.datetime.fromtimestamp(v, dt.timezone.utc):%Y-%m-%d}</lastmod>'
                        if v else '')
                body.append(f'  <url><loc>{loc}</loc>{last}</url>')
            body.append('</urlset>')
            _write(self.out / 'sitemap.xml', '\n'.join(body))


def export_static(cfg: Config, *, out=None, site_url=None, img_base=None,
                  contact_email=None, full_images=True, pages=True,
                  exclude_file=None) -> dict:
    from ..app import create_app
    s = load_settings()
    out = Path(out) if out else ROOT / 'dist'
    exp = Export(
        cfg, out=out, r2=ROOT / 'r2',
        site_url=site_url if site_url is not None else s.get('site_url', ''),
        img_base=img_base if img_base is not None else s.get('img_base', ''),
        contact_email=(contact_email if contact_email is not None
                       else s.get('contact_email', '')),
        full_images=full_images, pages=pages,
        exclude=load_excludes(Path(exclude_file) if exclude_file
                              else EXCLUDE_FILE))
    return exp.run(create_app(cfg))
