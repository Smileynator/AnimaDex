"""`python -m animadex <subcommand>` -- the single entry point.

Subcommands:
    serve       Start the Flask web app.
    pipeline    Per-row pipeline driver (ingest + generate + thumb + score).
    build-db    CSV -> SQLite upsert in bulk (no image work).
    build-thumbs Build any missing thumbnails / copyright collages.
    score       Score every artist with no score yet.
    sync-loras  Pull character LoRAs from CivitAI.
    export-static Build the read-only static site (Cloudflare Pages).
    genkey      Print a fresh hex secret_key for config.toml.
    db-init     Create the schema + data dirs without doing anything else.

Run `python -m animadex <subcommand> --help` for per-command options.
"""

from __future__ import annotations

import argparse
import os
import secrets
import sys

from . import db
from .config import REPO_ROOT, ensure_dirs, load as load_config


def _cmd_serve(args):
    from .app import create_app
    cfg = load_config()
    app = create_app(cfg)
    app.run(host=cfg.server.host, port=cfg.server.port,
            debug=cfg.server.debug, threaded=True)


def _cmd_pipeline(args):
    from .pipeline.orchestrator import run_csv
    cfg = load_config()
    ensure_dirs(cfg)
    only = (s.strip() for s in args.rows.split(',')) if args.rows else None
    only = [s for s in only if s] if only else None
    summary = run_csv(cfg, args.csv, args.mode,
                       limit=args.limit, only_slugs=only,
                       dry_run=args.dry_run)
    print(f'\nProcessed {summary["processed"]} rows, failed '
          f'{summary["failed"]}.')


def _cmd_build_db(args):
    from .pipeline.ingest import build_db as bulk_ingest
    cfg = load_config()
    ensure_dirs(cfg)
    conn = db.connect_rw(cfg.paths.database)
    try:
        count = bulk_ingest(conn, args.csv, args.mode,
                            keep_existing=args.keep_existing)
        what = 'Added' if args.keep_existing else 'Upserted'
        print(f'{what} {count} {args.mode} from {args.csv}.')
    finally:
        conn.close()


def _cmd_build_thumbs(args):
    from .pipeline.thumbnails import (build_all_for_mode,
                                       build_copyright_collages)
    cfg = load_config()
    ensure_dirs(cfg)
    if args.mode in ('all', 'characters'):
        build_all_for_mode(cfg, 'characters')
    if args.mode in ('all', 'artists'):
        build_all_for_mode(cfg, 'artists')
    for kind in db.KINDS:
        if args.mode in ('all', kind):
            build_all_for_mode(cfg, kind)
    if args.mode in ('all', 'copyrights') and args.csv:
        n = build_copyright_collages(cfg, args.csv)
        print(f'Built {n} copyright collages.')


def _cmd_score(args):
    from .pipeline.scoring import score_all_pending
    cfg = load_config()
    if not cfg.features.scoring_enabled:
        print('[scoring] features.scoring_enabled is false in config.toml; '
              'running anyway. Set it to true to integrate scoring with '
              'the pipeline orchestrator.', file=sys.stderr)
    score_all_pending(cfg, limit=args.limit)


def _cmd_sync_loras(args):
    from .pipeline.loras import sync
    cfg = load_config()
    sync(cfg, full=args.full)


def _cmd_redo(args):
    from .pipeline.redo import process_pending
    cfg = load_config()
    done, failed = process_pending(cfg, limit=args.limit)
    print(f'Redo: {done} done, {failed} failed.')


def _cmd_export_static(args):
    from .pipeline.static_export import export_static
    cfg = load_config()
    stats = export_static(
        cfg, out=args.out, site_url=args.site_url, img_base=args.img_base,
        contact_email=args.contact_email,
        full_images=not args.no_full_images, pages=not args.no_pages,
        exclude_file=args.exclude)
    for mode, st in stats.items():
        print(f'  {mode:12} {st["exported"]:6} exported'
              f'  ({st["no_thumb"]} without thumbnail, '
              f'{st["excluded"]} excluded)')
    print('\nDone. Deploy static_site/dist to Cloudflare Pages; upload '
          'static_site/r2 to R2 (see static_site/README.md).')


def _cmd_genkey(args):
    print(secrets.token_hex(32))


def _cmd_db_init(args):
    cfg = load_config()
    ensure_dirs(cfg)
    conn = db.connect_rw(cfg.paths.database)
    conn.close()
    print(f'Schema applied: {cfg.paths.database}')


def main(argv=None):
    p = argparse.ArgumentParser(prog='animadex',
                                description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)

    s = sub.add_parser('serve', help='Start the Flask web app.')
    s.set_defaults(func=_cmd_serve)

    s = sub.add_parser('pipeline',
                       help='Per-row pipeline (ingest + image + thumb + score).')
    s.add_argument('csv', help='Path to a characters or artists CSV.')
    s.add_argument('--mode', choices=('characters', 'artists'),
                   required=True)
    s.add_argument('--limit', type=int, default=0,
                   help='Stop after N rows (0 = all).')
    s.add_argument('--rows',
                   help='Comma-separated slugs to process; others skipped.')
    s.add_argument('--dry-run', action='store_true',
                   help='Print the plan, run nothing.')
    s.set_defaults(func=_cmd_pipeline)

    s = sub.add_parser('build-db',
                       help='Bulk CSV -> SQLite upsert; no image work.')
    s.add_argument('csv')
    s.add_argument('--mode', required=True,
                   choices=('characters', 'artists', *db.KINDS))
    s.add_argument('--keep-existing', action='store_true',
                   help='Database is leading: only insert rows that are '
                        'missing, never overwrite existing ones.')
    s.set_defaults(func=_cmd_build_db)

    s = sub.add_parser('build-thumbs',
                       help='Build any missing thumbnails and collages.')
    s.add_argument('--mode',
                   choices=('all', 'characters', 'artists', 'copyrights',
                            *db.KINDS),
                   default='all')
    s.add_argument('--csv',
                   help='Character CSV (required for the copyrights step).')
    s.set_defaults(func=_cmd_build_thumbs)

    s = sub.add_parser('score',
                       help='Run artwork-scorer over unscored artists.')
    s.add_argument('--limit', type=int, default=0)
    s.set_defaults(func=_cmd_score)

    s = sub.add_parser('redo',
                       help='Render queued "redo with custom prompt" items.')
    s.add_argument('--limit', type=int, default=0,
                   help='Stop after N items (0 = all pending).')
    s.set_defaults(func=_cmd_redo)

    s = sub.add_parser('sync-loras', help='Pull LoRAs from CivitAI.')
    s.add_argument('--full', action='store_true',
                   help='Ignore the stored timestamp; full re-sync.')
    s.set_defaults(func=_cmd_sync_loras)

    s = sub.add_parser('export-static',
                       help='Write the read-only static site to '
                            'static_site/dist (for Cloudflare Pages).')
    s.add_argument('--out', help='Output folder (default static_site/dist).')
    s.add_argument('--site-url',
                   help='Public origin, e.g. https://anima.example.com '
                        '(canonical links + sitemap). Overrides site.toml.')
    s.add_argument('--img-base',
                   help='Public URL of the R2 images bucket, e.g. '
                        'https://img.example.com . Without it the static '
                        'site shows thumbnails only.')
    s.add_argument('--contact-email',
                   help='Shown as a mailto: link in the footer.')
    s.add_argument('--exclude',
                   help='Exclude list (default static_site/exclude.txt).')
    s.add_argument('--no-full-images', action='store_true',
                   help='Skip linking full-size images into static_site/r2.')
    s.add_argument('--no-pages', action='store_true',
                   help='Skip the per-character pages.')
    s.set_defaults(func=_cmd_export_static)

    s = sub.add_parser('genkey',
                       help='Print a fresh hex secret_key for config.toml.')
    s.set_defaults(func=_cmd_genkey)

    s = sub.add_parser('db-init',
                       help='Create the schema and data folders.')
    s.set_defaults(func=_cmd_db_init)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == '__main__':
    main()
