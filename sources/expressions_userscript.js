// ==UserScript==
// @name         AnimaDex Extra Tags Browser
// @namespace    local.animadex.extra-tags
// @version      0.9.0
// @description  Adds Clothing, Backgrounds, Poses and Expressions browsers to animadex.net with SD/HD previews, colored categories, tag editing and infinite scrolling.
// @author       ChatGPT
// @match        https://animadex.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @connect      raw.githubusercontent.com
// @connect      cdn.jsdelivr.net
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.9.0';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const PAGE_SIZE = 36;

  // Curated prompt-friendly expression catalogue. It stays inside the userscript so
  // the Expressions tab is immediately usable and its previews never depend on a CDN.
  const EXPRESSION_DATA = Object.entries({
    'Happy & Cheerful': [
      ['Smile', 'smile', 'smile', 'happy,gentle'],
      ['Light Smile', 'light smile', 'smile', 'happy,subtle'],
      ['Grin', 'grin', 'grin', 'happy,open mouth'],
      ['Big Grin', 'big grin, open mouth', 'grin', 'happy,energetic'],
      ['Laughing', 'laughing, open mouth', 'laugh', 'happy,energetic'],
      ['Closed-Eye Smile', 'closed eyes, smile', 'closed-smile', 'happy,cute'],
      ['Open-Mouth Smile', 'smile, open mouth', 'grin', 'happy'],
      ['Fang Smile', 'smile, fang', 'fang', 'happy,cute'],
      ['Excited', 'excited, open mouth, sparkling eyes', 'excited', 'happy,energetic'],
      ['Delighted', 'delighted, closed eyes, smile', 'closed-smile', 'happy'],
      ['Relieved', 'relieved, light smile, closed eyes', 'relieved', 'calm,happy'],
      ['Proud', 'proud, smile', 'proud', 'confident,happy'],
    ],
    'Cute & Shy': [
      ['Blush', 'blush', 'blush', 'cute,shy'],
      ['Light Blush', 'light blush', 'blush', 'cute,subtle'],
      ['Full-Face Blush', 'full-face blush, embarrassed', 'blush-heavy', 'cute,shy'],
      ['Embarrassed', 'embarrassed, blush', 'embarrassed', 'cute,shy'],
      ['Shy', 'shy, blush, looking away', 'shy', 'cute'],
      ['Flustered', 'flustered, blush, nervous', 'flustered', 'cute,nervous'],
      ['Bashful', 'bashful, light blush, looking away', 'shy', 'cute,gentle'],
      ['Nervous Smile', 'nervous smile, sweatdrop', 'nervous-smile', 'shy,nervous'],
      ['Sheepish Smile', 'sheepish smile, blush', 'nervous-smile', 'cute,awkward'],
      ['Looking Away Shyly', 'looking away, shy, blush', 'shy-side', 'cute,shy'],
      ['Covering Face', 'covering face, embarrassed, blush', 'embarrassed', 'cute,shy'],
      ['Starry-Eyed', 'starry eyes, smile', 'starry', 'cute,excited'],
    ],
    'Smug & Playful': [
      ['Smirk', 'smirk', 'smirk', 'smug,confident'],
      ['Smug', 'smug', 'smug', 'confident'],
      ['Smug Smile', 'smug smile, half-closed eyes', 'smug', 'confident,playful'],
      ['Doyagao', 'doyagao, smug', 'doyagao', 'confident,playful'],
      ['Sly Smile', 'sly smile, narrowed eyes', 'sly', 'playful,confident'],
      ['Mischievous Smile', 'mischievous smile', 'mischievous', 'playful'],
      ['Evil Smile', 'evil smile, narrowed eyes', 'evil-smile', 'dark,playful'],
      ['Evil Grin', 'evil grin, teeth', 'evil-grin', 'dark,intense'],
      ['Teasing', 'teasing smile, tongue out', 'teasing', 'playful'],
      ['Seductive Smile', 'seductive smile, half-closed eyes', 'seductive', 'confident'],
      ['Confident', 'confident, smile', 'proud', 'confident'],
      ['Cheeky', 'cheeky smile, fang', 'fang', 'playful,cute'],
    ],
    'Angry & Annoyed': [
      ['Angry', 'angry, furrowed brow', 'angry', 'intense'],
      ['Annoyed', 'annoyed, frown', 'annoyed', 'mild'],
      ['Frown', 'frown', 'frown', 'sad,angry'],
      ['Scowl', 'scowl, glaring', 'scowl', 'intense'],
      ['Glare', 'glaring, narrowed eyes', 'glare', 'intense'],
      ['Furrowed Brow', 'furrowed brow, serious', 'serious', 'angry,focused'],
      ['Clenched Teeth', 'clenched teeth, angry', 'clenched', 'intense'],
      ['Gritted Teeth', 'gritted teeth, glaring', 'clenched', 'intense'],
      ['Pout', 'pout, annoyed', 'pout', 'cute,angry'],
      ['Frustrated', 'frustrated, frown, sweat', 'frustrated', 'angry,nervous'],
      ['Yelling', 'yelling, angry, open mouth', 'yell', 'intense,open mouth'],
      ['Rage', 'rage, shouting, clenched teeth', 'rage', 'intense'],
    ],
    'Sad & Crying': [
      ['Sad', 'sad, frown', 'sad', 'gentle'],
      ['Gloomy', 'gloomy, downcast eyes', 'gloomy', 'sad'],
      ['Tearing Up', 'tearing up, sad', 'tearing', 'sad,gentle'],
      ['Tears', 'tears, sad', 'cry', 'sad'],
      ['Crying', 'crying, tears', 'cry', 'sad,intense'],
      ['Sobbing', 'sobbing, crying, tears', 'sob', 'sad,intense'],
      ['Wavy Mouth', 'wavy mouth, worried', 'wavy', 'sad,nervous'],
      ['Trembling Lips', 'trembling lips, tearing up', 'wavy', 'sad,gentle'],
      ['Disappointed', 'disappointed, downcast eyes', 'disappointed', 'sad'],
      ['Lonely', 'lonely, sad, distant gaze', 'gloomy', 'sad'],
      ['Depressed', 'depressed, empty eyes, frown', 'depressed', 'sad,dark'],
      ['Heartbroken', 'heartbroken, crying, tears', 'sob', 'sad,intense'],
    ],
    'Surprised & Afraid': [
      ['Surprised', 'surprised, wide eyes, open mouth', 'surprised', 'open mouth'],
      ['Shocked', 'shocked, wide eyes, open mouth', 'shocked', 'intense'],
      ['Startled', 'startled, wide eyes', 'startled', 'intense'],
      ['Wide-Eyed', 'wide-eyed', 'wide-eyed', 'alert'],
      ['Scared', 'scared, worried, sweat', 'scared', 'nervous'],
      ['Terrified', 'terrified, wide eyes, open mouth', 'terrified', 'intense'],
      ['Nervous', 'nervous, sweatdrop', 'nervous', 'mild'],
      ['Worried', 'worried, furrowed brow', 'worried', 'sad,nervous'],
      ['Panicking', 'panicking, sweat, open mouth', 'panic', 'intense,nervous'],
      ['Confused', 'confused, raised eyebrow', 'confused', 'questioning'],
      ['Raised Eyebrow', 'raised eyebrow, skeptical', 'raised-brow', 'questioning'],
      ['Aghast', 'aghast, pale, wide eyes', 'aghast', 'intense'],
    ],
    'Neutral & Serious': [
      ['Expressionless', 'expressionless', 'neutral', 'neutral'],
      ['Neutral', 'neutral expression', 'neutral', 'neutral'],
      ['Serious', 'serious, focused', 'serious', 'focused'],
      ['Bored', 'bored, half-closed eyes', 'bored', 'neutral'],
      ['Blank Stare', 'blank stare, expressionless', 'blank', 'neutral'],
      ['Deadpan', 'deadpan, expressionless', 'deadpan', 'neutral,comedic'],
      ['Stoic', 'stoic, serious', 'stoic', 'neutral,focused'],
      ['Calm', 'calm, relaxed', 'calm', 'gentle'],
      ['Poker Face', 'poker face, expressionless', 'neutral', 'neutral'],
      ['Skeptical', 'skeptical, raised eyebrow', 'raised-brow', 'questioning'],
      ['Unimpressed', 'unimpressed, half-closed eyes', 'unimpressed', 'neutral'],
      ['Contemplative', 'contemplative, distant gaze', 'thoughtful', 'focused'],
    ],
    'Sleepy & Tired': [
      ['Sleepy', 'sleepy, half-closed eyes', 'sleepy', 'tired'],
      ['Tired', 'tired, half-closed eyes', 'tired', 'tired'],
      ['Drowsy', 'drowsy, sleepy', 'sleepy', 'tired'],
      ['Yawning', 'yawning, closed eyes, open mouth', 'yawn', 'tired,open mouth'],
      ['Exhausted', 'exhausted, bags under eyes', 'exhausted', 'tired'],
      ['Bags Under Eyes', 'bags under eyes, tired', 'exhausted', 'tired'],
      ['Drooling Sleepily', 'sleepy, drooling, half-closed eyes', 'drool', 'tired,cute'],
      ['Waking Up', 'waking up, sleepy, rubbing eyes', 'sleepy', 'tired'],
      ['Eyes Closed', 'closed eyes, calm', 'closed', 'calm'],
      ['Dozing', 'dozing, closed eyes', 'closed', 'tired'],
    ],
    'Eyes & Gaze': [
      ['Wink', 'wink, smile', 'wink', 'cute,playful'],
      ['One Eye Closed', 'one eye closed', 'wink-neutral', 'eyes'],
      ['Closed Eyes', 'closed eyes', 'closed', 'eyes,calm'],
      ['Happy Eyes', 'happy eyes, smile', 'closed-smile', 'eyes,happy'],
      ['Half-Closed Eyes', 'half-closed eyes', 'half-closed', 'eyes'],
      ['Jitome', 'jitome, expressionless', 'jitome', 'eyes,neutral'],
      ['Tareme', 'tareme, gentle eyes', 'tareme', 'eyes,gentle'],
      ['Tsurime', 'tsurime, sharp eyes', 'tsurime', 'eyes,intense'],
      ['Narrowed Eyes', 'narrowed eyes', 'narrowed', 'eyes,intense'],
      ['Rolling Eyes', 'rolling eyes, annoyed', 'eye-roll', 'eyes,annoyed'],
      ['Cross-Eyed', 'cross-eyed', 'cross-eyed', 'eyes,comedic'],
      ['Looking Up', 'looking up', 'look-up', 'eyes,gaze'],
      ['Looking Down', 'looking down', 'look-down', 'eyes,gaze'],
      ['Looking to the Side', 'looking to the side', 'look-side', 'eyes,gaze'],
    ],
    'Mouth & Gestures': [
      ['Tongue Out', 'tongue out', 'tongue', 'playful,mouth'],
      ['Playful Tongue', 'tongue out, wink', 'teasing', 'playful,mouth'],
      [':P', ':p, tongue out', 'tongue', 'playful,mouth'],
      ['Parted Lips', 'parted lips', 'parted', 'mouth,subtle'],
      ['Puckered Lips', 'puckered lips', 'kiss', 'mouth'],
      ['Kiss', 'kiss, puckered lips, closed eyes', 'kiss-closed', 'romantic,mouth'],
      ['Lip Bite', 'biting own lip', 'lip-bite', 'mouth'],
      ['Licking Lips', 'licking lips, tongue', 'lick-lips', 'mouth'],
      ['Cheek Puff', 'puffed cheeks, pout', 'cheek-puff', 'cute,mouth'],
      ['Upper Teeth', 'upper teeth, smile', 'teeth', 'mouth'],
      ['Clenched Mouth', 'clenched mouth, serious', 'clenched', 'mouth,intense'],
      ['Drooling', 'drooling, open mouth', 'drool', 'mouth,comedic'],
    ],
    'Comedic & Intense': [
      ['Ahegao', 'ahegao, rolling eyes, tongue out', 'ahegao', 'intense,comedic'],
      ['Crazy Eyes', 'crazy eyes, wide eyes', 'crazy', 'intense'],
      ['Crazy Smile', 'crazy smile, wide eyes, grin', 'crazy-smile', 'intense'],
      ['Yandere', 'yandere, crazy eyes, evil smile', 'yandere', 'dark,intense'],
      ['Disgusted', 'disgusted, grimace', 'disgust', 'intense'],
      ['Grimace', 'grimace, clenched teeth', 'grimace', 'intense'],
      ['Facepalm', 'facepalm, annoyed', 'facepalm', 'comedic,annoyed'],
      ['Squeezed Eyes', '>_<, squeezed eyes', 'squeezed', 'comedic'],
      [':3', ':3, smile', 'cat-mouth', 'cute,comedic'],
      [':D', ':d, open mouth, smile', 'grin', 'happy,comedic'],
      [':O', ':o, open mouth, surprised', 'surprised', 'surprised,comedic'],
      ['Sweatdrop', 'sweatdrop, nervous', 'nervous', 'comedic,nervous'],
    ],
  }).flatMap(([category, rows]) => rows.map(([name, tags, faceStyle, traits]) => ({
    id: `expression-${name.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    name,
    tags,
    categories: [category],
    traits: String(traits || '').split(',').filter(Boolean),
    faceStyle,
  })));

  // Only these fixed data files are fetched. They are parsed as JSON arrays; no remote JS is executed.
  const DATASETS = {
    clothing: {
      label: 'Clothing',
      icon: '👗',
      url: 'https://raw.githubusercontent.com/nregret/Comfyui-Anima-Tools/refs/heads/main/js/clothing_data.js',
      expectedVar: 'clothingData',
    },
    backgrounds: {
      label: 'Backgrounds',
      icon: '🌄',
      url: 'https://raw.githubusercontent.com/nregret/Comfyui-Anima-Tools/refs/heads/main/js/background_data.js',
      expectedVar: 'backgroundData',
    },
    poses: {
      label: 'Poses',
      icon: '🕺',
      url: 'https://raw.githubusercontent.com/nregret/Comfyui-Anima-Tools/refs/heads/main/js/pose_data.js',
      expectedVar: 'poseData',
    },
    expressions: {
      label: 'Expressions',
      icon: '😳',
      items: EXPRESSION_DATA,
    },
  };

  // Preview URLs from the current datasets are served through jsDelivr.
  // Unknown hosts are not loaded as images.
  const ALLOWED_IMAGE_HOSTS = new Set(['cdn.jsdelivr.net']);


  // Fixed colors keep each category visually consistent across cards.
  const CATEGORY_COLORS = Object.freeze({
    // Clothing
    'Casual & Daily': '#ffd400',
    'Dress & Gown': '#ff1787',
    'Fantasy & Cosplay': '#4cff24',
    'Revealing': '#ff67d4',
    'Swimsuit & Lingerie': '#ff303b',
    'Uniform & Suit': '#1754ff',

    // Backgrounds
    'Fantasy & Sci-Fi': '#1754ff',
    'Minimalist & Abstract': '#ff7900',
    'Nature & Outdoors': '#55ed18',
    'Urban & Daily': '#ffd400',

    // Poses
    'Adjusting & Dressing': '#16e7ef',
    'Daily & Miscellaneous': '#ffd400',
    'Duo & Interaction': '#ff252e',
    'Gestures & Arms': '#ef68d7',
    'Lying & Prone': '#591cff',
    'Props & Holding': '#50ef20',
    'Sitting Poses': '#c000ff',
    'Standing & Dynamic': '#139df5',
  });

  const CATEGORY_FALLBACK_COLORS = Object.freeze([
    '#ff1787', '#55ed18', '#1754ff', '#ffd400', '#ff7900', '#c000ff', '#16e7ef', '#ff303b'
  ]);

  const state = {
    open: false,
    active: 'clothing',
    data: new Map(),
    query: '',
    category: '',
    page: 1,
    loadedPages: 1,
    loadingMore: false,
    loading: false,
    lastCopied: '',
    tagFilters: new Set(),
    tagFilterSearch: '',
    tagSelections: new Map(),
  };

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = String(value);
      else if (key === 'title') node.title = String(value);
      else if (key === 'type') node.type = String(value);
      else if (key === 'placeholder') node.placeholder = String(value);
      else if (key === 'value') node.value = String(value);
      else if (key === 'href') node.href = String(value);
      else if (key === 'target') node.target = String(value);
      else if (key === 'rel') node.rel = String(value);
      else if (key === 'loading') node.loading = String(value);
      else if (key === 'referrerPolicy') node.referrerPolicy = String(value);
      else if (key.startsWith('data-')) node.setAttribute(key, String(value));
      else node.setAttribute(key, String(value));
    }
    for (const child of children.flat()) {
      if (child === undefined || child === null) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #adx-extra-launcher {
        position: fixed; right: 20px; bottom: 55px; z-index: 2147483000;
        border: 1px solid rgba(255,255,255,.16); border-radius: 12px;
        background: #17191f; color: #f5f6f8; padding: 10px 14px;
        font: 600 14px/1.2 system-ui, -apple-system, Segoe UI, sans-serif;
        box-shadow: 0 10px 30px rgba(0,0,0,.35); cursor: pointer;
      }
      #adx-extra-launcher:hover { background: #22252d; }
      #adx-extra-overlay {
        position: fixed; inset: 0; z-index: 2147483001; display: none;
        background: rgba(6,7,10,.72); backdrop-filter: blur(5px);
        align-items: center; justify-content: center; padding: 2vh 2vw;
        font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      }
      #adx-extra-overlay.adx-open { display: flex; }
      #adx-extra-modal {
        width: 94vw;
        height: 90vh;
        max-width: calc(100vw - 24px);
        max-height: calc(100vh - 24px);
        background: #111318; color: #eceef2; border: 1px solid #30343d;
        border-radius: 16px; overflow: hidden; display: flex; flex-direction: column;
        box-shadow: 0 22px 70px rgba(0,0,0,.55);
      }
      .adx-head { display:flex; align-items:center; gap:12px; padding:14px 16px; border-bottom:1px solid #2b2f37; flex-wrap:wrap; }
      .adx-title { font-weight:750; font-size:18px; white-space:nowrap; }
      .adx-sub { color:#9299a6; font-size:12px; }
      .adx-spacer { flex:1; }
      .adx-iconbtn, .adx-btn {
        border:1px solid #353a44; background:#1b1e25; color:#e9ebef;
        border-radius:9px; cursor:pointer; padding:8px 11px; font:600 13px/1 system-ui;
      }
      .adx-iconbtn:hover, .adx-btn:hover { background:#282c35; }
      .adx-iconbtn:disabled, .adx-btn:disabled { opacity:.45; cursor:default; background:#17191f; }
      .adx-tabs { display:flex; gap:8px; padding:10px 16px 0; overflow-x:auto; flex:0 0 auto; }
      .adx-tab {
        border:1px solid #30343d; border-bottom:0; background:#171a20; color:#aeb4bf;
        padding:9px 14px; border-radius:10px 10px 0 0; cursor:pointer; font-weight:650;
      }
      .adx-tab.adx-active { background:#252a34; color:#fff; }
      .adx-toolbar {
        display:grid; grid-template-columns:minmax(220px,1fr) minmax(180px,300px) auto;
        gap:10px; padding:12px 16px; border-top:1px solid #30343d; border-bottom:1px solid #2b2f37;
        background:#15181e;
      }
      .adx-input, .adx-select {
        width:100%; box-sizing:border-box; border:1px solid #343944; background:#0e1014; color:#edf0f4;
        border-radius:9px; padding:9px 11px; outline:none; font:14px system-ui;
      }
      .adx-input:focus, .adx-select:focus { border-color:#6c7a96; }
      .adx-status { align-self:center; color:#9da4af; font-size:12px; white-space:nowrap; }
      .adx-main { flex:1; min-height:0; display:flex; overflow:hidden; }
      .adx-sidebar {
        width:clamp(220px,17vw,285px); flex:0 0 auto; min-height:0;
        border-right:1px solid #2b2f37; background:#121419;
        display:flex; flex-direction:column;
      }
      .adx-sidebar-head { padding:12px 12px 8px; border-bottom:1px solid #272b33; }
      .adx-sidebar-titleline { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
      .adx-sidebar-title { font-size:12px; font-weight:800; letter-spacing:.08em; color:#c7ccd5; }
      .adx-sidebar-count { color:#7f8794; font-size:11px; margin-left:auto; }
      .adx-sidebar-actions { display:flex; gap:6px; margin-top:8px; }
      .adx-sidebar-actions .adx-btn { padding:7px 9px; font-size:11px; }
      .adx-tagfilter-list { flex:1; min-height:0; overflow:auto; padding:7px 8px 12px; }
      .adx-tagfilter-row {
        display:grid; grid-template-columns:18px minmax(0,1fr) auto; gap:7px; align-items:center;
        padding:6px 7px; border-radius:7px; color:#c4cad4; cursor:pointer; user-select:none;
        font-size:11.5px;
      }
      .adx-tagfilter-row:hover { background:#1b1f26; }
      .adx-tagfilter-row.adx-selected { background:#242a33; color:#fff; }
      .adx-tagfilter-row input { margin:0; accent-color:#d62f83; }
      .adx-tagfilter-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .adx-tagfilter-num { color:#7d8592; font-size:10.5px; }
      .adx-body { flex:1; min-width:0; min-height:0; overflow:auto; padding:14px 16px 20px; }
      .adx-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(clamp(210px,12vw,280px),1fr)); gap:12px; }
      .adx-card { background:#171a20; border:1px solid #2d323b; border-radius:12px; overflow:hidden; min-width:0; }
      .adx-preview {
        position:relative; aspect-ratio:2 / 3; height:auto; background:#0b0d11;
        display:flex; align-items:center; justify-content:center; color:#606773; overflow:hidden;
      }
      .adx-preview.adx-clickable { cursor:pointer; }
      .adx-preview.adx-expression { aspect-ratio:1 / 1; }
      .adx-preview img { width:100%; height:100%; object-fit:contain; display:block; background:#0b0d11; }
      .adx-preview canvas { max-width:100%; max-height:100%; width:auto; height:auto; display:block; background:#0b0d11; }
      .adx-preview-size {
        position:absolute; right:7px; bottom:7px; z-index:2;
        padding:3px 6px; border-radius:6px;
        background:rgba(5,7,10,.78); color:#e7eaf0;
        font:600 10px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;
        pointer-events:none; opacity:.82;
      }
      .adx-preview-quality {
        position:absolute; left:7px; top:7px; z-index:2;
        padding:4px 7px; border-radius:999px;
        background:rgba(5,7,10,.84); color:#edf1f6;
        border:1px solid rgba(255,255,255,.12);
        font:700 10px/1 system-ui,-apple-system,Segoe UI,sans-serif;
        pointer-events:none; letter-spacing:.02em;
      }
      .adx-preview-quality.adx-hd {
        background:rgba(26,96,58,.92); color:#f1fff5; border-color:rgba(156,255,196,.25);
      }
      .adx-preview-quality.adx-sd {
        background:rgba(96,64,10,.92); color:#fff4df; border-color:rgba(255,221,158,.22);
      }
      .adx-preview-quality.adx-local {
        background:rgba(92,49,118,.94); color:#fff2ff; border-color:rgba(239,184,255,.28);
      }

      #adx-image-lightbox {
        position:fixed; inset:0; z-index:2147483004; display:none;
        background:rgba(3,4,7,.93); backdrop-filter:blur(7px);
        font-family:system-ui,-apple-system,Segoe UI,sans-serif;
      }
      #adx-image-lightbox.adx-open { display:flex; flex-direction:column; }
      .adx-lightbox-head {
        flex:0 0 auto; min-height:52px; display:flex; align-items:center; gap:10px;
        padding:8px 12px; background:rgba(17,19,24,.96);
        border-bottom:1px solid #30343d; color:#eef0f4;
      }
      .adx-lightbox-title {
        min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        font-size:14px; font-weight:700;
      }
      .adx-lightbox-meta { color:#9ea5b0; font-size:12px; white-space:nowrap; }
      .adx-lightbox-stage {
        flex:1; min-height:0; overflow:auto; display:flex;
        align-items:center; justify-content:center; padding:18px;
      }
      .adx-lightbox-stage.adx-actual { align-items:flex-start; justify-content:flex-start; }
      .adx-lightbox-canvas {
        display:block; background:#090b0f; box-shadow:0 12px 45px rgba(0,0,0,.55);
        cursor:zoom-in;
      }
      .adx-lightbox-stage:not(.adx-actual) .adx-lightbox-canvas {
        max-width:calc(100vw - 40px); max-height:calc(100vh - 92px);
        width:auto; height:auto;
      }
      .adx-lightbox-stage.adx-actual .adx-lightbox-canvas {
        max-width:none; max-height:none; width:auto; height:auto; cursor:zoom-out;
      }
      .adx-lightbox-loading, .adx-lightbox-error { color:#aeb5c0; padding:30px; text-align:center; }
      .adx-lightbox-error { color:#ffb0b0; }
      .adx-cardbody { padding:10px; display:flex; flex-direction:column; gap:8px; }
      .adx-name { font-size:14px; font-weight:700; color:#f3f4f6; overflow-wrap:anywhere; }
      .adx-tags { color:#aeb5c0; font-size:11.5px; line-height:1.35; max-height:4.1em; overflow:hidden; overflow-wrap:anywhere; }
      .adx-cats { display:flex; gap:5px; flex-wrap:wrap; min-height:20px; }
      .adx-chip {
        --adx-cat-color:#abb3bf;
        appearance:none; background:#1b1e25; color:var(--adx-cat-color);
        border:1px solid var(--adx-cat-color); border-radius:999px;
        padding:3px 7px; font:600 10.5px/1.25 system-ui,-apple-system,Segoe UI,sans-serif;
        cursor:pointer; opacity:.92; transition:background .12s ease, box-shadow .12s ease, transform .12s ease;
      }
      .adx-chip:hover {
        background:color-mix(in srgb, var(--adx-cat-color) 16%, #1b1e25);
        box-shadow:0 0 0 1px color-mix(in srgb, var(--adx-cat-color) 55%, transparent);
        transform:translateY(-1px); opacity:1;
      }
      .adx-chip.adx-category-active {
        background:color-mix(in srgb, var(--adx-cat-color) 25%, #171a20);
        box-shadow:0 0 0 1px var(--adx-cat-color);
        opacity:1;
      }
      .adx-copy { width:100%; margin-top:2px; }
      .adx-name.adx-editable { cursor:pointer; }
      .adx-name.adx-editable:hover { color:#ff88c2; }

      #adx-tag-editor {
        position:fixed; inset:0; z-index:2147483003; display:none;
        background:rgba(3,4,7,.86); backdrop-filter:blur(7px);
        align-items:center; justify-content:center; padding:3vh 3vw;
        font-family:system-ui,-apple-system,Segoe UI,sans-serif;
      }
      #adx-tag-editor.adx-open { display:flex; }
      .adx-editor-panel {
        width:min(1120px,94vw); height:min(760px,90vh); min-height:420px;
        background:#111318; border:1px solid #333844; border-radius:16px; overflow:hidden;
        box-shadow:0 24px 80px rgba(0,0,0,.6); display:flex; flex-direction:column; color:#eef0f4;
      }
      .adx-editor-head {
        display:flex; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid #2b2f37;
        background:#15181e;
      }
      .adx-editor-title { font-size:16px; font-weight:800; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .adx-editor-content { flex:1; min-height:0; display:grid; grid-template-columns:minmax(280px,43%) 1fr; }
      .adx-editor-image-wrap {
        min-height:0; background:#090b0f; border-right:1px solid #2b2f37;
        display:flex; align-items:center; justify-content:center; padding:18px; overflow:hidden;
      }
      .adx-editor-image-wrap.adx-clickable { cursor:zoom-in; }
      .adx-editor-image-wrap canvas { max-width:100%; max-height:100%; width:auto; height:auto; display:block; }
      .adx-editor-tags { min-width:0; min-height:0; display:flex; flex-direction:column; }
      .adx-editor-toolbar {
        display:flex; align-items:center; gap:7px; flex-wrap:wrap; padding:12px 14px; border-bottom:1px solid #292d35;
      }
      .adx-editor-counter { font-size:12px; font-weight:800; color:#d8dde6; margin-right:auto; }
      .adx-editor-chipbox {
        flex:1; min-height:0; overflow:auto; padding:14px; display:flex; flex-wrap:wrap; align-content:flex-start; gap:8px;
      }
      .adx-editor-chip {
        border:1px solid transparent; border-radius:999px; padding:7px 10px; cursor:pointer; user-select:none;
        font:700 12px/1 system-ui,-apple-system,Segoe UI,sans-serif; transition:filter .12s ease, transform .12s ease;
      }
      .adx-editor-chip:hover { filter:brightness(1.12); transform:translateY(-1px); }
      .adx-editor-chip.adx-on { background:#1fb84d; border-color:#65e184; color:#08150c; }
      .adx-editor-chip.adx-off { background:#d52d3d; border-color:#f16b77; color:#fff; }
      .adx-editor-footer {
        display:flex; gap:8px; justify-content:flex-end; align-items:center; padding:11px 14px; border-top:1px solid #2b2f37; background:#15181e;
      }
      .adx-editor-hint { margin-right:auto; color:#838b98; font-size:11px; }
      .adx-empty { padding:50px 15px; text-align:center; color:#8d95a1; }
      .adx-footer { display:flex; align-items:center; gap:8px; padding:10px 16px; border-top:1px solid #2b2f37; background:#15181e; }
      .adx-page-btn {
        background:#293448; border-color:#586b89; color:#f4f7ff;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
      }
      .adx-page-btn:hover { background:#35445d; border-color:#7188ad; }
      .adx-page-btn:disabled { background:#1a202b; border-color:#303a4b; color:#747f91; opacity:.62; }
      .adx-pageinfo { color:#9ba2ad; font-size:12px; }
      .adx-last { flex:1; min-width:0; color:#8f97a3; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .adx-error { color:#ffb0b0; padding:20px; white-space:pre-wrap; }
      .adx-loading { padding:45px; text-align:center; color:#aeb5c0; }
      @media (max-width: 760px) {
        #adx-extra-overlay { padding:0; }
        #adx-extra-modal { width:100vw; height:100vh; border-radius:0; }
        .adx-toolbar { grid-template-columns:1fr; }
        .adx-status { white-space:normal; }
        .adx-main { flex-direction:column; }
        .adx-sidebar { width:100%; max-height:210px; border-right:0; border-bottom:1px solid #2b2f37; }
        .adx-grid { grid-template-columns:repeat(auto-fill,minmax(165px,1fr)); }
        .adx-preview { aspect-ratio:2 / 3; height:auto; }
        .adx-editor-content { grid-template-columns:1fr; }
        .adx-editor-image-wrap { display:none; }
      }
    `;
    document.head.appendChild(style);
  }

  function safeImageUrl(value) {
    if (typeof value !== 'string' || !value) return '';
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || !ALLOWED_IMAGE_HOSTS.has(u.hostname)) return '';
      return u.href;
    } catch {
      return '';
    }
  }

  function asString(value, max = 12000) {
    return typeof value === 'string' ? value.slice(0, max) : '';
  }

  function asStringArray(value, maxItems = 50) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, maxItems).filter(v => typeof v === 'string').map(v => v.slice(0, 250));
  }

  function validateDataset(items) {
    if (!Array.isArray(items)) throw new Error('Dataset is not an array.');
    if (items.length > 10000) throw new Error(`Unexpected dataset size: ${items.length}`);

    return items.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const id = asString(item.id, 200) || `item-${index}`;
      const name = asString(item.name, 500);
      const tags = asString(item.tags, 12000);
      if (!name && !tags) return null;
      return {
        id,
        name: name || tags.slice(0, 80),
        tags,
        categories: asStringArray(item.categories, 20),
        traits: asStringArray(item.traits, 80),
        faceStyle: asString(item.faceStyle, 60),
        preview: safeImageUrl(
            item.preview ||
            item.image ||
            item.thumbnail ||
            item.thumb ||
            item.previewUrl
        ),
      };
    }).filter(Boolean);
  }

  function parseDataFile(text, expectedVar) {
    if (typeof text !== 'string' || text.length < 10) throw new Error('Empty dataset response.');
    const prefix = `const ${expectedVar}`;
    const prefixAt = text.indexOf(prefix);
    if (prefixAt < 0) throw new Error(`Expected ${expectedVar} declaration was not found.`);

    const start = text.indexOf('[', prefixAt);
    const end = text.lastIndexOf('];');
    if (start < 0 || end < start) throw new Error('Could not locate the data array.');

    const jsonOnly = text.slice(start, end + 1);
    let parsed;
    try {
      parsed = JSON.parse(jsonOnly);
    } catch (err) {
      throw new Error(`Dataset is no longer strict JSON-compatible: ${err.message}`);
    }
    return validateDataset(parsed);
  }

  function requestText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 20000,
        anonymous: true,
        headers: { Accept: 'text/plain' },
        onload: (r) => {
          if (r.status >= 200 && r.status < 300) resolve(r.responseText);
          else reject(new Error(`HTTP ${r.status}`));
        },
        onerror: () => reject(new Error('Network request failed.')),
        ontimeout: () => reject(new Error('Network request timed out.')),
      });
    });
  }

  function cacheKey(key) {
    return `adx-extra-tags:${VERSION}:${key}`;
  }

  async function loadDataset(key, force = false) {
    const spec = DATASETS[key];
    if (!spec) throw new Error('Unknown dataset.');
    if (!force && state.data.has(key)) return state.data.get(key);

    if (Array.isArray(spec.items)) {
      const parsed = validateDataset(spec.items);
      state.data.set(key, parsed);
      return parsed;
    }

    const ck = cacheKey(key);
    if (!force) {
      const cached = GM_getValue(ck, null);
      if (cached && typeof cached === 'object' && typeof cached.raw === 'string' && Number.isFinite(cached.time)) {
        if (Date.now() - cached.time < CACHE_TTL_MS) {
          try {
            const parsed = parseDataFile(cached.raw, spec.expectedVar);
            state.data.set(key, parsed);
            return parsed;
          } catch {
            GM_deleteValue(ck);
          }
        }
      }
    }

    const raw = await requestText(spec.url);
    const parsed = parseDataFile(raw, spec.expectedVar);
    GM_setValue(ck, { time: Date.now(), raw });
    state.data.set(key, parsed);
    return parsed;
  }

  function cleanCategory(category) {
    const s = String(category || '').trim();
    const m = s.match(/\(([^()]*)\)\s*$/);
    return (m ? m[1] : s).trim();
  }


  function categoryColor(category) {
    const label = cleanCategory(category);
    if (CATEGORY_COLORS[label]) return CATEGORY_COLORS[label];

    let hash = 0;
    for (let i = 0; i < label.length; i++) hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
    return CATEGORY_FALLBACK_COLORS[Math.abs(hash) % CATEGORY_FALLBACK_COLORS.length];
  }

  function setCategoryFilter(category) {
    const next = state.category === category ? '' : category;
    state.category = next;
    state.page = 1;
    state.loadedPages = 1;
    if (categorySelect) categorySelect.value = next;
    renderResults();
  }

  function cleanTags(tags) {
    return String(tags || '').replace(/\s*,\s*/g, ', ').replace(/,\s*$/, '').trim();
  }

  function normalize(s) {
    return String(s || '').toLocaleLowerCase('en-US');
  }

  function splitPromptTags(tags) {
    const text = String(tags || '');
    const out = [];
    let cur = '';
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        cur += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        cur += ch;
        escaped = true;
        continue;
      }
      if (ch === ',') {
        const token = cur.trim();
        if (token) out.push(token);
        cur = '';
        continue;
      }
      cur += ch;
    }
    const tail = cur.trim();
    if (tail) out.push(tail);
    return out;
  }

  function itemPromptTags(item) {
    return splitPromptTags(item?.tags || '');
  }

  function itemTagKeySet(item) {
    return new Set(itemPromptTags(item).map(tag => normalize(tag)));
  }

  function selectionKey(item) {
    return `${state.active}:${item?.id || ''}`;
  }

  function getTagSelection(item) {
    const tags = itemPromptTags(item);
    const key = selectionKey(item);
    let set = state.tagSelections.get(key);
    if (!(set instanceof Set)) {
      set = new Set(tags.map((_, i) => i));
      state.tagSelections.set(key, set);
    }
    return { tags, set, key };
  }

  function classifyPreviewSize(width, height) {
    const w = Number(width) || 0;
    const h = Number(height) || 0;
    const isHD = (w >= 768 && h >= 1024) || (w >= 1024 && h >= 768);
    return {
      isHD,
      label: isHD ? 'HD' : 'SD',
      className: isHD ? 'adx-hd' : 'adx-sd',
      description: isHD ? 'HD' : 'SD',
    };
  }

  function formatPreviewMeta(width, height) {
    const info = classifyPreviewSize(width, height);
    return `${Number(width).toLocaleString()} × ${Number(height).toLocaleString()} px • ${info.description}`;
  }

  function makeExpressionCanvas(item, size = 600) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.setAttribute('aria-label', `${item?.name || 'Expression'} illustrated preview`);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return canvas;

    const s = String(item?.faceStyle || 'neutral');
    const has = (...parts) => parts.some(part => s.includes(part));
    const W = 600;
    ctx.save();
    ctx.scale(size / W, size / W);

    const palette = has('angry', 'rage', 'evil', 'yandere', 'crazy')
      ? ['#3d1d35', '#17131f']
      : has('sad', 'cry', 'sob', 'gloomy', 'depressed')
        ? ['#29415d', '#151c2c']
        : has('surprised', 'scared', 'panic', 'terrified', 'shocked')
          ? ['#4c385c', '#1c1729']
          : ['#4d385f', '#1d172b'];
    const bg = ctx.createLinearGradient(0, 0, 600, 600);
    bg.addColorStop(0, palette[0]);
    bg.addColorStop(1, palette[1]);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 600, 600);

    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#f2c5ff';
    for (const [x, y, r] of [[75, 90, 46], [530, 130, 65], [490, 500, 90], [95, 480, 55]]) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Shoulders, neck and hair silhouette.
    ctx.fillStyle = '#362742';
    ctx.beginPath(); ctx.ellipse(300, 585, 190, 105, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f5c8b4';
    ctx.fillRect(258, 430, 84, 105);
    ctx.fillStyle = '#2d2038';
    ctx.beginPath(); ctx.ellipse(300, 280, 220, 255, 0, 0, Math.PI * 2); ctx.fill();

    // Face and ears.
    ctx.fillStyle = '#ffd9c5';
    ctx.beginPath(); ctx.ellipse(117, 302, 32, 54, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(483, 302, 32, 54, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(300, 300, 178, 218, 0, 0, Math.PI * 2); ctx.fill();

    // Fringe.
    ctx.fillStyle = '#3a2947';
    ctx.beginPath();
    ctx.moveTo(125, 236);
    ctx.quadraticCurveTo(145, 55, 300, 68);
    ctx.quadraticCurveTo(475, 62, 479, 237);
    ctx.quadraticCurveTo(423, 182, 391, 147);
    ctx.quadraticCurveTo(365, 202, 332, 226);
    ctx.quadraticCurveTo(322, 166, 284, 125);
    ctx.quadraticCurveTo(267, 191, 214, 231);
    ctx.quadraticCurveTo(202, 177, 165, 158);
    ctx.quadraticCurveTo(166, 211, 125, 236);
    ctx.fill();

    const eyeY = 305;
    const wide = has('wide', 'surprised', 'shocked', 'startled', 'scared', 'terrified', 'panic', 'aghast', 'crazy', 'starry', 'excited', 'ahegao');
    const half = has('half', 'smug', 'doyagao', 'sly', 'seductive', 'bored', 'unimpressed', 'sleepy', 'tired', 'drool', 'jitome', 'narrowed', 'eye-roll');
    const closedBoth = has('closed-smile', 'laugh', 'relieved', 'kiss-closed', 'closed', 'yawn', 'squeezed');
    const winkLeft = has('wink', 'teasing');
    let gazeX = 0;
    let gazeY = 0;
    if (has('look-side')) gazeX = 12;
    if (has('look-up', 'eye-roll', 'ahegao')) gazeY = -10;
    if (has('look-down', 'gloomy', 'disappointed', 'depressed')) gazeY = 10;
    if (has('cross-eyed')) gazeX = 16;

    function drawClosedEye(cx, cy, inverted = false) {
      ctx.strokeStyle = '#513442';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 37, cy + (inverted ? -3 : 6));
      ctx.quadraticCurveTo(cx, cy + (inverted ? 19 : -16), cx + 37, cy + (inverted ? -3 : 6));
      ctx.stroke();
    }

    function drawEye(cx, cy, side) {
      const crossOffset = has('cross-eyed') ? (side < 0 ? 16 : -16) : gazeX;
      const rx = wide ? 44 : 42;
      const ry = wide ? 43 : half ? 17 : 33;
      ctx.fillStyle = '#fff8f5';
      ctx.strokeStyle = '#513442';
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

      if (has('starry')) {
        ctx.fillStyle = '#d75dba';
        ctx.save(); ctx.translate(cx + crossOffset, cy + gazeY); ctx.rotate(-Math.PI / 2);
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 8 : 23;
          const a = i * Math.PI / 5;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath(); ctx.fill(); ctx.restore();
      } else {
        ctx.fillStyle = has('crazy', 'yandere', 'evil') ? '#dc496d' : '#7d4d9e';
        ctx.beginPath(); ctx.arc(cx + crossOffset, cy + gazeY, wide ? 18 : 20, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#241528';
        ctx.beginPath(); ctx.arc(cx + crossOffset, cy + gazeY + 2, wide ? 9 : 11, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(cx + crossOffset - 6, cy + gazeY - 7, 5, 0, Math.PI * 2); ctx.fill();
      }
    }

    if (closedBoth) {
      drawClosedEye(215, eyeY, has('squeezed'));
      drawClosedEye(385, eyeY, has('squeezed'));
    } else {
      if (winkLeft) drawClosedEye(215, eyeY);
      else drawEye(215, eyeY, -1);
      drawEye(385, eyeY, 1);
    }

    // Brows carry much of the emotion even when eyes are closed.
    ctx.strokeStyle = '#49303f';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    const angry = has('angry', 'annoyed', 'scowl', 'glare', 'clenched', 'frustrated', 'yell', 'rage', 'evil', 'yandere', 'disgust', 'grimace');
    const sad = has('sad', 'gloomy', 'tear', 'cry', 'sob', 'wavy', 'disappointed', 'depressed', 'heartbroken', 'worried', 'scared');
    ctx.beginPath();
    if (angry) { ctx.moveTo(172, 248); ctx.lineTo(247, 270); ctx.moveTo(353, 270); ctx.lineTo(428, 248); }
    else if (sad) { ctx.moveTo(172, 266); ctx.lineTo(247, 244); ctx.moveTo(353, 244); ctx.lineTo(428, 266); }
    else if (has('raised-brow', 'confused')) { ctx.moveTo(174, 244); ctx.lineTo(244, 235); ctx.moveTo(354, 262); ctx.lineTo(426, 262); }
    else { ctx.moveTo(176, 252); ctx.lineTo(244, 247); ctx.moveTo(356, 247); ctx.lineTo(424, 252); }
    ctx.stroke();

    // Nose.
    ctx.strokeStyle = 'rgba(150,83,80,.45)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(301, 333); ctx.quadraticCurveTo(291, 363, 307, 367); ctx.stroke();

    // Mouth variants.
    ctx.strokeStyle = '#8a4053';
    ctx.fillStyle = '#8f3e55';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    const openMouth = has('grin', 'laugh', 'excited', 'fang', 'yell', 'rage', 'surprised', 'shocked', 'terrified', 'panic', 'aghast', 'yawn', 'drool', 'crazy-smile', 'ahegao');
    if (has('tongue', 'teasing', 'ahegao', 'lick-lips')) {
      ctx.beginPath(); ctx.ellipse(300, 420, 48, 34, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ef8fa5';
      ctx.beginPath(); ctx.ellipse(300, 438, 29, 31, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#be637b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(300, 432); ctx.lineTo(300, 454); ctx.stroke();
    } else if (has('kiss', 'pout', 'cheek-puff')) {
      ctx.beginPath(); ctx.moveTo(270, 413); ctx.quadraticCurveTo(294, 395, 300, 414); ctx.quadraticCurveTo(308, 395, 332, 413); ctx.quadraticCurveTo(305, 432, 300, 419); ctx.quadraticCurveTo(292, 433, 270, 413); ctx.fill();
    } else if (has('wavy')) {
      ctx.beginPath(); ctx.moveTo(250, 420); ctx.quadraticCurveTo(270, 400, 290, 420); ctx.quadraticCurveTo(310, 440, 330, 420); ctx.quadraticCurveTo(345, 405, 355, 422); ctx.stroke();
    } else if (has('cat-mouth')) {
      ctx.beginPath(); ctx.moveTo(300, 407); ctx.quadraticCurveTo(280, 429, 256, 410); ctx.moveTo(300, 407); ctx.quadraticCurveTo(321, 429, 344, 410); ctx.stroke();
    } else if (has('clenched', 'grimace', 'disgust')) {
      ctx.fillStyle = '#fff8ed'; ctx.strokeStyle = '#8a4053';
      ctx.beginPath(); ctx.roundRect(251, 395, 98, 48, 12); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(270, 399); ctx.lineTo(270, 439); ctx.moveTo(290, 399); ctx.lineTo(290, 439); ctx.moveTo(310, 399); ctx.lineTo(310, 439); ctx.moveTo(330, 399); ctx.lineTo(330, 439); ctx.stroke();
    } else if (has('parted', 'lip-bite', 'teeth')) {
      ctx.fillStyle = '#fff7ef';
      ctx.beginPath(); ctx.ellipse(300, 414, 45, has('parted') ? 12 : 20, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (has('lip-bite')) { ctx.fillStyle = '#e58aa0'; ctx.beginPath(); ctx.ellipse(300, 429, 38, 12, 0, 0, Math.PI * 2); ctx.fill(); }
    } else if (openMouth) {
      const rY = has('surprised', 'shocked', 'terrified', 'panic', 'aghast', 'yawn') ? 43 : 34;
      ctx.beginPath(); ctx.ellipse(300, 418, has('yell', 'rage') ? 54 : 47, rY, 0, 0, Math.PI * 2); ctx.fill();
      if (!has('surprised', 'shocked', 'terrified', 'panic', 'aghast')) {
        ctx.fillStyle = '#f29aad'; ctx.beginPath(); ctx.ellipse(300, 434, 28, 12, 0, 0, Math.PI * 2); ctx.fill();
      }
      if (has('fang')) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(328, 391); ctx.lineTo(345, 394); ctx.lineTo(335, 414); ctx.closePath(); ctx.fill(); }
    } else if (has('sad', 'gloomy', 'depressed', 'disappointed', 'frown', 'annoyed', 'angry', 'scowl', 'glare', 'frustrated', 'tear', 'cry', 'sob', 'worried', 'scared')) {
      ctx.beginPath(); ctx.moveTo(254, 428); ctx.quadraticCurveTo(300, 386, 346, 428); ctx.stroke();
    } else if (has('neutral', 'blank', 'deadpan', 'stoic', 'serious', 'bored', 'unimpressed', 'thoughtful', 'tired', 'sleepy')) {
      ctx.beginPath(); ctx.moveTo(267, 417); ctx.lineTo(333, 417); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(252, 404); ctx.quadraticCurveTo(300, 448, 348, 404); ctx.stroke();
    }

    // Blush and emotional effects.
    if (has('blush', 'embarrassed', 'shy', 'flustered', 'nervous-smile', 'seductive')) {
      ctx.strokeStyle = 'rgba(225,89,111,.72)'; ctx.lineWidth = 6;
      for (const x of [160, 178, 196, 404, 422, 440]) {
        ctx.beginPath(); ctx.moveTo(x - 8, 378); ctx.lineTo(x + 6, 365); ctx.stroke();
      }
    }
    if (has('tear', 'cry', 'sob')) {
      ctx.fillStyle = '#75cfff';
      for (const x of [215, 385]) { ctx.beginPath(); ctx.moveTo(x - 13, 344); ctx.quadraticCurveTo(x, 385, x + 15, 344); ctx.quadraticCurveTo(x, 359, x - 13, 344); ctx.fill(); }
    }
    if (has('nervous', 'flustered', 'frustrated', 'scared', 'panic')) {
      ctx.fillStyle = '#7fd8ff'; ctx.beginPath(); ctx.moveTo(466, 230); ctx.quadraticCurveTo(499, 278, 466, 300); ctx.quadraticCurveTo(433, 278, 466, 230); ctx.fill();
    }
    if (has('angry', 'rage')) {
      ctx.strokeStyle = '#ff6a7e'; ctx.lineWidth = 9; ctx.beginPath();
      ctx.moveTo(448, 174); ctx.lineTo(474, 153); ctx.lineTo(470, 184); ctx.lineTo(502, 180); ctx.stroke();
    }
    if (has('confused', 'raised-brow')) {
      ctx.fillStyle = '#f1c8ff'; ctx.font = 'bold 74px system-ui'; ctx.fillText('?', 457, 210);
    }

    // Caption keeps similar-looking micro-expressions distinguishable.
    ctx.fillStyle = 'rgba(13,10,20,.72)';
    ctx.fillRect(88, 526, 424, 52);
    ctx.fillStyle = '#fff';
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(item?.name || 'Expression').slice(0, 32), 300, 552);
    ctx.restore();
    return canvas;
  }

  function canUseActualZoom(width, height) {
    const stageMaxW = Math.max(240, window.innerWidth - 64);
    const stageMaxH = Math.max(240, window.innerHeight - 120);
    return Number(width) > stageMaxW || Number(height) > stageMaxH;
  }

  function filteredItems() {
    const items = state.data.get(state.active) || [];
    const terms = normalize(state.query).split(/\s+/).filter(Boolean);
    const selectedTags = [...state.tagFilters];

    return items.filter(item => {
      if (state.category && !item.categories.includes(state.category)) return false;

      if (selectedTags.length) {
        const itemTags = itemTagKeySet(item);
        if (!selectedTags.every(tag => itemTags.has(tag))) return false;
      }

      if (!terms.length) return true;
      const haystack = normalize([
        item.name,
        item.tags,
        item.categories.join(' '),
        item.traits.join(' '),
      ].join(' '));
      return terms.every(term => haystack.includes(term));
    });
  }

  function copyText(text) {
    const cleaned = cleanTags(text);
    if (!cleaned) return;
    try {
      GM_setClipboard(cleaned, 'text');
    } catch {
      navigator.clipboard?.writeText(cleaned).catch(() => {});
    }
    state.lastCopied = cleaned;
    renderFooter();
  }

  let overlay, body, searchInput, categorySelect, statusEl, footerEl, tabHost;
  let sidebarEl, sidebarSearchInput, sidebarListEl, sidebarCountEl;
  let tagEditor, tagEditorPanel, tagEditorTitle, tagEditorImageWrap, tagEditorCounter, tagEditorChipbox, tagEditorCopySelectedBtn;
  let currentEditorItem = null;
  let lightbox, lightboxStage, lightboxTitle, lightboxMeta, lightboxFitBtn, lightboxActualBtn, lightboxOpenOriginalBtn;
  let lightboxGeneration = 0;
  let lightboxCurrentUrl = '';
  let lightboxCurrentSize = null;
  let searchTimer = null;
  let scrollFrame = null;

  function buildShell() {
    addStyles();

    const launcher = el('button', { id: 'adx-extra-launcher', type: 'button', title: 'Clothing, backgrounds, poses and expressions' }, '✦ Anima Tags');
    launcher.addEventListener('click', openModal);

    overlay = el('div', { id: 'adx-extra-overlay' });
    const modal = el('section', { id: 'adx-extra-modal', role: 'dialog', 'aria-modal': 'true' });

    const source = el('a', {
      href: 'https://github.com/nregret/Comfyui-Anima-Tools', target: '_blank', rel: 'noopener noreferrer',
      class: 'adx-sub', title: 'Dataset source'
    }, 'source: Anima-Tools');

    const refresh = el('button', { class: 'adx-iconbtn', type: 'button', title: 'Discard 24h cache and reload this dataset' }, '↻ Refresh data');
    refresh.addEventListener('click', async () => {
      GM_deleteValue(cacheKey(state.active));
      state.data.delete(state.active);
      await activateTab(state.active, true);
    });

    const close = el('button', { class: 'adx-iconbtn', type: 'button', title: 'Close' }, '✕');
    close.addEventListener('click', closeModal);

    const head = el('div', { class: 'adx-head' },
      el('div', { class: 'adx-title' }, 'Anima Tag Browser'),
      el('div', { class: 'adx-sub' }, 'local UI • curated expressions • 24h remote cache'),
      source,
      el('div', { class: 'adx-spacer' }),
      refresh,
      close,
    );

    tabHost = el('div', { class: 'adx-tabs' });
    for (const [key, spec] of Object.entries(DATASETS)) {
      const b = el('button', { class: 'adx-tab', type: 'button', 'data-key': key }, `${spec.icon} ${spec.label}`);
      b.addEventListener('click', () => activateTab(key));
      tabHost.appendChild(b);
    }

    searchInput = el('input', {
      class: 'adx-input', type: 'search', placeholder: 'Search name, prompt tags, traits…',
    });
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.query = searchInput.value;
        state.page = 1;
        state.loadedPages = 1;
        renderResults();
      }, 180);
    });

    categorySelect = el('select', { class: 'adx-select' });
    categorySelect.addEventListener('change', () => {
      state.category = categorySelect.value;
      state.page = 1;
      state.loadedPages = 1;
      renderResults();
    });

    statusEl = el('div', { class: 'adx-status' });
    const toolbar = el('div', { class: 'adx-toolbar' }, searchInput, categorySelect, statusEl);

    buildTagSidebar();
    body = el('div', { class: 'adx-body' });
    body.addEventListener('scroll', () => {
      if (scrollFrame !== null) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        updateCurrentPageFromScroll();
        maybeAutoLoad();
      });
    }, { passive: true });
    footerEl = el('div', { class: 'adx-footer' });
    const main = el('div', { class: 'adx-main' }, sidebarEl, body);

    modal.append(head, tabHost, toolbar, main, footerEl);
    overlay.appendChild(modal);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) closeModal();
    });

    buildImageLightbox();
    buildTagEditor();

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (lightbox?.classList.contains('adx-open')) {
        closeImageLightbox();
      } else if (tagEditor?.classList.contains('adx-open')) {
        closeTagEditor();
      } else if (state.open) {
        closeModal();
      }
    });

    document.body.append(launcher, overlay, tagEditor, lightbox);
  }

  function buildTagSidebar() {
    sidebarEl = el('aside', { class: 'adx-sidebar' });
    sidebarCountEl = el('span', { class: 'adx-sidebar-count' }, '0 tags');
    sidebarSearchInput = el('input', {
      class: 'adx-input', type: 'search', placeholder: 'Search tags…',
    });
    sidebarSearchInput.addEventListener('input', () => {
      state.tagFilterSearch = sidebarSearchInput.value;
      renderTagSidebar();
    });

    const clearFilters = el('button', { class: 'adx-btn', type: 'button' }, 'Clear filters');
    clearFilters.addEventListener('click', () => {
      state.tagFilters.clear();
      state.page = 1;
      state.loadedPages = 1;
      renderTagSidebar();
      renderResults();
    });

    const head = el('div', { class: 'adx-sidebar-head' },
      el('div', { class: 'adx-sidebar-titleline' },
        el('span', { class: 'adx-sidebar-title' }, 'TAGS'),
        sidebarCountEl,
      ),
      sidebarSearchInput,
      el('div', { class: 'adx-sidebar-actions' }, clearFilters),
    );
    sidebarListEl = el('div', { class: 'adx-tagfilter-list' });
    sidebarEl.append(head, sidebarListEl);
  }

  function buildTagIndex(items) {
    const map = new Map();
    for (const item of items || []) {
      const seen = new Set();
      for (const tag of itemPromptTags(item)) {
        const key = normalize(tag);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const prev = map.get(key);
        if (prev) prev.count++;
        else map.set(key, { key, label: tag, count: 1 });
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'en'));
  }

  function renderTagSidebar() {
    if (!sidebarListEl) return;
    const items = state.data.get(state.active) || [];
    const q = normalize(state.tagFilterSearch).trim();
    const entries = buildTagIndex(items).filter(x => !q || normalize(x.label).includes(q));
    const totalUnique = buildTagIndex(items).length;
    sidebarCountEl.textContent = `${state.tagFilters.size} selected • ${totalUnique.toLocaleString()} total`;

    const frag = document.createDocumentFragment();
    for (const entry of entries) {
      const checked = state.tagFilters.has(entry.key);
      const input = el('input', { type: 'checkbox' });
      input.checked = checked;
      const row = el('label', { class: `adx-tagfilter-row${checked ? ' adx-selected' : ''}`, title: entry.label },
        input,
        el('span', { class: 'adx-tagfilter-name' }, entry.label),
        el('span', { class: 'adx-tagfilter-num' }, entry.count.toLocaleString()),
      );
      input.addEventListener('change', () => {
        if (input.checked) state.tagFilters.add(entry.key);
        else state.tagFilters.delete(entry.key);
        state.page = 1;
        state.loadedPages = 1;
        renderTagSidebar();
        renderResults();
      });
      frag.appendChild(row);
    }

    if (!entries.length) {
      sidebarListEl.replaceChildren(el('div', { class: 'adx-empty' }, 'No matching tags.'));
    } else {
      sidebarListEl.replaceChildren(frag);
    }
  }

  function buildTagEditor() {
    tagEditor = el('div', { id: 'adx-tag-editor', role: 'dialog', 'aria-modal': 'true' });
    tagEditorPanel = el('section', { class: 'adx-editor-panel' });

    tagEditorTitle = el('div', { class: 'adx-editor-title' }, 'Edit prompt tags');
    const close = el('button', { class: 'adx-iconbtn', type: 'button', title: 'Close tag editor' }, '✕');
    close.addEventListener('click', closeTagEditor);
    const head = el('div', { class: 'adx-editor-head' },
      tagEditorTitle,
      el('div', { class: 'adx-spacer' }),
      close,
    );

    tagEditorImageWrap = el('div', { class: 'adx-editor-image-wrap' }, 'No preview');
    tagEditorCounter = el('div', { class: 'adx-editor-counter' }, 'Prompt Tags · 0/0');
    tagEditorChipbox = el('div', { class: 'adx-editor-chipbox' });

    const selectAll = el('button', { class: 'adx-btn', type: 'button' }, 'Select all');
    const clearAll = el('button', { class: 'adx-btn', type: 'button' }, 'Clear all');
    const reset = el('button', { class: 'adx-btn', type: 'button' }, 'Reset');

    selectAll.addEventListener('click', () => {
      if (!currentEditorItem) return;
      const { tags, set, key } = getTagSelection(currentEditorItem);
      set.clear();
      tags.forEach((_, i) => set.add(i));
      state.tagSelections.set(key, set);
      renderTagEditorState();
    });
    clearAll.addEventListener('click', () => {
      if (!currentEditorItem) return;
      const { set, key } = getTagSelection(currentEditorItem);
      set.clear();
      state.tagSelections.set(key, set);
      renderTagEditorState();
    });
    reset.addEventListener('click', () => {
      if (!currentEditorItem) return;
      const { key } = getTagSelection(currentEditorItem);
      state.tagSelections.delete(key);
      renderTagEditorState();
    });

    const toolbar = el('div', { class: 'adx-editor-toolbar' },
      tagEditorCounter,
      selectAll,
      clearAll,
      reset,
    );

    const tagsPane = el('div', { class: 'adx-editor-tags' }, toolbar, tagEditorChipbox);
    const content = el('div', { class: 'adx-editor-content' }, tagEditorImageWrap, tagsPane);

    const copyAll = el('button', { class: 'adx-btn', type: 'button' }, 'Copy all');
    tagEditorCopySelectedBtn = el('button', { class: 'adx-btn', type: 'button' }, 'Copy selected');
    copyAll.addEventListener('click', () => {
      if (!currentEditorItem) return;
      copyText(currentEditorItem.tags);
      const old = copyAll.textContent;
      copyAll.textContent = 'Copied';
      setTimeout(() => { copyAll.textContent = old; }, 900);
    });
    tagEditorCopySelectedBtn.addEventListener('click', () => {
      if (!currentEditorItem) return;
      const { tags, set } = getTagSelection(currentEditorItem);
      const selected = tags.filter((_, i) => set.has(i)).join(', ');
      if (!selected) return;
      copyText(selected);
      const old = tagEditorCopySelectedBtn.textContent;
      tagEditorCopySelectedBtn.textContent = 'Copied';
      setTimeout(() => { tagEditorCopySelectedBtn.textContent = old; }, 900);
    });

    const footer = el('div', { class: 'adx-editor-footer' },
      el('div', { class: 'adx-editor-hint' }, 'Green = included • Red = excluded'),
      copyAll,
      tagEditorCopySelectedBtn,
    );

    tagEditorPanel.append(head, content, footer);
    tagEditor.appendChild(tagEditorPanel);
    tagEditor.addEventListener('mousedown', (e) => {
      if (e.target === tagEditor) closeTagEditor();
    });
  }

  async function renderTagEditorImage(item) {
    tagEditorImageWrap.classList.remove('adx-clickable');
    tagEditorImageWrap.replaceChildren(el('div', { class: 'adx-loading' }, 'Loading preview…'));
    if (item?.faceStyle) {
      const canvas = makeExpressionCanvas(item, 600);
      canvas.title = 'Click to enlarge the illustrated preview';
      tagEditorImageWrap.replaceChildren(canvas);
      tagEditorImageWrap.classList.add('adx-clickable');
      tagEditorImageWrap.onclick = () => openImageLightbox(item);
      return;
    }
    if (!item?.preview) {
      tagEditorImageWrap.textContent = 'No preview';
      return;
    }
    try {
      const blob = await requestImageBytes(item.preview);
      if (currentEditorItem !== item || !tagEditor?.classList.contains('adx-open')) return;
      const bitmap = await createImageBitmap(blob);
      if (currentEditorItem !== item || !tagEditor?.classList.contains('adx-open')) {
        bitmap.close?.();
        return;
      }
      const maxW = 560;
      const maxH = 680;
      const scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) {
        bitmap.close?.();
        throw new Error('Canvas 2D is unavailable.');
      }
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      canvas.title = 'Click for full-resolution preview';
      tagEditorImageWrap.replaceChildren(canvas);
      tagEditorImageWrap.classList.add('adx-clickable');
      tagEditorImageWrap.onclick = () => openImageLightbox(item);
    } catch (err) {
      console.warn('[Anima Tags] Editor preview failed:', item.preview, err);
      tagEditorImageWrap.textContent = 'Preview unavailable';
    }
  }

  function renderTagEditorState() {
    if (!currentEditorItem) return;
    const { tags, set } = getTagSelection(currentEditorItem);
    tagEditorCounter.textContent = `Prompt Tags · ${set.size}/${tags.length}`;
    tagEditorCopySelectedBtn.disabled = set.size === 0;

    const frag = document.createDocumentFragment();
    tags.forEach((tag, index) => {
      const active = set.has(index);
      const chip = el('button', {
        class: `adx-editor-chip ${active ? 'adx-on' : 'adx-off'}`,
        type: 'button',
        title: active ? 'Included — click to exclude' : 'Excluded — click to include',
      }, tag);
      chip.addEventListener('click', () => {
        if (set.has(index)) set.delete(index);
        else set.add(index);
        state.tagSelections.set(selectionKey(currentEditorItem), set);
        renderTagEditorState();
      });
      frag.appendChild(chip);
    });
    tagEditorChipbox.replaceChildren(frag);
  }

  function openTagEditor(item) {
    if (!item) return;
    currentEditorItem = item;
    tagEditorTitle.textContent = item.name || 'Edit prompt tags';
    renderTagEditorState();
    renderTagEditorImage(item);
    tagEditor.classList.add('adx-open');
  }

  function closeTagEditor() {
    currentEditorItem = null;
    tagEditor?.classList.remove('adx-open');
    if (tagEditorImageWrap) {
      tagEditorImageWrap.onclick = null;
      tagEditorImageWrap.classList.remove('adx-clickable');
      tagEditorImageWrap.replaceChildren();
    }
  }

  function buildImageLightbox() {
    lightbox = el('div', { id: 'adx-image-lightbox', role: 'dialog', 'aria-modal': 'true' });

    lightboxTitle = el('div', { class: 'adx-lightbox-title' }, 'Image preview');
    lightboxMeta = el('div', { class: 'adx-lightbox-meta' });

    lightboxFitBtn = el('button', { class: 'adx-iconbtn', type: 'button', title: 'Fit image to window' }, 'Fit');
    lightboxActualBtn = el('button', { class: 'adx-iconbtn', type: 'button', title: 'Show image at native pixel size' }, '100%');
    lightboxOpenOriginalBtn = el('button', { class: 'adx-iconbtn', type: 'button', title: 'Open the original image URL in a new tab' }, 'Open original');
    const close = el('button', { class: 'adx-iconbtn', type: 'button', title: 'Close image' }, '✕');

    lightboxFitBtn.addEventListener('click', () => setLightboxZoom(false));
    lightboxActualBtn.addEventListener('click', () => setLightboxZoom(true));
    lightboxOpenOriginalBtn.addEventListener('click', () => {
      if (lightboxCurrentUrl) window.open(lightboxCurrentUrl, '_blank', 'noopener,noreferrer');
    });
    close.addEventListener('click', closeImageLightbox);

    const head = el('div', { class: 'adx-lightbox-head' },
      lightboxTitle,
      lightboxMeta,
      el('div', { class: 'adx-spacer' }),
      lightboxFitBtn,
      lightboxActualBtn,
      lightboxOpenOriginalBtn,
      close,
    );

    lightboxStage = el('div', { class: 'adx-lightbox-stage' });
    lightboxStage.addEventListener('mousedown', (e) => {
      if (e.target === lightboxStage) closeImageLightbox();
    });

    lightbox.append(head, lightboxStage);
  }

  function setLightboxZoom(actual) {
    if (!lightboxStage) return;
    if (actual && lightboxActualBtn?.disabled) actual = false;

    lightboxStage.classList.toggle('adx-actual', !!actual);
    lightboxFitBtn?.classList.toggle('adx-active', !actual);
    lightboxActualBtn?.classList.toggle('adx-active', !!actual);

    if (!actual) {
      lightboxStage.scrollTop = 0;
      lightboxStage.scrollLeft = 0;
    }
  }

  function closeImageLightbox() {
    lightboxGeneration++;
    lightboxCurrentUrl = '';
    lightboxCurrentSize = null;
    lightbox?.classList.remove('adx-open');
    lightboxStage?.classList.remove('adx-actual');
    lightboxStage?.replaceChildren();
    if (lightboxMeta) lightboxMeta.textContent = '';
    if (lightboxActualBtn) {
      lightboxActualBtn.disabled = true;
      lightboxActualBtn.classList.remove('adx-active');
    }
    if (lightboxFitBtn) lightboxFitBtn.classList.add('adx-active');
    if (lightboxOpenOriginalBtn) lightboxOpenOriginalBtn.disabled = true;
  }

  async function openImageLightbox(item) {
    if (!item?.preview && !item?.faceStyle) return;

    const generation = ++lightboxGeneration;
    lightboxCurrentUrl = item.preview || '';
    lightboxCurrentSize = null;
    lightboxTitle.textContent = item.name || 'Image preview';
    lightboxMeta.textContent = '';
    lightboxStage.replaceChildren(el('div', { class: 'adx-lightbox-loading' }, item.faceStyle ? 'Drawing expression preview…' : 'Loading full-resolution image…'));
    lightbox.classList.add('adx-open');
    if (lightboxOpenOriginalBtn) lightboxOpenOriginalBtn.disabled = !item.preview;
    if (lightboxActualBtn) {
      lightboxActualBtn.disabled = true;
      lightboxActualBtn.title = 'Loading native size…';
    }
    setLightboxZoom(false);

    if (item.faceStyle) {
      const canvas = makeExpressionCanvas(item, 900);
      canvas.className = 'adx-lightbox-canvas';
      canvas.title = 'Generated locally from the expression definition';
      lightboxCurrentSize = { width: canvas.width, height: canvas.height, isHD: false };
      lightboxMeta.textContent = 'Illustrated local preview • prompt tags below the card';
      lightboxStage.replaceChildren(canvas);
      if (lightboxActualBtn) {
        lightboxActualBtn.disabled = !canUseActualZoom(canvas.width, canvas.height);
        lightboxActualBtn.title = 'Show preview at native pixel size';
      }
      setLightboxZoom(false);
      return;
    }

    try {
      const blob = await requestImageBytes(item.preview);
      if (generation !== lightboxGeneration || !lightbox.classList.contains('adx-open')) return;

      const bitmap = await createImageBitmap(blob);
      if (generation !== lightboxGeneration || !lightbox.classList.contains('adx-open')) {
        bitmap.close?.();
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.className = 'adx-lightbox-canvas';
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;

      const sizeInfo = classifyPreviewSize(bitmap.width, bitmap.height);
      const actualUseful = canUseActualZoom(bitmap.width, bitmap.height);
      canvas.title = actualUseful ? 'Click to toggle Fit / 100%' : 'Image already fits the window';

      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) {
        bitmap.close?.();
        throw new Error('Canvas 2D is unavailable.');
      }

      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();

      canvas.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!canUseActualZoom(canvas.width, canvas.height)) return;
        setLightboxZoom(!lightboxStage.classList.contains('adx-actual'));
      });

      lightboxCurrentSize = { width: canvas.width, height: canvas.height, isHD: sizeInfo.isHD };
      lightboxMeta.textContent = formatPreviewMeta(canvas.width, canvas.height);
      lightboxStage.replaceChildren(canvas);

      if (lightboxActualBtn) {
        lightboxActualBtn.disabled = !actualUseful;
        lightboxActualBtn.title = actualUseful
          ? 'Show image at native pixel size'
          : 'Native-size zoom is not useful for this image';
      }
      setLightboxZoom(false);
    } catch (err) {
      if (generation !== lightboxGeneration) return;
      console.warn('[Anima Tags] Full image failed:', item.preview, err);
      if (lightboxActualBtn) lightboxActualBtn.disabled = true;
      lightboxStage.replaceChildren(
        el('div', { class: 'adx-lightbox-error' }, `Could not load full-resolution image.\n${err?.message || err}`)
      );
    }
  }

  async function openModal() {
    state.open = true;
    overlay.classList.add('adx-open');
    document.documentElement.style.overflow = 'hidden';
    await activateTab(state.active);
    setTimeout(() => searchInput.focus(), 0);
  }

  function closeModal() {
    closeImageLightbox();
    closeTagEditor();
    state.open = false;
    overlay.classList.remove('adx-open');
    document.documentElement.style.overflow = '';
  }

  async function activateTab(key, force = false) {
    if (!DATASETS[key]) return;
    state.active = key;
    state.query = '';
    state.category = '';
    state.tagFilters.clear();
    state.tagFilterSearch = '';
    state.page = 1;
    state.loadedPages = 1;
    searchInput.value = '';
    if (sidebarSearchInput) sidebarSearchInput.value = '';
    updateTabs();
    body.replaceChildren(el('div', { class: 'adx-loading' }, `Loading ${DATASETS[key].label}…`));
    statusEl.textContent = 'Loading…';

    try {
      state.loading = true;
      const items = await loadDataset(key, force);
      populateCategories(items);
      renderTagSidebar();
      renderResults();
    } catch (err) {
      body.replaceChildren(el('div', { class: 'adx-error' }, `Could not load ${DATASETS[key].label}.\n${err.message}`));
      statusEl.textContent = 'Load failed';
    } finally {
      state.loading = false;
    }
  }

  function updateTabs() {
    for (const b of tabHost.querySelectorAll('.adx-tab')) {
      b.classList.toggle('adx-active', b.dataset.key === state.active);
    }
  }

  function populateCategories(items) {
    const categories = [...new Set(items.flatMap(x => x.categories))]
      .sort((a, b) => cleanCategory(a).localeCompare(cleanCategory(b), 'en'));
    categorySelect.replaceChildren(el('option', { value: '' }, 'All categories'));
    for (const c of categories) {
      const option = el('option', { value: c, title: cleanCategory(c) }, cleanCategory(c));
      option.dataset.categoryColor = categoryColor(c);
      categorySelect.appendChild(option);
    }
  }

  function renderResults({ append = false, preserveScroll = false } = {}) {
    const all = state.data.get(state.active) || [];
    const filtered = filteredItems();
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    state.loadedPages = Math.min(Math.max(1, state.loadedPages), pages);
    state.page = Math.min(Math.max(1, state.page), state.loadedPages);

    let start = append ? (state.loadedPages - 1) * PAGE_SIZE : 0;
    const end = Math.min(filtered.length, state.loadedPages * PAGE_SIZE);
    let itemsToRender = filtered.slice(start, end);

    const previewCount = all.reduce((n, item) => n + (item.preview || item.faceStyle ? 1 : 0), 0);
    const filterNote = state.tagFilters.size ? ` • ${state.tagFilters.size} tag filter${state.tagFilters.size === 1 ? '' : 's'}` : '';
    statusEl.textContent = `${filtered.length.toLocaleString()} / ${all.length.toLocaleString()} items • ${previewCount.toLocaleString()} previews${filterNote}`;

    if (!filtered.length) {
      body.replaceChildren(el('div', { class: 'adx-empty' }, 'No matching items.'));
      state.page = 1;
      state.loadedPages = 1;
      renderFooter(0, pages);
      return;
    }

    let grid = append ? body.querySelector('.adx-grid') : null;
    if (!grid) {
      grid = el('div', { class: 'adx-grid' });
      if (append) {
        // A filter or tab change may have replaced the grid before an observer tick.
        append = false;
        start = 0;
        itemsToRender = filtered.slice(0, end);
      }
    }

    itemsToRender.forEach((item, offset) => {
      grid.appendChild(renderCard(item, start + offset));
    });

    if (!append) body.replaceChildren(grid);
    if (!preserveScroll) body.scrollTop = 0;
    renderFooter(filtered.length, pages);
    requestAnimationFrame(maybeAutoLoad);
  }

  function loadNextPage(auto = false) {
    if (state.loadingMore) return false;
    const filtered = filteredItems();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (state.loadedPages >= totalPages) return false;

    state.loadingMore = true;
    state.loadedPages++;
    state.page = state.loadedPages;
    renderResults({ append: true, preserveScroll: true });
    state.loadingMore = false;

    if (!auto) scrollToPage(state.page);
    return true;
  }

  function maybeAutoLoad() {
    if (!body || !state.open || state.loading || state.loadingMore) return;
    const distanceFromBottom = body.scrollHeight - body.scrollTop - body.clientHeight;
    if (distanceFromBottom <= 360) loadNextPage(true);
  }

  function updateCurrentPageFromScroll() {
    if (!body) return;
    const cards = [...body.querySelectorAll('.adx-card[data-result-index]')];
    if (!cards.length) return;

    const marker = body.scrollTop + 32;
    let visiblePage = 1;
    for (const card of cards) {
      if (card.offsetTop > marker) break;
      const index = Number(card.dataset.resultIndex);
      if (Number.isFinite(index)) visiblePage = Math.floor(index / PAGE_SIZE) + 1;
    }

    visiblePage = Math.min(Math.max(1, visiblePage), state.loadedPages);
    if (visiblePage !== state.page) {
      state.page = visiblePage;
      renderFooter();
    }
  }

  function scrollToPage(page) {
    const index = (Math.max(1, page) - 1) * PAGE_SIZE;
    const card = body?.querySelector(`.adx-card[data-result-index="${index}"]`);
    if (!card) return;
    body.scrollTo({ top: Math.max(0, card.offsetTop - 12), behavior: 'smooth' });
  }

  function requestImageBytes(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 20000,
        anonymous: true,
        responseType: 'arraybuffer',
        headers: {
          Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
        },
        onload: (r) => {
          if (r.status < 200 || r.status >= 300 || !r.response) {
            reject(new Error(`HTTP ${r.status}`));
            return;
          }

          const headerMatch = String(r.responseHeaders || '').match(/^content-type:\s*([^;\r\n]+)/im);
          const contentType = headerMatch ? headerMatch[1].trim() : 'image/webp';

          if (!contentType.startsWith('image/')) {
            reject(new Error(`Unexpected content type: ${contentType}`));
            return;
          }

          resolve(new Blob([r.response], { type: contentType }));
        },
        onerror: () => reject(new Error('Image request failed.')),
        ontimeout: () => reject(new Error('Image request timed out.')),
      });
    });
  }

  async function attachPreview(previewEl, item) {
    if (item?.faceStyle) {
      const canvas = makeExpressionCanvas(item, 420);
      canvas.title = 'Click to open the prompt tag editor';
      const qualityBadge = el('div', { class: 'adx-preview-quality adx-local' }, 'Local');
      previewEl.replaceChildren(canvas, qualityBadge);
      previewEl.classList.add('adx-clickable');
      previewEl.title = `${item.name || 'Expression'} — illustrated local preview\nClick to open image and prompt tag editor`;
      previewEl.addEventListener('click', () => openTagEditor(item));
      return;
    }

    const url = item?.preview || '';
    if (!url) {
      previewEl.textContent = 'No preview URL';
      return;
    }

    previewEl.textContent = 'Loading preview…';

    try {
      // Fetch through Tampermonkey instead of letting animadex.net load the
      // external CDN image directly. This avoids the site's image CSP.
      const blob = await requestImageBytes(url);

      // Decode once at full resolution, then paint only a compact card preview.
      const bitmap = await createImageBitmap(blob);
      const nativeW = bitmap.width;
      const nativeH = bitmap.height;
      const sizeInfo = classifyPreviewSize(nativeW, nativeH);

      const maxW = 420;
      const maxH = 420;
      const scale = Math.min(1, maxW / nativeW, maxH / nativeH);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(nativeW * scale));
      canvas.height = Math.max(1, Math.round(nativeH * scale));
      canvas.setAttribute('aria-label', `Preview ${nativeW} × ${nativeH}`);
      canvas.title = 'Click to open image and prompt tag editor';

      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) {
        bitmap.close?.();
        throw new Error('Canvas 2D is unavailable.');
      }

      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();

      const badge = el('div', { class: 'adx-preview-size' }, `${nativeW} × ${nativeH}`);
      const qualityBadge = el('div', { class: `adx-preview-quality ${sizeInfo.className}` }, sizeInfo.label);
      previewEl.replaceChildren(canvas, qualityBadge, badge);
      previewEl.classList.add('adx-clickable');
      previewEl.title = `${item.name || 'Image'} — ${formatPreviewMeta(nativeW, nativeH)}\nClick to open image and prompt tag editor`;
      previewEl.addEventListener('click', () => openTagEditor(item));
    } catch (err) {
      console.warn('[Anima Tags] Preview failed:', url, err);
      previewEl.textContent = 'Preview unavailable';
      previewEl.title = `${url}\n${err?.message || err}`;
    }
  }


  function renderCard(item, resultIndex = -1) {
    const preview = el('div', { class: `adx-preview${item.faceStyle ? ' adx-expression' : ''}` }, 'No preview');

    if (item.preview || item.faceStyle) {
      attachPreview(preview, item);
    }

    const chips = el('div', { class: 'adx-cats' });
    item.categories.slice(0, 2).forEach(c => {
      const label = cleanCategory(c);
      const color = categoryColor(c);
      const chip = el('button', {
        class: `adx-chip${state.category === c ? ' adx-category-active' : ''}`,
        type: 'button',
        title: state.category === c
          ? `Remove ${label} category filter`
          : `Filter by ${label}`,
        style: `--adx-cat-color:${color}`,
      }, label);
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        setCategoryFilter(c);
      });
      chips.appendChild(chip);
    });

    const copy = el('button', { class: 'adx-btn adx-copy', type: 'button' }, 'Copy prompt tags');
    copy.addEventListener('click', () => {
      copyText(item.tags);
      const old = copy.textContent;
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = old; }, 900);
    });

    const name = el('div', {
      class: 'adx-name adx-editable',
      title: `${item.name} — click to edit ${itemPromptTags(item).length} prompt tags`,
    }, item.name);
    name.addEventListener('click', () => openTagEditor(item));

    const tagText = cleanTags(item.tags);

    return el('article', { class: 'adx-card', 'data-result-index': resultIndex },
      preview,
      el('div', { class: 'adx-cardbody' },
        name,
        chips,
        el('div', { class: 'adx-tags', title: `${tagText}\nClick the image or title to edit individual tags` }, tagText || 'No tags'),
        copy,
      )
    );
  }

  function renderFooter(filteredCount = null, pages = null) {
    const filtered = filteredCount ?? filteredItems().length;
    const totalPages = pages ?? Math.max(1, Math.ceil(filtered / PAGE_SIZE));
    const loadedItems = Math.min(filtered, state.loadedPages * PAGE_SIZE);

    const prev = el('button', { class: 'adx-btn adx-page-btn', type: 'button' }, '← Prev');
    prev.disabled = state.page <= 1;
    prev.addEventListener('click', () => {
      if (state.page <= 1) return;
      state.page--;
      scrollToPage(state.page);
      renderFooter(filtered, totalPages);
    });

    const next = el('button', { class: 'adx-btn adx-page-btn', type: 'button' }, 'Next →');
    next.disabled = state.page >= totalPages && state.loadedPages >= totalPages;
    next.addEventListener('click', () => {
      if (state.page < state.loadedPages) {
        state.page++;
        scrollToPage(state.page);
        renderFooter(filtered, totalPages);
      } else {
        loadNextPage(false);
      }
    });

    const last = el('div', { class: 'adx-last', title: state.lastCopied || '' },
      state.lastCopied ? `Last copied: ${state.lastCopied}` : 'Click a card image or title to edit individual tags.'
    );

    footerEl.replaceChildren(
      prev,
      el('span', { class: 'adx-pageinfo' }, `Page ${state.page} / ${totalPages} • ${loadedItems.toLocaleString()} loaded`),
      next,
      last,
    );
  }

  buildShell();
})();
