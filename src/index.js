/**
 * Plummer — Cloudflare Worker Link Shortener
 *
 * Required KV binding : LINKIVERSE
 * Required secret     : ADMIN_SECRET  (npx wrangler secret put ADMIN_SECRET)
 *
 * KV schema — key: "link:{slug}"
 * Value (JSON):
 *   {
 *     slug        : string,
 *     guest       : string,   // destination URL
 *     passwordHash: string|null,  // SHA-256 of password, or null
 *     expiresAt   : number|null,  // Unix ms timestamp, or null
 *     clicks      : number,
 *     createdAt   : number        // Unix ms timestamp
 *   }
 */

// ─── Reserved slugs that cannot be used as short-link slugs ─────────────────
const RESERVED = new Set([
  'admin', 'api', 'favicon.ico', 'robots.txt', 'sitemap.xml',
]);

const ADMIN_REALM = 'Plummer Admin';

// ─── Shared CSS (based on SillyLittleTech lander / pasCurtain) ──────────────
const SHARED_CSS = `
  :root {
    --bg-color: #ffffff;
    --text-color: #1a1a1a;
    --card-bg: #f5f5f5;
    --card-hover: #e8e8e8;
    --border-color: #e0e0e0;
    --shadow: rgba(0,0,0,0.1);
    --accent-color: #667eea;
    --danger-color: #ef4444;
    --success-color: #10b981;
  }
  [data-theme="dark"] {
    --bg-color: #1a1a1a;
    --text-color: #ffffff;
    --card-bg: #2d2d2d;
    --card-hover: #3a3a3a;
    --border-color: #404040;
    --shadow: rgba(0,0,0,0.3);
    --accent-color: #8b9dff;
    --danger-color: #f87171;
    --success-color: #34d399;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Lexend", -apple-system, BlinkMacSystemFont, "Segoe UI",
      Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 16px;
    background: var(--bg-color);
    color: var(--text-color);
    transition: background-color 0.18s ease, color 0.18s ease;
    min-height: 100vh;
    line-height: 1.6;
  }
  a { color: var(--accent-color); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* Buttons */
  .btn {
    display: inline-flex; align-items: center; justify-content: center;
    gap: 6px;
    padding: 10px 18px;
    border: none; border-radius: 10px;
    font-family: inherit; font-size: 15px; font-weight: 700;
    cursor: pointer;
    transition: transform 0.14s ease, box-shadow 0.14s ease, opacity 0.12s ease;
    text-decoration: none;
    white-space: nowrap;
  }
  .btn:hover { text-decoration: none; }
  .btn-primary {
    background: linear-gradient(180deg, var(--accent-color),
      color-mix(in srgb, var(--accent-color) 85%, black 15%));
    color: #fff;
    box-shadow: 0 6px 24px rgba(102,126,234,0.2);
  }
  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 32px rgba(102,126,234,0.25);
  }
  .btn-secondary {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    color: var(--text-color);
  }
  .btn-secondary:hover { background: var(--card-hover); transform: translateY(-2px); }
  .btn-danger { background: var(--danger-color); color: #fff; }
  .btn-danger:hover { opacity: 0.9; transform: translateY(-1px); }
  .btn-sm { padding: 6px 12px; font-size: 13px; border-radius: 8px; }

  /* Cards */
  .card {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 24px;
    box-shadow: 0 4px 16px var(--shadow);
  }

  /* Form elements */
  .input, .select {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-color);
    color: var(--text-color);
    font-family: inherit; font-size: 15px;
    transition: border-color 0.14s ease;
  }
  .input:focus, .select:focus {
    outline: none;
    border-color: var(--accent-color);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 20%, transparent);
  }
  label { display: block; font-weight: 600; margin-bottom: 6px; font-size: 14px; }
  .form-group { margin-bottom: 16px; }
  .hint { font-size: 12px; opacity: 0.65; margin-top: 4px; }

  /* Theme toggle */
  .theme-toggle {
    position: fixed; top: 20px; right: 20px;
    background: var(--card-bg);
    border: 2px solid var(--border-color); border-radius: 50%;
    width: 48px; height: 48px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; z-index: 1000;
    transition: transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
    box-shadow: 0 6px 18px rgba(0,0,0,0.06);
  }
  .theme-toggle:hover { background: var(--card-hover); transform: rotate(12deg); }
  .theme-toggle svg {
    width: 22px; height: 22px;
    color: var(--text-color);
    fill: none; stroke: currentColor;
    stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
  }
  .sun-icon { display: none; }
  .moon-icon { display: block; }
  [data-theme="dark"] .sun-icon { display: block; }
  [data-theme="dark"] .moon-icon { display: none; }

  /* Alerts */
  .alert {
    padding: 12px 16px; border-radius: 8px; margin-bottom: 16px;
    font-weight: 600; font-size: 14px;
  }
  .alert-error {
    background: color-mix(in srgb, var(--danger-color) 10%, transparent);
    border: 1px solid var(--danger-color); color: var(--danger-color);
  }
  .alert-success {
    background: color-mix(in srgb, var(--success-color) 10%, transparent);
    border: 1px solid var(--success-color); color: var(--success-color);
  }

  /* Toast notification */
  .toast {
    position: fixed; bottom: 24px; right: 24px;
    background: var(--card-bg); border: 1px solid var(--border-color);
    border-radius: 10px; padding: 12px 20px;
    font-weight: 600; font-size: 14px;
    box-shadow: 0 8px 32px var(--shadow);
    transform: translateY(80px); opacity: 0;
    transition: all 0.3s ease; z-index: 9999;
    max-width: 320px;
  }
  .toast.show { transform: translateY(0); opacity: 1; }
  .toast.toast-error { border-color: var(--danger-color); }
  .toast.toast-ok { border-color: var(--success-color); }
`;

// ─── Theme toggle script ─────────────────────────────────────────────────────
const THEME_SCRIPT = `
(function(){
  var html = document.documentElement;
  function getSaved(){ try{ return localStorage.getItem('theme'); }catch(e){ return null; } }
  function save(t){ try{ localStorage.setItem('theme',t); }catch(e){} }
  function apply(t){ if(t) html.dataset.theme = t; }
  function detect(){
    try{ return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
    catch(e){ return 'light'; }
  }
  function toggle(){
    var c = html.dataset.theme||'light';
    var n = c==='light' ? 'dark' : 'light';
    apply(n); save(n);
  }
  var saved = getSaved();
  var theme = saved || detect();
  apply(theme);
  if(!saved) save(theme);
  document.addEventListener('DOMContentLoaded', function(){
    var btn = document.getElementById('themeToggle');
    if(btn) btn.addEventListener('click', toggle);
  });
})();
`;

const TOGGLE_BTN = `<button class="theme-toggle" id="themeToggle" aria-label="Toggle theme">
  <svg class="sun-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="5"></circle>
    <line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
    <line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
  </svg>
  <svg class="moon-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
  </svg>
</button>`;

// ─── HTML page wrapper ───────────────────────────────────────────────────────
function htmlPage(title, bodyContent, extraCss = '', extraScript = '') {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <script>(function(){try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}})();</script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lexend:wght@100..900&display=swap" />
  <style>${SHARED_CSS}${extraCss}</style>
</head>
<body>
  ${TOGGLE_BTN}
  ${bodyContent}
  <script>${THEME_SCRIPT}${extraScript}</script>
</body>
</html>`;
}

// ─── Page: Homepage ──────────────────────────────────────────────────────────
function homePage(origin) {
  return htmlPage(
    'Plummer — Link Shortener',
    `<main class="home-main">
  <div class="hero">
    <div class="hero-icon" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="1.5"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
    </div>
    <h1>Plummer</h1>
    <p class="tagline">A simple, fast link shortener — powered by<br>Cloudflare Workers &amp; KV.</p>
    <a href="/admin" class="btn btn-primary hero-cta">Manage Links →</a>
  </div>

  <div class="features">
    <div class="feature-card card">
      <div class="feature-icon" aria-hidden="true">⚡</div>
      <h3>Edge-Fast Redirects</h3>
      <p>Every redirect is served from Cloudflare's global edge network — sub-millisecond latency worldwide.</p>
    </div>
    <div class="feature-card card">
      <div class="feature-icon" aria-hidden="true">📊</div>
      <h3>Click Analytics</h3>
      <p>Track how many times each short link has been visited, right from the admin dashboard.</p>
    </div>
    <div class="feature-card card">
      <div class="feature-icon" aria-hidden="true">🔒</div>
      <h3>Password Protection</h3>
      <p>Optionally require a password before visitors are redirected — perfect for private links.</p>
    </div>
    <div class="feature-card card">
      <div class="feature-icon" aria-hidden="true">⏰</div>
      <h3>Link Expiry</h3>
      <p>Set links to expire automatically at a specific date and time. Expired links are cleaned up automatically.</p>
    </div>
  </div>
</main>

<footer class="home-footer">
  Plummer — Open-source link shortener by
  <a href="https://sillylittle.tech" target="_blank" rel="noopener">SillyLittleTech</a>.
  <a href="https://github.com/SillyLittleTech/plummer" target="_blank" rel="noopener">View on GitHub</a>
</footer>`,
    /* extra CSS */
    `
    body {
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      padding: 40px 20px 80px;
    }
    .home-main { max-width: 900px; width: 100%; }

    /* Hero */
    .hero { text-align: center; padding: 60px 20px 48px; }
    .hero-icon {
      width: 84px; height: 84px;
      background: linear-gradient(135deg, var(--accent-color),
        color-mix(in srgb, var(--accent-color) 70%, #8b5cf6 30%));
      border-radius: 20px;
      display: inline-flex; align-items: center; justify-content: center;
      color: #fff; margin-bottom: 28px;
      box-shadow: 0 8px 32px color-mix(in srgb, var(--accent-color) 40%, transparent);
    }
    h1 { font-size: 3.5rem; font-weight: 800; letter-spacing: -2px; line-height: 1; }
    .tagline {
      font-size: 1.15rem; opacity: 0.75; margin-top: 16px;
      max-width: 420px; margin-left: auto; margin-right: auto;
      line-height: 1.7;
    }
    .hero-cta { margin-top: 28px; font-size: 1rem; padding: 12px 28px; border-radius: 12px; }

    /* Features */
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 16px; margin-top: 16px;
    }
    .feature-card { text-align: center; }
    .feature-icon { font-size: 2rem; margin-bottom: 12px; }
    .feature-card h3 { font-size: 1rem; font-weight: 700; margin-bottom: 8px; }
    .feature-card p { font-size: 0.875rem; opacity: 0.7; line-height: 1.55; }

    /* Footer */
    .home-footer {
      position: fixed; bottom: 0; left: 0; right: 0;
      text-align: center; padding: 10px 16px;
      background: var(--card-bg); border-top: 1px solid var(--border-color);
      font-size: 0.82rem; opacity: 0.8;
    }

    @media (max-width: 600px) {
      h1 { font-size: 2.4rem; }
      .features { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 400px) {
      .features { grid-template-columns: 1fr; }
    }
    `,
  );
}

// ─── Page: Admin Dashboard ───────────────────────────────────────────────────
function adminPage(links, origin) {
  const rows = links.length === 0
    ? `<tr><td colspan="6" class="empty-row">No links yet — create one above!</td></tr>`
    : links.map(link => {
        const expiry = link.expiresAt
          ? new Date(link.expiresAt).toLocaleString('en-GB', {
              dateStyle: 'short', timeStyle: 'short',
            })
          : '—';
        const shortUrl = `${origin}/${link.slug}`;
        return `<tr data-slug="${escHtml(link.slug)}">
          <td><code class="slug-code">${escHtml(link.slug)}</code></td>
          <td class="url-cell">
            <a href="${escHtml(link.guest)}" target="_blank" rel="noopener"
               title="${escHtml(link.guest)}">${escHtml(link.guest)}</a>
          </td>
          <td class="center">${link.clicks ?? 0}</td>
          <td class="center">${link.passwordHash ? '🔒' : '—'}</td>
          <td class="center nowrap">${expiry}</td>
          <td class="center nowrap">
            <button class="btn btn-sm btn-secondary"
              onclick="copyLink(${escHtml(JSON.stringify(shortUrl))})"
              title="Copy short URL">📋 Copy</button>
            <button class="btn btn-sm btn-danger"
              onclick="deleteLink(${escHtml(JSON.stringify(link.slug))})"
              title="Delete link">🗑</button>
          </td>
        </tr>`;
      }).join('');

  return htmlPage(
    'Plummer — Admin',
    `<div class="admin-wrap">
  <header class="admin-header">
    <a href="/" class="back-link">← Plummer</a>
    <h1>Link Dashboard</h1>
    <p>Create, track, and manage your short links.</p>
  </header>

  <section class="card create-card" aria-label="Create short link">
    <h2>Create Short Link</h2>
    <form id="createForm" novalidate>
      <div class="form-row">
        <div class="form-group">
          <label for="slug">Slug</label>
          <input class="input" type="text" id="slug" name="slug"
            placeholder="my-link" pattern="[a-zA-Z0-9_-]+" required
            autocomplete="off" spellcheck="false" />
          <p class="hint">Letters, numbers, hyphens and underscores only.</p>
        </div>
        <div class="form-group">
          <label for="guest">Destination URL</label>
          <input class="input" type="url" id="guest" name="guest"
            placeholder="https://example.com" required />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="expiresAt">Expires at <span class="opt">(optional)</span></label>
          <input class="input" type="datetime-local" id="expiresAt" name="expiresAt" />
          <p class="hint">Leave blank for a permanent link.</p>
        </div>
        <div class="form-group">
          <label for="password">Password protection <span class="opt">(optional)</span></label>
          <input class="input" type="password" id="password" name="password"
            placeholder="Leave blank for none" autocomplete="new-password" />
          <p class="hint">Visitors must enter this before being redirected.</p>
        </div>
      </div>
      <div id="formError" class="alert alert-error" style="display:none;"></div>
      <button type="submit" class="btn btn-primary" id="createBtn">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Create Link
      </button>
    </form>
  </section>

  <section class="card links-card" aria-label="All short links">
    <h2>All Links <span class="badge" id="linkCount">${links.length}</span></h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Slug</th>
            <th>Destination</th>
            <th class="center">Clicks</th>
            <th class="center">Pass</th>
            <th class="center">Expires</th>
            <th class="center">Actions</th>
          </tr>
        </thead>
        <tbody id="linksBody">
          ${rows}
        </tbody>
      </table>
    </div>
  </section>
</div>

<div id="toast" class="toast" role="status" aria-live="polite"></div>`,

    /* extra CSS */
    `
    body { padding: 24px 16px 40px; }
    .admin-wrap { max-width: 1060px; margin: 0 auto; }
    .admin-header {
      margin-bottom: 24px; padding-bottom: 20px;
      border-bottom: 1px solid var(--border-color);
    }
    .admin-header h1 { font-size: 2rem; font-weight: 800; margin: 8px 0 4px; }
    .admin-header p { opacity: 0.7; font-size: 0.95rem; }
    .back-link { color: var(--accent-color); font-weight: 600; font-size: 0.875rem; }
    .back-link:hover { text-decoration: underline; }

    .create-card { margin-bottom: 20px; }
    .create-card h2, .links-card h2 {
      font-size: 1.1rem; font-weight: 700; margin-bottom: 18px;
    }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .opt { font-weight: 400; opacity: 0.6; font-size: 12px; }

    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    thead { background: var(--card-hover); }
    th {
      padding: 10px 14px; text-align: left;
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.6px; white-space: nowrap;
    }
    td { padding: 12px 14px; border-bottom: 1px solid var(--border-color); vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: color-mix(in srgb, var(--card-hover) 50%, transparent); }
    .center { text-align: center; }
    .nowrap { white-space: nowrap; }
    .slug-code {
      font-family: ui-monospace, "Cascadia Code", monospace;
      background: var(--card-hover); padding: 2px 8px;
      border-radius: 5px; font-size: 13px;
    }
    .url-cell {
      max-width: 260px; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap;
    }
    .url-cell a { font-size: 13px; }
    .empty-row { text-align: center; padding: 40px; opacity: 0.55; font-style: italic; }
    .badge {
      background: var(--accent-color); color: #fff;
      border-radius: 999px; padding: 2px 9px;
      font-size: 11px; font-weight: 700; margin-left: 8px;
      vertical-align: middle;
    }
    #formError { margin-top: 12px; margin-bottom: 0; }
    .actions-cell { display: flex; gap: 6px; justify-content: center; }
    td:last-child { text-align: center; }
    td:last-child .btn { margin: 2px; }

    @media (max-width: 640px) {
      .form-row { grid-template-columns: 1fr; }
      body { padding: 16px 12px 40px; }
    }
    `,

    /* extra script */
    `
const ORIGIN = ${JSON.stringify(origin)};

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (isError ? 'toast-error' : 'toast-ok');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.classList.remove('show'); }, 2800);
}

async function deleteLink(slug) {
  if (!confirm('Delete /' + slug + '? This cannot be undone.')) return;
  const r = await fetch('/api/links/' + encodeURIComponent(slug), { method: 'DELETE' });
  if (r.ok) {
    showToast('Link /' + slug + ' deleted.');
    const row = document.querySelector('[data-slug="' + slug + '"]');
    if (row) row.remove();
    const badge = document.getElementById('linkCount');
    if (badge) badge.textContent = parseInt(badge.textContent || '0', 10) - 1;
    const tbody = document.getElementById('linksBody');
    if (tbody && tbody.rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No links yet — create one above!</td></tr>';
    }
  } else {
    const d = await r.json().catch(() => ({}));
    showToast('Error: ' + (d.error || 'Unknown error'), true);
  }
}

function copyLink(url) {
  navigator.clipboard.writeText(url)
    .then(() => showToast('Copied: ' + url))
    .catch(() => showToast('Could not copy to clipboard.', true));
}

document.getElementById('createForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const errEl = document.getElementById('formError');
  errEl.style.display = 'none';
  const fd = new FormData(e.target);
  const slug = fd.get('slug').trim();
  const guest = fd.get('guest').trim();
  const expiresAtRaw = fd.get('expiresAt');
  const password = fd.get('password');

  const body = {
    slug,
    guest,
    expiresAt: expiresAtRaw ? new Date(expiresAtRaw).getTime() : null,
    password: password || null,
  };

  const btn = document.getElementById('createBtn');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  const r = await fetch('/api/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  btn.disabled = false;
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Create Link';

  if (!r.ok) {
    errEl.textContent = d.error || 'Failed to create link.';
    errEl.style.display = '';
    return;
  }

  showToast('Created: ' + ORIGIN + '/' + slug);
  e.target.reset();

  // Add row to table
  const tbody = document.getElementById('linksBody');
  // Remove empty-row if present
  const emptyRow = tbody.querySelector('.empty-row');
  if (emptyRow) emptyRow.closest('tr').remove();

  const expiryText = body.expiresAt
    ? new Date(body.expiresAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
  const shortUrl = ORIGIN + '/' + slug;
  const tr = document.createElement('tr');
  tr.dataset.slug = slug;

  // Use JSON.stringify to get a safe JS literal, then HTML-encode the quotes
  // for the onclick attribute value (browser decodes HTML entities before eval).
  function jsAttr(val) {
    return JSON.stringify(val).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  }
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  tr.innerHTML =
    '<td><code class="slug-code">' + esc(slug) + '</code></td>' +
    '<td class="url-cell"><a href="' + esc(guest) + '" target="_blank" rel="noopener" title="' + esc(guest) + '">' + esc(guest) + '</a></td>' +
    '<td class="center">0</td>' +
    '<td class="center">' + (body.password ? '🔒' : '—') + '</td>' +
    '<td class="center nowrap">' + esc(expiryText) + '</td>' +
    '<td class="center nowrap">' +
      '<button class="btn btn-sm btn-secondary" onclick="copyLink(' + jsAttr(shortUrl) + ')" title="Copy short URL">📋 Copy</button> ' +
      '<button class="btn btn-sm btn-danger" onclick="deleteLink(' + jsAttr(slug) + ')" title="Delete link">🗑</button>' +
    '</td>';
  tbody.insertBefore(tr, tbody.firstChild);

  const badge = document.getElementById('linkCount');
  if (badge) badge.textContent = parseInt(badge.textContent || '0', 10) + 1;
});
    `,
  );
}

// ─── Page: Password prompt ───────────────────────────────────────────────────
function passwordPage(slug, badPassword) {
  return htmlPage(
    'Protected Link — Plummer',
    `<div class="pw-wrap">
  <div class="card pw-card">
    <div class="pw-icon" aria-hidden="true">🔒</div>
    <h1>Protected Link</h1>
    <p>This link requires a password. Enter it below to continue.</p>
    ${badPassword ? '<div class="alert alert-error">Incorrect password — please try again.</div>' : ''}
    <form method="POST" action="/${escHtml(slug)}">
      <div class="form-group">
        <label for="password">Password</label>
        <input class="input" type="password" id="password" name="password"
          required autofocus autocomplete="current-password" />
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%;">
        Continue →
      </button>
    </form>
  </div>
</div>`,
    `
    body { display:flex; align-items:center; justify-content:center; min-height:100vh; padding:20px; }
    .pw-wrap { width:100%; max-width:380px; }
    .pw-card { text-align:center; }
    .pw-icon { font-size:3rem; margin-bottom:18px; }
    h1 { font-size:1.5rem; font-weight:800; margin-bottom:10px; }
    p { opacity:0.72; margin-bottom:20px; font-size:0.95rem; }
    .alert { text-align:left; }
    `,
  );
}

// ─── Page: Link expired ──────────────────────────────────────────────────────
function expiredPage() {
  return htmlPage(
    'Link Expired — Plummer',
    `<div class="center-wrap">
  <div class="card center-card">
    <div class="page-icon" aria-hidden="true">⏰</div>
    <h1>Link Expired</h1>
    <p>This short link has expired and is no longer active.</p>
    <a href="/" class="btn btn-secondary" style="margin-top:1.25rem;">← Back to Home</a>
  </div>
</div>`,
    `
    body { display:flex; align-items:center; justify-content:center; min-height:100vh; padding:20px; }
    .center-card { text-align:center; max-width:380px; }
    .page-icon { font-size:3rem; margin-bottom:18px; }
    h1 { font-size:1.5rem; font-weight:800; margin-bottom:10px; }
    p { opacity:0.72; margin-bottom:4px; font-size:0.95rem; }
    `,
  );
}

// ─── Page: Not found ─────────────────────────────────────────────────────────
function notFoundPage() {
  return htmlPage(
    'Not Found — Plummer',
    `<div class="center-wrap">
  <div class="card center-card">
    <div class="page-icon" aria-hidden="true">🔍</div>
    <h1>Link Not Found</h1>
    <p>This short link doesn't exist, or may have been deleted.</p>
    <a href="/" class="btn btn-secondary" style="margin-top:1.25rem;">← Back to Home</a>
  </div>
</div>`,
    `
    body { display:flex; align-items:center; justify-content:center; min-height:100vh; padding:20px; }
    .center-card { text-align:center; max-width:380px; }
    .page-icon { font-size:3rem; margin-bottom:18px; }
    h1 { font-size:1.5rem; font-weight:800; margin-bottom:10px; }
    p { opacity:0.72; margin-bottom:4px; font-size:0.95rem; }
    `,
  );
}

// ─── Page: Misconfigured (no ADMIN_SECRET set) ───────────────────────────────
function misconfiguredPage() {
  return htmlPage(
    'Setup Required — Plummer',
    `<div class="center-wrap">
  <div class="card center-card">
    <div class="page-icon" aria-hidden="true">⚙️</div>
    <h1>Setup Required</h1>
    <p>The <code>ADMIN_SECRET</code> environment variable is not configured.</p>
    <p style="margin-top:10px;">
      Run the following command to set it, then re-deploy:
    </p>
    <pre class="setup-code">npx wrangler secret put ADMIN_SECRET</pre>
    <a href="https://github.com/SillyLittleTech/plummer#setup" target="_blank"
       rel="noopener" class="btn btn-primary" style="margin-top:1.25rem;">
      View Setup Guide →
    </a>
  </div>
</div>`,
    `
    body { display:flex; align-items:center; justify-content:center; min-height:100vh; padding:20px; }
    .center-card { text-align:center; max-width:440px; }
    .page-icon { font-size:3rem; margin-bottom:18px; }
    h1 { font-size:1.5rem; font-weight:800; margin-bottom:10px; }
    p { opacity:0.75; margin-bottom:4px; font-size:0.95rem; }
    p code {
      font-family: ui-monospace, monospace;
      background: var(--card-hover); padding: 1px 6px; border-radius: 4px; font-size:0.9rem;
    }
    .setup-code {
      margin-top:14px; padding:12px 16px;
      background:var(--card-hover); border:1px solid var(--border-color);
      border-radius:8px; font-family:ui-monospace,monospace; font-size:13px;
      text-align:left; overflow-x:auto;
    }
    `,
  );
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Escape characters that are special in HTML attribute values and text nodes. */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Compute a hex SHA-256 digest of a string using Web Crypto. */
async function sha256(text) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Timing-safe equality check for two hex digests of equal length.
 * Prevents timing attacks when comparing password hashes.
 */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Validate that a submitted URL is http or https. */
function isValidUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Check HTTP Basic Auth against env.ADMIN_SECRET. Returns true if valid. */
async function checkAdminAuth(request, env) {
  if (!env.ADMIN_SECRET) return false;
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Basic ')) return false;
  let decoded;
  try {
    decoded = atob(auth.slice(6));
  } catch {
    return false;
  }
  const colon = decoded.indexOf(':');
  if (colon === -1) return false;
  const password = decoded.slice(colon + 1);
  // Compare hashes to get a fixed-length comparison (mitigates timing leaks)
  const [submittedHash, secretHash] = await Promise.all([
    sha256(password),
    sha256(env.ADMIN_SECRET),
  ]);
  return safeEqual(submittedHash, secretHash);
}

/** Returns a 401 response that prompts Basic Auth in the browser. */
function unauthorizedResponse() {
  return new Response('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${ADMIN_REALM}", charset="UTF-8"`,
      'Content-Type': 'text/plain',
    },
  });
}

// ─── KV helpers ──────────────────────────────────────────────────────────────

async function getLink(env, slug) {
  const raw = await env.LINKIVERSE.get(`link:${slug}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function putLink(env, link) {
  await env.LINKIVERSE.put(`link:${link.slug}`, JSON.stringify(link));
}

async function deleteLink(env, slug) {
  await env.LINKIVERSE.delete(`link:${slug}`);
}

/** Fetch all stored links, handling KV list pagination. */
async function getAllLinks(env) {
  const links = [];
  let cursor;
  do {
    const page = await env.LINKIVERSE.list({ prefix: 'link:', limit: 100, cursor });
    for (const key of page.keys) {
      const raw = await env.LINKIVERSE.get(key.name);
      if (raw) {
        try { links.push(JSON.parse(raw)); } catch { /* skip corrupt entries */ }
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  links.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return links;
}

// ─── Route handlers ──────────────────────────────────────────────────────────

async function handleHomePage(origin) {
  return new Response(homePage(origin), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function handleAdminPage(request, env, origin) {
  // if (!env.ADMIN_SECRET) {
  //   return new Response(misconfiguredPage(), {
  //     status: 503,
  //     headers: { 'Content-Type': 'text/html; charset=utf-8' },
  //   });
  // }
  // if (!await checkAdminAuth(request, env)) return unauthorizedResponse();

  const links = await getAllLinks(env);
  return new Response(adminPage(links, origin), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function handleAPI(request, env, pathname) {
  // if (!env.ADMIN_SECRET) {
  //   return Response.json({ error: 'ADMIN_SECRET is not configured' }, { status: 503 });
  // }
  // if (!await checkAdminAuth(request, env)) {
  //   return new Response('Unauthorized', {
  //     status: 401,
  //     headers: { 'WWW-Authenticate': `Basic realm="${ADMIN_REALM}"` },
  //   });
  // }

  // GET /api/links
  if (pathname === '/api/links' && request.method === 'GET') {
    const links = await getAllLinks(env);
    return Response.json(links);
  }

  // POST /api/links
  if (pathname === '/api/links' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { slug, guest, expiresAt, password } = body ?? {};

    if (!slug || typeof slug !== 'string') {
      return Response.json({ error: 'slug is required' }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(slug)) {
      return Response.json(
        { error: 'Slug may only contain letters, numbers, hyphens and underscores (max 64 chars)' },
        { status: 400 },
      );
    }
    if (RESERVED.has(slug.toLowerCase())) {
      return Response.json({ error: `"${slug}" is a reserved slug` }, { status: 400 });
    }
    if (!guest || !isValidUrl(guest)) {
      return Response.json({ error: 'A valid destination URL is required' }, { status: 400 });
    }
    if (expiresAt !== undefined && expiresAt !== null) {
      if (typeof expiresAt !== 'number' || expiresAt < Date.now()) {
        return Response.json({ error: 'expiresAt must be a future Unix timestamp (ms)' }, { status: 400 });
      }
    }

    const existing = await getLink(env, slug);
    if (existing) {
      return Response.json({ error: `Slug "${slug}" is already in use` }, { status: 409 });
    }

    const passwordHash = password ? await sha256(password) : null;

    const link = {
      slug,
      guest,
      passwordHash,
      expiresAt: expiresAt ?? null,
      clicks: 0,
      createdAt: Date.now(),
    };
    await putLink(env, link);
    return Response.json({ slug, message: 'Created' }, { status: 201 });
  }

  // DELETE /api/links/:slug
  const deleteMatch = pathname.match(/^\/api\/links\/([^/]+)$/);
  if (deleteMatch && request.method === 'DELETE') {
    const slug = decodeURIComponent(deleteMatch[1]);
    const existing = await getLink(env, slug);
    if (!existing) return Response.json({ error: 'Link not found' }, { status: 404 });
    await deleteLink(env, slug);
    return Response.json({ message: 'Deleted' });
  }

  return Response.json({ error: 'API route not found' }, { status: 404 });
}

async function handleRedirect(request, env, slug) {
  const link = await getLink(env, slug);
  if (!link) {
    return new Response(notFoundPage(), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Check link expiry
  if (link.expiresAt && Date.now() > link.expiresAt) {
    // Clean up the expired link from KV
    await deleteLink(env, slug);
    return new Response(expiredPage(), {
      status: 410,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Handle password-protected links
  if (link.passwordHash) {
    if (request.method === 'POST') {
      let formData;
      try { formData = await request.formData(); } catch {
        return new Response(passwordPage(slug, false), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      const submitted = formData.get('password') ?? '';
      const submittedHash = await sha256(submitted);
      if (!safeEqual(submittedHash, link.passwordHash)) {
        return new Response(passwordPage(slug, true), {
          status: 403,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      // Correct password — fall through to redirect
    } else {
      return new Response(passwordPage(slug, false), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
  }

  // Increment click counter (best-effort; do not block the redirect)
  const updated = { ...link, clicks: (link.clicks ?? 0) + 1 };
  // Use waitUntil if available to avoid delaying the response
  env.ctx?.waitUntil(putLink(env, updated));

  return Response.redirect(link.guest, 302);
}

// ─── Security headers added to every response ────────────────────────────────
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function addSecurityHeaders(response) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  return r;
}

// ─── Main fetch handler ──────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    // Attach ctx so handlers can use waitUntil
    env.ctx = ctx;

    const url = new URL(request.url);
    const { pathname } = url;
    const origin = url.origin;

    let response;

    // Homepage
    if (pathname === '/' && request.method === 'GET') {
      response = await handleHomePage(origin);
    }

    // Admin dashboard
    else if ((pathname === '/admin' || pathname === '/admin/') && request.method === 'GET') {
      response = await handleAdminPage(request, env, origin);
    }

    // REST API
    else if (pathname.startsWith('/api/')) {
      response = await handleAPI(request, env, pathname);
    }

    // Short-link redirect — slug must be alphanumeric/-/_
    else {
      const slugMatch = pathname.match(/^\/([a-zA-Z0-9_-]+)\/?$/);
      if (slugMatch && (request.method === 'GET' || request.method === 'POST')) {
        response = await handleRedirect(request, env, slugMatch[1]);
      } else {
        response = new Response(notFoundPage(), {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
    }

    return addSecurityHeaders(response);
  },
};
