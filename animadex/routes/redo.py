"""Local-only "redo with a custom prompt" API.

Every endpoint refuses (404) unless the request comes straight from this
machine: loopback address, a localhost Host header, and none of the
headers a reverse proxy / Cloudflare tunnel adds.  A tunnel connects from
127.0.0.1 too, so the address alone is NOT enough.  Writes also require a
JSON body and a same-origin Origin header (blocks cross-site form posts).
"""

from __future__ import annotations

from urllib.parse import urlparse

from flask import Blueprint, abort, current_app, jsonify, request

from .. import db
from ..images import thumb_url
from ..pipeline import redo as engine

redo_bp = Blueprint('redo', __name__)

_PROXY_HEADERS = ('X-Forwarded-For', 'X-Forwarded-Host', 'X-Real-Ip',
                  'Forwarded', 'Cf-Connecting-Ip', 'Cf-Ray', 'Cf-Visitor',
                  'Cf-Ipcountry', 'Cdn-Loop')
_LOCAL_HOSTS = {'127.0.0.1', 'localhost', '::1'}
MAX_TEXT = 4000


def is_local() -> bool:
    if request.remote_addr not in ('127.0.0.1', '::1'):
        return False
    if any(h in request.headers for h in _PROXY_HEADERS):
        return False
    host = (urlparse('//' + request.host).hostname or '').lower()
    return host in _LOCAL_HOSTS


def _local_only():
    if not is_local():
        abort(404)


def _write_guard():
    _local_only()
    if not request.is_json:
        abort(415)
    origin = request.headers.get('Origin')
    if origin and urlparse(origin).netloc != request.host:
        abort(403)


def _no_store(resp):
    resp.headers['Cache-Control'] = 'no-store'
    return resp


def _rw():
    return db.connect_rw(current_app.config['ANIMADEX'].paths.database)


def _text(body, key, default=''):
    v = body.get(key, default)
    if v is None:
        return None
    if not isinstance(v, str) or len(v) > MAX_TEXT:
        abort(400)
    return v


@redo_bp.route('/api/redo/status')
def status():
    if not is_local():
        return _no_store(jsonify(local=False))
    conn = _rw()
    try:
        rows = conn.execute(
            'SELECT mode, slug, status FROM redo').fetchall()
    finally:
        conn.close()
    return _no_store(jsonify(
        local=True,
        pending=sum(1 for r in rows if r['status'] == 'pending'),
        marks={f"{r['mode']}:{r['slug']}": r['status'] for r in rows}))


@redo_bp.route('/api/redo/frame')
def get_frame():
    _local_only()
    mode, slug = request.args.get('mode', ''), request.args.get('slug', '')
    if mode not in engine.MODES:
        abort(404)
    conn = _rw()
    try:
        fr = engine.frame(conn, mode, slug)
        row = engine.item_row(conn, mode, slug)
    finally:
        conn.close()
    if fr is None:
        abort(404)
    fr['thumb_url'] = thumb_url(mode, slug, row['image_version'])
    return _no_store(jsonify(fr))


@redo_bp.route('/api/redo/list')
def list_items():
    _local_only()
    conn = _rw()
    try:
        rows = conn.execute(
            'SELECT mode, slug FROM redo ORDER BY '
            "CASE status WHEN 'pending' THEN 0 WHEN 'failed' THEN 1 "
            'ELSE 2 END, created_at DESC').fetchall()
        items = []
        for r in rows:
            fr = engine.frame(conn, r['mode'], r['slug'])
            row = engine.item_row(conn, r['mode'], r['slug'])
            if fr is None:
                continue
            fr['thumb_url'] = thumb_url(r['mode'], r['slug'],
                                        row['image_version'])
            items.append(fr)
    finally:
        conn.close()
    return _no_store(jsonify(items=items))


@redo_bp.route('/api/redo', methods=['POST'])
def save():
    _write_guard()
    body = request.get_json(silent=True) or {}
    mode, slug = body.get('mode'), body.get('slug')
    if mode not in engine.MODES or not isinstance(slug, str):
        abort(400)
    before = _text(body, 'before')
    after = _text(body, 'after')
    tags_override = _text(body, 'tags_override', None)
    negative_extra = _text(body, 'negative_extra') or ''
    seed = body.get('seed')
    if seed is not None:
        try:
            seed = int(seed)
        except (TypeError, ValueError):
            abort(400)
    conn = _rw()
    try:
        if engine.item_row(conn, mode, slug) is None:
            abort(404)
        conn.execute(
            'INSERT INTO redo(mode, slug, pre_text, post_text, tags_override, '
            "negative_extra, seed, status, error, created_at) "
            "VALUES (?,?,?,?,?,?,?, 'pending', '', "
            "strftime('%Y-%m-%d %H:%M:%S','now')) "
            'ON CONFLICT(mode, slug) DO UPDATE SET '
            'pre_text=excluded.pre_text, post_text=excluded.post_text, '
            'tags_override=excluded.tags_override, '
            'negative_extra=excluded.negative_extra, seed=excluded.seed, '
            "status='pending', error='', "
            "created_at=strftime('%Y-%m-%d %H:%M:%S','now'), done_at=NULL",
            (mode, slug, before, after, tags_override, negative_extra,
             seed))
        conn.commit()
    finally:
        conn.close()
    return _no_store(jsonify(ok=True))


@redo_bp.route('/api/redo/delete', methods=['POST'])
def delete():
    _write_guard()
    body = request.get_json(silent=True) or {}
    mode, slug = body.get('mode'), body.get('slug')
    if mode not in engine.MODES or not isinstance(slug, str):
        abort(400)
    conn = _rw()
    try:
        conn.execute('DELETE FROM redo WHERE mode = ? AND slug = ?',
                     (mode, slug))
        conn.commit()
    finally:
        conn.close()
    return _no_store(jsonify(ok=True))
