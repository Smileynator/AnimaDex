"""CSV -> SQLite ingest. Single-row callable; the orchestrator uses
`upsert_one()` per row, and the standalone `build-db` CLI command
batches through a whole CSV with a single transaction."""

from __future__ import annotations

import csv
import time
from pathlib import Path

from .. import db


def upsert_character(conn, csv_row: dict) -> dict | None:
    """Parse and upsert one character CSV row. Returns the parsed
    fields dict (suitable for downstream image/thumb steps) or None if
    the row was empty."""
    parsed = db.parse_character_row(csv_row)
    if parsed is None:
        return None
    fields, traits = parsed
    conn.execute(db.upsert_statement('characters', db.CSV_COLUMNS,
                                      'character'),
                 [fields[c] for c in db.CSV_COLUMNS])
    conn.execute('DELETE FROM traits WHERE character = ?',
                 (fields['character'],))
    if traits:
        conn.executemany(
            'INSERT INTO traits(character, facet, value, label) '
            'VALUES (?, ?, ?, ?)',
            [(fields['character'], fa, va, la) for (fa, va, la) in traits])
    return fields


def upsert_artist(conn, csv_row: dict) -> dict | None:
    fields = db.parse_artist_row(csv_row)
    if fields is None:
        return None
    conn.execute(db.upsert_statement('artists', db.ARTIST_CSV_COLUMNS,
                                      'artist'),
                 [fields[c] for c in db.ARTIST_CSV_COLUMNS])
    return fields


def upsert_kind(conn, kind: str, csv_row: dict, ord_: int) -> dict | None:
    parsed = db.parse_kind_row(csv_row, ord_)
    if parsed is None:
        return None
    fields, cats = parsed
    conn.execute(db.upsert_statement(kind, db.KIND_CSV_COLUMNS, 'slug'),
                 [fields[c] for c in db.KIND_CSV_COLUMNS])
    conn.execute(f'DELETE FROM {kind}_categories WHERE slug = ?',
                 (fields['slug'],))
    if cats:
        conn.executemany(
            f'INSERT OR IGNORE INTO {kind}_categories(slug, category) '
            'VALUES (?, ?)', [(fields['slug'], c) for c in cats])
    return fields


def upsert_one(conn, csv_row: dict, mode: str) -> dict | None:
    if mode == 'characters':
        return upsert_character(conn, csv_row)
    if mode == 'artists':
        return upsert_artist(conn, csv_row)
    raise ValueError(f'unknown mode {mode!r}')


_KEY = {'characters': 'character', 'artists': 'artist',
        **{k: 'slug' for k in db.KINDS}}


def build_db(conn, csv_path: str | Path, mode: str,
             keep_existing: bool = False) -> int:
    """Bulk ingest. Returns the count of rows upserted.

    keep_existing=True makes the database leading: rows that already exist
    are left exactly as they are (so edits made in the website survive) and
    only rows missing from the database are inserted."""
    count = 0
    existing: set[str] = set()
    if keep_existing:
        existing = {r[0] for r in conn.execute(
            f'SELECT {_KEY[mode]} FROM {mode}')}
    with conn:
        with open(csv_path, encoding='utf-8', newline='') as f:
            for i, row in enumerate(csv.DictReader(f)):
                if keep_existing and \
                        (row.get(_KEY[mode]) or '').strip() in existing:
                    continue
                if mode in db.KINDS:
                    ok = upsert_kind(conn, mode, row, i) is not None
                else:
                    ok = upsert_one(conn, row, mode) is not None
                if ok:
                    count += 1
        db.set_meta(conn, f'{mode}_built_at',
                    time.strftime('%Y-%m-%d %H:%M:%S'))
    return count
