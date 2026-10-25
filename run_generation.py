"""Unattended generation loop for AnimaDex.

Fills every dataset evenly: each round renders BATCH new images per type,
cycling through the types, so all of them grow together.

  Phase 1: poses, clothing, backgrounds, expressions
           (queued so every sub-category fills evenly, not A-Z)
  Phase 2: artists, characters   (starts once phase 1 has nothing left)

Safe to stop and restart at any time: generate_dataset.py skips every
image that already exists. Prompts are read from kind_prompts.json on
every batch, so edits apply to the next batch without a restart.

Run:   .venv\\Scripts\\python.exe run_generation.py
Stop:  end the process (progress is kept).
Log:   generation.log
"""
import csv
import ctypes
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PY = ROOT / ".venv" / "Scripts" / "python.exe"
COMFY = "http://127.0.0.1:8000/"
BATCH = 5                        # new images per type per round
SYNC_EVERY = 15 * 60             # seconds between automatic gallery syncs
DATA = Path(r"E:\animadex-data")
LOG = ROOT / "generation.log"

KINDS = ("poses", "clothing", "backgrounds", "expressions")
# (mode, csv, workflow, output dir)
PHASE1 = [(k, f"sources/{k}_queue.csv", "AnimaGenArtist.json",
           DATA / k / "images") for k in KINDS]
# HARD LIMITS for phase 2: only entries with at least this many Danbooru
# posts are ever generated (the source lists are sorted by popularity).
MIN_POSTS = {"artist": 100, "character": 50}
CAPPED = {"artist": ("danbooru_artist.csv", "sources/artists_capped.csv"),
          "character": ("danbooru_character.csv",
                        "sources/characters_capped.csv")}
PHASE2 = [
    ("artist", CAPPED["artist"][1], "AnimaGenArtist.json",
     DATA / "artists" / "images"),
    ("character", CAPPED["character"][1], "AnimaGen.json",
     DATA / "characters" / "images"),
]


_sync = {"proc": None, "last": 0.0, "pending": 0}


def maybe_sync(force=False):
    """Load newly generated images into the website: runs sync_gallery.py in
    the background (the GPU keeps rendering meanwhile) at most once every
    SYNC_EVERY seconds, and only if something new was generated."""
    proc = _sync["proc"]
    if proc is not None and proc.poll() is None:
        return                                   # previous sync still running
    if proc is not None:                         # it just finished
        log(f"gallery sync finished (exit={proc.returncode})")
        _sync["proc"] = None
    if not _sync["pending"]:
        return
    if not force and time.time() - _sync["last"] < SYNC_EVERY:
        return
    n, _sync["pending"], _sync["last"] = _sync["pending"], 0, time.time()
    out = open(ROOT / "sync.log", "w", encoding="utf-8")
    _sync["proc"] = subprocess.Popen(
        [str(PY), "sync_gallery.py"], cwd=ROOT, stdout=out, stderr=out)
    log(f"gallery sync started ({n} new images since the last one)")


def log(msg):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def comfy_up():
    try:
        urllib.request.urlopen(COMFY + "system_stats", timeout=5).read()
        return True
    except Exception:
        return False


def build_queues():
    """sources/<kind>_queue.csv = the kind's rows interleaved by
    sub-category (one from each in turn), so every category fills evenly."""
    for k in KINDS:
        src = ROOT / "sources" / f"{k}.csv"
        with open(src, encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            fields, rows = reader.fieldnames, list(reader)
        groups = {}
        for r in rows:
            groups.setdefault(r["categories"].split("|")[0], []).append(r)
        order, lists = sorted(groups), [groups[c] for c in sorted(groups)]
        queue = []
        for i in range(max(len(g) for g in lists)):
            queue += [g[i] for g in lists if i < len(g)]
        with open(ROOT / "sources" / f"{k}_queue.csv", "w",
                  encoding="utf-8", newline="") as o:
            w = csv.DictWriter(o, fieldnames=fields, lineterminator="\n")
            w.writeheader()
            w.writerows(queue)
        log(f"queue {k}: {len(queue)} rows over {len(order)} categories")


def build_caps():
    """sources/*_capped.csv = the source list cut at MIN_POSTS. These capped
    files are what phase 2 generates from, so the limit is enforced no matter
    how long the runner keeps going."""
    for mode, (src, out) in CAPPED.items():
        with open(ROOT / src, encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            fields, rows = reader.fieldnames, list(reader)
        keep = [r for r in rows if int(r.get("count") or 0) >= MIN_POSTS[mode]]
        with open(ROOT / out, "w", encoding="utf-8", newline="") as o:
            w = csv.DictWriter(o, fieldnames=fields, lineterminator="\n")
            w.writeheader()
            w.writerows(keep)
        log(f"cap {mode}: {len(keep):,} of {len(rows):,} entries have "
            f">= {MIN_POSTS[mode]} posts -> only those are generated")


def run_batch(job):
    mode, csv_path, workflow, outdir = job
    while not comfy_up():
        log("ComfyUI not reachable, waiting 60s")
        time.sleep(60)
    outdir.mkdir(parents=True, exist_ok=True)
    cmd = [str(PY), "scripts/generate_dataset.py", "--mode", mode,
           "--csv", csv_path, "--workflow", workflow,
           "--output-dir", str(outdir), "--comfyui-url", COMFY,
           "--limit", str(BATCH), "--workers", "1"]
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    tail = (p.stdout or "").strip().splitlines()[-3:]
    summary = next((l for l in tail if l.startswith("Done.")), "")
    err = (p.stderr or "").strip().splitlines()[-1:] if p.returncode else []
    log(f"{mode}: exit={p.returncode} "
        f"{summary or ' | '.join(tail + err)}")
    if "generated=" in summary:
        n = int(summary.split("generated=")[1].split()[0])
        _sync["pending"] += n
        return n
    return 0


def run_redos():
    """Render any images flagged in the website's local "redo list"."""
    p = subprocess.run([str(PY), "-m", "animadex", "redo"], cwd=ROOT,
                       capture_output=True, text=True)
    lines = (p.stdout or "").strip().splitlines()
    last = lines[-1] if lines else ""
    if p.returncode or "0 done, 0 failed" not in last:
        log(f"redo: exit={p.returncode} {' | '.join(lines[-3:])}")


def run_phase(jobs, label):
    log(f"--- {label} ---")
    active = list(jobs)
    while active:
        run_redos()
        for job in list(active):
            if run_batch(job) == 0:
                log(f"{job[0]}: nothing new to generate - done "
                    f"(or only failures left)")
                active.remove(job)
            maybe_sync()


def main():
    # ES_CONTINUOUS | ES_SYSTEM_REQUIRED: keep Windows from sleeping.
    ctypes.windll.kernel32.SetThreadExecutionState(0x80000001)
    log("run_generation started")
    build_queues()
    build_caps()
    _sync["pending"] = 1                         # catch up once at startup
    maybe_sync(force=True)
    run_phase(PHASE1, "phase 1: poses / clothing / backgrounds / expressions")
    run_phase(PHASE2, "phase 2: artists / characters")
    for _ in range(3):                           # final sync(s)
        if _sync["proc"] is not None:
            _sync["proc"].wait()
        maybe_sync(force=True)
        if _sync["proc"] is None:
            break
    if _sync["proc"] is not None:
        _sync["proc"].wait()
    log("all done")


if __name__ == "__main__":
    main()
