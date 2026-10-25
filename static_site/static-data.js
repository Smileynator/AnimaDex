/* ===== static-data.js -- the "server" of the static build ================= */
/* The gallery frontend (app.js) is shared with the local Flask site and
   talks to it through fetch('/api/<mode>/...'). In the static build there is
   no Flask, so this file answers those same calls in the browser from the
   JSON shards written by `python -m animadex export-static`.

   It must load BEFORE app.js. Response shapes and sort / filter semantics
   mirror animadex/routes/api_gallery.py + animadex/db.py -- when you change
   one, change the other. Only these calls are handled; anything else under
   /api/ gets a 404 (there is no backend to write to). */
(() => {
  'use strict';
  const D = window.ANIMADEX_STATIC_DATA;
  if (!D) return;
  const realFetch = window.fetch.bind(window);

  const FACET_LABELS = {
    character: 'Character', copyright: 'Copyright', hair_color: 'Hair Color',
    hair_length: 'Hair Length', eye_color: 'Eye Color', gender: 'Gender',
    artist: 'Artist', score: 'Score', category: 'Classifications',
  };
  const TRAIT_FACETS = ['hair_color', 'hair_length', 'eye_color', 'gender'];
  const HAIR_LENGTH_ORDER = ['very short hair', 'short hair', 'medium hair',
    'long hair', 'very long hair', 'absurdly long hair'];
  const SCORE_BUCKETS = [
    ['5', '50% and up', 0.50, 1.01], ['4', '40 - 50%', 0.40, 0.50],
    ['3', '30 - 40%', 0.30, 0.40], ['2', '20 - 30%', 0.20, 0.30],
    ['1', 'Under 20%', 0.00, 0.20],
  ];
  const FACETS = {
    characters: ['character', 'copyright', ...TRAIT_FACETS],
    artists: ['artist', 'score', 'category'],
  };
  const FACET_LIMIT = 30;
  const KINDS = new Set(Object.keys(D.shards)
    .filter(m => m !== 'characters' && m !== 'artists'));

  /* ---- url builders (mirror static_export.Export._thumb_url/_img_url) -- */
  const ver = v => (v ? '?v=' + v : '');
  const thumbURL = (mode, file, v) => `/thumbs/${mode}/${file}.webp${ver(v)}`;
  const imgURL = (mode, file, ext, v) => (D.img_base && ext)
    ? `${D.img_base}/${mode}/${file}.${ext}${ver(v)}` : '';
  const splitTags = s => (s || '').split(',').map(t => t.trim())
    .filter(Boolean);

  /* ---- dataset loading ------------------------------------------------- */
  const loaded = {};
  function load(mode){
    if (!loaded[mode]) loaded[mode] = realFetch(D.shards[mode])
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status);
                   return r.json(); })
      .then(sh => build(mode, sh));
    return loaded[mode];
  }

  function build(mode, sh){
    const ds = { mode, categories: sh.categories || [], traits: sh.traits || [] };
    if (mode === 'characters'){
      ds.items = sh.rows.map((r, i) => ({
        slug: r[0], name: r[1], copyright: r[2], copyright_name: r[3],
        trigger: r[4], core: r[5], count: r[6], url: r[7], file: r[8],
        v: r[9], ext: r[10], custom: !!r[11], tr: r[12], pos: i + 1,
        nameLower: r[1].toLowerCase(),
        blob: (r[0] + ' ' + r[2] + ' ' + r[4] + ' ' + r[5]).toLowerCase(),
      }));
      const cpThumb = {};
      for (const [slug, file, v] of sh.copyrights || []) cpThumb[slug] = [file, v];
      const groups = new Map();
      for (const it of ds.items){
        let g = groups.get(it.copyright);
        if (!g) groups.set(it.copyright, g = {
          slug: it.copyright, label: it.copyright_name, n: 0, pos: it.pos,
          thumb: cpThumb[it.copyright] });
        g.n++;
      }
      ds.copyrights = [...groups.values()];
    } else if (mode === 'artists'){
      ds.items = sh.rows.map((r, i) => ({
        slug: r[0], name: r[1], trigger: r[2], count: r[3], url: r[4],
        score: r[5], file: r[6], v: r[7], ext: r[8], custom: !!r[9],
        cats: r[10], pos: i + 1, nameLower: r[1].toLowerCase(),
        blob: (r[0] + ' ' + r[2]).toLowerCase(),
      }));
    } else {
      ds.items = sh.rows.map((r, i) => ({
        slug: r[0], name: r[1], tags: r[2], ord: r[3], file: r[4], v: r[5],
        ext: r[6], custom: !!r[7], cats: r[8], pos: i + 1,
        nameLower: r[1].toLowerCase(),
        blob: (r[0] + ' ' + r[1] + ' ' + r[2] + ' ' +
               r[8].map(i => ds.categories[i]).join(' ')).toLowerCase(),
      }));
    }
    return ds;
  }

  /* ---- result serializers (mirror animadex/images.py) ------------------ */
  function serialize(mode, it){
    const base = { slug: it.slug, name: it.name,
      thumb_url: thumbURL(mode, it.file, it.v),
      img_url: imgURL(mode, it.file, it.ext, it.v),
      has_image: true, custom: it.custom };
    if (mode === 'characters') return Object.assign(base, {
      copyright: it.copyright, copyright_name: it.copyright_name,
      trigger: it.trigger, tags: splitTags(it.core), count: it.count,
      url: it.url, loras: [] });
    if (mode === 'artists') return Object.assign(base, {
      trigger: it.trigger, count: it.count, url: it.url, score: it.score });
    return Object.assign(base, { tags: splitTags(it.tags) });
  }
  const serializeCopyright = g => ({
    slug: g.slug, name: g.label, count: g.n,
    thumb_url: g.thumb ? thumbURL('copyrights', g.thumb[0], g.thumb[1]) : '',
    has_image: true, custom: false });

  /* ---- ordering --------------------------------------------------------- */
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  function seedMix(value){
    let s = parseInt(value || 0, 10);
    if (!Number.isFinite(s)) s = 0;
    return Number((BigInt(s) * 2654435761n + 1n) % 2147483647n) || 1;
  }
  const shuffleKey = (pos, mix) => (pos * mix) % 2147483647;

  function sorter(mode, sort, seed){
    if (sort === 'random'){
      const mix = seedMix(seed);
      return (a, b) => shuffleKey(a.pos, mix) - shuffleKey(b.pos, mix);
    }
    if (sort === 'az') return (a, b) => cmp(a.nameLower, b.nameLower);
    if (mode === 'artists' && sort === 'score')
      return (a, b) => {
        if (a.score == null || b.score == null){
          if (a.score == null && b.score == null)
            return cmp(a.nameLower, b.nameLower);
          return a.score == null ? 1 : -1;       // NULLs last, like SQLite DESC
        }
        return (b.score - a.score) || cmp(a.nameLower, b.nameLower);
      };
    if (KINDS.has(mode))
      return (a, b) => (a.ord - b.ord) || cmp(a.nameLower, b.nameLower);
    return (a, b) => (b.count - a.count) || cmp(a.nameLower, b.nameLower);
  }

  /* ---- search ----------------------------------------------------------- */
  const tokensOf = q => (q || '').split(',').map(t => t.trim().toLowerCase())
    .filter(Boolean);

  function filterItems(ds, p){
    const mode = ds.mode;
    const tokens = tokensOf(p.get('q'));
    const sets = {};
    for (const f of (FACETS[mode] || ['category']))
      sets[f] = new Set(p.getAll(f));
    const favs = p.has('favs')
      ? new Set(p.get('favs').split(',').slice(0, 500).filter(Boolean)) : null;
    const buckets = mode === 'artists'
      ? SCORE_BUCKETS.filter(b => sets.score.has(b[0])) : [];

    return ds.items.filter(it => {
      if (!tokens.every(t => it.blob.includes(t))) return false;
      if (favs && !favs.has(it.slug)) return false;
      if (mode === 'characters'){
        if (sets.character.size && !sets.character.has(it.slug)) return false;
        if (sets.copyright.size && !sets.copyright.has(it.copyright))
          return false;
        for (const f of TRAIT_FACETS){
          if (!sets[f].size) continue;
          if (!it.tr.some(i => ds.traits[i][0] === f &&
                               sets[f].has(ds.traits[i][1]))) return false;
        }
      } else if (mode === 'artists'){
        if (sets.artist.size && !sets.artist.has(it.slug)) return false;
        if (buckets.length && !(it.score != null && buckets.some(
              b => it.score >= b[2] && it.score < b[3]))) return false;
        if (sets.category.size &&
            !it.cats.some(i => sets.category.has(ds.categories[i])))
          return false;
      } else if (sets.category.size &&
                 !it.cats.some(i => sets.category.has(ds.categories[i]))){
        return false;
      }
      return true;
    });
  }

  function page(rows, p){
    const size = D.page_size;
    const n = Math.max(1, parseInt(p.get('page') || '1', 10) || 1);
    return { total: rows.length, page: n, page_size: size,
      pages: Math.ceil(rows.length / size),
      slice: rows.slice((n - 1) * size, n * size) };
  }

  async function search(mode, p){
    if (mode === 'copyrights'){
      const ds = await load('characters');
      const tokens = tokensOf(p.get('q'));
      let rows = ds.copyrights.filter(g => tokens.every(t =>
        g.slug.toLowerCase().includes(t) || g.label.toLowerCase().includes(t)));
      const sort = p.get('sort');
      if (sort === 'random'){
        const mix = seedMix(p.get('seed'));
        rows = rows.slice().sort((a, b) =>
          shuffleKey(a.pos, mix) - shuffleKey(b.pos, mix));
      } else if (sort === 'az'){
        rows = rows.slice().sort((a, b) => cmp(a.label, b.label));
      } else {
        rows = rows.slice().sort((a, b) => (b.n - a.n) || cmp(a.label, b.label));
      }
      const pg = page(rows, p);
      return { total: pg.total, page: pg.page, page_size: pg.page_size,
        pages: pg.pages, results: pg.slice.map(serializeCopyright) };
    }
    const ds = await load(mode);
    const rows = filterItems(ds, p)
      .sort(sorter(mode, p.get('sort') || 'count', p.get('seed')));
    const pg = page(rows, p);
    return { total: pg.total, page: pg.page, page_size: pg.page_size,
      pages: pg.pages, results: pg.slice.map(it => serialize(mode, it)) };
  }

  /* ---- facets ----------------------------------------------------------- */
  const fv = (value, label, count) => ({ value, label, count });
  const byCountThenLabel = (a, b) => (b.count - a.count) || cmp(a.label, b.label);

  function facet(ds, name, q){
    const mode = ds.mode;
    q = (q || '').trim().toLowerCase();
    const has = s => !q || s.toLowerCase().includes(q);

    if (mode === 'characters'){
      if (name === 'character'){
        const rows = ds.items.filter(it => has(it.name) || has(it.slug));
        const vals = rows.map(it => fv(it.slug, it.name, it.count))
          .sort(byCountThenLabel);
        return { label: FACET_LABELS.character, total: rows.length,
                 values: vals.slice(0, FACET_LIMIT) };
      }
      if (name === 'copyright'){
        const groups = new Map();
        for (const it of ds.items){
          if (!(has(it.copyright) || has(it.copyright_name))) continue;
          const g = groups.get(it.copyright);
          if (g) g.count++;
          else groups.set(it.copyright,
                          fv(it.copyright, it.copyright_name, 1));
        }
        const vals = [...groups.values()].sort(byCountThenLabel);
        return { label: FACET_LABELS.copyright, total: vals.length,
                 values: vals.slice(0, FACET_LIMIT) };
      }
      if (TRAIT_FACETS.includes(name)){
        const groups = new Map();
        for (const it of ds.items) for (const i of it.tr){
          const [f, value, label] = ds.traits[i];
          if (f !== name || !(has(value) || has(label))) continue;
          const g = groups.get(value);
          if (g) g.count++; else groups.set(value, fv(value, label, 1));
        }
        let vals = [...groups.values()].sort(byCountThenLabel);
        const total = vals.length;
        vals = vals.slice(0, FACET_LIMIT);
        if (name === 'hair_length'){
          const rank = v => { const i = HAIR_LENGTH_ORDER.indexOf(v);
                              return i < 0 ? 99 : i; };
          vals.sort((a, b) => rank(a.value) - rank(b.value));
        }
        return { label: FACET_LABELS[name], total, values: vals };
      }
      return null;
    }

    if (mode === 'artists'){
      if (name === 'score'){
        const vals = SCORE_BUCKETS.map(([value, label, lo, hi]) => fv(value, label,
          ds.items.filter(it => it.score != null && it.score >= lo &&
                                it.score < hi).length));
        return { label: FACET_LABELS.score, total: vals.length, values: vals };
      }
      if (name === 'category') return categoryFacet(ds, false, '');
      if (name === 'artist'){
        const rows = ds.items.filter(it => has(it.name) || has(it.slug));
        const vals = rows.map(it => fv(it.slug, it.name, it.count))
          .sort(byCountThenLabel);
        return { label: FACET_LABELS.artist, total: rows.length,
                 values: vals.slice(0, FACET_LIMIT) };
      }
      return null;
    }

    return name === 'category' ? categoryFacet(ds, true, q) : null;
  }

  function categoryFacet(ds, isKind, q){
    const counts = ds.categories.map(() => 0);
    for (const it of ds.items) for (const i of it.cats) counts[i]++;
    const vals = ds.categories
      .map((c, i) => fv(c, c, counts[i]))
      .filter(v => !isKind || !q || v.label.toLowerCase().includes(q))
      .sort((a, b) => cmp(a.label, b.label));
    return { label: isKind ? 'Category' : FACET_LABELS.category,
             total: vals.length, values: vals };
  }

  async function facets(mode){
    if (mode === 'copyrights'){
      const ds = await load('characters');
      return { total: ds.copyrights.length, facets: {} };
    }
    const ds = await load(mode);
    const names = FACETS[mode] || ['category'];
    const out = {};
    for (const n of names) out[n] = facet(ds, n, '');
    return { total: ds.items.length, facets: out };
  }

  /* ---- the fetch shim --------------------------------------------------- */
  const json = (obj, status) => new Response(JSON.stringify(obj), {
    status: status || 200, headers: { 'Content-Type': 'application/json' } });

  window.fetch = async function(input, init){
    const raw = typeof input === 'string' ? input : input.url;
    const url = new URL(raw, location.href);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);

    const m = url.pathname.match(
      /^\/api\/([a-z]+)\/(facets|search|facet\/([a-z_]+))$/);
    const mode = m && m[1];
    const known = mode === 'copyrights' || (mode && D.shards[mode]);
    if (!known) return json({ error: 'not available in the static build' }, 404);

    try {
      if (m[2] === 'facets') return json(await facets(mode));
      if (m[2] === 'search') return json(await search(mode, url.searchParams));
      if (mode === 'copyrights') return json({ error: 'not found' }, 404);
      const data = facet(await load(mode), m[3], url.searchParams.get('q'));
      return data ? json(data) : json({ error: 'not found' }, 404);
    } catch (e){
      return json({ error: String(e) }, 500);
    }
  };
})();
