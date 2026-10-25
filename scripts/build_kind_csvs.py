#!/usr/bin/env python3
"""Convert the tag datasets into AnimaDex CSVs (poses / clothing /
backgrounds / expressions).

The sources are plain-text data files and are only *parsed* (the JSON
array is sliced out and loaded) -- no JavaScript is ever executed:

  sources/pose_data.js        } from github.com/nregret/Comfyui-Anima-Tools
  sources/clothing_data.js    } (MIT licence -- keep the credit)
  sources/background_data.js  }
  sources/expressions_userscript.js   (the curated list inside the userscript)

Output: sources/poses.csv, clothing.csv, backgrounds.csv, expressions.csv
Columns: slug, name, tags, categories ('|' separated), traits ('|' separated)

Run from the repo root:   python scripts/build_kind_csvs.py
"""
import ast
import csv
import json
import re
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "sources"


def clean_tags(tags):
    tags = re.sub(r"\s*,\s*", ", ", (tags or "").strip())
    return tags.strip(", ").strip()


def clean_category(cat):
    """'手势与手臂 (Gestures & Arms)' -> 'Gestures & Arms'."""
    cat = (cat or "").strip()
    m = re.search(r"\(([^()]*)\)\s*$", cat)
    return (m.group(1) if m else cat).strip()


def load_js_array(path):
    text = path.read_text(encoding="utf-8")
    return json.loads(text[text.index("["):text.rindex("]") + 1])


def from_js(filename, skip_duplicates=False):
    rows, skipped = [], {"empty tags": 0, "duplicate": 0}
    for e in load_js_array(SRC / filename):
        tags = clean_tags(e.get("tags"))
        if not tags:
            skipped["empty tags"] += 1
            continue
        if skip_duplicates and e.get("duplicate"):
            skipped["duplicate"] += 1
            continue
        cats = [clean_category(c) for c in e.get("categories") or []]
        rows.append({
            "slug": str(e["id"]),
            "name": str(e["name"]).strip(),
            "tags": tags,
            "categories": "|".join(c for c in cats if c) or "Uncategorized",
            "traits": "|".join(e.get("traits") or []),
        })
    return rows, skipped


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def expressions():
    rows, seen, category = [], set(), None
    for line in (SRC / "expressions_userscript.js").read_text(
            encoding="utf-8").splitlines():
        s = line.strip()
        head = re.match(r"^'([^']+)':\s*\[$", s)
        if head:
            category = head.group(1)
            continue
        if category and s.startswith("[") and s.rstrip(",").endswith("]"):
            try:
                name, tags, _style, traits = ast.literal_eval(s.rstrip(","))
            except (ValueError, SyntaxError):
                continue
            slug = "expression-" + slugify(name)
            while slug in seen:
                slug += "-2"
            seen.add(slug)
            rows.append({
                "slug": slug, "name": name, "tags": clean_tags(tags),
                "categories": category, "traits": traits.replace(",", "|"),
            })
        elif s.startswith("}).flatMap"):
            break
    return rows


def write(name, rows):
    path = SRC / f"{name}.csv"
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["slug", "name", "tags",
                                          "categories", "traits"],
                           lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    cats = sorted({c for r in rows for c in r["categories"].split("|")})
    print(f"{name}.csv: {len(rows)} rows, {len(cats)} categories")


def main():
    for out, src, dedupe in (("poses", "pose_data.js", False),
                             ("clothing", "clothing_data.js", False),
                             ("backgrounds", "background_data.js", True)):
        rows, skipped = from_js(src, skip_duplicates=dedupe)
        write(out, rows)
        if any(skipped.values()):
            print("   skipped:", {k: v for k, v in skipped.items() if v})
    write("expressions", expressions())


if __name__ == "__main__":
    main()
