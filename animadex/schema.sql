-- AnimaDex SQLite schema.
--
-- Two main datasets share one DB file: characters (with multi-valued
-- `traits`) and artists. image_version is bumped whenever the pipeline
-- (re)builds a row's full image or thumbnail; the web layer appends
-- ?v=<image_version> to every image URL so caches refresh on change.

CREATE TABLE IF NOT EXISTS characters (
    character      TEXT PRIMARY KEY,    -- danbooru-style slug
    copyright      TEXT NOT NULL,
    name           TEXT NOT NULL,
    name_lower     TEXT NOT NULL,
    copyright_name TEXT NOT NULL,
    trigger        TEXT NOT NULL,
    core_tags      TEXT NOT NULL,
    count          INTEGER NOT NULL DEFAULT 0,
    url            TEXT NOT NULL DEFAULT '',
    imgname        TEXT NOT NULL,
    thumbname      TEXT NOT NULL,
    search_blob    TEXT NOT NULL,
    image_version  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_char_count
    ON characters(count DESC, name_lower);
CREATE INDEX IF NOT EXISTS idx_char_name      ON characters(name_lower);
CREATE INDEX IF NOT EXISTS idx_char_copyright ON characters(copyright);

CREATE TABLE IF NOT EXISTS traits (
    character TEXT NOT NULL,
    facet     TEXT NOT NULL,
    value     TEXT NOT NULL,
    label     TEXT NOT NULL,
    PRIMARY KEY (character, facet, value)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_traits_facet ON traits(facet, value);

CREATE TABLE IF NOT EXISTS artists (
    artist        TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    name_lower    TEXT NOT NULL,
    trigger       TEXT NOT NULL,
    count         INTEGER NOT NULL DEFAULT 0,
    url           TEXT NOT NULL DEFAULT '',
    imgname       TEXT NOT NULL,
    thumbname     TEXT NOT NULL,
    score         REAL,                 -- artwork-scorer 0-1; NULL = unscored
    search_blob   TEXT NOT NULL,
    image_version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_artist_count
    ON artists(count DESC, name_lower);
CREATE INDEX IF NOT EXISTS idx_artist_name ON artists(name_lower);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS categories (
    name TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS artist_categories (
    artist   TEXT NOT NULL,
    category TEXT NOT NULL,
    PRIMARY KEY (artist, category)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_artcat_cat ON artist_categories(category);

CREATE TABLE IF NOT EXISTS loras (
    character TEXT NOT NULL,
    model_id  INTEGER NOT NULL,
    name      TEXT NOT NULL,
    url       TEXT NOT NULL,
    thumb     TEXT,
    published TEXT,
    PRIMARY KEY (character, model_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_loras_char ON loras(character);

CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    reason     TEXT NOT NULL,
    message    TEXT NOT NULL,
    ip         TEXT,
    user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(id DESC);

-- Per-filename version for copyright collage thumbnails. Copyrights are
-- a GROUP BY on characters.copyright -- they don't have their own row
-- to hold an image_version, so the side table fills that gap.
CREATE TABLE IF NOT EXISTS copyright_versions (
    filename TEXT PRIMARY KEY,
    version  INTEGER NOT NULL
);

-- Tag-library datasets: poses, clothing, backgrounds, expressions.
-- Same shape, kept as four separate tables (plus one category table
-- each) so each can grow its own columns later.

CREATE TABLE IF NOT EXISTS poses (
    slug          TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    name_lower    TEXT NOT NULL,
    tags          TEXT NOT NULL,
    ord           INTEGER NOT NULL DEFAULT 0,   -- source order
    imgname       TEXT NOT NULL,
    thumbname     TEXT NOT NULL,
    search_blob   TEXT NOT NULL,
    image_version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_poses_ord  ON poses(ord, name_lower);
CREATE INDEX IF NOT EXISTS idx_poses_name ON poses(name_lower);
CREATE TABLE IF NOT EXISTS poses_categories (
    slug     TEXT NOT NULL,
    category TEXT NOT NULL,
    PRIMARY KEY (slug, category)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_poses_cat ON poses_categories(category);

CREATE TABLE IF NOT EXISTS clothing (
    slug          TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    name_lower    TEXT NOT NULL,
    tags          TEXT NOT NULL,
    ord           INTEGER NOT NULL DEFAULT 0,   -- source order
    imgname       TEXT NOT NULL,
    thumbname     TEXT NOT NULL,
    search_blob   TEXT NOT NULL,
    image_version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_clothing_ord  ON clothing(ord, name_lower);
CREATE INDEX IF NOT EXISTS idx_clothing_name ON clothing(name_lower);
CREATE TABLE IF NOT EXISTS clothing_categories (
    slug     TEXT NOT NULL,
    category TEXT NOT NULL,
    PRIMARY KEY (slug, category)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_clothing_cat ON clothing_categories(category);

CREATE TABLE IF NOT EXISTS backgrounds (
    slug          TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    name_lower    TEXT NOT NULL,
    tags          TEXT NOT NULL,
    ord           INTEGER NOT NULL DEFAULT 0,   -- source order
    imgname       TEXT NOT NULL,
    thumbname     TEXT NOT NULL,
    search_blob   TEXT NOT NULL,
    image_version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_backgrounds_ord  ON backgrounds(ord, name_lower);
CREATE INDEX IF NOT EXISTS idx_backgrounds_name ON backgrounds(name_lower);
CREATE TABLE IF NOT EXISTS backgrounds_categories (
    slug     TEXT NOT NULL,
    category TEXT NOT NULL,
    PRIMARY KEY (slug, category)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_backgrounds_cat ON backgrounds_categories(category);

CREATE TABLE IF NOT EXISTS expressions (
    slug          TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    name_lower    TEXT NOT NULL,
    tags          TEXT NOT NULL,
    ord           INTEGER NOT NULL DEFAULT 0,   -- source order
    imgname       TEXT NOT NULL,
    thumbname     TEXT NOT NULL,
    search_blob   TEXT NOT NULL,
    image_version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_expressions_ord  ON expressions(ord, name_lower);
CREATE INDEX IF NOT EXISTS idx_expressions_name ON expressions(name_lower);
CREATE TABLE IF NOT EXISTS expressions_categories (
    slug     TEXT NOT NULL,
    category TEXT NOT NULL,
    PRIMARY KEY (slug, category)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_expressions_cat ON expressions_categories(category);

-- "Redo with a custom prompt" queue (local-only tool). pre_text/post_text
-- are the prompt text around the item's own tags, which are always
-- inserted at generation time (tags_override replaces them only when the
-- user explicitly unlocked and edited them). status: pending/done/failed.
CREATE TABLE IF NOT EXISTS redo (
    mode           TEXT NOT NULL,
    slug           TEXT NOT NULL,
    pre_text       TEXT NOT NULL DEFAULT '',
    post_text      TEXT NOT NULL DEFAULT '',
    tags_override  TEXT,
    negative_extra TEXT NOT NULL DEFAULT '',
    seed           INTEGER,
    status         TEXT NOT NULL DEFAULT 'pending',
    error          TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL,
    done_at        TEXT,
    PRIMARY KEY (mode, slug)
) WITHOUT ROWID;
