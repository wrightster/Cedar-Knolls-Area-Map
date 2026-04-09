'use strict';

const http = require('http');
const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT          = 3001;
const PROJECT_ROOT  = __dirname;
const CANDIDATES    = path.join(PROJECT_ROOT, 'candidates.json');
const AMENITIES     = path.join(PROJECT_ROOT, 'amenities.json');

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function streamHeaders() {
  return {
    'Content-Type':           'text/plain; charset=utf-8',
    'Transfer-Encoding':      'chunked',
    'Cache-Control':          'no-cache',
    'X-Content-Type-Options': 'nosniff',
  };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function serveHtml(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(ADMIN_HTML);
}

function getCandidates(res) {
  if (!fs.existsSync(CANDIDATES)) {
    return json(res, 404, { error: 'candidates.json not found. Run Discover first.' });
  }
  let data;
  try { data = JSON.parse(fs.readFileSync(CANDIDATES, 'utf8')); }
  catch { return json(res, 500, { error: 'candidates.json is malformed.' }); }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function postCandidates(req, res) {
  let arr;
  try { arr = await readBody(req); }
  catch { return json(res, 400, { error: 'Invalid JSON body.' }); }
  if (!Array.isArray(arr)) return json(res, 400, { error: 'Body must be a JSON array.' });
  try {
    fs.writeFileSync(CANDIDATES, JSON.stringify(arr, null, 2) + '\n', 'utf8');
  } catch (err) {
    return json(res, 500, { error: 'Failed to write candidates.json: ' + err.message });
  }
  json(res, 200, { ok: true, count: arr.length });
}

function getAmenities(res) {
  let data;
  try { data = JSON.parse(fs.readFileSync(AMENITIES, 'utf8')); }
  catch { return json(res, 500, { error: 'amenities.json is malformed.' }); }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function postAmenities(req, res) {
  let body;
  try { body = await readBody(req); }
  catch { return json(res, 400, { error: 'Invalid JSON body.' }); }
  if (!body || !Array.isArray(body.places)) {
    return json(res, 400, { error: 'Body must be a full amenities data object with a places array.' });
  }
  try {
    fs.writeFileSync(AMENITIES, JSON.stringify(body, null, 2) + '\n', 'utf8');
  } catch (err) {
    return json(res, 500, { error: 'Failed to write amenities.json: ' + err.message });
  }
  json(res, 200, { ok: true, count: body.places.length });
}

async function runStream(req, res, scriptId) {
  let body;
  try { body = await readBody(req); } catch { body = {}; }

  const apiKey   = (body.apiKey || '').trim();
  const needsKey = scriptId !== 'merge' && scriptId !== 'overwrite';

  if (needsKey && !apiKey) {
    res.writeHead(200, streamHeaders());
    res.write('[ERROR] API key is required.\n[DONE:1]\n');
    return res.end();
  }

  const discoverArgs = ['--discover'];
  const radius = parseFloat(body.radius);
  if (!isNaN(radius) && radius > 0) discoverArgs.push(`--radius=${radius}`);

  const scriptMap = {
    'fetch-photos': [path.join(PROJECT_ROOT, 'scripts', 'fetch-photos.js')],
    'discover':     [path.join(PROJECT_ROOT, 'scripts', 'discover-places.js'), ...discoverArgs],
    'merge':        [path.join(PROJECT_ROOT, 'scripts', 'discover-places.js'), '--merge'],
    'overwrite':    [path.join(PROJECT_ROOT, 'scripts', 'discover-places.js'), '--overwrite'],
  };

  const childEnv = { ...process.env };
  if (apiKey) childEnv.GOOGLE_PLACES_API_KEY = apiKey;

  res.writeHead(200, streamHeaders());

  const child = spawn(process.execPath, scriptMap[scriptId], {
    cwd: PROJECT_ROOT,
    env: childEnv,
  });
  child.stdout.on('data', d => res.write(d));
  child.stderr.on('data', d => res.write(d));
  child.on('close', code => { res.write(`\n[DONE:${code ?? 1}]\n`); res.end(); });
  child.on('error', err  => { res.write(`\n[SPAWN ERROR] ${err.message}\n[DONE:1]\n`); res.end(); });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url);

  try {
    if (req.method === 'GET'  && pathname === '/')                   return serveHtml(res);
    if (req.method === 'GET'  && pathname === '/candidates')         return getCandidates(res);
    if (req.method === 'POST' && pathname === '/candidates')         return postCandidates(req, res);
    if (req.method === 'GET'  && pathname === '/amenities')          return getAmenities(res);
    if (req.method === 'POST' && pathname === '/amenities')          return postAmenities(req, res);
    if (req.method === 'POST' && pathname === '/run/fetch-photos')   return runStream(req, res, 'fetch-photos');
    if (req.method === 'POST' && pathname === '/run/discover')       return runStream(req, res, 'discover');
    if (req.method === 'POST' && pathname === '/run/merge')          return runStream(req, res, 'merge');
    if (req.method === 'POST' && pathname === '/run/overwrite')      return runStream(req, res, 'overwrite');
    res.writeHead(404); res.end('Not found');
  } catch (err) {
    console.error('Server error:', err);
    if (!res.headersSent) { res.writeHead(500); res.end('Internal server error'); }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Cedar Knolls admin panel → http://127.0.0.1:${PORT}`);
});

// ---------------------------------------------------------------------------
// Embedded admin UI
// ---------------------------------------------------------------------------

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cedar Knolls Map — Admin</title>
<style>
:root {
  --bg:           #0f1117;
  --surface:      #1a1d27;
  --surface2:     #21263a;
  --border:       #2e3347;
  --text:         #d4d8e8;
  --muted:        #6b7280;
  --accent:       #4f9cf9;
  --green:        #4eb581;
  --red:          #dd5757;
  --yellow:       #ddcb4a;
  --term-bg:      #0a0c10;
  --term-text:    #9ec99e;
  --r:            6px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font: 14px/1.5 'Segoe UI', system-ui, sans-serif; min-height: 100vh; }

header {
  padding: 14px 28px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: baseline; gap: 14px;
}
header h1 { font-size: 15px; font-weight: 600; color: var(--accent); letter-spacing: .01em; }
header span { font-size: 12px; color: var(--muted); }

main { max-width: 960px; margin: 0 auto; padding: 28px 24px; display: flex; flex-direction: column; gap: 20px; }

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r);
  overflow: hidden;
}
.card-head {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.card-head h2 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
.card-head-actions { display: flex; align-items: center; gap: 8px; }
.card-body { padding: 20px; }

/* API key */
.key-row { display: flex; gap: 8px; align-items: center; }
input[type=password], input[type=text], input[type=number] {
  flex: 1;
  background: var(--term-bg); border: 1px solid var(--border);
  color: var(--text); padding: 7px 10px;
  border-radius: var(--r); font-size: 13px;
}
input[type=password], input[type=text] {
  max-width: 420px;
  font-family: 'Cascadia Code', 'Fira Mono', monospace;
}
input:focus { outline: none; border-color: var(--accent); }
.key-status { font-size: 12px; color: var(--muted); margin-top: 8px; }
.key-status.ok { color: var(--green); }

/* Buttons */
button {
  border: none; border-radius: var(--r); font-size: 13px;
  font-weight: 500; cursor: pointer; padding: 8px 16px;
  transition: filter .12s, opacity .12s;
}
button:hover:not(:disabled) { filter: brightness(1.12); }
button:disabled { opacity: .4; cursor: not-allowed; }
.btn-primary  { background: var(--accent);   color: #fff; }
.btn-danger   { background: var(--red);      color: #fff; }
.btn-ghost    { background: var(--surface2); color: var(--text); border: 1px solid var(--border); }
.btn-ghost:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); filter: none; }
.btn-sm       { padding: 5px 12px; font-size: 12px; }

/* Steps */
.steps { display: flex; flex-direction: column; gap: 0; }
.step { padding: 20px; border-bottom: 1px solid var(--border); }
.step:last-child { border-bottom: none; }
.step-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.step-head h3 { font-size: 13px; font-weight: 600; }
.step-num {
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--accent); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; flex-shrink: 0;
}
.step-desc { font-size: 12px; color: var(--muted); margin-bottom: 14px; line-height: 1.55; }
.step-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

/* Log terminal */
.log {
  background: var(--term-bg);
  color: var(--term-text);
  font: 12px/1.65 'Cascadia Code', 'Fira Mono', monospace;
  padding: 12px 14px;
  border-radius: var(--r);
  min-height: 52px; max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin-top: 12px;
  display: none;
}
.log.show { display: block; }

/* Tables (shared by candidates + amenities) */
.tbl-controls {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 12px; flex-wrap: wrap;
}
.tbl-count  { font-size: 12px; color: var(--muted); flex: 1; }
.tbl-status { font-size: 12px; color: var(--green); }
.tbl-notice {
  font-size: 12px; color: var(--muted);
  padding: 10px 14px; background: var(--surface2);
  border: 1px solid var(--border); border-radius: var(--r);
  margin-bottom: 12px;
}
table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
thead th {
  text-align: left; padding: 6px 10px;
  color: var(--muted); font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .06em;
  border-bottom: 1px solid var(--border);
}
tbody td { padding: 7px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
tbody tr:last-child td { border-bottom: none; }
tbody tr.removed td:not(:last-child) { opacity: .3; text-decoration: line-through; }

/* Badges */
.badge {
  display: inline-block; padding: 2px 7px; border-radius: 20px;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  color: #fff; white-space: nowrap;
}
.badges { display: flex; gap: 4px; flex-wrap: wrap; }

.td-name a { color: var(--text); text-decoration: none; }
.td-name a:hover { color: var(--accent); }
.td-muted { color: var(--muted); }
.td-dist  { color: var(--muted); white-space: nowrap; }

/* Remove/keep toggle (candidates) */
button.btn-remove {
  background: none; border: 1px solid var(--border); color: var(--muted);
  padding: 3px 10px; border-radius: var(--r); font-size: 11px;
}
button.btn-remove:hover:not(:disabled) { border-color: var(--red); color: var(--red); filter: none; }
button.btn-remove.active { background: var(--red); border-color: var(--red); color: #fff; }
button.btn-remove.active:hover:not(:disabled) { filter: brightness(1.1); }

/* Category selects (candidates table) */
.cat-selects { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
select.cat-sel {
  background: var(--surface2); border: 1px solid var(--border);
  color: var(--text); padding: 3px 6px;
  border-radius: var(--r); font-size: 11px; cursor: pointer;
  max-width: 110px;
}
select.cat-sel:focus { outline: none; border-color: var(--accent); }
select.cat-sel.cat-sel-extra { color: var(--muted); }

/* Amenities edit form */
.am-edit-wrap {
  background: var(--surface2);
  border-top: 1px solid var(--border);
  padding: 16px 18px;
}
.am-edit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
  margin-bottom: 14px;
}
.am-edit-grid label {
  display: flex; flex-direction: column; gap: 4px;
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .06em; color: var(--muted);
}
.am-edit-grid label input { flex: 1; }
.am-edit-grid .span2 { grid-column: span 2; }
.am-edit-cats { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
.am-edit-cats select {
  background: var(--surface2); border: 1px solid var(--border);
  color: var(--text); padding: 5px 8px;
  border-radius: var(--r); font-size: 12px; cursor: pointer; flex: 1; min-width: 120px;
}
.am-edit-cats select:focus { outline: none; border-color: var(--accent); }
.am-edit-actions { display: flex; gap: 8px; }

/* Sortable column headers (amenities table) */
thead th.sortable { cursor: pointer; user-select: none; }
thead th.sortable:hover { color: var(--text); }
thead th.sort-asc::after  { content: ' \\25b2'; font-size: 9px; }
thead th.sort-desc::after { content: ' \\25bc'; font-size: 9px; }
</style>
</head>
<body>

<header>
  <h1>Cedar Knolls Map</h1>
  <span>Admin Panel</span>
</header>

<main>

  <!-- API Key -->
  <div class="card">
    <div class="card-head"><h2>Google Places API Key</h2></div>
    <div class="card-body">
      <div class="key-row">
        <input type="password" id="api-key" placeholder="AIza…" autocomplete="off" spellcheck="false">
        <button class="btn-ghost btn-sm" id="btn-toggle-key" onclick="toggleKey()">Show</button>
        <button class="btn-primary btn-sm" onclick="saveKey()">Save</button>
      </div>
      <p class="key-status" id="key-status"></p>
    </div>
  </div>

  <!-- Fetch Photos -->
  <div class="card">
    <div class="card-head">
      <h2>Fetch Photos</h2>
      <button class="btn-primary btn-sm" id="btn-fetch" onclick="runFetch()">Run</button>
    </div>
    <div class="card-body">
      <p class="step-desc" style="margin-bottom:0">
        Downloads one photo from Google for each place in <code>amenities.json</code>.
        Safe to run any time — runs automatically on the 1st of every month via GitHub Actions.
      </p>
      <div class="log" id="log-fetch"></div>
    </div>
  </div>

  <!-- Discover & Merge -->
  <div class="card">
    <div class="card-head"><h2>Discover &amp; Merge New Places</h2></div>
    <div class="steps">

      <!-- Step 1 -->
      <div class="step">
        <div class="step-head">
          <span class="step-num">1</span>
          <h3>Discover</h3>
        </div>
        <p class="step-desc">
          Searches Google Places for locations near Cedar Knolls not yet in your map.
          Results are written to <code>candidates.json</code> for review.
        </p>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
          <label style="font-size:12px;color:var(--muted);white-space:nowrap">Search radius</label>
          <input type="range" id="discover-radius" min="1" max="30" step="1" value="15"
            style="flex:1;max-width:220px;accent-color:var(--accent);cursor:pointer"
            oninput="updateRadiusLabel(this.value)">
          <span id="radius-label" style="font-size:13px;font-weight:600;color:var(--text);min-width:42px">15 mi</span>
        </div>
        <button class="btn-primary btn-sm" id="btn-discover" onclick="runDiscover()">Run Discover</button>
        <div class="log" id="log-discover"></div>
      </div>

      <!-- Step 2 -->
      <div class="step">
        <div class="step-head">
          <span class="step-num">2</span>
          <h3>Review Candidates</h3>
        </div>
        <p class="step-desc">
          Adjust categories using the dropdowns, mark unwanted places as <strong>Remove</strong>,
          then click <strong>Save Changes</strong> before moving to Step 3.
        </p>
        <div id="candidates-section">
          <div class="tbl-notice" id="cand-notice" style="display:none"></div>
          <div class="tbl-controls" id="cand-controls" style="display:none">
            <span class="tbl-count" id="cand-count"></span>
            <button class="btn-ghost btn-sm" onclick="loadCandidates()">Reload</button>
            <button class="btn-primary btn-sm" id="btn-save-cands" onclick="saveCandidates()">Save Changes</button>
            <button class="btn-danger btn-sm" onclick="clearCandidates()">Clear</button>
            <span class="tbl-status" id="cand-save-status"></span>
          </div>
          <div style="overflow-x:auto" id="cand-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Categories</th><th>Mall</th><th>Address</th><th>Miles</th><th></th>
                </tr>
              </thead>
              <tbody id="cand-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Step 3 -->
      <div class="step">
        <div class="step-head">
          <span class="step-num">3</span>
          <h3>Merge or Overwrite</h3>
        </div>
        <p class="step-desc">
          <strong>Merge</strong> appends candidates to the existing places in <code>amenities.json</code>.<br>
          <strong>Overwrite</strong> replaces all existing places with the candidates list.
          Run <strong>Fetch Photos</strong> afterwards to download photos for new places.
        </p>
        <div class="step-actions">
          <button class="btn-primary btn-sm" id="btn-merge" onclick="runMerge()">Merge</button>
          <button class="btn-danger btn-sm" id="btn-overwrite" onclick="runOverwrite()">Overwrite All</button>
        </div>
        <div class="log" id="log-merge"></div>
      </div>

    </div>
  </div>

  <!-- Amenities Manager -->
  <div class="card">
    <div class="card-head">
      <h2>Amenities</h2>
      <div class="card-head-actions">
        <span class="tbl-status" id="am-save-status"></span>
        <button class="btn-ghost btn-sm" onclick="loadAmenities()">Reload</button>
        <button class="btn-primary btn-sm" id="btn-save-amenities" onclick="saveAllAmenities()" disabled>Save Changes</button>
      </div>
    </div>
    <div class="card-body" style="padding:0">
      <div class="tbl-notice" id="am-notice" style="display:none;margin:16px 20px 0"></div>
      <div style="overflow-x:auto">
        <table>
          <thead id="am-thead">
            <tr>
              <th class="sortable" data-col="id" onclick="sortAmenities('id')">#</th>
              <th class="sortable" data-col="name" onclick="sortAmenities('name')">Name</th>
              <th class="sortable" data-col="categories" onclick="sortAmenities('categories')">Categories</th>
              <th class="sortable" data-col="address" onclick="sortAmenities('address')">Address</th>
              <th class="sortable" data-col="miles" onclick="sortAmenities('miles')">Miles</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="am-tbody"></tbody>
        </table>
      </div>
    </div>
  </div>

</main>

<script>
// ---------------------------------------------------------------------------
// Category data (mirrors amenities.json categories array)
// ---------------------------------------------------------------------------
const CAT_COLORS = {
  mall:       '#1a3469',
  shopping:   '#43c4d1',
  grocery:    '#4eb581',
  restaurant: '#f49656',
  cafe:       '#826054',
  gym:        '#ae67ce',
  park:       '#9fbf3c',
  school:     '#638ae0',
  medical:    '#dd5757',
  church:     '#ddcb4a',
  gas:        '#e8784d',
  bar:        '#c4833a',
};
const CAT_LABELS = {
  mall:       'Shopping Centers',
  shopping:   'Shopping',
  grocery:    'Grocery',
  restaurant: 'Restaurants',
  cafe:       'Cafe',
  gym:        'Fitness',
  park:       'Parks',
  school:     'Schools',
  medical:    'Medical',
  church:     'Worship',
  gas:        'Gas Stations',
  bar:        'Bars',
};
const CAT_IDS = Object.keys(CAT_COLORS);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Normalise a place's category data into an array (handles both old string and new array format).
function normCats(place) {
  if (Array.isArray(place.categories) && place.categories.length) return place.categories.slice(0, 3);
  if (place.category) return [place.category];
  return [];
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderBadges(cats) {
  return cats.map(c => {
    const color = CAT_COLORS[c] || '#888';
    const label = CAT_LABELS[c] || c;
    return \`<span class="badge" style="background:\${color}">\${esc(label)}</span>\`;
  }).join(' ');
}

// Build <option> elements for a category select.
// If allowEmpty is true, a "— none —" option is prepended.
function catOptions(selected, allowEmpty) {
  let opts = allowEmpty ? \`<option value="">— none —</option>\` : '';
  opts += CAT_IDS.map(id =>
    \`<option value="\${id}"\${id === selected ? ' selected' : ''}>\${CAT_LABELS[id]||id}</option>\`
  ).join('');
  return opts;
}

// ---------------------------------------------------------------------------
// API key
// ---------------------------------------------------------------------------
let apiKey = localStorage.getItem('ck_admin_key') || '';

(function init() {
  document.getElementById('api-key').value = apiKey;
  updateKeyStatus();
  const savedRadius = localStorage.getItem('ck_discover_radius');
  if (savedRadius) {
    document.getElementById('discover-radius').value = savedRadius;
    document.getElementById('radius-label').textContent = savedRadius + ' mi';
  }
  loadCandidates();
  loadAmenities();
})();

function updateRadiusLabel(val) {
  document.getElementById('radius-label').textContent = val + ' mi';
  localStorage.setItem('ck_discover_radius', val);
}

function saveKey() {
  apiKey = document.getElementById('api-key').value.trim();
  localStorage.setItem('ck_admin_key', apiKey);
  updateKeyStatus();
}

function updateKeyStatus() {
  const el = document.getElementById('key-status');
  if (apiKey) {
    el.textContent = '\\u2713 Key saved';
    el.className = 'key-status ok';
  } else {
    el.textContent = 'No key saved — required for Fetch Photos and Discover.';
    el.className = 'key-status';
  }
}

function toggleKey() {
  const inp = document.getElementById('api-key');
  const btn = document.getElementById('btn-toggle-key');
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = 'Hide'; }
  else { inp.type = 'password'; btn.textContent = 'Show'; }
}

// ---------------------------------------------------------------------------
// Log helpers
// ---------------------------------------------------------------------------
function showLog(id) {
  const el = document.getElementById(id);
  el.textContent = '';
  el.classList.add('show');
  return el;
}

function appendLog(el, text) {
  el.textContent += text;
  el.scrollTop = el.scrollHeight;
}

// ---------------------------------------------------------------------------
// Generic script runner (streaming)
// ---------------------------------------------------------------------------
async function runScript(endpoint, logEl, btnId, body) {
  const btn = document.getElementById(btnId);
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Running\\u2026';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      appendLog(logEl, '[ERROR] Server returned ' + res.status);
      return 1;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   exitCode = 0;
    let   buffer   = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      buffer = buffer.replace(/\\[DONE:(\\d+)\\]\\n?/g, (_, code) => {
        exitCode = parseInt(code, 10);
        return '';
      });

      appendLog(logEl, buffer);
      buffer = '';
    }

    appendLog(logEl, exitCode === 0
      ? '\\n\\u2714 Completed successfully.'
      : '\\n\\u2718 Exited with code ' + exitCode + '.');
    return exitCode;

  } catch (err) {
    appendLog(logEl, '\\n[ERROR] ' + err.message);
    return 1;
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

// ---------------------------------------------------------------------------
// Fetch Photos
// ---------------------------------------------------------------------------
async function runFetch() {
  if (!apiKey) { alert('Enter and save your API key first.'); return; }
  const log = showLog('log-fetch');
  await runScript('/run/fetch-photos', log, 'btn-fetch', { apiKey });
}

// ---------------------------------------------------------------------------
// Discover
// ---------------------------------------------------------------------------
async function runDiscover() {
  if (!apiKey) { alert('Enter and save your API key first.'); return; }
  const radius = parseInt(document.getElementById('discover-radius').value, 10);
  const log = showLog('log-discover');
  const code = await runScript('/run/discover', log, 'btn-discover', { apiKey, radius });
  if (code === 0) loadCandidates();
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------
let candidates = [];

async function loadCandidates() {
  const notice    = document.getElementById('cand-notice');
  const controls  = document.getElementById('cand-controls');

  try {
    const res = await fetch('/candidates');
    if (res.status === 404) {
      notice.textContent = 'No candidates.json yet. Run Discover first.';
      notice.style.display = 'block';
      controls.style.display = 'none';
      document.getElementById('cand-tbody').innerHTML = '';
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      notice.textContent = 'Error: ' + err.error;
      notice.style.display = 'block';
      return;
    }

    notice.style.display = 'none';
    const data = await res.json();
    candidates = data.map(c => ({ ...c, _removed: false }));
    renderCandidates();
    controls.style.display = 'flex';
  } catch (err) {
    notice.textContent = 'Failed to load candidates: ' + err.message;
    notice.style.display = 'block';
  }
}

function renderCandidates() {
  const tbody  = document.getElementById('cand-tbody');
  const count  = document.getElementById('cand-count');
  const kept   = candidates.filter(c => !c._removed).length;

  count.textContent = kept + ' of ' + candidates.length + ' candidates will be merged';

  tbody.innerHTML = candidates.map((c, i) => {
    const cats = normCats(c);
    // Primary category select (required)
    const sel0 = \`<select class="cat-sel" onchange="updateCandCat(\${i},0,this.value)">\${catOptions(cats[0]||'', false)}</select>\`;
    // Secondary category select (optional)
    const sel1 = \`<select class="cat-sel cat-sel-extra" onchange="updateCandCat(\${i},1,this.value)">\${catOptions(cats[1]||'', true)}</select>\`;
    // Tertiary category select (optional)
    const sel2 = \`<select class="cat-sel cat-sel-extra" onchange="updateCandCat(\${i},2,this.value)">\${catOptions(cats[2]||'', true)}</select>\`;

    const isMall = normCats(c).includes('mall') || (Array.isArray(c.tags) && c.tags.includes('mall'));
    return '<tr class="' + (c._removed ? 'removed' : '') + '">'
      + '<td class="td-name"><a href="' + esc(c.googleMapsUrl) + '" target="_blank" rel="noopener">' + esc(c.name) + '</a></td>'
      + '<td><div class="cat-selects">' + sel0 + sel1 + sel2 + '</div></td>'
      + '<td style="text-align:center"><input type="checkbox"' + (isMall ? ' checked' : '') + ' onchange="updateCandMall(' + i + ',this.checked)"></td>'
      + '<td class="td-muted">' + esc(c.address) + '</td>'
      + '<td class="td-dist">' + c.distanceMiles + ' mi</td>'
      + '<td><button class="btn-remove' + (c._removed ? ' active' : '') + '" onclick="toggleRemove(' + i + ')">'
      + (c._removed ? 'Keep' : 'Remove') + '</button></td>'
      + '</tr>';
  }).join('');
}

function updateCandCat(idx, slot, value) {
  const cats = normCats(candidates[idx]);
  // Extend array if needed
  while (cats.length <= slot) cats.push('');
  cats[slot] = value;
  // Remove trailing empty slots
  while (cats.length > 0 && !cats[cats.length - 1]) cats.pop();
  candidates[idx] = { ...candidates[idx], categories: cats };
  delete candidates[idx].category; // remove old format if present
  document.getElementById('cand-save-status').textContent = '';
}

function updateCandMall(idx, checked) {
  let cats = normCats(candidates[idx]).filter(c => c !== 'mall');
  if (checked) cats = ['mall', ...cats].slice(0, 3);
  candidates[idx] = { ...candidates[idx], categories: cats, tags: [] };
  document.getElementById('cand-save-status').textContent = '';
}

function toggleRemove(i) {
  candidates[i]._removed = !candidates[i]._removed;
  renderCandidates();
  document.getElementById('cand-save-status').textContent = '';
}

async function saveCandidates() {
  const toSave = candidates
    .filter(c => !c._removed)
    .map(({ _removed, ...rest }) => rest);

  const btn = document.getElementById('btn-save-cands');
  btn.disabled = true;

  try {
    const res = await fetch('/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toSave),
    });
    const data = await res.json();
    if (data.ok) {
      document.getElementById('cand-save-status').textContent = '\\u2713 Saved ' + data.count + ' candidates';
      candidates = toSave.map(c => ({ ...c, _removed: false }));
      renderCandidates();
    } else {
      document.getElementById('cand-save-status').textContent = '\\u2718 Save failed';
    }
  } catch (err) {
    document.getElementById('cand-save-status').textContent = '\\u2718 ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

async function clearCandidates() {
  if (!confirm('Delete all candidates? This cannot be undone.')) return;
  const btn = document.querySelector('[onclick="clearCandidates()"]');
  btn.disabled = true;
  try {
    const res = await fetch('/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    });
    const data = await res.json();
    if (data.ok) {
      candidates = [];
      renderCandidates();
      document.getElementById('cand-controls').style.display = 'none';
      const notice = document.getElementById('cand-notice');
      notice.textContent = 'Candidates cleared.';
      notice.style.display = 'block';
    }
  } catch (err) {
    alert('Failed to clear: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Merge / Overwrite
// ---------------------------------------------------------------------------
async function runMerge() {
  const log = showLog('log-merge');
  const code = await runScript('/run/merge', log, 'btn-merge', {});
  if (code === 0) { loadAmenities(); }
}

async function runOverwrite() {
  if (!confirm('This will REPLACE all places in amenities.json with the current candidates list.\\nAre you sure?')) return;
  const log = showLog('log-merge');
  const code = await runScript('/run/overwrite', log, 'btn-overwrite', {});
  if (code === 0) { loadAmenities(); }
}

// ---------------------------------------------------------------------------
// Amenities Manager
// ---------------------------------------------------------------------------
let amenitiesData = null;  // full amenities.json data object
let amenities     = [];    // just the places array (reference into amenitiesData)
let amenitiesDirty = false;
let amenitiesSort = { col: null, dir: 1 };

function sortAmenities(col) {
  if (amenitiesSort.col === col) {
    amenitiesSort.dir *= -1;
  } else {
    amenitiesSort.col = col;
    amenitiesSort.dir = 1;
  }
  renderAmenities();
}

function getSortedIndices() {
  const indices = amenities.map((_, i) => i);
  const { col, dir } = amenitiesSort;
  if (!col) return indices;
  return indices.sort((a, b) => {
    const pa = amenities[a], pb = amenities[b];
    if (col === 'id') {
      return (parseInt(pa.id, 10) - parseInt(pb.id, 10)) * dir;
    }
    if (col === 'miles') {
      return ((pa.distanceMiles || 0) - (pb.distanceMiles || 0)) * dir;
    }
    let va, vb;
    if (col === 'name')       { va = (pa.name    || '').toLowerCase(); vb = (pb.name    || '').toLowerCase(); }
    if (col === 'categories') { va = (normCats(pa)[0] || '').toLowerCase(); vb = (normCats(pb)[0] || '').toLowerCase(); }
    if (col === 'address')    { va = (pa.address || '').toLowerCase(); vb = (pb.address || '').toLowerCase(); }
    return va < vb ? -dir : va > vb ? dir : 0;
  });
}

async function loadAmenities() {
  const notice = document.getElementById('am-notice');
  try {
    const res = await fetch('/amenities');
    if (!res.ok) {
      notice.textContent = 'Failed to load amenities.json';
      notice.style.display = 'block';
      return;
    }
    amenitiesData = await res.json();
    amenities = amenitiesData.places || [];
    amenitiesDirty = false;
    notice.style.display = 'none';
    renderAmenities();
  } catch (err) {
    notice.textContent = 'Error: ' + err.message;
    notice.style.display = 'block';
  }
}

function markAmenitiesDirty() {
  amenitiesDirty = true;
  document.getElementById('btn-save-amenities').disabled = false;
  document.getElementById('am-save-status').textContent = '';
}

function renderAmenities() {
  const tbody = document.getElementById('am-tbody');
  tbody.innerHTML = getSortedIndices().map(i => renderAmenityRow(amenities[i], i)).join('');
  document.querySelectorAll('#am-thead th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === amenitiesSort.col) {
      th.classList.add(amenitiesSort.dir === 1 ? 'sort-asc' : 'sort-desc');
    }
  });
  document.getElementById('btn-save-amenities').disabled = !amenitiesDirty;
}

function renderAmenityRow(p, i) {
  const cats = normCats(p);
  const badges = cats.length ? renderBadges(cats) : '<span style="color:var(--muted);font-size:11px">none</span>';
  const addrShort = (p.address || '').length > 45
    ? esc(p.address.slice(0, 45)) + '&hellip;'
    : esc(p.address || '');
  return \`
    <tr id="am-row-\${i}">
      <td class="td-muted" style="font-size:11px">\${esc(p.id)}</td>
      <td><strong>\${esc(p.name)}</strong></td>
      <td><div class="badges">\${badges}</div></td>
      <td class="td-muted" style="max-width:200px" title="\${esc(p.address||'')}">\${addrShort}</td>
      <td class="td-dist">\${p.distanceMiles != null ? p.distanceMiles + ' mi' : '—'}</td>
      <td style="white-space:nowrap">
        <button class="btn-ghost btn-sm" onclick="toggleEditAmenity(\${i})">Edit</button>
        <button class="btn-remove btn-sm" onclick="deleteAmenity(\${i})">Delete</button>
      </td>
    </tr>
    <tr id="am-edit-\${i}" style="display:none">
      <td colspan="6" style="padding:0"></td>
    </tr>
  \`;
}

function toggleEditAmenity(i) {
  const editRow = document.getElementById('am-edit-' + i);
  if (!editRow) return;
  if (editRow.style.display !== 'none') {
    editRow.style.display = 'none';
    return;
  }
  const td = editRow.querySelector('td');
  td.innerHTML = buildAmenityEditForm(amenities[i], i);
  editRow.style.display = '';
}

function buildAmenityEditForm(p, i) {
  const cats = normCats(p);
  return \`
    <div class="am-edit-wrap">
      <div class="am-edit-grid">
        <label>Name
          <input id="am-name-\${i}" value="\${esc(p.name||'')}">
        </label>
        <label>Miles
          <input id="am-dist-\${i}" type="number" step="0.1" value="\${p.distanceMiles != null ? p.distanceMiles : ''}">
        </label>
        <label class="span2">Address
          <input id="am-address-\${i}" value="\${esc(p.address||'')}">
        </label>
        <label>Phone
          <input id="am-phone-\${i}" value="\${esc(p.phone||'')}">
        </label>
        <label>Website
          <input id="am-website-\${i}" value="\${esc(p.website||'')}">
        </label>
        <label class="span2">Google Maps URL
          <input id="am-gmaps-\${i}" value="\${esc(p.googleMapsUrl||'')}">
        </label>
        <label>Latitude
          <input id="am-lat-\${i}" type="number" step="any" value="\${p.lat != null ? p.lat : ''}">
        </label>
        <label>Longitude
          <input id="am-lng-\${i}" type="number" step="any" value="\${p.lng != null ? p.lng : ''}">
        </label>
        <label>Place ID
          <input id="am-placeid-\${i}" value="\${esc(p.placeId||'')}">
        </label>
        <div class="span2">
          <label style="margin-bottom:6px">Categories <span style="font-size:10px;font-weight:400;text-transform:none;letter-spacing:0">(primary first, others optional)</span></label>
          <div class="am-edit-cats">
            <select id="am-cat0-\${i}">\${catOptions(cats[0]||'', false)}</select>
            <select id="am-cat1-\${i}">\${catOptions(cats[1]||'', true)}</select>
            <select id="am-cat2-\${i}">\${catOptions(cats[2]||'', true)}</select>
          </div>
        </div>
        <label style="flex-direction:row;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="am-mall-\${i}"\${normCats(p).includes('mall') ? ' checked' : ''}>
          Mall / Shopping Center
        </label>
      </div>
      <div class="am-edit-actions">
        <button class="btn-primary btn-sm" onclick="saveAmenityEdit(\${i})">Save</button>
        <button class="btn-ghost btn-sm" onclick="toggleEditAmenity(\${i})">Cancel</button>
      </div>
    </div>
  \`;
}

function saveAmenityEdit(i) {
  const g = id => document.getElementById(id);
  const p = amenities[i];

  const cats = [
    g('am-cat0-' + i).value,
    g('am-cat1-' + i).value,
    g('am-cat2-' + i).value,
  ].filter(Boolean);

  const lat  = parseFloat(g('am-lat-' + i).value);
  const lng  = parseFloat(g('am-lng-' + i).value);
  const dist = parseFloat(g('am-dist-' + i).value);

  // Sync mall category with the checkbox
  var mallChecked = g('am-mall-' + i).checked;
  if (mallChecked && !cats.includes('mall')) {
    cats = ['mall'].concat(cats.filter(function (c) { return c !== 'mall'; })).slice(0, 3);
  } else if (!mallChecked) {
    cats = cats.filter(function (c) { return c !== 'mall'; });
  }

  amenities[i] = {
    id:            p.id,
    name:          g('am-name-' + i).value.trim(),
    categories:    cats.length ? cats : normCats(p),
    tags:          [],
    lat:           isNaN(lat)  ? p.lat  : lat,
    lng:           isNaN(lng)  ? p.lng  : lng,
    address:       g('am-address-' + i).value.trim(),
    phone:         g('am-phone-' + i).value.trim(),
    website:       g('am-website-' + i).value.trim(),
    distanceMiles: isNaN(dist) ? p.distanceMiles : dist,
    googleMapsUrl: g('am-gmaps-' + i).value.trim(),
    placeId:       g('am-placeid-' + i).value.trim(),
  };

  markAmenitiesDirty();
  renderAmenities();
  // Collapse the edit row after save
  const editRow = document.getElementById('am-edit-' + i);
  if (editRow) editRow.style.display = 'none';
}

function deleteAmenity(i) {
  const name = amenities[i] ? amenities[i].name : 'this entry';
  if (!confirm('Delete "' + name + '"?')) return;
  amenities.splice(i, 1);
  markAmenitiesDirty();
  renderAmenities();
}

async function saveAllAmenities() {
  const btn    = document.getElementById('btn-save-amenities');
  const status = document.getElementById('am-save-status');
  btn.disabled = true;

  const toSave = { ...amenitiesData, places: amenities };

  try {
    const res = await fetch('/amenities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toSave),
    });
    const data = await res.json();
    if (data.ok) {
      amenitiesData = toSave;
      amenitiesDirty = false;
      status.textContent = '\\u2713 Saved ' + data.count + ' places';
    } else {
      status.textContent = '\\u2718 Save failed: ' + (data.error || 'unknown error');
      btn.disabled = false;
    }
  } catch (err) {
    status.textContent = '\\u2718 ' + err.message;
    btn.disabled = false;
  }
}
</script>
</body>
</html>`;
