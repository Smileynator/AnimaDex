"""Upload new / changed full-size images from static_site/r2 to the R2 bucket.

    python static_site/upload_r2.py            # upload what changed
    python static_site/upload_r2.py --seed     # just record the current state

Uses `wrangler r2 bulk put` (log in once with `npx wrangler login`), so no
extra tools or access keys are needed. A manifest (r2-uploaded.json, git-
ignored) remembers size + mtime of everything already uploaded, so only new
or regenerated images are sent. Files are never deleted from the bucket.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
R2 = HERE / 'r2'
MANIFEST = HERE / 'r2-uploaded.json'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bucket', default='animadex-img')
    ap.add_argument('--seed', action='store_true',
                    help='record the current files as uploaded, send nothing')
    ap.add_argument('--concurrency', type=int, default=20)
    args = ap.parse_args()

    done = json.loads(MANIFEST.read_text()) if MANIFEST.is_file() else {}
    now, todo = {}, []
    for f in sorted(R2.glob('*/*')):
        st = f.stat()
        key = f'{f.parent.name}/{f.name}'
        now[key] = [st.st_size, st.st_mtime_ns]
        if done.get(key) != now[key]:
            todo.append({'key': key, 'file': str(f)})

    if args.seed:
        MANIFEST.write_text(json.dumps(now))
        print(f'Recorded {len(now)} files as uploaded.')
        return
    if not todo:
        print('Nothing new to upload.')
        return

    print(f'Uploading {len(todo)} of {len(now)} files ...')
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as tmp:
        json.dump(todo, tmp)
    cmd = ['npx', 'wrangler', 'r2', 'bulk', 'put', args.bucket,
           '--filename', tmp.name, '--remote', '--concurrency',
           str(args.concurrency), '--content-type', 'image/png',
           '--cache-control', 'public, max-age=31536000, immutable', '-y']
    rc = subprocess.run(cmd, cwd=HERE.parent, shell=sys.platform == 'win32'
                        ).returncode
    Path(tmp.name).unlink(missing_ok=True)
    if rc:
        sys.exit(f'wrangler failed ({rc}); manifest not updated')
    MANIFEST.write_text(json.dumps(now))
    print('Done.')


if __name__ == '__main__':
    main()
