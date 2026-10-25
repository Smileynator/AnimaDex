/* ===== "Redo with a custom prompt" tool -- LOCAL ONLY ===================== */
/* The server only answers /api/redo/* for requests coming straight from
   this PC (never through the tunnel). If /api/redo/status says
   local:false, this file does nothing and no redo UI is ever shown.

   The item's own tags are shown as highlighted "required" chips and are
   inserted automatically at generation time; only the text before/after
   them is freely editable, so nothing integral can be dropped by accident
   (unless the unlock box is ticked on purpose). */
(() => {
  'use strict';
  const q = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const KINDS = new Set(['poses', 'clothing', 'backgrounds', 'expressions']);
  let marks = {};                         // "mode:slug" -> pending|done|failed
  let current = null;                     // frame being edited

  async function api(path, opts){
    const r = await fetch(path, Object.assign({ cache: 'no-store' }, opts));
    if (!r.ok){
      let msg = 'HTTP ' + r.status;
      try { msg = (await r.json()).error || msg; } catch (e){}
      throw new Error(msg);
    }
    return r.json();
  }
  const post = (path, body) => api(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });

  /* ---- tile buttons + marks ------------------------------------------ */
  function tileMode(){ return state.mode; }

  function decorateTiles(){
    const add = q('#add-open');
    if (add) add.hidden = !window.ANIMADEX_LOCAL
      || tileMode() === 'copyrights';
    if (!window.ANIMADEX_LOCAL || tileMode() === 'copyrights') return;
    document.querySelectorAll('#gallery .tile[data-slug]').forEach(t => {
      const meta = t.querySelector('.meta');
      if (!meta) return;
      let b = t.querySelector('.redobtn');
      if (!b){
        b = document.createElement('button');
        b.type = 'button'; b.className = 'redobtn'; b.textContent = '↻';
        meta.appendChild(b);
      }
      if (t.dataset.custom){
        if (!t.querySelector('.newbadge')){
          const nb = document.createElement('span');
          nb.className = 'newbadge'; nb.textContent = 'NEW';
          nb.title = 'An item you added';
          t.querySelector('.thumb')?.appendChild(nb);
        }
        if (!t.querySelector('.rmbtn')){
          const rb = document.createElement('button');
          rb.type = 'button'; rb.className = 'rmbtn'; rb.textContent = '✕';
          rb.title = 'Remove this item (only items you added)';
          meta.appendChild(rb);
        }
      }
      const st = marks[tileMode() + ':' + t.dataset.slug] || '';
      b.classList.remove('pending', 'done', 'failed');
      if (st) b.classList.add(st);
      b.title = st === 'pending' ? 'Queued for redo (click to edit)'
        : st === 'done' ? 'Redone with a custom prompt (click to edit)'
        : st === 'failed' ? 'Redo failed (click to edit)'
        : 'Redo this image with a custom prompt';
    });
  }

  function updateCount(){
    const n = Object.values(marks).filter(v => v === 'pending').length;
    const total = Object.keys(marks).length;
    const c = q('#redo-count');
    if (c) c.textContent = n ? n + ' queued' : total;
  }

  async function refreshMarks(){
    const s = await api('/api/redo/status');
    marks = s.marks || {};
    updateCount();
    decorateTiles();
  }

  /* ---- modal shell ---------------------------------------------------- */
  function shell(){
    let m = q('#redo-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'redo-modal'; m.className = 'rmodal'; m.hidden = true;
    m.innerHTML = `<div class="rbox" role="dialog" aria-modal="true">
        <div class="rhead"><div class="rtitle"></div>
          <button type="button" class="rx" aria-label="Close">×</button></div>
        <div class="rbody"></div><div class="rfoot"></div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => {
      if (e.target === m || e.target.closest('.rx')) closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !m.hidden) closeModal();
    });
    return m;
  }
  function closeModal(){
    shell().hidden = true; document.body.classList.remove('noscroll');
    current = null;
  }
  function openModal(title){
    const m = shell();
    m.querySelector('.rtitle').innerHTML = title;
    m.hidden = false; document.body.classList.add('noscroll');
    return m;
  }

  /* ---- editor --------------------------------------------------------- */
  const chips = (tags, mode) => (tags || '').split(',').map(t => t.trim())
    .filter(Boolean).map(t => {
      const d = (typeof dbTag === 'function'
        && typeof DANBOORU_MODES !== 'undefined' && DANBOORU_MODES.has(mode))
        ? dbTag(t) : '';
      return d
        ? `<a class="rchip rlink" href="${dbPosts(d)}" target="_blank"
             rel="noopener" title="Search Danbooru for ${esc(d)}">${esc(t)} ↗</a>`
        : `<span class="rchip">${esc(t)}</span>`;
    }).join('');

  function previewHTML(pre, ins, post){
    return `<span class="rpre">${esc(pre)}</span><mark class="rins">${
      esc(ins)}</mark><span class="rpost">${esc(post)}</span>`;
  }

  async function openEditor(mode, slug){
    let fr;
    try {
      fr = await api('/api/redo/frame?mode=' + encodeURIComponent(mode)
                     + '&slug=' + encodeURIComponent(slug));
    } catch (e){ toast('Could not load the prompt: ' + e.message); return; }
    current = fr;
    const m = openModal(`Redo: <b>${esc(fr.name)}</b> <span class="rmode">${
      esc(mode)}</span>`);
    const d = fr.default;
    m.querySelector('.rbody').innerHTML = `
      <div class="rleft">
        <img src="${esc(fr.thumb_url)}" alt="">
        <div class="rnote">Current image${fr.status
          ? ` · redo ${esc(fr.status)}` : ''}</div>
        ${fr.error ? `<div class="rerr">${esc(fr.error)}</div>` : ''}
      </div>
      <div class="rright">
        <label for="rd-name">Entry name <small>— shown on the tile; saved
          straight into the entry</small></label>
        <input id="rd-name" type="text" maxlength="120" spellcheck="false"
          value="${esc(fr.name)}">

        <label for="rd-pre">Prompt <b>before</b> the item's tags</label>
        <textarea id="rd-pre" rows="3" spellcheck="false">${esc(fr.before)}</textarea>

        <div class="rreq">
          <div class="rreq-head"><span class="rlock">🔒</span> Required item
            tags <small>— inserted automatically; the image needs these at
            minimum</small></div>
          <div id="rd-chips" class="rchips">${chips(fr.inserted, mode)}</div>
          <label class="runlock"><input type="checkbox" id="rd-unlock"
            ${fr.tags_edited ? 'checked' : ''}> I want to edit these item
            tags too (careful) — ${KINDS.has(mode)
              ? "saved into the entry itself: the tile, copy button, search and Danbooru links will use them"
              : 'used for this render only; the entry keeps its original tags'}
          </label>
          <textarea id="rd-tags" rows="3" spellcheck="false"
            ${fr.tags_edited ? '' : 'hidden'}>${esc(fr.inserted)}</textarea>
        </div>

        <label for="rd-post">Prompt <b>after</b> the item's tags</label>
        <textarea id="rd-post" rows="3" spellcheck="false">${esc(fr.after)}</textarea>

        <label for="rd-neg">Extra negative tags
          <small>(added to the default negative prompt)</small></label>
        <textarea id="rd-neg" rows="2" spellcheck="false">${esc(fr.negative_extra)}</textarea>
        <div class="rdefneg">default negative: ${esc(fr.default_negative)}</div>

        <label for="rd-seed">Seed</label>
        <div class="rseedrow">
          <input id="rd-seed" type="number" value="${esc(fr.seed)}">
          <button type="button" id="rd-dice" class="rbtn">🎲 random</button>
          <small>default: ${esc(d.seed)}</small>
        </div>

        <div class="rlabel">Final prompt <small>(highlighted = the item's own
          tags)</small></div>
        <div id="rd-preview" class="rpreview"></div>
        <div class="rhint">The previous image is kept in a
          <code>_previous</code> folder. The generation runner picks this up
          at its next round, or run <code>python -m animadex redo</code>.</div>
      </div>`;
    m.querySelector('.rfoot').innerHTML = `
      <button type="button" class="rbtn" id="rd-reset">Reset to default</button>
      <button type="button" class="rbtn" id="rd-entry"
        title="Save the entry name / corrected tags only; do not re-render the image">Save entry only</button>
      ${fr.has_override ? '<button type="button" class="rbtn rdanger" id="rd-remove">Remove from list</button>' : ''}
      <span class="rspacer"></span>
      <button type="button" class="rbtn" id="rd-cancel">Cancel</button>
      <button type="button" class="rbtn rprimary" id="rd-save">Save &amp; queue redo</button>`;

    const pre = q('#rd-pre'), postTa = q('#rd-post'), tags = q('#rd-tags'),
      unlock = q('#rd-unlock'), seed = q('#rd-seed');
    const insNow = () => unlock.checked ? tags.value : d.inserted;
    const refresh = () => {
      q('#rd-chips').innerHTML = chips(insNow(), mode);
      q('#rd-preview').innerHTML = previewHTML(pre.value, insNow(), postTa.value);
    };
    [pre, postTa, tags].forEach(el => el.addEventListener('input', refresh));
    unlock.addEventListener('change', () => {
      tags.hidden = !unlock.checked;
      if (unlock.checked && !tags.value) tags.value = d.inserted;
      if (!unlock.checked) tags.value = d.inserted;
      refresh();
    });
    q('#rd-dice').addEventListener('click', () => {
      seed.value = Math.floor(Math.random() * 2 ** 48);
    });
    q('#rd-reset').addEventListener('click', () => {
      pre.value = d.before; postTa.value = d.after; tags.value = d.inserted;
      unlock.checked = false; tags.hidden = true;
      q('#rd-neg').value = ''; seed.value = d.seed; refresh();
    });
    q('#rd-cancel').addEventListener('click', closeModal);
    const rm = q('#rd-remove');
    if (rm) rm.addEventListener('click', async () => {
      await post('/api/redo/delete', { mode, slug });
      toast('Removed from the redo list');
      closeModal(); await refreshMarks();
    });
    const isKind = KINDS.has(mode);
    // name / (tag-library) tags are written into the entry itself
    async function saveEntry(){
      const nm = q('#rd-name').value.trim();
      const nameChanged = nm && nm !== fr.name;
      const tagsChanged = isKind && unlock.checked
        && tags.value.trim() !== d.inserted.trim();
      if (!nameChanged && !tagsChanged) return false;
      await post('/api/entry', {
        mode, slug, name: nameChanged ? nm : null,
        tags: tagsChanged ? tags.value : null });
      return true;
    }
    q('#rd-entry').addEventListener('click', async () => {
      try {
        const saved = await saveEntry();
        toast(saved ? 'Entry saved' : 'Nothing changed in the entry');
        if (saved){ closeModal(); runSearch(state.page); }
      } catch (e){ toast('Save failed: ' + e.message); }
    });
    q('#rd-save').addEventListener('click', async () => {
      const edited = !isKind && unlock.checked
        && tags.value.trim() !== d.inserted.trim();
      try {
        await saveEntry();
        await post('/api/redo', {
          mode, slug, before: pre.value, after: postTa.value,
          tags_override: edited ? tags.value : null,
          negative_extra: q('#rd-neg').value,
          seed: seed.value === '' ? null : Number(seed.value),
        });
      } catch (e){ toast('Save failed: ' + e.message); return; }
      toast('Queued for redo');
      closeModal(); await refreshMarks(); runSearch(state.page);
    });
    refresh();
  }

  /* ---- list ----------------------------------------------------------- */
  async function openList(){
    let data;
    try { data = await api('/api/redo/list'); }
    catch (e){ toast('Could not load the list: ' + e.message); return; }
    const items = data.items;
    const m = openModal(`Redo list <span class="rmode">${items.length}</span>`);
    m.querySelector('.rbody').innerHTML = items.length ? `<div class="rlist">${
      items.map(it => `
        <div class="rrow" data-mode="${esc(it.mode)}" data-slug="${esc(it.slug)}">
          <img src="${esc(it.thumb_url)}" alt="">
          <div class="rinfo">
            <div class="rname">${esc(it.name)} <span class="rmode">${esc(it.mode)}</span>
              <span class="rstat ${esc(it.status || '')}">${esc(it.status || '')}</span></div>
            <div class="rpreview small">${previewHTML(it.before, it.inserted, it.after)}</div>
            ${it.negative_extra ? `<div class="rdefneg">+ negative: ${esc(it.negative_extra)}</div>` : ''}
            ${it.error ? `<div class="rerr">${esc(it.error)}</div>` : ''}
          </div>
          <div class="ract">
            <button type="button" class="rbtn" data-act="edit">Edit</button>
            <button type="button" class="rbtn rdanger" data-act="del">Remove</button>
          </div>
        </div>`).join('')}</div>`
      : '<div class="rempty">Nothing flagged yet. Click the ↻ on any tile to flag it.</div>';
    m.querySelector('.rfoot').innerHTML =
      '<span class="rspacer"></span><button type="button" class="rbtn" id="rl-close">Close</button>';
    q('#rl-close').addEventListener('click', closeModal);
    m.querySelector('.rbody').onclick = async e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const row = btn.closest('.rrow');
      const mode = row.dataset.mode, slug = row.dataset.slug;
      if (btn.dataset.act === 'del'){
        await post('/api/redo/delete', { mode, slug });
        await refreshMarks(); openList();
      } else {
        openEditor(mode, slug);
      }
    };
  }

  /* ---- add / remove your own items ------------------------------------ */
  const FORMS = {
    characters: { noun: 'character', fields: [
      ['name', 'Character name', 'text', true, 'e.g. Arthur Pendragon'],
      ['series', 'Series / copyright', 'text', false, 'e.g. fate (leave empty for an original character)'],
      ['core_tags', 'Appearance tags', 'area', false, 'e.g. 1girl, blue eyes, blonde hair, long hair, ahoge'],
    ] },
    artists: { noun: 'artist', fields: [
      ['name', 'Artist tag', 'text', true, 'the name as used in the prompt after @, e.g. john doe'],
    ] },
  };
  for (const k of ['poses', 'clothing', 'backgrounds', 'expressions'])
    FORMS[k] = { noun: k.replace(/s$/, ''), fields: [
      ['name', 'Name', 'text', true, 'e.g. Leaning on railing'],
      ['tags', 'Tags', 'area', true, 'comma separated tags, e.g. leaning on object, arms on railing, looking away'],
      ['category', 'Category', 'cat', false, 'pick one or type a new one'],
    ] };

  async function removeItem(mode, slug, name){
    if (!confirm(`Remove "${name}"?\n\nOnly items you added can be removed. ` +
                 `Its image is moved to a _bin folder, not erased.`)) return false;
    try { await post('/api/custom/remove', { mode, slug }); }
    catch (e){ toast('Could not remove: ' + e.message); return false; }
    toast('Removed');
    await refreshMarks();
    runSearch(state.page);
    return true;
  }

  async function openAdd(){
    const mode = tileMode(), form = FORMS[mode];
    if (!form) return;
    let cats = [];
    if (mode !== 'characters' && mode !== 'artists'){
      try {
        const f = await api('/api/' + mode + '/facets');
        cats = (f.facets.category?.values || []).map(v => v.label);
      } catch (e){}
    }
    const m = openModal(`Add a new ${esc(form.noun)} <span class="rmode">${
      esc(mode)}</span>`);
    m.querySelector('.rbody').innerHTML = `
      <div class="raddcol">
        <div class="rhint">It is added to the gallery right away and queued
          for rendering with the normal prompt. Click ↻ on its tile first if
          you want to change the prompt before it is rendered.</div>
        ${form.fields.map(([key, label, type, req, ph]) => `
          <label for="ra-${key}">${esc(label)}${req ? ' <b>*</b>' : ''}</label>
          ${type === 'area'
            ? `<textarea id="ra-${key}" rows="3" spellcheck="false" placeholder="${esc(ph)}"></textarea>`
            : `<input id="ra-${key}" type="text" spellcheck="false" placeholder="${esc(ph)}"
                 ${type === 'cat' ? 'list="ra-cats"' : ''}>`}
          ${type === 'cat' ? `<datalist id="ra-cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>` : ''}
        `).join('')}
        <div id="ra-err" class="rerr"></div>
        <div class="rlabel">Added by you <small>(only these can be removed)</small></div>
        <div id="ra-list" class="rlist"></div>
      </div>`;
    m.querySelector('.rfoot').innerHTML = `
      <span class="rspacer"></span>
      <button type="button" class="rbtn" id="ra-close">Close</button>
      <button type="button" class="rbtn rprimary" id="ra-save">Add &amp; queue render</button>`;
    q('#ra-close').addEventListener('click', closeModal);

    async function loadMine(){
      const data = await api('/api/custom/list?mode=' + encodeURIComponent(mode));
      q('#ra-list').innerHTML = data.items.length ? data.items.map(it => `
        <div class="rrow" data-slug="${esc(it.slug)}" data-name="${esc(it.name)}">
          ${it.has_image ? `<img src="${esc(it.thumb_url)}" alt="">`
            : '<div class="rwait">waiting<br>to render</div>'}
          <div class="rinfo"><div class="rname">${esc(it.name)}
            <span class="rstat ${esc(it.status || '')}">${esc(it.status || 'done')}</span></div></div>
          <div class="ract">
            <button type="button" class="rbtn" data-act="edit">Edit prompt</button>
            <button type="button" class="rbtn rdanger" data-act="del">Remove</button>
          </div></div>`).join('')
        : '<div class="rempty small">Nothing added yet.</div>';
    }
    q('#ra-list').addEventListener('click', async e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const row = b.closest('.rrow');
      if (b.dataset.act === 'edit') openEditor(mode, row.dataset.slug);
      else if (await removeItem(mode, row.dataset.slug, row.dataset.name))
        loadMine();
    });
    q('#ra-save').addEventListener('click', async () => {
      const body = { mode };
      for (const [key] of form.fields) body[key] = q('#ra-' + key).value;
      q('#ra-err').textContent = '';
      try { await post('/api/custom/add', body); }
      catch (e){ q('#ra-err').textContent = e.message; return; }
      toast('Added — it will be rendered in the next generation round');
      for (const [key] of form.fields) q('#ra-' + key).value = '';
      await refreshMarks(); loadMine(); runSearch(state.page);
    });
    loadMine();
  }

  /* ---- boot ----------------------------------------------------------- */
  async function init(){
    let s;
    try { s = await api('/api/redo/status'); } catch (e){ return; }
    if (!s.local) return;                       // tunnel / remote visitor
    window.ANIMADEX_LOCAL = true;
    document.body.classList.add('is-local');
    marks = s.marks || {};
    const open = q('#redo-open');
    if (open){ open.hidden = false; open.addEventListener('click', openList); }
    const add = q('#add-open');
    if (add) add.addEventListener('click', openAdd);
    updateCount();
    decorateTiles();
    new MutationObserver(decorateTiles)
      .observe(q('#gallery'), { childList: true });
    q('#gallery').addEventListener('click', e => {
      const rm = e.target.closest('.rmbtn');
      if (rm){
        e.stopPropagation();
        const t = rm.closest('.tile');
        removeItem(tileMode(), t.dataset.slug,
                   t.querySelector('.name')?.textContent || t.dataset.slug);
        return;
      }
      const b = e.target.closest('.redobtn');
      if (!b) return;
      e.stopPropagation();
      const tile = b.closest('.tile');
      openEditor(tileMode(), tile.dataset.slug);
    }, true);                                   // capture: beat other handlers
  }
  init();
})();
