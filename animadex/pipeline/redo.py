"""Per-image "redo with a custom prompt".

A redo entry stores the prompt text *around* the item's own tags (before /
after), optional extra negative tags and a seed.  The item's own tags --
the part the dataset requires -- are always inserted automatically at
generation time, so an override can never silently drop them (unless the
user explicitly unlocks and edits them).

`frame()` builds the editable view of one image (used by the website);
`process_pending()` renders every queued redo through ComfyUI, keeping the
previous image in `_previous/` next to the new one.
"""

from __future__ import annotations

import importlib.util
import os
import shutil
import sys
import time
import uuid
from argparse import Namespace
from pathlib import Path

from .. import db
from ..config import Config
from ..images import full_path, thumb_path

ROOT = Path(__file__).resolve().parents[2]
MODES = ('characters', 'artists', *db.KINDS)
_WORKFLOW = {m: 'AnimaGenArtist.json' for m in MODES}
_WORKFLOW['characters'] = 'AnimaGen.json'

_gen_module = None


def _gen():
    """Load scripts/generate_dataset.py once (it is a script, not a package;
    its main() is guarded so importing it has no side effects)."""
    global _gen_module
    if _gen_module is None:
        path = ROOT / 'scripts' / 'generate_dataset.py'
        spec = importlib.util.spec_from_file_location('generate_dataset',
                                                      path)
        mod = importlib.util.module_from_spec(spec)
        sys.modules['generate_dataset'] = mod
        spec.loader.exec_module(mod)
        _gen_module = mod
    return _gen_module


def _load_workflow(mode: str) -> dict:
    import json
    with open(ROOT / _WORKFLOW[mode], encoding='utf-8') as f:
        return json.load(f)


def _negative_node(workflow: dict) -> str | None:
    for node in workflow.values():
        if node.get('class_type') == 'KSampler':
            link = node['inputs'].get('negative')
            if isinstance(link, list):
                return str(link[0])
    return None


def default_negative(mode: str) -> str:
    wf = _load_workflow(mode)
    nid = _negative_node(wf)
    return wf[nid]['inputs'].get('text', '') if nid else ''


def _split(template: str, placeholders) -> tuple[str, str]:
    for p in placeholders:
        if p in template:
            before, after = template.split(p, 1)
            return before, after
    return template, ''


def item_row(conn, mode: str, slug: str):
    """The dataset row behind one image, or None."""
    if mode == 'characters':
        return conn.execute(
            'SELECT character AS slug, name, trigger, core_tags, imgname, '
            'thumbname, image_version FROM characters WHERE character = ?',
            (slug,)).fetchone()
    if mode == 'artists':
        return conn.execute(
            'SELECT artist AS slug, name, trigger, imgname, thumbname, '
            'image_version FROM artists WHERE artist = ?',
            (slug,)).fetchone()
    if mode in db.KINDS:
        return conn.execute(
            f'SELECT slug, name, tags, imgname, thumbname, image_version '
            f'FROM {mode} WHERE slug = ?', (slug,)).fetchone()
    return None


def default_frame(mode: str, row) -> dict:
    """What the normal run would send: (before, inserted, after, seed)."""
    gen = _gen()
    if mode == 'characters':
        wf = _load_workflow(mode)
        node = gen.find_prompt_node(wf)
        template = wf[node]['inputs']['text']
        before, after = _split(template, gen.PLACEHOLDERS)
        trigger = (row['trigger'] or '').strip()
        core = (row['core_tags'] or '').strip()
        tags = f'{trigger}, {core}' if core else trigger
        inserted = gen.sanitize_tags(tags)
        seed = gen.seed_for(trigger, 'character',
                            Namespace(seed=None, random_seed=False))
    elif mode == 'artists':
        before = ''
        inserted = '@' + (row['trigger'] or '').strip()
        after = ', ' + gen.ARTIST_SUBJECT
        seed = gen.ARTIST_SEED
    else:
        template = gen.kind_prompt(mode, '{tags}')
        before, after = _split(template, ('{tags}',))
        inserted = (row['tags'] or '').strip()
        seed = gen.ARTIST_SEED
    return {'before': before, 'inserted': inserted, 'after': after,
            'seed': seed}


def get_override(conn, mode: str, slug: str):
    return conn.execute(
        'SELECT * FROM redo WHERE mode = ? AND slug = ?',
        (mode, slug)).fetchone()


def frame(conn, mode: str, slug: str) -> dict | None:
    row = item_row(conn, mode, slug)
    if row is None:
        return None
    default = default_frame(mode, row)
    ov = get_override(conn, mode, slug)
    out = {
        'mode': mode, 'slug': slug, 'name': row['name'],
        'default': default,
        'default_negative': default_negative(mode),
        'before': default['before'], 'inserted': default['inserted'],
        'after': default['after'], 'seed': default['seed'],
        'negative_extra': '', 'tags_edited': False,
        'status': None, 'error': '', 'has_override': ov is not None,
    }
    if ov is not None:
        out['before'] = ov['pre_text']
        out['after'] = ov['post_text']
        out['negative_extra'] = ov['negative_extra'] or ''
        if ov['tags_override'] is not None:
            out['inserted'] = ov['tags_override']
            out['tags_edited'] = True
        if ov['seed'] is not None:
            out['seed'] = ov['seed']
        out['status'] = ov['status']
        out['error'] = ov['error'] or ''
    return out


def final_prompt(fr: dict) -> str:
    return fr['before'] + fr['inserted'] + fr['after']


# ---- processing ---------------------------------------------------------

def process_pending(cfg: Config, limit: int = 0, log=print) -> tuple[int, int]:
    """Render queued redos. Returns (done, failed)."""
    gen = _gen()
    conn = db.connect_rw(cfg.paths.database)
    base_url = cfg.generation.comfyui_url.rstrip('/')
    args = Namespace(poll_interval=2.0, timeout=900.0)
    done = failed = 0
    try:
        pending = conn.execute(
            "SELECT mode, slug FROM redo WHERE status = 'pending' "
            'ORDER BY created_at').fetchall()
        if not pending:
            return 0, 0
        try:
            gen.http_json(f'{base_url}/system_stats', timeout=15)
        except Exception as e:                       # noqa: BLE001
            log(f'redo: ComfyUI not reachable at {base_url} ({e}); '
                f'{len(pending)} left pending')
            return 0, 0
        for item in pending:
            if limit and done + failed >= limit:
                break
            mode, slug = item['mode'], item['slug']
            fr = frame(conn, mode, slug)
            row = item_row(conn, mode, slug)
            if fr is None or row is None:
                _finish(conn, mode, slug, 'failed', 'item no longer exists')
                failed += 1
                continue
            try:
                wf = _load_workflow(mode)
                node = gen.find_prompt_node(wf)
                if not node:
                    raise RuntimeError('no prompt placeholder in workflow')
                wf = gen.build_workflow(wf, node, gen.find_seed_nodes(wf),
                                        final_prompt(fr), int(fr['seed']))
                extra = (fr['negative_extra'] or '').strip()
                neg = _negative_node(wf)
                if extra and neg:
                    base = wf[neg]['inputs'].get('text', '').rstrip(', ')
                    wf[neg]['inputs']['text'] = f'{base}, {extra}'
                out = full_path(cfg, mode, row['imgname'])
                os.makedirs(os.path.dirname(out), exist_ok=True)
                prev_dir = os.path.join(os.path.dirname(out), '_previous')
                keep = None
                if os.path.exists(out):
                    os.makedirs(prev_dir, exist_ok=True)
                    keep = os.path.join(prev_dir, row['imgname'])
                    shutil.copy2(out, keep)
                gen.generate_one(base_url, str(uuid.uuid4()), wf, out, args)
                thumb = thumb_path(cfg, mode, row['thumbname'])
                if os.path.exists(thumb):
                    os.remove(thumb)
                _bump(conn, mode, slug)
                _finish(conn, mode, slug, 'done', '')
                done += 1
                log(f'redo: {mode}/{slug} done')
            except Exception as e:                   # noqa: BLE001
                _finish(conn, mode, slug, 'failed', str(e)[:400])
                failed += 1
                log(f'redo: {mode}/{slug} FAILED: {e}')
    finally:
        conn.close()
    return done, failed


def _bump(conn, mode, slug):
    v = int(time.time())
    if mode == 'characters':
        db.bump_character_version(conn, slug, v)
    elif mode == 'artists':
        db.bump_artist_version(conn, slug, v)
    else:
        db.bump_kind_version(conn, mode, slug, v)
    conn.commit()


def _finish(conn, mode, slug, status, error):
    conn.execute(
        'UPDATE redo SET status = ?, error = ?, '
        "done_at = strftime('%Y-%m-%d %H:%M:%S','now') "
        'WHERE mode = ? AND slug = ?', (status, error, mode, slug))
    conn.commit()
