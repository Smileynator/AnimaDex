"""Load only the rows that already have a generated image into the gallery.

Safe to re-run while run_generation.py is still working: it builds subset
CSVs from the images that exist right now, upserts them, drops DB rows that
have no image (e.g. the install's sample seed), then builds missing
thumbnails and copyright collages.

Run:  .venv\\Scripts\\python.exe sync_gallery.py
"""
import csv
import os
import subprocess
import sys
from pathlib import Path

from animadex.config import load
from animadex import db
from animadex.db import sanitize_filename

ROOT = Path(__file__).resolve().parent
PY = sys.executable
cfg = load()
SUBSETS = ROOT / "subsets"
SUBSETS.mkdir(exist_ok=True)

MODES = {
    "characters": ("danbooru_character.csv", "character",
                   os.path.join(cfg.paths.characters_dir, "images")),
    "artists": ("danbooru_artist.csv", "artist",
                os.path.join(cfg.paths.artists_dir, "images")),
}
# tag-library sets: CSV rows are keyed by `slug`, image file = slug + .png
for _k in db.KINDS:
    MODES[_k] = (f"sources/{_k}.csv", "slug",
                 os.path.join(getattr(cfg.paths, f"{_k}_dir"), "images"))


def run(*args):
    subprocess.run([PY, "-m", "animadex", *args], cwd=ROOT, check=True)


for mode, (src, key, imgdir) in MODES.items():
    have = {n for n in os.listdir(imgdir) if n.lower().endswith(".png")}
    out = SUBSETS / f"{mode}.csv"
    kept = 0
    with open(src, encoding="utf-8", newline="") as f, \
            open(out, "w", encoding="utf-8", newline="") as o:
        r = csv.DictReader(f)
        w = csv.DictWriter(o, fieldnames=r.fieldnames)
        w.writeheader()
        for row in r:
            trig = (row.get("slug") if mode in db.KINDS
                    else row.get("trigger") or "").strip()
            if trig and sanitize_filename(trig) + ".png" in have:
                w.writerow(row)
                kept += 1
    print(f"{mode}: {kept} rows match {len(have)} images")
    run("build-db", str(out), "--mode", mode, "--keep-existing")

# Drop rows whose image does not exist (sample seed leftovers).
conn = db.connect_rw(cfg.paths.database)
try:
    for table, mode in [(m, m) for m in MODES]:
        imgdir = MODES[mode][2]
        have = set(os.listdir(imgdir))
        gone = [r[0] for r in conn.execute(
                    f"SELECT imgname FROM {table} WHERE custom = 0")
                if r[0] not in have]
        for name in gone:
            conn.execute(f"DELETE FROM {table} WHERE imgname = ?", (name,))
        print(f"{table}: removed {len(gone)} rows without an image")
    # remove category/trait rows left behind by the pruned items
    for k in db.KINDS:
        conn.execute(f"DELETE FROM {k}_categories "
                     f"WHERE slug NOT IN (SELECT slug FROM {k})")
    conn.execute("DELETE FROM traits "
                 "WHERE character NOT IN (SELECT character FROM characters)")
    conn.execute("DELETE FROM artist_categories "
                 "WHERE artist NOT IN (SELECT artist FROM artists)")
    conn.commit()
finally:
    conn.close()

run("build-thumbs", "--mode", "all", "--csv", str(SUBSETS / "characters.csv"))
print("sync complete")
