"""Local-only add / remove of your own items (any dataset).

Same access rules as the redo tool (see routes/redo.py): only requests
coming straight from this PC; never through the tunnel.

* add    -> inserts the item (custom = 1) and queues its first render
            through the redo queue, so the generation runner picks it up.
* remove -> only items you added yourself; built-in items are refused.
            The image is moved into a `_bin` folder, never erased.
"""

from __future__ import annotations

import os
import re

from flask import (Blueprint, abort, current_app, jsonify, make_response,
                   request)

from .. import db
from ..images import full_path, thumb_path, thumb_url
from ..pipeline import ingest
from ..pipeline import redo as engine
from .redo import _local_only, _no_store, _rw, _write_guard

custom_bp = Blueprint('custom', __name__)

KEY = {'characters': 'character', 'artists': 'artist',
       **{k: 'slug' for k in db.KINDS}}


def _fail(message, code=400):
    abort(make_response(jsonify(error=message), code))


def _slugify(s: str, sep: str = '-') -> str:
    return re.sub(r'[^a-z0-9]+', sep, s.lower()).strip(sep)


def _clean(body, key, maxlen, required=False):
    v = body.get(key)
    v = (v if isinstance(v, str) else '').strip()
    if required and not v:
        _fail(f'"{key}" is required')
    if len(v) > maxlen:
        _fail(f'"{key}" is too long (max {maxlen})')
    return v


def _exists(conn, mode, slug) -> bool:
    return conn.execute(
        f'SELECT 1 FROM {mode} WHERE {KEY[mode]} = ?',
        (slug,)).fetchone() is not None


@custom_bp.route('/api/custom/add', methods=['POST'])
def add():
    _write_guard()
    body = request.get_json(silent=True) or {}
    mode = body.get('mode')
    if mode not in engine.MODES:
        _fail('unknown dataset')
    conn = _rw()
    try:
        if mode in db.KINDS:
            name = _clean(body, 'name', 120, required=True)
            tags = _clean(body, 'tags', 2000, required=True)
            cat = _clean(body, 'category', 60) or 'Custom'
            tags = re.sub(r'\s*,\s*', ', ', tags).strip(', ')
            base = 'custom-' + (_slugify(name) or 'item')
            slug, n = base, 2
            while _exists(conn, mode, slug):
                slug, n = f'{base}-{n}', n + 1
            ord_ = conn.execute(
                f'SELECT COALESCE(MAX(ord), 0) + 1 FROM {mode}'
            ).fetchone()[0]
            ingest.upsert_kind(conn, mode, {
                'slug': slug, 'name': name, 'tags': tags,
                'categories': cat, 'traits': ''}, ord_)
        elif mode == 'characters':
            name = _clean(body, 'name', 120, required=True)
            series = _clean(body, 'series', 120)
            core = re.sub(r'\s*,\s*', ', ',
                          _clean(body, 'core_tags', 2000)).strip(', ')
            nslug, sslug = _slugify(name, '_'), _slugify(series, '_')
            if not nslug:
                _fail('the name needs letters or numbers')
            slug = nslug + (f'_({sslug})' if sslug else '')
            trigger = name.lower() + (f', {series.lower()}' if series else '')
            clash = conn.execute(
                'SELECT character FROM characters WHERE character = ? '
                'OR trigger = ? OR (character = ? AND copyright = ?)',
                (slug, trigger, nslug, sslug or 'original')).fetchone()
            if clash:
                _fail(f'this character already exists as '
                      f'"{clash[0]}"', 409)
            ingest.upsert_character(conn, {
                'character': slug, 'copyright': sslug or 'original',
                'trigger': trigger, 'core_tags': core,
                'count': 0, 'url': ''})
        else:                                           # artists
            name = _clean(body, 'name', 120, required=True)
            trigger = re.sub(r'\s+', ' ', name.lower()).strip()
            slug = _slugify(trigger, '_')
            if not slug:
                _fail('the artist tag needs letters or numbers')
            if _exists(conn, mode, slug):
                _fail(f'an artist "{slug}" already exists', 409)
            ingest.upsert_artist(conn, {
                'artist': slug, 'trigger': trigger, 'count': 0, 'url': ''})

        conn.execute(f'UPDATE {mode} SET custom = 1 WHERE {KEY[mode]} = ?',
                     (slug,))
        # queue the first render (the runner / `animadex redo` picks it up);
        # the prompt text is captured now so it can still be edited with ↻
        row = engine.item_row(conn, mode, slug)
        d = engine.default_frame(mode, row)
        conn.execute(
            'INSERT OR REPLACE INTO redo(mode, slug, pre_text, post_text, '
            'tags_override, negative_extra, seed, status, error, created_at) '
            "VALUES (?,?,?,?,NULL,'',NULL,'pending','', "
            "strftime('%Y-%m-%d %H:%M:%S','now'))",
            (mode, slug, d['before'], d['after']))
        conn.commit()
    finally:
        conn.close()
    return _no_store(jsonify(ok=True, slug=slug))


@custom_bp.route('/api/entry', methods=['POST'])
def edit_entry():
    """Correct an entry itself: its display name and (tag-library sets
    only) its tags. The database is leading, so the next sync keeps this."""
    _write_guard()
    body = request.get_json(silent=True) or {}
    mode, slug = body.get('mode'), body.get('slug')
    if mode not in engine.MODES or not isinstance(slug, str):
        _fail('bad request')
    name = body.get('name')
    tags = body.get('tags')
    if name is None and tags is None:
        _fail('nothing to change')
    conn = _rw()
    try:
        key = KEY[mode]
        row = conn.execute(f'SELECT * FROM {mode} WHERE {key} = ?',
                           (slug,)).fetchone()
        if row is None:
            _fail('not found', 404)
        sets, params = [], []
        new_name = row['name']
        if name is not None:
            new_name = _clean({'name': name}, 'name', 120, required=True)
            sets += ['name = ?', 'name_lower = ?']
            params += [new_name, new_name.lower()]
        if tags is not None:
            if mode not in db.KINDS:
                _fail('tags can only be edited for poses, clothing, '
                      'backgrounds and expressions')
            new_tags = re.sub(r'\s*,\s*', ', ',
                              _clean({'tags': tags}, 'tags', 2000,
                                     required=True)).strip(', ')
            sets.append('tags = ?')
            params.append(new_tags)
        if mode in db.KINDS:                        # keep search text in sync
            cur_tags = new_tags if tags is not None else row['tags']
            cats = ' '.join(r[0] for r in conn.execute(
                f'SELECT category FROM {mode}_categories WHERE slug = ?',
                (slug,)))
            sets.append('search_blob = ?')
            params.append(' '.join((slug, new_name, cur_tags, cats)).lower())
        conn.execute(f'UPDATE {mode} SET {", ".join(sets)} WHERE {key} = ?',
                     params + [slug])
        if tags is not None:
            # the entry now holds the corrected tags; a leftover override
            # would only hide that, so drop it
            conn.execute('UPDATE redo SET tags_override = NULL '
                         'WHERE mode = ? AND slug = ?', (mode, slug))
        conn.commit()
    finally:
        conn.close()
    return _no_store(jsonify(ok=True))


@custom_bp.route('/api/custom/remove', methods=['POST'])
def remove():
    _write_guard()
    body = request.get_json(silent=True) or {}
    mode, slug = body.get('mode'), body.get('slug')
    if mode not in engine.MODES or not isinstance(slug, str):
        _fail('bad request')
    cfg = current_app.config['ANIMADEX']
    conn = _rw()
    try:
        key = KEY[mode]
        row = conn.execute(
            f'SELECT imgname, thumbname, custom FROM {mode} '
            f'WHERE {key} = ?', (slug,)).fetchone()
        if row is None:
            _fail('not found', 404)
        if not row['custom']:
            _fail('built-in items cannot be removed', 403)
        conn.execute(f'DELETE FROM {mode} WHERE {key} = ?', (slug,))
        if mode in db.KINDS:
            conn.execute(f'DELETE FROM {mode}_categories WHERE slug = ?',
                         (slug,))
        elif mode == 'characters':
            conn.execute('DELETE FROM traits WHERE character = ?', (slug,))
        else:
            conn.execute('DELETE FROM artist_categories WHERE artist = ?',
                         (slug,))
        conn.execute('DELETE FROM redo WHERE mode = ? AND slug = ?',
                     (mode, slug))
        conn.commit()
    finally:
        conn.close()
    # files: image -> _bin (recoverable), thumbnail is just a cache
    src = full_path(cfg, mode, row['imgname'])
    if os.path.exists(src):
        bin_dir = os.path.join(os.path.dirname(src), '_bin')
        os.makedirs(bin_dir, exist_ok=True)
        os.replace(src, os.path.join(bin_dir, row['imgname']))
    thumb = thumb_path(cfg, mode, row['thumbname'])
    if os.path.exists(thumb):
        os.remove(thumb)
    return _no_store(jsonify(ok=True))


@custom_bp.route('/api/custom/list')
def list_custom():
    _local_only()
    mode = request.args.get('mode', '')
    if mode not in engine.MODES:
        abort(404)
    cfg = current_app.config['ANIMADEX']
    conn = _rw()
    try:
        key = KEY[mode]
        rows = conn.execute(
            f'SELECT {key} AS slug, name, imgname, image_version '
            f'FROM {mode} WHERE custom = 1 ORDER BY rowid DESC').fetchall()
        status = {r['slug']: r['status'] for r in conn.execute(
            'SELECT slug, status FROM redo WHERE mode = ?', (mode,))}
    finally:
        conn.close()
    items = [{
        'slug': r['slug'], 'name': r['name'],
        'has_image': os.path.exists(full_path(cfg, mode, r['imgname'])),
        'status': status.get(r['slug']),
        'thumb_url': thumb_url(mode, r['slug'], r['image_version']),
    } for r in rows]
    return _no_store(jsonify(items=items))
