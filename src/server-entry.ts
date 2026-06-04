import { Router, type Response } from 'express';
import type { Kysely } from 'kysely';
import type { Database } from '@vencore/db';
import { createMailAccountsRouter } from './routes/mail-accounts';
import { createMailEmailsRouter } from './routes/mail-emails';
import { createMailBodyRouter } from './routes/mail-body';
import { createMailConfigRouter } from './routes/mail-config';
import { createMailWebhookRouter } from './routes/mail-webhook';

function serveUi(res: Response) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Mail</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#f7f6f2;color:#1a1814;font-size:13px;height:100vh;display:flex;flex-direction:column}
header{padding:14px 20px;background:#fff;border-bottom:1px solid #e4e0d8;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
h1{font-size:16px;font-weight:600;letter-spacing:-.3px}
.badge{font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;background:#d8f3dc;color:#2d6a4f}
.layout{display:flex;flex:1;overflow:hidden}
.sidebar{width:160px;border-right:1px solid #e4e0d8;background:#fff;padding:12px 10px;flex-shrink:0}
.folder{padding:7px 10px;border-radius:8px;cursor:pointer;font-size:12.5px;color:#6b665c;display:flex;justify-content:space-between}
.folder.active,.folder:hover{background:#f0ede6;color:#1a1814}
.count{font-size:11px;color:#9e998f}
.main{flex:1;overflow-y:auto}
.email-row{padding:12px 20px;border-bottom:1px solid #e4e0d8;cursor:pointer;display:flex;gap:12px;align-items:flex-start}
.email-row:hover{background:#fff}
.email-row.unread .subject{font-weight:600}
.avatar{width:32px;height:32px;border-radius:50%;background:#e4e0d8;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#6b665c;flex-shrink:0}
.subject{font-size:13px;color:#1a1814;margin-bottom:2px}
.meta{font-size:11px;color:#9e998f}
.snippet{font-size:12px;color:#6b665c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:480px}
.empty{padding:40px 20px;text-align:center;color:#9e998f}
.no-account{padding:32px 20px;text-align:center}
.no-account h2{font-size:14px;font-weight:500;color:#6b665c;margin-bottom:8px}
.no-account p{font-size:12px;color:#9e998f}
</style>
</head>
<body>
<header>
  <h1>Mail</h1>
  <span class="badge" id="acct-badge">Loading…</span>
</header>
<div class="layout">
  <nav class="sidebar">
    <div class="folder active" onclick="loadFolder('INBOX')">Inbox <span class="count" id="inbox-count"></span></div>
    <div class="folder" onclick="loadFolder('sent')">Sent</div>
    <div class="folder" onclick="loadFolder('drafts')">Drafts</div>
  </nav>
  <div class="main" id="main"><div class="empty">Loading…</div></div>
</div>
<script>
const BASE = '/api/plugins/route/com.vencore.mail';
let TOKEN = null;
let currentFolder = 'INBOX';

window.addEventListener('message', e => {
  if (e.data?.type === 'AUTH_TOKEN') { TOKEN = e.data.token; boot(); }
});

async function api(path) {
  const r = await fetch(BASE + path, {
    credentials: 'include',
    headers: TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}
  });
  return r.json();
}

async function boot() {
  const acct = await api('/accounts');
  const accounts = acct.data ?? [];
  document.getElementById('acct-badge').textContent =
    accounts.length ? accounts.map(a => a.email).join(', ') : 'No accounts';
  if (!accounts.length) {
    document.getElementById('main').innerHTML =
      '<div class="no-account"><h2>No email accounts connected</h2><p>Add an account in Settings → Mail to get started.</p></div>';
    return;
  }
  loadFolder('INBOX');
}

async function loadFolder(folder) {
  currentFolder = folder;
  document.querySelectorAll('.folder').forEach(f => f.classList.remove('active'));
  event?.target?.classList.add('active');
  const main = document.getElementById('main');
  main.innerHTML = '<div class="empty">Loading…</div>';
  const data = await api('/emails?folder=' + folder + '&per_page=30');
  const emails = data.data ?? [];
  if (folder === 'INBOX') {
    const unread = emails.filter(e => !e.is_read).length;
    document.getElementById('inbox-count').textContent = unread || '';
  }
  if (!emails.length) { main.innerHTML = '<div class="empty">No messages.</div>'; return; }
  main.innerHTML = emails.map(e => {
    const d = new Date(e.sent_at);
    const date = d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
    const init = (e.from_name || e.from_address)[0].toUpperCase();
    return '<div class="email-row' + (e.is_read ? '' : ' unread') + '">' +
      '<div class="avatar">' + init + '</div>' +
      '<div style="min-width:0;flex:1">' +
        '<div class="subject">' + esc(e.subject || '(no subject)') + '</div>' +
        '<div class="meta">' + esc(e.from_name || e.from_address) + ' · ' + date + '</div>' +
        (e.snippet ? '<div class="snippet">' + esc(e.snippet) + '</div>' : '') +
      '</div></div>';
  }).join('');
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.parent.postMessage({ type: 'PLUGIN_READY' }, '*');
</script>
</body>
</html>`);
}

export function createRouter(db: Kysely<Database>) {
  const router = Router();
  router.get('/ui', (_req, res) => serveUi(res));
  router.use('/accounts', createMailAccountsRouter(db));
  router.use('/emails',   createMailEmailsRouter(db));
  router.use('/body',     createMailBodyRouter(db));
  router.use('/config',   createMailConfigRouter(db));
  router.use('/webhook',  createMailWebhookRouter(db));
  return router;
}
