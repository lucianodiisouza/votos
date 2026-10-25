// votos-api: polls TSE results, keeps history, sends web push alerts.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import webpush from 'web-push';

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || './data';
const TSE_URL = process.env.TSE_URL ||
  'https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-c0001-e006258-u.json';
const POLL_MS = Number(process.env.POLL_MS || 20000);
const SITE_URL = process.env.SITE_URL || 'https://votos.oprimo.dev/';
const PUSH_CONCURRENCY = 50;
const MAX_BODY = 4096;
const MILESTONES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 99];

const file = (n) => path.join(DATA_DIR, n);
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- persistence ----------
async function readJSON(name, fallback) {
  try { return JSON.parse(await fs.readFile(file(name), 'utf8')); }
  catch { return fallback; }
}
async function writeAtomic(name, data) {
  const target = file(name);
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, target);
}
const timers = new Map();
const pending = new Map();
function saveSoon(name, getData, delay = 1000) {
  pending.set(name, getData);
  if (timers.has(name)) return;
  timers.set(name, setTimeout(async () => {
    timers.delete(name);
    const g = pending.get(name); pending.delete(name);
    try { await writeAtomic(name, g()); } catch (e) { log('save error', name, e.message); }
  }, delay));
}
async function flushAll() {
  for (const [name, t] of timers) {
    clearTimeout(t); timers.delete(name);
    const g = pending.get(name); pending.delete(name);
    try { await writeAtomic(name, g()); } catch (e) { log('flush error', name, e.message); }
  }
}

// ---------- state ----------
await fs.mkdir(DATA_DIR, { recursive: true });
let history = await readJSON('history.json', []);
if (!Array.isArray(history)) history = [];
const subs = new Map((await readJSON('subs.json', [])).map((s) => [s.endpoint, s]));
let state = await readJSON('state.json', null); // { lastIdg, leader, sent: [] }
const firstRun = !state;
state ||= { lastIdg: null, leader: null, sent: [] };
const sent = new Set(state.sent);
if (!state.lastIdg && history.length) state.lastIdg = history.at(-1).idg ?? null;

const seenIdg = new Set(history.map((s) => s.idg).filter(Boolean));
const LEAD_COOLDOWN_MS = Number(process.env.LEAD_COOLDOWN_MS || 5 * 60 * 1000);
const saveHistory =() => saveSoon('history.json', () => history);
const saveSubs = () => saveSoon('subs.json', () => [...subs.values()]);
const saveState = () => saveSoon('state.json', () => ({ ...state, sent: [...sent] }), 200);

// ---------- VAPID ----------
let vapid;
if (process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) {
  vapid = { publicKey: process.env.VAPID_PUBLIC, privateKey: process.env.VAPID_PRIVATE };
} else {
  vapid = await readJSON('vapid.json', null);
  if (!vapid?.publicKey || !vapid?.privateKey) {
    vapid = webpush.generateVAPIDKeys();
    await writeAtomic('vapid.json', vapid);
    log('generated VAPID keys ->', file('vapid.json'));
  }
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://votos.oprimo.dev', vapid.publicKey, vapid.privateKey);

// ---------- push ----------
async function broadcast(payload) {
  const body = JSON.stringify({ ...payload, url: SITE_URL });
  const list = [...subs.values()];
  let ok = 0, gone = 0, fail = 0;
  for (let i = 0; i < list.length; i += PUSH_CONCURRENCY) {
    await Promise.all(list.slice(i, i + PUSH_CONCURRENCY).map(async (s) => {
      try {
        await webpush.sendNotification(s, body, { TTL: 600, urgency: 'high', timeout: 10000 });
        ok++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) { subs.delete(s.endpoint); gone++; }
        else fail++;
      }
    }));
  }
  if (gone) saveSubs();
  log(`push "${payload.title}" ok=${ok} gone=${gone} fail=${fail}`);
}

// ---------- TSE parsing ----------
const num = (s) => (s == null || s === '' ? 0 : Number(String(s).replace(/\./g, '').replace(',', '.')));
const fmt = (n, d = 2) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

function parse(j) {
  const cands = [];
  for (const c of j.carg || []) for (const a of c.agr || []) for (const p of a.par || []) for (const k of p.cand || []) {
    cands.push({ n: String(k.n), name: k.nmu || k.nm, pct: num(k.pvapn), votes: Number(k.vap || 0), elected: k.e === 's' });
  }
  cands.sort((x, y) => y.pct - x.pct || y.votes - x.votes);
  return { idg: String(j.idg), pst: num(j.s?.pstn), final: j.tf === 's', cands };
}

function line(r) {
  const [a, b] = r.cands;
  return `${a.name} ${fmt(a.pct)}% × ${fmt(b.pct)}% ${b.name} · ${fmt(r.pst, 1)}% das seções apuradas`;
}

async function checkEvents(r) {
  if (r.cands.length < 2) return;
  const [a] = r.cands;
  const events = [];

  // lead change
  const leader = a.pct > r.cands[1].pct ? a.n : null; // null = tie
  if (leader && state.leader && leader !== state.leader) {
    const key = `lead:${leader}:${r.idg}`;
    const cooling = Date.now() - (state.lastLeadPush || 0) < LEAD_COOLDOWN_MS;
    if (!sent.has(key) && !cooling) {
      state.lastLeadPush = Date.now();
      events.push({ key, title: `Virada! ${a.name} assume a liderança`, tag: 'lead' });
    }
  }
  if (leader) state.leader = leader;

  // milestones: only notify the highest newly crossed one; mark lower ones as done
  const crossed = MILESTONES.filter((m) => r.pst >= m && !sent.has(`pst:${m}`));
  if (crossed.length) {
    const top = crossed.at(-1);
    crossed.slice(0, -1).forEach((m) => sent.add(`pst:${m}`));
    events.push({ key: `pst:${top}`, title: `${top}% das seções apuradas · ${a.name} lidera`, tag: 'pst' });
  }

  // final / elected
  const elected = r.cands.find((c) => c.elected);
  if ((elected || r.final) && !sent.has('final')) {
    const w = elected || a;
    events.push({ key: 'final', title: elected ? `${w.name} está eleito presidente` : `Totalização encerrada · ${w.name} vence`, tag: 'final' });
  }

  for (const ev of events) {
    sent.add(ev.key);
    saveState();
    if (firstRun && ev.key.startsWith('pst:')) continue; // seed silently on very first boot
    await broadcast({ title: ev.title, body: line(r), tag: ev.tag });
  }
  saveState();
}

// ---------- poller ----------
let etag = null, lastFetch = null, lastError = null;
async function poll() {
  try {
    const headers = { 'accept-encoding': 'gzip', 'user-agent': 'votos-api/1.0' };
    if (etag) headers['if-none-match'] = etag;
    const res = await fetch(`${TSE_URL}`, { headers, signal: AbortSignal.timeout(15000) });
    lastFetch = Date.now();
    if (res.status === 304) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    etag = res.headers.get('etag') || null;
    const r = parse(j);
    if (r.idg === state.lastIdg || seenIdg.has(r.idg)) return;
    // CDN edges can serve stale files (idg is not monotonic): never go backwards
    const last = history.at(-1);
    if (last && r.pst < last.pst) { log(`stale file idg=${r.idg} pst=${r.pst} < ${last.pst}, ignored`); return; }
    seenIdg.add(r.idg);
    if (r.cands.length) {
      const sample = { t: Date.now(), idg: r.idg, pst: r.pst, v: {}, votes: {} };
      for (const c of r.cands) { sample.v[c.n] = c.pct; sample.votes[c.n] = c.votes; }
      history.push(sample);
      saveHistory();
      log(`sample idg=${r.idg} pst=${r.pst} ${r.cands.map((c) => `${c.n}=${c.pct}`).join(' ')}`);
    }
    state.lastIdg = r.idg;
    saveState();
    await checkEvents(r);
    lastError = null;
  } catch (e) {
    lastError = e.message;
    log('poll error', e.message);
  }
}
let polling = false;
async function tick() {
  if (polling) return;
  polling = true;
  try { await poll(); } finally { polling = false; }
}
tick();
setInterval(tick, POLL_MS);

// ---------- HTTP ----------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
function send(res, status, body, extra = {}) {
  const h = { ...CORS, ...extra };
  if (body === undefined) { res.writeHead(status, h); return res.end(); }
  h['Content-Type'] = 'application/json; charset=utf-8';
  res.writeHead(status, h);
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; let over = false; const chunks = [];
    req.on('data', (c) => {
      if (over) return; // drain and discard
      size += c.length;
      if (size > MAX_BODY) { over = true; chunks.length = 0; reject(Object.assign(new Error('too large'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (over) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); }
      catch { reject(Object.assign(new Error('bad json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
const isStr = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max;
function validSub(b) {
  if (!b || typeof b !== 'object') return null;
  if (!isStr(b.endpoint, 1024)) return null;
  let u; try { u = new URL(b.endpoint); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (!b.keys || !isStr(b.keys.p256dh, 256) || !isStr(b.keys.auth, 64)) return null;
  const exp = typeof b.expirationTime === 'number' ? b.expirationTime : null;
  return { endpoint: b.endpoint, expirationTime: exp, keys: { p256dh: b.keys.p256dh, auth: b.keys.auth } };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return send(res, 204);

    if (req.method === 'GET' && p === '/history') {
      const since = Number(url.searchParams.get('since'));
      const series = Number.isFinite(since) && since > 0 ? history.filter((s) => s.t > since) : history;
      return send(res, 200, { series }, { 'Cache-Control': 'public, max-age=10' });
    }
    if (req.method === 'GET' && p === '/vapid') return send(res, 200, { key: vapid.publicKey });
    if (req.method === 'GET' && (p === '/health' || p === '/')) {
      return send(res, 200, { ok: true, samples: history.length, subs: subs.size, lastIdg: state.lastIdg, lastFetch, lastError }, { 'Cache-Control': 'no-store' });
    }
    if (req.method === 'POST' && p === '/subscribe') {
      const sub = validSub(await readBody(req));
      if (!sub) return send(res, 400, { error: 'invalid subscription' });
      subs.set(sub.endpoint, sub);
      saveSubs();
      return send(res, 201, { ok: true });
    }
    if (req.method === 'POST' && p === '/unsubscribe') {
      const b = await readBody(req);
      if (!b || !isStr(b.endpoint, 1024)) return send(res, 400, { error: 'endpoint required' });
      if (subs.delete(b.endpoint)) saveSubs();
      return send(res, 204);
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'internal error' }, e.status === 413 ? { Connection: 'close' } : {});
  }
});
server.requestTimeout = 10000;
server.listen(PORT, () => log(`votos-api listening on :${PORT} (data: ${DATA_DIR}, samples: ${history.length}, subs: ${subs.size})`));

process.on('unhandledRejection', (e) => log('unhandledRejection', e?.message || e));
process.on('uncaughtException', (e) => log('uncaughtException', e?.message || e));
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    log(`${sig}, flushing`);
    server.close();
    await flushAll();
    process.exit(0);
  });
}
