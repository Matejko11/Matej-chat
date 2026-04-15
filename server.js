const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sem-vloz-api-kluc';
const PORT = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, 'config.json');
const PROMPT_FILE = path.join(__dirname, 'SYSTEM_PROMPT_v2.md');
const CONV_FILE = path.join(__dirname, 'data', 'conversations.jsonl');
const RATINGS_FILE = path.join(__dirname, 'data', 'ratings.jsonl');
const SHORTCUTS_FILE = path.join(__dirname, 'data', 'shortcuts.json');

if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));
if (!fs.existsSync(path.join(__dirname, 'public'))) fs.mkdirSync(path.join(__dirname, 'public'));
if (!fs.existsSync(SHORTCUTS_FILE)) {
  fs.writeFileSync(SHORTCUTS_FILE, JSON.stringify([
    { id: 1, label: 'Doprava', text: 'Doručenie je zadarmo nad 70€. Kuriér SPS doručí nasledujúci pracovný deň pri objednávke do 14:00.' },
    { id: 2, label: 'Vrátenie', text: 'Máš 30 dní na vrátenie. Vybavíme cez Packetu, bez tlačenia štítkov. Presný postup nájdeš tu: https://www.bezeckepotreby.sk/stranka/vratenie-tovaru-do-30-dni' },
    { id: 3, label: 'Veľkosť', text: 'Odporúčame objednať o 0,5 väčšiu ako bežne nosíte. Ak máte širšie chodidlo, zvoľte 1 číslo navyše.' },
    { id: 4, label: 'Sklad', text: 'Dostupnosť tovaru prosím overte na tel. 0948 535 530 alebo emailom info@bezeckepotreby.sk.' },
    { id: 5, label: 'Reklamácia', text: 'Ako správne odoslať tovar na reklamáciu? Všetky info nájdeš tu: https://www.bezeckepotreby.sk/stranka/reklamacie/' },
    { id: 6, label: 'Výmena', text: 'Pri prvej výmene bežeckej obuvi máš u nás dopravu späť úplne ZDARMA. Viac info tu: https://www.bezeckepotreby.sk/vymena' }
  ], null, 2));
}

const sessions = {};
const adminClients = new Set();

// Online/Offline stav: 'auto', 'online', 'offline'
let onlineStatus = 'auto';

function loadConfig() { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); }
function loadPrompt() { return fs.readFileSync(PROMPT_FILE, 'utf-8'); }

function isDST(date) {
  const jan = new Date(date.getFullYear(), 0, 1);
  const jul = new Date(date.getFullYear(), 6, 1);
  return date.getTimezoneOffset() < Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
}

function isWorkingHours() {
  const now = new Date();
  const offset = isDST(now) ? 2 : 1;
  const sk = new Date(now.getTime() + offset * 60 * 60 * 1000);
  const day = sk.getUTCDay();
  const hour = sk.getUTCHours();
  const min = sk.getUTCMinutes();
  const time = hour * 60 + min;
  if (day >= 1 && day <= 5) return time >= 9 * 60 + 30 && time < 16 * 60 + 30;
  if (day === 6) return time >= 9 * 60 && time < 12 * 60;
  return false;
}

function isOnline() {
  if (onlineStatus === 'online') return true;
  if (onlineStatus === 'offline') return false;
  return isWorkingHours();
}

const offlineMessages = {
  SK: 'Ahoj! Momentálne sme offline. Pracujeme Po–Pia 9:30–16:30 a So 9:00–12:00. Zanechaj nám svoj email a hneď ako budeme online, ozveme sa ti. 🙂',
  CZ: 'Ahoj! Momentálně jsme offline. Pracujeme Po–Pá 9:30–16:30 a So 9:00–12:00. Zanech nám svůj email a jakmile budeme online, ozveme se ti. 🙂',
  HU: 'Szia! Jelenleg offline vagyunk. Munkaidőnk: H–P 9:30–16:30 és Szo 9:00–12:00. Hagyd meg az email címed és amint online leszünk, jelentkezünk. 🙂'
};

function detectSite(req, body) {
  const origin = req.headers.origin || req.headers.referer || '';
  if (body && body.lang === 'HU') return { site: 'runnie.hu', lang: 'HU' };
  if (body && body.lang === 'CZ') return { site: 'runnie.cz', lang: 'CZ' };
  if (body && body.lang === 'SK') return { site: 'bezeckepotreby.sk', lang: 'SK' };
  if (origin.includes('runnie.cz')) return { site: 'runnie.cz', lang: 'CZ' };
  if (origin.includes('runnie.hu')) return { site: 'runnie.hu', lang: 'HU' };
  return { site: 'bezeckepotreby.sk', lang: 'SK' };
}

function broadcastToAdmins(data) {
  const msg = JSON.stringify(data);
  adminClients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); });
}

function saveConversation(session, role, text) {
  const entry = { timestamp: new Date().toISOString(), sessionId: session.id, site: session.site, lang: session.lang, userName: session.name, userEmail: session.email, role, text };
  fs.appendFileSync(CONV_FILE, JSON.stringify(entry) + '\n');
}

const waitingMessages = {
  SK: 'Prosíme o trpezlivosť, všetci naši operátori sú vyťažení. Ak nemôžete dlhšie čakať, napíšte nám váš e-mail a my sa vám ozveme. Ďakujeme za pochopenie.',
  CZ: 'Prosíme o trpělivost, všichni naši operátoři jsou momentálně zaneprázdněni. Pokud nemůžete déle čekat, napište nám svůj e-mail a my se vám ozveme. Děkujeme za pochopení.',
  HU: 'Kérjük türelmét, operátoraink jelenleg foglaltak. Ha nem tud tovább várni, kérjük, adja meg e-mail címét és hamarosan felvesszük Önnel a kapcsolatot. Köszönjük megértését.'
};

async function translateText(text, targetLang) {
  if (targetLang === 'SK') return text;
  const langName = { CZ: 'spisovnú češtinu', HU: 'spisovnú maďarčinu' }[targetLang];
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, messages: [{ role: 'user', content: 'Prelozte nasledujuci text do ' + langName + '. Vraťte IBA prelozeny text:\n\n' + text }] })
    });
    const data = await response.json();
    return data.content?.[0]?.text || text;
  } catch { return text; }
}

async function translateToSK(text, fromLang) {
  if (fromLang === 'SK') return text;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 300, messages: [{ role: 'user', content: 'Prelozte nasledujuci text do slovenciny. Vraťte IBA prelozeny text:\n\n' + text }] })
    });
    const data = await response.json();
    return data.content?.[0]?.text || text;
  } catch { return text; }
}

async function generateDraft(session) {
  const prompt = loadPrompt();
  const systemMsg = prompt + '\n\n---\nDOLEZITE: Odpovedaj VZDY po SLOVENSKY. Tvoja odpoved bude prelozena do jazyka zakaznika automaticky.\n\nAktualny zakaznik: ' + (session.name || 'neznamy') + ', stranka: ' + session.site;
  const messages = session.messages.map(m => ({ role: m.role === 'customer' ? 'user' : 'assistant', content: m.textSK || m.text }));
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 500, system: systemMsg, messages })
    });
    const data = await response.json();
    return data.content?.[0]?.text || '';
  } catch { return ''; }
}

// ── CUSTOMER API ──────────────────────────────────────────────────────────────

app.post('/api/start', async (req, res) => {
  const { name, email, sessionId } = req.body;
  const { site, lang } = detectSite(req, req.body);
  const sid = sessionId || ('s_' + Date.now() + '_' + Math.random().toString(36).slice(2,7));
  const online = isOnline();

  sessions[sid] = { id: sid, name: name || 'Zákazník', email: email || '', site, lang, messages: [], status: 'waiting', aiDraft: null, createdAt: Date.now(), lastActivity: Date.now(), waitingSent: false };

  if (!online) {
    const offMsg = offlineMessages[lang] || offlineMessages.SK;
    sessions[sid].messages.push({ role: 'operator', text: offMsg, textSK: 'Automatická offline správa', timestamp: Date.now(), delivered: false });
    saveConversation(sessions[sid], 'assistant', offMsg);
  }

  broadcastToAdmins({ type: 'new_session', session: { id: sid, name: sessions[sid].name, email: sessions[sid].email, site, lang, status: 'waiting', createdAt: sessions[sid].createdAt, messages: [] } });

  setTimeout(() => {
    const s = sessions[sid];
    if (s && s.status === 'waiting' && !s.waitingSent && isOnline()) {
      s.waitingSent = true;
      const waitMsg = waitingMessages[s.lang] || waitingMessages.SK;
      broadcastToAdmins({ type: 'send_to_customer', sessionId: sid, text: waitMsg, textSK: 'Automatická správa: operátori sú vyťažení' });
    }
  }, 3 * 60 * 1000);

  res.json({ ok: true, sessionId: sid, online });
});

app.post('/api/message', async (req, res) => {
  const { sessionId, text } = req.body;
  const session = sessions[sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });

  session.lastActivity = Date.now();
  const textSK = await translateToSK(text, session.lang);
  const msg = { role: 'customer', text, textSK, timestamp: Date.now() };
  session.messages.push(msg);
  saveConversation(session, 'user', text);

  if (isOnline()) {
    const draft = await generateDraft(session);
    session.aiDraft = draft;
    session.status = 'pending';
    broadcastToAdmins({ type: 'customer_message', sessionId, message: msg, aiDraft: draft, name: session.name, site: session.site, lang: session.lang });
  } else {
    broadcastToAdmins({ type: 'customer_message', sessionId, message: msg, aiDraft: null, name: session.name, site: session.site, lang: session.lang });
  }

  res.json({ ok: true });
});

app.get('/api/poll/:sessionId', (req, res) => {
  const session = sessions[req.params.sessionId];
  if (!session) return res.json({ messages: [], online: isOnline() });
  const operatorMsgs = session.messages.filter(m => m.role === 'operator' && !m.delivered);
  operatorMsgs.forEach(m => m.delivered = true);
  res.json({ messages: operatorMsgs, online: isOnline() });
});

// Status endpoint pre widget
app.get('/api/status', (req, res) => {
  res.json({ online: isOnline(), status: onlineStatus });
});

// ── ADMIN API ─────────────────────────────────────────────────────────────────

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  const config = loadConfig();
  if (password === config.adminPassword) {
    res.json({ ok: true, token: Buffer.from(password).toString('base64') });
  } else {
    res.status(401).json({ ok: false, error: 'Nesprávne heslo' });
  }
});

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'Neautorizovaný' });
  const config = loadConfig();
  if (Buffer.from(token, 'base64').toString() === config.adminPassword) next();
  else res.status(401).json({ error: 'Neautorizovaný' });
}

// Online status ovládanie
app.get('/admin/status', adminAuth, (req, res) => {
  res.json({ status: onlineStatus, online: isOnline() });
});

app.post('/admin/status', adminAuth, (req, res) => {
  const { status } = req.body;
  if (!['auto', 'online', 'offline'].includes(status)) return res.status(400).json({ error: 'Neplatný status' });
  onlineStatus = status;
  broadcastToAdmins({ type: 'status_changed', status, online: isOnline() });
  res.json({ ok: true, status, online: isOnline() });
});

app.get('/admin/sessions', adminAuth, (req, res) => {
  const list = Object.values(sessions).sort((a, b) => b.lastActivity - a.lastActivity);
  res.json({ sessions: list });
});

app.post('/admin/reply', adminAuth, async (req, res) => {
  const { sessionId, textSK } = req.body;
  const session = sessions[sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const textTranslated = await translateText(textSK, session.lang);
  const msg = { role: 'operator', text: textTranslated, textSK, timestamp: Date.now(), delivered: false };
  session.messages.push(msg);
  session.status = 'answered';
  session.aiDraft = null;
  saveConversation(session, 'assistant', textTranslated);
  broadcastToAdmins({ type: 'reply_sent', sessionId, textSK, textTranslated, lang: session.lang });
  res.json({ ok: true, textTranslated });
});

app.get('/admin/prompt', adminAuth, (req, res) => res.json({ prompt: loadPrompt() }));
app.post('/admin/prompt', adminAuth, (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Chýba prompt' });
  const backup = path.join(__dirname, 'data', 'prompt_' + Date.now() + '.md');
  fs.copyFileSync(PROMPT_FILE, backup);
  fs.writeFileSync(PROMPT_FILE, prompt, 'utf-8');
  res.json({ ok: true });
});

app.post('/admin/change-password', adminAuth, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Príliš krátke heslo' });
  const config = loadConfig();
  config.adminPassword = newPassword;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  res.json({ ok: true, newToken: Buffer.from(newPassword).toString('base64') });
});

app.get('/admin/shortcuts', adminAuth, (req, res) => {
  const s = JSON.parse(fs.readFileSync(SHORTCUTS_FILE, 'utf-8'));
  res.json({ shortcuts: s });
});
app.post('/admin/shortcuts', adminAuth, (req, res) => {
  const { shortcuts } = req.body;
  fs.writeFileSync(SHORTCUTS_FILE, JSON.stringify(shortcuts, null, 2));
  broadcastToAdmins({ type: 'shortcuts_updated', shortcuts });
  res.json({ ok: true });
});

app.post('/api/rating', (req, res) => {
  const { sessionId, rating } = req.body;
  const session = sessions[sessionId] || {};
  const record = { timestamp: new Date().toISOString(), sessionId, site: session.site, lang: session.lang, userName: session.name, userEmail: session.email, rating };
  fs.appendFileSync(RATINGS_FILE, JSON.stringify(record) + '\n');
  res.json({ ok: true });
});

app.get('/admin/ratings', adminAuth, (req, res) => {
  if (!fs.existsSync(RATINGS_FILE)) return res.json({ ratings: [] });
  const ratings = fs.readFileSync(RATINGS_FILE, 'utf-8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
  res.json({ ratings });
});

app.get('/admin/history', adminAuth, (req, res) => {
  if (!fs.existsSync(CONV_FILE)) return res.json({ conversations: [] });
  const lines = fs.readFileSync(CONV_FILE, 'utf-8').trim().split('\n').filter(Boolean);
  const msgs = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const sessions2 = {};
  for (const m of msgs) {
    if (!sessions2[m.sessionId]) sessions2[m.sessionId] = { sessionId: m.sessionId, site: m.site, lang: m.lang, userName: m.userName, userEmail: m.userEmail, started: m.timestamp, messages: [] };
    sessions2[m.sessionId].messages.push({ role: m.role, text: m.text, timestamp: m.timestamp });
    sessions2[m.sessionId].lastActivity = m.timestamp;
  }
  res.json({ conversations: Object.values(sessions2).sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity)) });
});

app.get('/admin/stats', adminAuth, (req, res) => {
  let totalConv = 0, totalMsgs = 0, bySite = { 'bezeckepotreby.sk': 0, 'runnie.cz': 0, 'runnie.hu': 0 };
  if (fs.existsSync(CONV_FILE)) {
    const lines = fs.readFileSync(CONV_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    totalMsgs = lines.length;
    const sids = {};
    for (const l of lines) { try { const o = JSON.parse(l); if (!sids[o.sessionId]) { sids[o.sessionId] = o.site; } } catch {} }
    totalConv = Object.keys(sids).length;
    for (const s of Object.values(sids)) { if (bySite[s] !== undefined) bySite[s]++; }
  }
  let avgRating = 0, totalRatings = 0;
  if (fs.existsSync(RATINGS_FILE)) {
    const lines = fs.readFileSync(RATINGS_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    const vals = lines.map(l => { try { return JSON.parse(l).rating; } catch { return null; } }).filter(r => r !== null);
    totalRatings = vals.length;
    if (totalRatings > 0) avgRating = (vals.reduce((a, b) => a + b, 0) / totalRatings).toFixed(1);
  }
  res.json({ totalConv, totalMsgs, avgRating, totalRatings, bySite });
});

app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'admin_connect') {
        const config = loadConfig();
        if (msg.token && Buffer.from(msg.token, 'base64').toString() === config.adminPassword) {
          adminClients.add(ws);
          ws.send(JSON.stringify({ type: 'connected', sessions: Object.values(sessions), status: onlineStatus, online: isOnline() }));
        }
      }
    } catch {}
  });
  ws.on('close', () => adminClients.delete(ws));
});

server.listen(PORT, () => {
  console.log('David LiveChat bezi na porte: ' + PORT);
});
