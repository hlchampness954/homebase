// HomeBase v2 — AI orchestrator (Cloudflare Worker, ES module, no npm deps)
//
// Routes  : POST /chat (SSE tool-use loop) · POST /confirm · POST /plan · POST /learn · GET /health
// Cron    : "30 10 * * *" → /plan for every household · "30 4 * * *" → /learn for every household
// Talks to: Supabase Auth (JWT check), PostgREST (service-role key, always household-scoped),
//           Anthropic Messages API (streaming), Open-Meteo (weather).
// Planner / recurrence logic is imported from ../../shared so the browser and the Worker agree.

import * as D from '../../shared/dates.js';
import { nextOccurrence, normalizeRule, describeRule, expectedGapDays } from '../../shared/recurrence.js';
import { planDay, needsAttention, replan, settingsOf, nextStepOf } from '../../shared/planner.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants & tiny utils
// ─────────────────────────────────────────────────────────────────────────────
const MAX_ITER = 8;
const MAX_TOKENS = 1500;
const HISTORY_TURNS = 20;
const RATE_LIMIT_PER_MIN = 60;
const PROPOSAL_TTL_S = 600;
const TOOL_RESULT_MAX_CHARS = 12000;
const DEFAULT_TZ = 'America/Chicago';
const DEFAULT_WX = { lat: 29.703, lon: -98.124 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'what', 'when', 'have', 'from', 'are', 'was', 'you', 'can', 'did', 'does', 'about', 'today', 'tomorrow', 'please', 'need', 'want', 'should', 'into', 'week', 'day', 'get', 'set', 'add', 'make', 'how', 'any', 'all', 'our', 'your']);

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
class ToolError extends Error { constructor(message, extra) { super(message); Object.assign(this, extra || {}); } }

const isUuid = v => typeof v === 'string' && UUID_RE.test(v);
const isDate = v => typeof v === 'string' && DATE_RE.test(v);
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o && k in o).map(k => [k, o[k]]));
const uniqBy = (arr, f) => { const s = new Set(); return arr.filter(x => { const k = f(x); return s.has(k) ? false : (s.add(k), true); }); };
const median = arr => { const a = arr.filter(x => Number.isFinite(x)).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const trimmedMedian = arr => { const a = arr.filter(x => Number.isFinite(x)).sort((x, y) => x - y); if (a.length >= 10) { const cut = Math.floor(a.length * 0.1); return median(a.slice(cut, a.length - cut)); } return median(a); };
const likePattern = s => '*' + String(s ?? '').replace(/[*%,()\\"]/g, ' ').replace(/\s+/g, ' ').trim() + '*';
const keywords = s => uniqBy(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP.has(w)), w => w);
const timeoutSignal = ms => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
const nowIso = () => new Date().toISOString();
const clampInt = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt; };

function dateRange(from, to, cap = 31) {
  const out = [];
  for (let d = from, i = 0; d <= to && i < cap; d = D.addDays(d, 1), i++) out.push(d);
  return out;
}

// Accepts ISO with zone, 'YYYY-MM-DD HH:MM' / 'YYYY-MM-DDTHH:MM' (household-local) or 'YYYY-MM-DD' (+fallback time)
function normalizeTs(v, tz, fallbackHM = '09:00') {
  if (!v) return null;
  const s = String(v).trim();
  if (isDate(s)) return D.toISO(s, fallbackHM, tz);
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (m) return D.toISO(m[1], `${m[2].padStart(2, '0')}:${m[3]}`, tz);
  const d = new Date(s);
  if (isNaN(d)) throw new ToolError(`Unrecognised timestamp "${s}" — use YYYY-MM-DD HH:MM (local) or ISO`);
  return d.toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers: CORS, JSON, SSE
// ─────────────────────────────────────────────────────────────────────────────
function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const ok = origin && (origin === env.ALLOWED_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin : (env.ALLOWED_ORIGIN || ''),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Household-Id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

function sseStream(headers) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  let closed = false;
  const send = (event, data) => { if (closed) return Promise.resolve(); return writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {}); };
  const close = () => { if (closed) return; closed = true; writer.close().catch(() => {}); };
  writer.write(enc.encode(': homebase\n\n')).catch(() => {});
  const response = new Response(readable, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...headers } });
  return { response, send, close };
}

// ─────────────────────────────────────────────────────────────────────────────
// PostgREST client (service-role key; every call scoped to one household)
// ─────────────────────────────────────────────────────────────────────────────
const OP_RE = /^(eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|ov|fts|plfts|phfts|wfts|not)(\([a-z_]+\))?\./;   // e.g. "eq.x", "wfts(english).x", "not.is.null"
const RAW_KEYS = new Set(['select', 'order', 'limit', 'offset', 'or', 'and', 'on_conflict', 'columns']);

function encodeVal(k, v) {
  if (RAW_KEYS.has(k)) return String(v);
  if (Array.isArray(v)) return `in.(${v.map(x => (/[,()" ]/.test(String(x)) ? `"${String(x).replace(/"/g, '\\"')}"` : x)).join(',')})`;
  if (typeof v === 'boolean' || typeof v === 'number') return `eq.${v}`;
  const s = String(v);
  return OP_RE.test(s) ? s : `eq.${s}`;
}
function qs(query, extra = []) {
  const pairs = [...extra];
  if (typeof query === 'string' && query) pairs.push(...new URLSearchParams(query).entries());
  else if (Array.isArray(query)) pairs.push(...query);
  else if (query && typeof query === 'object') for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) pairs.push([k, v]);
  const sp = new URLSearchParams();
  for (const [k, v] of pairs) sp.append(k, encodeVal(k, v));
  return sp.toString();
}

export function makeDb(env, hh = null) {
  const base = `${(env.SUPABASE_URL || '').replace(/\/$/, '')}/rest/v1`;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const scope = table => (hh ? [[table === 'households' ? 'id' : 'household_id', `eq.${hh}`]] : []);
  const rowsOf = (table, rows) => (Array.isArray(rows) ? rows : [rows]).map(r => (hh && table !== 'households' ? { household_id: hh, ...r } : r));
  const guardMatch = (m) => { if (!m || (typeof m === 'object' && !Object.keys(m).length)) throw new HttpError(500, 'db: refusing to mutate without a match'); };

  async function call(method, path, body, prefer) {
    const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(`${base}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: timeoutSignal(15000) });
    const text = await res.text();
    if (!res.ok) throw new HttpError(502, `db ${method} ${path.split('?')[0]} → ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }
  return {
    hh,
    select: (table, query) => call('GET', `${table}?${qs(query, scope(table))}`),
    insert: (table, rows) => call('POST', table, rowsOf(table, rows), 'return=representation'),
    upsert: (table, rows, onConflict) => call('POST', `${table}?on_conflict=${onConflict}`, rowsOf(table, rows), 'resolution=merge-duplicates,return=representation'),
    update: (table, match, patch) => { guardMatch(match); return call('PATCH', `${table}?${qs(match, scope(table))}`, patch, 'return=representation'); },
    del: (table, match) => { guardMatch(match); return call('DELETE', `${table}?${qs(match, scope(table))}`, undefined, 'return=representation'); },
    rpc: (name, args) => call('POST', `rpc/${name}`, args || {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth (Supabase JWT → user → household membership) and rate limiting
// ─────────────────────────────────────────────────────────────────────────────
async function authenticate(req, env) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') || '');
  if (!m) throw new HttpError(401, 'Missing bearer token');
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${m[1]}` }, signal: timeoutSignal(10000) });
  if (!res.ok) throw new HttpError(401, 'Invalid or expired session');
  const user = await res.json();
  const members = await makeDb(env).select('household_members', { user_id: user.id, select: 'household_id,person_id,role' });
  if (!members.length) throw new HttpError(403, 'This user does not belong to a household yet');
  const want = req.headers.get('X-Household-Id');
  const mem = members.find(x => x.household_id === want) || members[0];
  return { user, userId: user.id, hh: mem.household_id, personId: mem.person_id, role: mem.role };
}

async function rateLimit(env, userId) {
  if (!env.RATE) return;                                   // KV not bound → no limiting
  const key = `rl:${userId}:${Math.floor(Date.now() / 60000)}`;
  const n = Number(await env.RATE.get(key)) || 0;
  if (n >= RATE_LIMIT_PER_MIN) throw new HttpError(429, 'Slow down — 60 requests per minute');
  await env.RATE.put(key, String(n + 1), { expirationTtl: 120 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Weather (Open-Meteo), cached 1 h in KV when bound, else per-isolate memory
// ─────────────────────────────────────────────────────────────────────────────
const wxMem = new Map();
export async function getWeather(env, lat = DEFAULT_WX.lat, lon = DEFAULT_WX.lon, days = 7, tz = DEFAULT_TZ) {
  days = clampInt(days, 1, 16, 7);
  const key = `wx:${lat}:${lon}:${days}:${tz}`;
  const mem = wxMem.get(key);
  if (mem && Date.now() - mem.at < 3600e3) return mem.data;
  if (env?.RATE) { try { const c = await env.RATE.get(key, 'json'); if (c) { wxMem.set(key, { at: Date.now(), data: c }); return c; } } catch {} }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=precipitation_probability_max,precipitation_sum,temperature_2m_max&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=${encodeURIComponent(tz)}&forecast_days=${days}`;
  try {
    const res = await fetch(url, { signal: timeoutSignal(8000) });
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const j = await res.json();
    const out = {};
    (j.daily?.time || []).forEach((d, i) => { out[d] = { rain_prob: j.daily.precipitation_probability_max?.[i] ?? 0, precip_in: j.daily.precipitation_sum?.[i] ?? 0, tmax_f: j.daily.temperature_2m_max?.[i] ?? null }; });
    wxMem.set(key, { at: Date.now(), data: out });
    if (env?.RATE) { try { await env.RATE.put(key, JSON.stringify(out), { expirationTtl: 3600 }); } catch {} }
    return out;
  } catch { return {}; }                                   // planner treats missing weather as "no rain"
}

// ─────────────────────────────────────────────────────────────────────────────
// Context loader → the ctx shape shared/planner.js expects
// ─────────────────────────────────────────────────────────────────────────────
export async function loadCtx(env, hh, db = makeDb(env, hh)) {
  const [house] = await db.select('households', { select: 'id,name,tz,settings' });
  if (!house) throw new HttpError(404, 'Household not found');
  const tz = house.tz || env.HOUSEHOLD_TZ || DEFAULT_TZ;
  const today = D.todayIn(tz), now = D.nowHM(tz);
  const from = D.addDays(today, -7), to = D.addDays(today, 21);
  const wx = { ...DEFAULT_WX, ...(house.settings?.weather || {}) };
  const [tasks, events, routines, maintenance, projects, steps, plants, obs, dayModes, memories, people, pets, areas, weather] = await Promise.all([
    db.select('tasks', { status: 'open', order: 'due_date.asc.nullslast', limit: 500 }),
    db.select('events', { and: `(starts_at.gte.${D.toISO(from, '00:00', tz)},starts_at.lte.${D.toISO(to, '23:59', tz)})`, order: 'starts_at.asc', limit: 500 }),
    db.select('routines', { active: true }),
    db.select('maintenance_rules', { active: true }),
    db.select('projects', { status: 'in.(active,paused)', order: 'priority.asc' }),
    db.select('project_steps', { order: 'sort.asc', limit: 1000 }),
    db.select('plants', { archived: false }),
    db.select('plant_observations', { select: 'plant_id,group_name,at,kind', order: 'at.desc', limit: 400 }),
    db.select('day_modes', { and: `(date.gte.${from},date.lte.${to})` }),
    db.select('memories', { status: 'active', order: 'confidence.desc', limit: 300 }),
    db.select('people', { order: 'sort.asc' }),
    db.select('pets', {}),
    db.select('areas', { archived: false, order: 'sort.asc' }),
    getWeather(env, wx.lat, wx.lon, 7, tz),
  ]);
  for (const p of plants) {                                 // last water / observation as local dates
    const mine = obs.filter(o => o.plant_id === p.id || (o.group_name && o.group_name === p.group_name));
    const water = mine.find(o => o.kind === 'water' || o.kind === 'topoff');
    p.last_water = water ? D.dateOf(water.at, tz) : null;
    p.last_observation = mine.length ? D.dateOf(mine[0].at, tz) : null;
  }
  return { hh, db, household: house, today, now, tz, settings: house.settings || {}, tasks, events, routines, maintenance, projects, steps, dayModes, memories, weather, plants, people, pets, areas };
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory retrieval (plan §4.3): preferences ≥0.8 + FTS hits + entity-anchored + view subject
// ─────────────────────────────────────────────────────────────────────────────
const VIEW_SUBJECT = { today: 'scheduling', tasks: 'scheduling', calendar: 'scheduling', home: 'home', projects: 'projects', plants: 'plants', pets: 'pets', settings: 'preferences' };

function entityMentions(ctx, text) {
  const t = String(text || '').toLowerCase();
  if (!t) return [];
  const out = [];
  const scan = (rows, type, col = 'name') => { for (const r of rows || []) { const n = String(r[col] || '').toLowerCase(); if (n.length >= 3 && t.includes(n)) out.push({ type, id: r.id, name: r[col] }); } };
  scan(ctx.routines, 'routine'); scan(ctx.projects, 'project'); scan(ctx.plants, 'plant'); scan(ctx.pets, 'pet');
  scan(ctx.maintenance, 'maintenance_rule'); scan(ctx.areas, 'area'); scan(ctx.people, 'person');
  return out;
}

async function retrieveMemories(ctx, message, view) {
  const q = String(message || '').trim();
  const prefs = ctx.memories.filter(m => m.kind === 'preference' && Number(m.confidence) >= 0.8);
  let hits = [];
  if (q) {
    const clean = q.replace(/[():|&!*'"<>\\,]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    try { hits = await ctx.db.select('memories', { status: 'active', fts: `wfts(english).${clean}`, order: 'confidence.desc', limit: 12 }); } catch { hits = []; }
    if (!hits.length) {
      const words = keywords(q).slice(0, 5);
      if (words.length) { try { hits = await ctx.db.select('memories', { status: 'active', or: `(${words.map(w => `content.ilike.${likePattern(w)}`).join(',')})`, order: 'confidence.desc', limit: 12 }); } catch { hits = []; } }
    }
  }
  const anchored = entityMentions(ctx, q).flatMap(e => ctx.memories.filter(m => m.entity_type === e.type && m.entity_id === e.id));
  const subj = VIEW_SUBJECT[view];
  const bySubject = subj ? ctx.memories.filter(m => m.subject === subj).slice(0, 6) : [];
  const out = uniqBy([...prefs, ...hits, ...anchored, ...bySubject], m => m.id).slice(0, 30);
  const stamp = out.length ? ctx.db.update('memories', { id: out.map(m => m.id) }, { last_used_at: nowIso() }).catch(() => {}) : Promise.resolve();
  return { memories: out, stamp };
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt (pure; exported for tests)
// ─────────────────────────────────────────────────────────────────────────────
const confWord = c => (Number(c) >= 0.9 ? 'sure' : Number(c) >= 0.7 ? 'likely' : 'guess');
const slimCand = c => ({ id: c.id, kind: c.kind, title: c.title, importance: c.importance, due_date: c.due_date || null, duration_min: c.duration_min, score: c.score, reasons: c.reasons, project_id: c.project_id || null });
const candLine = c => `- ${c.title} (${c.importance}${c.due_date ? `, due ${c.due_date}` : ''}, ~${c.duration_min} min${c.kind !== 'task' ? `, ${c.kind}` : ''}${c.reasons?.length ? `; ${c.reasons.join(', ')}` : ''})${c.kind === 'task' ? ` [task ${c.id}]` : ''}`;

export function buildSystemPrompt({ ctx = {}, plan = null, attention = [], memories = [], context = {} } = {}) {
  const h = ctx.household || {};
  const name = h.name || 'the household';
  const people = (ctx.people || []).map(p => p.name).filter(Boolean);
  const pets = (ctx.pets || []);
  const who = people.length ? people.join(' & ') : 'Luke & Hayley';
  const petText = pets.length ? pets.map(p => `${p.name}${p.species ? ` the ${p.species}` : ''}`).join(' and ') : 'Ruby the dog';
  const today = ctx.today || D.todayIn(ctx.tz || DEFAULT_TZ);
  const L = [];

  L.push(`You are HomeBase, the household assistant for ${name} — ${who}'s home in New Braunfels, Texas, shared with ${petText}.`);
  L.push(`Your job is to keep the house, projects, routines, ${pets[0]?.name || 'Ruby'} and their relationship on track while lowering stress. You have live access to their data through tools: look things up instead of guessing, and act instead of asking for forms.`);
  L.push('');
  L.push(`NOW: ${D.longDate(today)} (${today}) at ${ctx.now || D.nowHM(ctx.tz || DEFAULT_TZ)} ${ctx.tz || DEFAULT_TZ}. Client: view=${context.view || 'today'}${context.date ? ` date=${context.date}` : ''}${context.device ? ` device=${context.device}` : ''}.`);

  L.push('', 'HOUSEHOLD PROFILE');
  L.push(`People: ${(ctx.people || []).map(p => `${p.name}${p.is_user ? ' (user)' : ''} [${p.id}]`).join('; ') || 'Luke, Hayley'}`);
  if (pets.length) L.push(`Pets: ${pets.map(p => `${p.name} (${p.species || 'pet'}${p.breed ? `, ${p.breed}` : ''}) [${p.id}]`).join('; ')}`);
  if (ctx.areas?.length) L.push(`Areas: ${ctx.areas.map(a => a.name).join(', ')}`);
  const projects = (ctx.projects || []).filter(p => p.status === 'active');
  if (projects.length) {
    L.push('Projects:');
    for (const p of projects) {
      const steps = (ctx.steps || []).filter(s => s.project_id === p.id);
      const done = steps.filter(s => s.status === 'done' || s.status === 'skipped').length;
      const next = nextStepOf(p.id, ctx);
      L.push(`- P${p.priority} ${p.name}${p.stage ? ` · ${p.stage}` : ''} · ${done}/${steps.length} steps${next ? ` · next: ${next.title}` : ''}${p.target_date ? ` · target ${p.target_date}` : ''} [${p.id}]`);
    }
  }
  const routines = ctx.routines || [];
  if (routines.length) L.push(`Routines: ${routines.map(r => `${r.name} (${describeRule(r.cadence)}${r.last_done_at ? `, last ${D.dateOf(r.last_done_at, ctx.tz)}` : ', never logged'})`).join('; ')}`);
  const maint = ctx.maintenance || [];
  if (maint.length) L.push(`Maintenance rules: ${maint.map(m => `${m.name} every ${m.interval_days}d${m.next_due ? `, next ${m.next_due}` : ''}`).join('; ')}`);

  if (plan) {
    const cap = plan.capacity || {};
    L.push('', `TODAY SNAPSHOT (mode ${cap.mode || 'normal'} · capacity ${cap.minutes ?? '?'} min · planned ${plan.used ?? 0} min${plan.overloaded ? ' · OVERLOADED' : ''})`);
    L.push('Must do:'); (plan.must || []).forEach(c => L.push(candLine(c))); if (!(plan.must || []).length) L.push('- (none)');
    L.push('Planned:'); (plan.planned || []).forEach(c => L.push(candLine(c))); if (!(plan.planned || []).length) L.push('- (none)');
    if (plan.comingUp?.length) { L.push('Coming up:'); plan.comingUp.slice(0, 6).forEach(c => L.push(candLine(c))); }
  }
  if (attention.length) { L.push('Needs attention:'); attention.forEach(a => L.push(`- ${a.title}${a.detail ? ` — ${a.detail}` : ''}`)); }
  const todayEvents = (ctx.events || []).filter(e => D.dateOf(e.starts_at, ctx.tz) === today);
  if (todayEvents.length) L.push(`Today's calendar: ${todayEvents.map(e => `${e.all_day ? 'all day' : D.timeOf(e.starts_at, ctx.tz)} ${e.title}${e.kind === 'work_block' ? ' (work block)' : ''}`).join('; ')}`);
  const wx = ctx.weather || {};
  const wxDays = [today, D.addDays(today, 1), D.addDays(today, 2)].filter(d => wx[d]);
  if (wxDays.length) L.push(`Weather: ${wxDays.map(d => `${d === today ? 'today' : D.dayName(d)} ${wx[d].rain_prob}% rain${wx[d].tmax_f != null ? `, high ${Math.round(wx[d].tmax_f)}°F` : ''}`).join(' · ')}`);

  L.push('', 'WHAT YOU REMEMBER');
  if (!memories.length) L.push('- (nothing stored yet)');
  for (const m of memories) L.push(`- [${m.subject}/${m.kind}, ${confWord(m.confidence)}] ${m.content}${m.id ? ` {id ${m.id}}` : ''}`);

  L.push('', 'HOW TO WORK');
  L.push('- Use tools for anything about their data. Never invent ids; search or list first, then act. Names may be given loosely ("the HVAC filter rule") — tools resolve names leniently.');
  L.push('- Act immediately for ordinary, reversible changes: creating, completing, postponing, logging, scheduling, notes, memories. The app shows every action with Undo.');
  L.push('- delete_task, forget_memory and bulk_update only create a proposal; tell the user in a few words what will happen once they confirm the card.');
  L.push(`- Dates: use YYYY-MM-DD and household-local HH:MM (${ctx.tz || DEFAULT_TZ}). "Tonight" is today after 17:00; "this weekend" is the next Sat/Sun. Never use the UTC date.`);
  L.push('- When they state something durable (a preference, a habit, a fact about the house, who does what), call save_memory and finish with "Remembered: …". If you notice a pattern yourself, ask before saving it.');
  L.push('- Day modes: "I\'m sick", "traveling Tue–Thu", "Friday off" → set_day_mode; it replans and returns what was kept/reduced/moved — summarise that in one sentence.');
  L.push('- Be concise and warm: one or two sentences unless asked for detail. Short plain lists are fine for tasks; no headings, no tables, no emoji. Do not narrate tool calls — give the outcome.');
  L.push('- Protect their time and the relationship: prefer less, done well; nudge gently about flowers, date night and rest when relevant, never nag.');
  L.push('- Ask one short question only when a request is truly ambiguous; otherwise make the sensible choice and say what you did.');
  return L.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool schemas (Anthropic tool-use format). `confirm: true` → proposal instead of execution.
// ─────────────────────────────────────────────────────────────────────────────
const S = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
const bool = description => ({ type: 'boolean', description });
const dateP = description => str(`${description} (YYYY-MM-DD, household-local)`);
const tsP = description => str(`${description} — "YYYY-MM-DD HH:MM" household-local, or ISO`);
const refP = what => str(`${what}: a uuid, or a name/title fragment (resolved leniently, case-insensitive)`);
const IMPORTANCE = { enum: ['must', 'should', 'nice'] };
const LOCATION = { enum: ['home', 'anywhere', 'away'] };
const ENERGY = { enum: ['low', 'med', 'high'] };
const TASK_PATCH_PROPS = {
  title: str('New title'), notes: str('Notes'), importance: str('must | should | nice', IMPORTANCE),
  due_date: dateP('Deadline; null-string "" clears'), window_start: dateP('Flexible window start'), window_end: dateP('Flexible window end'),
  scheduled_start: tsP('Planned start'), scheduled_end: tsP('Planned end'), duration_min: int('Estimated minutes'),
  location: str('home | anywhere | away', LOCATION), weather_dependent: bool('Needs dry weather'), energy: str('low | med | high', ENERGY),
  area: refP('Area/room'), project: refP('Project'), step_id: str('Project step uuid'), assignee: refP('Person'),
  recurrence: { type: 'object', description: 'Recurrence rule {freq: daily|weekly|monthly|yearly, interval, byweekday:[mon..sun], anchor: schedule|completion}; null-like {} clears', additionalProperties: true },
  status: str('Only "open" is allowed here (reopen); use complete_task to finish', { enum: ['open'] }),
};

export const TOOLS = [
  // ── read ──
  { name: 'search_everything', description: 'Search tasks, events, projects, steps, notes/vendors, assets, plants, routines, maintenance rules, list items and memories by text. Use first when the user names something.', input_schema: S({ q: str('Search text') }, ['q']) },
  { name: 'get_today', description: 'Deterministic plan for a day: capacity, must-do, planned, coming up, needs-attention (today only) and calendar. Defaults to today.', input_schema: S({ date: dateP('Day to plan') }) },
  { name: 'list_tasks', description: 'List tasks with filters. Default status=open, max 50, soonest due first.', input_schema: S({ status: str('open | done | skipped | cancelled | all', { enum: ['open', 'done', 'skipped', 'cancelled', 'all'] }), area_id: refP('Area'), project_id: refP('Project'), due_before: dateP('Only tasks due on/before'), q: str('Title/notes text filter'), limit: int('Max rows (default 50)') }) },
  { name: 'get_calendar', description: 'Events, work blocks, scheduled tasks and deadlines between two dates (inclusive).', input_schema: S({ from: dateP('Start'), to: dateP('End') }, ['from', 'to']) },
  { name: 'find_open_time', description: 'Find free blocks inside the household\'s discretionary windows (weekday evenings, weekend days) long enough for a task.', input_schema: S({ duration_min: int('Minutes needed'), from: dateP('Search from (default today)'), to: dateP('Search to (default +7 days)'), prefer: str('morning | afternoon | evening | weekend | weekday | mon..sun') }, ['duration_min']) },
  { name: 'list_projects', description: 'Active/paused projects with priority, stage, progress and next unblocked step.', input_schema: S({ include_done: bool('Also include finished projects') }) },
  { name: 'get_project', description: 'One project with all steps (dependencies, status) and costs.', input_schema: S({ id: refP('Project') }, ['id']) },
  { name: 'list_maintenance', description: 'Maintenance rules with asset, interval, last done and next due. status: overdue | due_soon (14 d) | all.', input_schema: S({ status: str('overdue | due_soon | all', { enum: ['overdue', 'due_soon', 'all'] }) }) },
  { name: 'list_plants', description: 'Plants and hydroponic units with last watering/observation dates and learned watering interval.', input_schema: S({ include_archived: bool('Include archived plants') }) },
  { name: 'get_pet_history', description: 'Recent pet activities (training, walks, vet, meds) and pet-routine logs.', input_schema: S({ pet_id: refP('Pet (defaults to the only pet)'), kind: str('training | walk | vet | med | grooming | other'), days: int('Look-back days (default 30)') }) },
  { name: 'search_memory', description: 'Full-text search of stored memories (facts, preferences, learned patterns, stats).', input_schema: S({ q: str('Search text'), subject: str('scheduling | home | projects | plants | pets | family | preferences | people') }, ['q']) },
  { name: 'search_history', description: 'Search past activity: activity log, previous conversations, routine and maintenance notes.', input_schema: S({ q: str('Search text'), days: int('Look-back days (default 90)') }, ['q']) },
  { name: 'get_weather', description: 'Daily forecast (rain probability, precipitation inches, high °F) for New Braunfels.', input_schema: S({ days: int('Days ahead, 1-16 (default 7)') }) },

  // ── write: tasks ──
  { name: 'create_task', description: 'Create a task. Only title is required; set due_date for deadlines or window_start/window_end for flexible windows.', input_schema: S({ ...pick(TASK_PATCH_PROPS, ['title', 'notes', 'importance', 'due_date', 'window_start', 'window_end', 'scheduled_start', 'scheduled_end', 'duration_min', 'location', 'weather_dependent', 'energy', 'area', 'project', 'step_id', 'assignee', 'recurrence']) }, ['title']) },
  { name: 'update_task', description: 'Change fields on a task (dates, importance, notes, links…). Send only the fields to change.', input_schema: S({ id: refP('Task'), patch: { type: 'object', description: 'Fields to change', properties: TASK_PATCH_PROPS, additionalProperties: false } }, ['id', 'patch']) },
  { name: 'complete_task', description: 'Mark a task done. Creates the next instance for recurring tasks and logs linked routines/maintenance.', input_schema: S({ id: refP('Task'), actual_min: int('How long it actually took'), note: str('Optional note') }, ['id']) },
  { name: 'postpone_task', description: 'Move a task to a later date (keeps original_date, increments postponed).', input_schema: S({ id: refP('Task'), to_date: dateP('New date'), reason: str('Why') }, ['id', 'to_date']) },
  { name: 'delete_task', description: 'Remove a task (proposal — user confirms). Prefer complete_task or postpone_task when those fit.', confirm: true, input_schema: S({ id: refP('Task'), reason: str('Why') }, ['id']) },

  // ── write: calendar ──
  { name: 'create_event', description: 'Add a calendar event (fixed appointment, travel, deadline). Defaults to 60 min when ends_at is missing.', input_schema: S({ title: str('Title'), starts_at: tsP('Start'), ends_at: tsP('End'), all_day: bool('All-day event'), kind: str('fixed | travel | deadline', { enum: ['fixed', 'travel', 'deadline'] }), location: str('Where'), notes: str('Notes'), project: refP('Project'), people: { type: 'array', items: refP('Person'), description: 'Who is involved' } }, ['title', 'starts_at']) },
  { name: 'move_event', description: 'Move an event to a new start (end shifts by the same amount unless given).', input_schema: S({ id: refP('Event'), starts_at: tsP('New start'), ends_at: tsP('New end') }, ['id', 'starts_at']) },
  { name: 'create_work_block', description: 'Reserve time on the calendar for a task (creates a work_block event and sets the task\'s scheduled_start/end).', input_schema: S({ task_id: refP('Task'), start: tsP('Start'), end: tsP('End') }, ['task_id', 'start', 'end']) },

  // ── write: planning ──
  { name: 'set_day_mode', description: 'Set a day mode (sick, travel, busy, vacation, project, or normal to clear) for a date range, then replan: keeps must-dos, reduces routines to their minimum version, moves the rest to later days without piling up. Returns kept/reduced/moved.', input_schema: S({ from_date: dateP('First day'), to_date: dateP('Last day (default = from_date)'), mode: str('normal | busy | travel | sick | vacation | project', { enum: ['normal', 'busy', 'travel', 'sick', 'vacation', 'project'] }), note: str('Context, e.g. "in Houston"'), capacity_override_min: int('Override discretionary minutes for those days'), project: refP('Project (for project mode)') }, ['from_date', 'mode']) },
  { name: 'replan_day', description: 'Re-run the planner for one day and write scheduled_start/end for the chosen tasks inside the day\'s discretionary window.', input_schema: S({ date: dateP('Day (default today)') }) },
  { name: 'replan_week', description: 'Re-run the planner for 7 days starting at a date, scheduling each day in turn.', input_schema: S({ from: dateP('First day (default today)') }) },

  // ── write: projects ──
  { name: 'update_project_step', description: 'Change a project step\'s status (todo | doing | done | skipped) or note; done sets done_at.', input_schema: S({ id: refP('Step'), project: refP('Project (helps resolve a step by title)'), status: str('todo | doing | done | skipped', { enum: ['todo', 'doing', 'done', 'skipped'] }), note: str('Note'), actual_min: int('Minutes spent') }, ['id']) },
  { name: 'add_project_step', description: 'Insert a step into a project, optionally right after another step (which it then depends on).', input_schema: S({ project_id: refP('Project'), title: str('Step title'), phase: str('Phase label'), after_step_id: refP('Step it follows'), est_min: int('Estimated minutes') }, ['project_id', 'title']) },
  { name: 'add_project_cost', description: 'Add a bill-of-materials / cost line to a project.', input_schema: S({ project_id: refP('Project'), item: str('Item'), qty: str('Quantity, free text'), projected: num('Projected cost'), actual: num('Actual cost'), vendor: str('Vendor'), purchased_at: dateP('Purchase date') }, ['project_id', 'item']) },

  // ── write: home / plants / pets / routines ──
  { name: 'record_maintenance', description: 'Log that a maintenance rule was done (e.g. HVAC filter changed): writes maintenance_log, sets last_done_at and next_due, closes the open task.', input_schema: S({ rule_id: refP('Maintenance rule'), done_at: dateP('When (default today)'), note: str('Note'), cost: num('Cost') }, ['rule_id']) },
  { name: 'log_plant_observation', description: 'Log watering/feeding/pruning/harvest/observation for a plant or a whole group (e.g. hydro unit). Provide plant_id or group_name.', input_schema: S({ plant_id: refP('Plant'), group_name: str('Group / unit name for a group-wide entry'), kind: str('water | fertilize | prune | repot | observe | harvest | nutrient | clean | topoff', { enum: ['water', 'fertilize', 'prune', 'repot', 'observe', 'harvest', 'nutrient', 'clean', 'topoff'] }), note: str('Note'), soil_state: str('dry | moist | wet', { enum: ['dry', 'moist', 'wet'] }), ph: num('pH'), ec: num('EC'), water_level: str('Water level, free text'), at: tsP('When (default now)') }, ['kind']) },
  { name: 'log_pet_activity', description: 'Log training, a walk, vet visit, meds or grooming for a pet. Training also logs the pet\'s daily training routine.', input_schema: S({ pet_id: refP('Pet (defaults to the only pet)'), kind: str('training | walk | vet | med | grooming | other', { enum: ['training', 'walk', 'vet', 'med', 'grooming', 'other'] }), duration_min: int('Minutes'), focus: str('Skill focus, e.g. recall'), note: str('Note'), at: tsP('When (default now)') }, ['kind']) },
  { name: 'log_routine', description: 'Log a routine as done (flowers, mow, trash, household reset, hydro check, date night…): writes routine_log, updates last_done_at/streak, closes today\'s task for it.', input_schema: S({ routine_id: refP('Routine'), done_at: tsP('When (default now)'), duration_min: int('Minutes'), detail: { type: 'object', description: 'Structured detail, e.g. {"flowers":"tulips"} or {"focus":"recall"}', additionalProperties: true }, note: str('Note') }, ['routine_id']) },
  { name: 'add_list_item', description: 'Add an item to a shopping/packing list (list created if missing).', input_schema: S({ list_name_or_id: refP('List'), text: str('Item'), qty: str('Quantity'), project: refP('Project the item is for') }, ['list_name_or_id', 'text']) },
  { name: 'create_note', description: 'Save a note; vendor=true for contractors/services (with phone/url).', input_schema: S({ title: str('Title'), body: str('Body'), vendor: bool('Is a vendor/contact'), phone: str('Phone'), url: str('URL'), area: refP('Area'), project: refP('Project') }, ['title']) },
  { name: 'link', description: 'Relate two records (task, project, step, note, asset, plant, pet, event, routine, maintenance_rule, room, area).', input_schema: S({ from_type: str('Entity type'), from_id: str('uuid'), to_type: str('Entity type'), to_id: str('uuid'), rel: str('Relationship label (default related)') }, ['from_type', 'from_id', 'to_type', 'to_id']) },

  // ── write: memory ──
  { name: 'save_memory', description: 'Remember something durable the user stated (preference, fact, habit). One plain sentence.', input_schema: S({ subject: str('scheduling | home | projects | plants | pets | family | preferences | people', { enum: ['scheduling', 'home', 'projects', 'plants', 'pets', 'family', 'preferences', 'people'] }), kind: str('fact | preference | pattern | stat', { enum: ['fact', 'preference', 'pattern', 'stat'] }), content: str('One sentence'), confidence: num('0-1 (default 0.9 for stated)'), entity_type: str('Anchor type: routine | project | plant | pet | asset | maintenance_rule | task_series | person | area'), entity_id: str('Anchor uuid') }, ['subject', 'kind', 'content']) },
  { name: 'update_memory', description: 'Edit a memory\'s wording, confidence (1.0 = confirmed) or status (active | ignored).', input_schema: S({ id: str('Memory uuid'), content: str('New wording'), status: str('active | ignored', { enum: ['active', 'ignored'] }), confidence: num('0-1') }, ['id']) },
  { name: 'forget_memory', description: 'Delete a memory (proposal — user confirms).', confirm: true, input_schema: S({ id: str('Memory uuid') }, ['id']) },
  { name: 'bulk_update', description: 'Apply the same change to many tasks at once (proposal — user confirms).', confirm: true, input_schema: S({ task_ids: { type: 'array', items: str('Task uuid'), description: 'Tasks to change' }, patch: { type: 'object', description: 'Fields to change', properties: TASK_PATCH_PROPS, additionalProperties: false } }, ['task_ids', 'patch']) },
];
export const TOOL_SCHEMAS = TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
const TOOL_INDEX = Object.fromEntries(TOOLS.map(t => [t.name, t]));

// ─────────────────────────────────────────────────────────────────────────────
// Runtime (per request): db, lazy ctx, action log + SSE emitter
// ─────────────────────────────────────────────────────────────────────────────
const TABLE_OF = { task: 'tasks', event: 'events', project: 'projects', project_step: 'project_steps', project_cost: 'project_costs', maintenance_rule: 'maintenance_rules', maintenance_log: 'maintenance_log', routine: 'routines', routine_log: 'routine_log', plant: 'plants', plant_observation: 'plant_observations', pet_activity: 'pet_activities', list: 'lists', list_item: 'list_items', note: 'notes', link: 'links', memory: 'memories', day_mode: 'day_modes', household: 'households' };

function makeRuntime(env, { hh, userId = null, personId = null, actor = 'ai', emit = async () => {} }) {
  const db = makeDb(env, hh);
  let ctxPromise = null;
  const tz = env.HOUSEHOLD_TZ || DEFAULT_TZ;
  const rt = {
    env, db, hh, userId, personId, actor, emit, actions: [], proposals: [], tz, today: D.todayIn(tz), now: D.nowHM(tz),
    // Full planner context; cached until a mutation calls dirty(). Also pins tz/today/now for cheap tools.
    getCtx() { if (!ctxPromise) ctxPromise = loadCtx(env, hh, db).then(c => { rt.tz = c.tz; rt.today = c.today; rt.now = c.now; return c; }); return ctxPromise; },
    dirty() { ctxPromise = null; },
    async act(a) {
      const row = { actor, entity_type: a.entity_type, entity_id: a.entity_id || null, action: a.action, before: a.before ?? null, after: a.after ?? null, reason: a.reason || null };
      let logged = null;
      try { [logged] = await db.insert('activity_log', row); } catch (e) { console.error('activity_log', e.message); }
      const table = TABLE_OF[a.entity_type];
      const undo = a.undo || (a.action === 'create' && table ? { op: 'delete', table, id: a.entity_id } : a.before && table && a.entity_id ? { op: 'update', table, id: a.entity_id, patch: a.before } : null);
      const action = { id: logged?.id || null, at: nowIso(), summary: a.summary, entity_type: a.entity_type, entity_id: a.entity_id || null, action: a.action, reason: a.reason || null, undo };
      rt.actions.push(action);
      if (!a.quiet) await emit('action', action);
      return action;
    },
  };
  return rt;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lenient name → row resolution ("the HVAC filter rule" → maintenance_rules row)
// ─────────────────────────────────────────────────────────────────────────────
const NAME_COL = { tasks: 'title', events: 'title', project_steps: 'title', memories: 'content', list_items: 'text' };

async function fuzzyRows(rt, table, col, ref, filter) {
  const phrase = await rt.db.select(table, { [col]: `ilike.${likePattern(ref)}`, ...filter, limit: 8 });
  if (phrase.length) return phrase;
  const words = keywords(ref.replace(/\b(the|rule|task|project|routine|plant|list|note|event|step)\b/gi, ' ')).slice(0, 4);
  if (!words.length) return [];
  const all = await rt.db.select(table, { and: `(${words.map(w => `${col}.ilike.${likePattern(w)}`).join(',')})`, ...filter, limit: 8 });
  if (all.length) return all;
  const any = await rt.db.select(table, { or: `(${words.map(w => `${col}.ilike.${likePattern(w)}`).join(',')})`, ...filter, limit: 12 });
  const score = r => words.filter(w => String(r[col]).toLowerCase().includes(w)).length;
  return any.sort((a, b) => score(b) - score(a)).filter(r => score(r) === score(any[0]) || score(r) >= 2).slice(0, 8);
}

async function resolve(rt, table, ref, opts = {}) {
  const { filter = {}, label = table.replace(/_/g, ' ').replace(/s$/, ''), required = true } = opts;
  if (ref && typeof ref === 'object') ref = ref.id || ref.name || ref.title;
  if (ref == null || String(ref).trim() === '') { if (required) throw new ToolError(`${label} is required`); return null; }
  ref = String(ref).trim();
  if (isUuid(ref)) {
    const [row] = await rt.db.select(table, { id: ref });
    if (!row && required) throw new ToolError(`No ${label} with id ${ref}`);
    return row || null;
  }
  const col = NAME_COL[table] || 'name';
  const rows = await fuzzyRows(rt, table, col, ref, filter);
  if (!rows.length) { if (required) throw new ToolError(`No ${label} matching "${ref}" — try search_everything`); return null; }
  if (rows.length === 1) return rows[0];
  const exact = rows.filter(r => String(r[col]).toLowerCase() === ref.toLowerCase());
  if (exact.length === 1) return exact[0];
  const live = rows.filter(r => r.status === 'open' || r.active === true || r.status === 'active');
  if (live.length === 1) return live[0];
  throw new ToolError(`Several ${label}s match "${ref}" — ask which one, or use the id`, { candidates: rows.map(r => ({ id: r.id, [col]: r[col], status: r.status, due_date: r.due_date })) });
}
async function resolveTask(rt, ref) {
  if (!isUuid(String(ref || ''))) { const open = await resolve(rt, 'tasks', ref, { label: 'task', filter: { status: 'open' }, required: false }); if (open) return open; }
  return resolve(rt, 'tasks', ref, { label: 'task' });
}
const resolveId = async (rt, table, ref, label) => (ref == null || ref === '' ? null : (await resolve(rt, table, ref, { label })).id);

// ─────────────────────────────────────────────────────────────────────────────
// Row shapers (what the model sees) and small domain helpers
// ─────────────────────────────────────────────────────────────────────────────
const TASK_KEYS = ['id', 'title', 'status', 'importance', 'due_date', 'window_start', 'window_end', 'scheduled_start', 'scheduled_end', 'duration_min', 'location', 'energy', 'weather_dependent', 'area_id', 'project_id', 'step_id', 'routine_id', 'maintenance_rule_id', 'assignee_id', 'postponed', 'original_date', 'completed_at', 'actual_min', 'notes', 'series_id'];
const slimTask = t => t && { ...pick(t, TASK_KEYS), recurrence: t.recurrence ? describeRule(t.recurrence) : null };
const slimEvent = e => e && pick(e, ['id', 'title', 'kind', 'starts_at', 'ends_at', 'all_day', 'location', 'task_id', 'project_id', 'notes']);
const slimStep = s => s && pick(s, ['id', 'project_id', 'title', 'phase', 'sort', 'status', 'depends_on', 'est_min', 'actual_min', 'note', 'done_at']);
const slimProject = p => p && pick(p, ['id', 'name', 'priority', 'status', 'stage', 'description', 'budget', 'target_date', 'area_id', 'room_id']);
const slimPlant = p => p && pick(p, ['id', 'name', 'species', 'kind', 'group_name', 'location', 'container', 'water_interval_days', 'last_water', 'last_observation', 'notes']);
const slimRoutine = r => r && { ...pick(r, ['id', 'name', 'min_version', 'default_min', 'importance', 'location', 'pet_id', 'area_id', 'last_done_at', 'streak']), cadence: describeRule(r.cadence) };
const slimRule = m => m && pick(m, ['id', 'name', 'asset_id', 'interval_days', 'season_months', 'last_done_at', 'next_due', 'importance', 'instructions']);
const slimMemory = m => m && pick(m, ['id', 'subject', 'kind', 'content', 'source', 'confidence', 'evidence_count', 'status', 'entity_type', 'entity_id', 'data']);

const TASK_FIELDS = ['title', 'notes', 'importance', 'due_date', 'window_start', 'window_end', 'duration_min', 'location', 'weather_dependent', 'energy', 'step_id', 'status', 'area_id', 'project_id', 'assignee_id'];
async function normalizeTaskPatch(rt, p = {}) {
  const tz = rt.tz, out = {};
  for (const k of TASK_FIELDS) if (k in p) out[k] = p[k] === '' ? null : p[k];
  for (const k of ['due_date', 'window_start', 'window_end']) if (out[k] != null && !isDate(out[k])) throw new ToolError(`${k} must be YYYY-MM-DD`);
  if (out.importance && !['must', 'should', 'nice'].includes(out.importance)) throw new ToolError('importance must be must | should | nice');
  if (out.status && out.status !== 'open') throw new ToolError('Use complete_task / delete_task to change status');
  if ('scheduled_start' in p) out.scheduled_start = p.scheduled_start ? normalizeTs(p.scheduled_start, tz) : null;
  if ('scheduled_end' in p) out.scheduled_end = p.scheduled_end ? normalizeTs(p.scheduled_end, tz, '10:00') : null;
  if ('recurrence' in p) out.recurrence = p.recurrence && p.recurrence.freq ? normalizeRule(p.recurrence) : null;
  if ('area' in p) out.area_id = await resolveId(rt, 'areas', p.area, 'area');
  if ('project' in p) out.project_id = await resolveId(rt, 'projects', p.project, 'project');
  if ('assignee' in p) out.assignee_id = await resolveId(rt, 'people', p.assignee, 'person');
  if (out.duration_min != null) out.duration_min = clampInt(out.duration_min, 1, 1440, 30);
  if (out.scheduled_start && !out.scheduled_end) out.scheduled_end = new Date(+new Date(out.scheduled_start) + (out.duration_min || 30) * 60000).toISOString();
  return out;
}

function busyIntervals(day, ctx, { includeWorkBlocks = true } = {}) {
  const out = [];
  for (const e of ctx.events || []) {
    if (!includeWorkBlocks && e.kind === 'work_block') continue;
    if (D.dateOf(e.starts_at, ctx.tz) !== day) continue;
    if (e.all_day) { out.push([0, 1440]); continue; }
    const s = D.hmToMin(D.timeOf(e.starts_at, ctx.tz));
    out.push([s, e.ends_at ? D.hmToMin(D.timeOf(e.ends_at, ctx.tz)) : s + 60]);
  }
  for (const t of ctx.tasks || []) {
    if (t.status !== 'open' || D.dateOf(t.scheduled_start, ctx.tz) !== day) continue;
    const s = D.hmToMin(D.timeOf(t.scheduled_start, ctx.tz));
    out.push([s, t.scheduled_end ? D.hmToMin(D.timeOf(t.scheduled_end, ctx.tz)) : s + (t.duration_min || 30)]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
const windowsFor = (day, ctx) => { const s = settingsOf(ctx); return (D.isWeekend(day) ? s.windows.weekend : s.windows.weekday) || []; };

async function completeTaskRow(rt, t, { actual_min = null, note = null, reason = null, cascade = true } = {}) {
  if (t.status === 'done') return { task: slimTask(t), already_done: true };
  const today = rt.today;
  const patch = { status: 'done', completed_at: nowIso() };
  if (actual_min != null) patch.actual_min = clampInt(actual_min, 1, 1440, null);
  if (note) patch.notes = t.notes ? `${t.notes}\n${note}` : note;
  const [done] = await rt.db.update('tasks', { id: t.id }, patch);
  await rt.act({ entity_type: 'task', entity_id: t.id, action: 'complete', before: pick(t, ['status', 'completed_at', 'actual_min', 'notes']), after: pick(done, ['status', 'completed_at', 'actual_min']), reason, summary: `Completed "${t.title}"` });
  const out = { task: slimTask(done) };
  if (t.recurrence) {                                       // materialise the next instance (single place, plan §2)
    const rule = normalizeRule(t.recurrence);
    const from = rule.anchor === 'completion' ? today : (t.due_date || t.window_start || today);
    let next = nextOccurrence(rule, from);
    for (let i = 0; next && next < today && i < 200; i++) next = nextOccurrence(rule, next);
    if (next) {
      const seriesId = t.series_id || t.id;
      if (!t.series_id) await rt.db.update('tasks', { id: t.id }, { series_id: seriesId });
      const span = t.window_start && t.window_end ? D.diffDays(t.window_start, t.window_end) : 0;
      const row = { ...pick(t, ['title', 'notes', 'importance', 'duration_min', 'location', 'weather_dependent', 'energy', 'area_id', 'project_id', 'room_id', 'asset_id', 'routine_id', 'maintenance_rule_id', 'assignee_id', 'recurrence', 'source']), status: 'open', series_id: seriesId, postponed: 0, created_by: rt.userId };
      if (t.window_start && t.window_end) { row.window_start = next; row.window_end = D.addDays(next, span); } else row.due_date = next;
      const [n] = await rt.db.insert('tasks', row);
      await rt.act({ entity_type: 'task', entity_id: n.id, action: 'create', after: slimTask(n), reason: 'recurrence', summary: `Next "${n.title}" set for ${D.humanDate(next, today)}` });
      out.next = slimTask(n);
    }
  }
  if (cascade && t.routine_id) {
    const [r] = await rt.db.select('routines', { id: t.routine_id });
    if (r) out.routine_log = await coreLogRoutine(rt, r, { duration_min: actual_min, note });
  }
  if (cascade && t.maintenance_rule_id) {
    const [rule] = await rt.db.select('maintenance_rules', { id: t.maintenance_rule_id });
    if (rule) out.maintenance = await coreRecordMaintenance(rt, rule, { note });
  }
  rt.dirty();
  return out;
}

async function coreLogRoutine(rt, routine, { done_at = null, duration_min = null, detail = null, note = null } = {}) {
  const tz = rt.tz;
  const doneIso = done_at ? normalizeTs(done_at, tz, D.nowHM(tz)) : nowIso();
  const [log] = await rt.db.insert('routine_log', { routine_id: routine.id, done_at: doneIso, duration_min: duration_min ?? null, detail: detail || null, note: note || null, by_person_id: rt.personId });
  const lastDate = D.dateOf(routine.last_done_at, tz), doneDate = D.dateOf(doneIso, tz);
  const gap = expectedGapDays(routine.cadence) || 1;
  let streak = routine.streak || 0;
  if (lastDate !== doneDate) streak = lastDate && D.diffDays(lastDate, doneDate) <= Math.max(1, Math.round(gap * 1.5)) ? streak + 1 : 1;
  const patch = {};
  if (!routine.last_done_at || doneIso > routine.last_done_at) Object.assign(patch, { last_done_at: doneIso, streak });
  if (Object.keys(patch).length) await rt.db.update('routines', { id: routine.id }, patch);
  await rt.act({ entity_type: 'routine_log', entity_id: log.id, action: 'log', after: log, summary: `Logged ${routine.name}${duration_min ? ` (${duration_min} min)` : ''}`, undo: { op: 'delete', table: 'routine_log', id: log.id, also: { op: 'update', table: 'routines', id: routine.id, patch: pick(routine, ['last_done_at', 'streak']) } } });
  rt.dirty();
  return { ...log, streak };
}

async function closeLinkedTasks(rt, col, id, reason) {
  const open = await rt.db.select('tasks', { status: 'open', [col]: id, or: `(due_date.lte.${rt.today},due_date.is.null)` });
  const closed = [];
  for (const t of open) { await completeTaskRow(rt, t, { reason, cascade: false }); closed.push(t.title); }
  return closed;
}

async function coreRecordMaintenance(rt, rule, { done_at = null, note = null, cost = null } = {}) {
  const doneDate = done_at ? (isDate(done_at) ? done_at : D.dateOf(normalizeTs(done_at, rt.tz), rt.tz)) : rt.today;
  const [log] = await rt.db.insert('maintenance_log', { rule_id: rule.id, asset_id: rule.asset_id, done_at: doneDate, note: note || null, cost: cost ?? null, by_person_id: rt.personId });
  const next_due = D.addDays(doneDate, rule.interval_days || 90);
  await rt.db.update('maintenance_rules', { id: rule.id }, { last_done_at: doneDate, next_due });
  await rt.act({ entity_type: 'maintenance_log', entity_id: log.id, action: 'log', before: pick(rule, ['last_done_at', 'next_due']), after: { done_at: doneDate, next_due }, summary: `${rule.name} done ${doneDate} · next ${next_due}`, undo: { op: 'delete', table: 'maintenance_log', id: log.id, also: { op: 'update', table: 'maintenance_rules', id: rule.id, patch: pick(rule, ['last_done_at', 'next_due']) } } });
  rt.dirty();
  return { log_id: log.id, done_at: doneDate, next_due };
}

// Planner → DB: write scheduled_start/end for chosen tasks inside the first discretionary window
async function schedulePlan(rt, date, { exclude = new Set(), reason = 'plan' } = {}) {
  if (!isDate(date)) throw new ToolError('date must be YYYY-MM-DD');
  const ctx = await rt.getCtx();
  const ctx2 = exclude.size ? { ...ctx, tasks: ctx.tasks.filter(t => !exclude.has(t.id)) } : ctx;
  const plan = planDay(date, ctx2);
  const chosen = [...plan.must, ...plan.planned].filter(c => c.kind === 'task');
  const wins = windowsFor(date, ctx2);
  const scheduled = [];
  if (wins.length && chosen.length) {
    const w = wins[0];
    let cursor = D.hmToMin(w.start);
    const end = D.hmToMin(w.end);
    if (date === ctx.today) cursor = Math.max(cursor, Math.ceil(D.hmToMin(ctx.now) / 5) * 5);
    const busy = busyIntervals(date, ctx2, { includeWorkBlocks: false });   // fixed events + already-scheduled tasks
    for (const c of chosen) {
      const t = c.ref;
      if (D.dateOf(t.scheduled_start, ctx.tz) === date) { scheduled.push({ id: t.id, title: t.title, start: t.scheduled_start, end: t.scheduled_end, kept: true }); continue; }
      let s = cursor;
      for (let g = 0; g < 30; g++) { const hit = busy.find(([bs, be]) => s < be && s + c.duration_min > bs); if (!hit) break; s = hit[1]; }
      if (s + c.duration_min > end) continue;                // no room in the window → stays planned, unscheduled
      const start = D.toISO(date, D.minToHM(s), ctx.tz), endIso = D.toISO(date, D.minToHM(s + c.duration_min), ctx.tz);
      await rt.db.update('tasks', { id: t.id }, { scheduled_start: start, scheduled_end: endIso });
      await rt.act({ entity_type: 'task', entity_id: t.id, action: 'update', before: pick(t, ['scheduled_start', 'scheduled_end']), after: { scheduled_start: start, scheduled_end: endIso }, reason, summary: `Scheduled "${t.title}" ${D.humanDate(date, ctx.today)} ${D.fmtHM(D.minToHM(s))}`, quiet: reason === 'plan' });
      busy.push([s, s + c.duration_min]); cursor = s + c.duration_min;
      scheduled.push({ id: t.id, title: t.title, start, end: endIso });
    }
  }
  rt.dirty();
  return { date, day: D.dayName(date), capacity: plan.capacity, used: plan.used, overloaded: plan.overloaded, must: plan.must.map(slimCand), planned: plan.planned.map(slimCand), coming_up: plan.comingUp.map(slimCand), scheduled };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool implementations
// ─────────────────────────────────────────────────────────────────────────────
const MODES = ['normal', 'busy', 'travel', 'sick', 'vacation', 'project'];
const daysAgoIso = n => new Date(Date.now() - n * 86400e3).toISOString();

const TOOL_IMPL = {
  // ── read ──
  async search_everything({ q }, rt) {
    const p = likePattern(q), db = rt.db;
    if (p === '**') throw new ToolError('q is required');
    const [tasks, events, projects, steps, notes, assets, plants, routines, maint, items, memories] = await Promise.all([
      db.select('tasks', { or: `(title.ilike.${p},notes.ilike.${p})`, order: 'due_date.asc.nullslast', limit: 12 }),
      db.select('events', { title: `ilike.${p}`, order: 'starts_at.desc', limit: 8 }),
      db.select('projects', { or: `(name.ilike.${p},description.ilike.${p})`, limit: 5 }),
      db.select('project_steps', { title: `ilike.${p}`, limit: 8 }),
      db.select('notes', { or: `(title.ilike.${p},body.ilike.${p})`, limit: 8 }),
      db.select('assets', { or: `(name.ilike.${p},brand.ilike.${p},model.ilike.${p})`, limit: 5 }),
      db.select('plants', { or: `(name.ilike.${p},group_name.ilike.${p},species.ilike.${p})`, limit: 6 }),
      db.select('routines', { name: `ilike.${p}`, limit: 5 }),
      db.select('maintenance_rules', { or: `(name.ilike.${p},instructions.ilike.${p})`, limit: 5 }),
      db.select('list_items', { text: `ilike.${p}`, select: 'id,text,qty,done,list_id', limit: 8 }),
      db.select('memories', { content: `ilike.${p}`, status: 'active', limit: 5 }),
    ]);
    const out = { tasks: tasks.map(slimTask), events: events.map(slimEvent), projects: projects.map(slimProject), steps: steps.map(slimStep), notes: notes.map(n => pick(n, ['id', 'title', 'body', 'vendor', 'phone', 'url'])), assets: assets.map(a => pick(a, ['id', 'name', 'brand', 'model', 'consumables'])), plants: plants.map(slimPlant), routines: routines.map(slimRoutine), maintenance_rules: maint.map(slimRule), list_items: items, memories: memories.map(slimMemory) };
    for (const k of Object.keys(out)) if (!out[k].length) delete out[k];
    return Object.keys(out).length ? out : { found: 'nothing' };
  },

  async get_today({ date }, rt) {
    const ctx = await rt.getCtx();
    date = date || ctx.today;
    if (!isDate(date)) throw new ToolError('date must be YYYY-MM-DD');
    const plan = planDay(date, ctx);
    return { date, day: D.dayName(date), capacity: plan.capacity, used: plan.used, overloaded: plan.overloaded, must: plan.must.map(slimCand), planned: plan.planned.map(slimCand), coming_up: plan.comingUp.map(slimCand), needs_attention: date === ctx.today ? needsAttention(ctx) : [], events: ctx.events.filter(e => D.dateOf(e.starts_at, ctx.tz) === date).map(slimEvent), weather: ctx.weather[date] || null };
  },

  async list_tasks({ status, area_id, project_id, due_before, q, limit }, rt) {
    const query = { order: 'due_date.asc.nullslast', limit: clampInt(limit, 1, 100, 50) };
    if (status !== 'all') query.status = status || 'open';
    if (area_id) query.area_id = await resolveId(rt, 'areas', area_id, 'area');
    if (project_id) query.project_id = await resolveId(rt, 'projects', project_id, 'project');
    if (due_before) { if (!isDate(due_before)) throw new ToolError('due_before must be YYYY-MM-DD'); query.due_date = `lte.${due_before}`; }
    if (q) query.or = `(title.ilike.${likePattern(q)},notes.ilike.${likePattern(q)})`;
    const rows = await rt.db.select('tasks', query);
    return { count: rows.length, tasks: rows.map(slimTask) };
  },

  async get_calendar({ from, to }, rt) {
    if (!isDate(from) || !isDate(to)) throw new ToolError('from/to must be YYYY-MM-DD');
    const tz = rt.tz, a = D.toISO(from, '00:00', tz), b = D.toISO(to, '23:59', tz);
    const [events, tasks] = await Promise.all([
      rt.db.select('events', { and: `(starts_at.gte.${a},starts_at.lte.${b})`, order: 'starts_at.asc', limit: 200 }),
      rt.db.select('tasks', { status: 'open', or: `(and(due_date.gte.${from},due_date.lte.${to}),and(scheduled_start.gte.${a},scheduled_start.lte.${b}))`, limit: 200 }),
    ]);
    const days = {};
    const day = d => (days[d] ||= { events: [], scheduled: [], deadlines: [] });
    for (const e of events) day(D.dateOf(e.starts_at, tz)).events.push({ ...slimEvent(e), time: e.all_day ? 'all day' : D.timeOf(e.starts_at, tz) });
    for (const t of tasks) {
      const sd = D.dateOf(t.scheduled_start, tz);
      if (sd && sd >= from && sd <= to) day(sd).scheduled.push({ id: t.id, title: t.title, time: D.timeOf(t.scheduled_start, tz), duration_min: t.duration_min });
      if (t.due_date && t.due_date >= from && t.due_date <= to) day(t.due_date).deadlines.push({ id: t.id, title: t.title, importance: t.importance });
    }
    return { from, to, days: Object.fromEntries(Object.entries(days).sort()) };
  },

  async find_open_time({ duration_min, from, to, prefer }, rt) {
    const ctx = await rt.getCtx();
    const dur = clampInt(duration_min, 5, 720, 60);
    from = from || ctx.today; to = to || D.addDays(from, 7);
    if (!isDate(from) || !isDate(to)) throw new ToolError('from/to must be YYYY-MM-DD');
    const slots = [];
    for (const d of dateRange(from, to, 14)) {
      const busy = busyIntervals(d, ctx);
      for (const w of windowsFor(d, ctx)) {
        let cursor = D.hmToMin(w.start); const end = D.hmToMin(w.end);
        if (d === ctx.today) cursor = Math.max(cursor, Math.ceil(D.hmToMin(ctx.now) / 15) * 15);
        while (cursor + dur <= end) {
          const next = busy.filter(([, be]) => be > cursor).sort((x, y) => x[0] - y[0])[0];
          const gapEnd = next ? Math.min(next[0], end) : end;
          if (gapEnd - cursor >= dur) slots.push({ date: d, day: D.dayName(d), start: D.minToHM(cursor), end: D.minToHM(gapEnd), minutes: gapEnd - cursor, weekend: D.isWeekend(d) });
          if (!next) break;
          cursor = Math.max(cursor, next[1]);
        }
      }
    }
    const pref = String(prefer || '').toLowerCase();
    const fits = s => { const h = D.hmToMin(s.start); return pref === 'morning' ? h < 720 : pref === 'afternoon' ? h >= 720 && h < 1020 : pref === 'evening' ? h >= 1020 : pref === 'weekend' ? s.weekend : pref === 'weekday' ? !s.weekend : pref ? D.dow(s.date) === pref.slice(0, 3) : true; };
    return { duration_min: dur, slots: slots.sort((a, b) => Number(fits(b)) - Number(fits(a)) || D.cmp(a.date, b.date)).slice(0, 6) };
  },

  async list_projects({ include_done }, rt) {
    const ctx = await rt.getCtx();
    const rows = include_done ? await rt.db.select('projects', { order: 'priority.asc' }) : ctx.projects;
    return { projects: rows.map(p => { const steps = ctx.steps.filter(s => s.project_id === p.id); const done = steps.filter(s => s.status === 'done' || s.status === 'skipped').length; const next = nextStepOf(p.id, ctx); return { ...slimProject(p), steps_total: steps.length, steps_done: done, progress_pct: steps.length ? Math.round(100 * done / steps.length) : 0, next_step: next ? slimStep(next) : null }; }) };
  },

  async get_project({ id }, rt) {
    const p = await resolve(rt, 'projects', id, { label: 'project' });
    const [steps, costs] = await Promise.all([rt.db.select('project_steps', { project_id: p.id, order: 'sort.asc' }), rt.db.select('project_costs', { project_id: p.id, order: 'created_at.asc' })]);
    const ctx = await rt.getCtx();
    const next = nextStepOf(p.id, { ...ctx, steps });
    return { project: slimProject(p), progress_pct: steps.length ? Math.round(100 * steps.filter(s => s.status === 'done' || s.status === 'skipped').length / steps.length) : 0, next_step: next ? slimStep(next) : null, steps: steps.map(slimStep), costs: costs.map(c => pick(c, ['id', 'item', 'qty', 'projected', 'actual', 'vendor', 'purchased_at'])), totals: { projected: costs.reduce((a, c) => a + Number(c.projected || 0), 0), actual: costs.reduce((a, c) => a + Number(c.actual || 0), 0) } };
  },

  async list_maintenance({ status }, rt) {
    const ctx = await rt.getCtx();
    const assets = await rt.db.select('assets', { select: 'id,name' });
    let rules = ctx.maintenance;
    if (status === 'overdue') rules = rules.filter(m => m.next_due && m.next_due < ctx.today);
    else if (status === 'due_soon') rules = rules.filter(m => m.next_due && m.next_due <= D.addDays(ctx.today, 14));
    return { rules: rules.map(m => ({ ...slimRule(m), asset_name: assets.find(a => a.id === m.asset_id)?.name || null, days_until_due: m.next_due ? D.diffDays(ctx.today, m.next_due) : null })) };
  },

  async list_plants({ include_archived }, rt) {
    const ctx = await rt.getCtx();
    const rows = include_archived ? await rt.db.select('plants', {}) : ctx.plants;
    return { plants: rows.map(p => ({ ...slimPlant(p), days_since_water: p.last_water ? D.diffDays(p.last_water, ctx.today) : null })) };
  },

  async get_pet_history({ pet_id, kind, days }, rt) {
    const ctx = await rt.getCtx();
    const pet = pet_id ? await resolve(rt, 'pets', pet_id, { label: 'pet' }) : ctx.pets[0];
    if (!pet) throw new ToolError('No pet found');
    const since = daysAgoIso(clampInt(days, 1, 365, 30));
    const routines = ctx.routines.filter(r => r.pet_id === pet.id);
    const [acts, logs] = await Promise.all([
      rt.db.select('pet_activities', { pet_id: pet.id, at: `gte.${since}`, ...(kind ? { kind } : {}), order: 'at.desc', limit: 100 }),
      routines.length ? rt.db.select('routine_log', { routine_id: routines.map(r => r.id), done_at: `gte.${since}`, order: 'done_at.desc', limit: 100 }) : [],
    ]);
    const byKind = {}; for (const a of acts) byKind[a.kind] = (byKind[a.kind] || 0) + 1;
    const focus = {}; for (const a of acts) if (a.focus) focus[a.focus] = (focus[a.focus] || 0) + 1;
    const lastTraining = acts.find(a => a.kind === 'training')?.at || logs[0]?.done_at || null;
    return { pet: pick(pet, ['id', 'name', 'species', 'breed']), counts: byKind, focus_tally: focus, days_since_training: lastTraining ? D.diffDays(D.dateOf(lastTraining, ctx.tz), ctx.today) : null, activities: acts.slice(0, 30).map(a => pick(a, ['id', 'at', 'kind', 'duration_min', 'focus', 'note'])), routine_logs: logs.slice(0, 30).map(l => pick(l, ['routine_id', 'done_at', 'duration_min', 'detail', 'note'])) };
  },

  async search_memory({ q, subject }, rt) {
    const clean = String(q || '').replace(/[():|&!*'"<>\\,]/g, ' ').trim().slice(0, 200);
    const base = { status: 'active', order: 'confidence.desc', limit: 20, ...(subject ? { subject } : {}) };
    let rows = [];
    try { rows = clean ? await rt.db.select('memories', { ...base, fts: `wfts(english).${clean}` }) : []; } catch { rows = []; }
    if (!rows.length) { const words = keywords(q).slice(0, 5); rows = await rt.db.select('memories', { ...base, ...(words.length ? { or: `(${words.map(w => `content.ilike.${likePattern(w)}`).join(',')})` } : {}) }); }
    return { memories: rows.map(slimMemory) };
  },

  async search_history({ q, days }, rt) {
    const n = clampInt(days, 1, 730, 90), since = daysAgoIso(n), sinceDate = since.slice(0, 10), p = likePattern(q);
    const clean = String(q || '').replace(/[():|&!*'"<>\\,]/g, ' ').trim().slice(0, 200);
    const msgs = async () => { try { const r = await rt.db.select('ai_messages', { select: 'id,thread_id,role,text,created_at', created_at: `gte.${since}`, fts: `wfts(english).${clean}`, order: 'created_at.desc', limit: 20 }); if (r.length) return r; } catch {} return rt.db.select('ai_messages', { select: 'id,thread_id,role,text,created_at', created_at: `gte.${since}`, text: `ilike.${p}`, order: 'created_at.desc', limit: 20 }); };
    const [acts, conv, rlogs, mlogs] = await Promise.all([
      rt.db.select('activity_log', { at: `gte.${since}`, or: `(reason.ilike.${p},after->>title.ilike.${p},before->>title.ilike.${p},after->>summary.ilike.${p})`, order: 'at.desc', limit: 30 }),
      msgs(),
      rt.db.select('routine_log', { done_at: `gte.${since}`, note: `ilike.${p}`, order: 'done_at.desc', limit: 20 }),
      rt.db.select('maintenance_log', { done_at: `gte.${sinceDate}`, note: `ilike.${p}`, order: 'done_at.desc', limit: 20 }),
    ]);
    return { days: n, activity: acts.map(a => ({ at: a.at, actor: a.actor, action: a.action, entity_type: a.entity_type, entity_id: a.entity_id, title: a.after?.title || a.before?.title || null, reason: a.reason })), conversations: conv.map(m => ({ at: m.created_at, role: m.role, text: String(m.text || '').slice(0, 300) })), routine_notes: rlogs, maintenance_notes: mlogs };
  },

  async get_weather({ days }, rt) {
    const ctx = await rt.getCtx();
    const wx = { ...DEFAULT_WX, ...(ctx.settings.weather || {}) };
    const data = await getWeather(rt.env, wx.lat, wx.lon, clampInt(days, 1, 16, 7), ctx.tz);
    return { location: wx.label || 'New Braunfels, TX', days: Object.entries(data).map(([date, w]) => ({ date, day: D.dayName(date), ...w })) };
  },

  // ── write: tasks ──
  async create_task(input, rt) {
    if (!input.title || !String(input.title).trim()) throw new ToolError('title is required');
    const patch = await normalizeTaskPatch(rt, input);
    const row = { importance: 'should', ...patch, title: String(input.title).trim(), status: 'open', source: 'ai', created_by: rt.userId };
    const [t] = await rt.db.insert('tasks', row);
    await rt.act({ entity_type: 'task', entity_id: t.id, action: 'create', after: slimTask(t), summary: `Added "${t.title}"${t.due_date ? ` for ${D.humanDate(t.due_date, rt.today)}` : t.window_start ? ` (${t.window_start} → ${t.window_end})` : ''}` });
    rt.dirty();
    return { task: slimTask(t) };
  },

  async update_task({ id, patch }, rt) {
    const t = await resolveTask(rt, id);
    const p = await normalizeTaskPatch(rt, patch || {});
    if (!Object.keys(p).length) throw new ToolError('patch is empty');
    const [u] = await rt.db.update('tasks', { id: t.id }, p);
    await rt.act({ entity_type: 'task', entity_id: t.id, action: 'update', before: pick(t, Object.keys(p)), after: p, summary: `Updated "${u.title}" (${Object.keys(p).join(', ')})` });
    rt.dirty();
    return { task: slimTask(u) };
  },

  async complete_task({ id, actual_min, note }, rt) {
    const t = await resolveTask(rt, id);
    return completeTaskRow(rt, t, { actual_min, note });
  },

  async postpone_task({ id, to_date, reason }, rt) {
    const t = await resolveTask(rt, id);
    if (!isDate(to_date)) throw new ToolError('to_date must be YYYY-MM-DD');
    const tz = rt.tz, sd = D.dateOf(t.scheduled_start, tz);
    const patch = { postponed: (t.postponed || 0) + 1, original_date: t.original_date || t.due_date || sd || null };
    if (t.due_date || !sd) patch.due_date = to_date;
    if (sd) { patch.scheduled_start = D.toISO(to_date, D.timeOf(t.scheduled_start, tz), tz); patch.scheduled_end = t.scheduled_end ? D.toISO(to_date, D.timeOf(t.scheduled_end, tz), tz) : null; }
    if (t.window_end && t.window_end < to_date) patch.window_end = to_date;
    const [u] = await rt.db.update('tasks', { id: t.id }, patch);
    await rt.act({ entity_type: 'task', entity_id: t.id, action: 'postpone', before: pick(t, Object.keys(patch)), after: patch, reason: reason || null, summary: `Postponed "${t.title}" to ${D.humanDate(to_date, rt.today)}` });
    rt.dirty();
    return { task: slimTask(u) };
  },

  async delete_task({ id, reason }, rt) {                   // executed only via /confirm
    const t = await resolveTask(rt, id);
    const [u] = await rt.db.update('tasks', { id: t.id }, { status: 'cancelled' });
    await rt.act({ entity_type: 'task', entity_id: t.id, action: 'delete', before: slimTask(t), after: { status: 'cancelled' }, reason: reason || null, summary: `Removed "${t.title}"`, undo: { op: 'update', table: 'tasks', id: t.id, patch: { status: t.status } } });
    rt.dirty();
    return { task: slimTask(u) };
  },

  // ── write: calendar ──
  async create_event(input, rt) {
    const tz = rt.tz, today = rt.today;
    if (!input.title) throw new ToolError('title is required');
    const starts_at = normalizeTs(input.starts_at, tz, input.all_day ? '00:00' : '09:00');
    const ends_at = input.ends_at ? normalizeTs(input.ends_at, tz, '23:59') : input.all_day ? null : new Date(+new Date(starts_at) + 3600e3).toISOString();
    const people_ids = [];
    for (const p of input.people || []) { const id = await resolveId(rt, 'people', p, 'person'); if (id) people_ids.push(id); }
    const row = { title: String(input.title).trim(), kind: ['fixed', 'travel', 'deadline'].includes(input.kind) ? input.kind : 'fixed', starts_at, ends_at, all_day: !!input.all_day, location: input.location || null, notes: input.notes || null, project_id: await resolveId(rt, 'projects', input.project, 'project'), people_ids };
    const [e] = await rt.db.insert('events', row);
    await rt.act({ entity_type: 'event', entity_id: e.id, action: 'create', after: slimEvent(e), summary: `Added "${e.title}" ${D.humanDate(D.dateOf(e.starts_at, tz), today)}${e.all_day ? '' : ' ' + D.fmtHM(D.timeOf(e.starts_at, tz))}` });
    rt.dirty();
    return { event: slimEvent(e) };
  },

  async move_event({ id, starts_at, ends_at }, rt) {
    const tz = rt.tz, today = rt.today;
    let ev = isUuid(String(id)) ? null : await resolve(rt, 'events', id, { label: 'event', filter: { starts_at: `gte.${D.toISO(D.addDays(today, -1), '00:00', tz)}` }, required: false });
    ev = ev || await resolve(rt, 'events', id, { label: 'event' });
    const ns = normalizeTs(starts_at, tz, ev.all_day ? '00:00' : D.timeOf(ev.starts_at, tz));
    const dur = ev.ends_at ? +new Date(ev.ends_at) - +new Date(ev.starts_at) : 3600e3;
    const ne = ends_at ? normalizeTs(ends_at, tz, '23:59') : ev.ends_at ? new Date(+new Date(ns) + dur).toISOString() : null;
    const [u] = await rt.db.update('events', { id: ev.id }, { starts_at: ns, ends_at: ne });
    if (ev.task_id) await rt.db.update('tasks', { id: ev.task_id }, { scheduled_start: ns, scheduled_end: ne }).catch(() => {});
    await rt.act({ entity_type: 'event', entity_id: ev.id, action: 'update', before: pick(ev, ['starts_at', 'ends_at']), after: { starts_at: ns, ends_at: ne }, summary: `Moved "${ev.title}" to ${D.humanDate(D.dateOf(ns, tz), today)} ${ev.all_day ? '' : D.fmtHM(D.timeOf(ns, tz))}`.trim() });
    rt.dirty();
    return { event: slimEvent(u) };
  },

  async create_work_block({ task_id, start, end }, rt) {
    const tz = rt.tz, today = rt.today;
    const t = await resolveTask(rt, task_id);
    const s = normalizeTs(start, tz, '09:00');
    const e = end ? normalizeTs(end, tz, '10:00') : new Date(+new Date(s) + (t.duration_min || 60) * 60000).toISOString();
    if (e <= s) throw new ToolError('end must be after start');
    const [ev] = await rt.db.insert('events', { title: t.title, kind: 'work_block', starts_at: s, ends_at: e, task_id: t.id, project_id: t.project_id });
    await rt.db.update('tasks', { id: t.id }, { scheduled_start: s, scheduled_end: e });
    await rt.act({ entity_type: 'event', entity_id: ev.id, action: 'create', after: slimEvent(ev), summary: `Reserved ${D.humanDate(D.dateOf(s, tz), today)} ${D.fmtHM(D.timeOf(s, tz))}–${D.fmtHM(D.timeOf(e, tz))} for "${t.title}"`, undo: { op: 'delete', table: 'events', id: ev.id, also: { op: 'update', table: 'tasks', id: t.id, patch: pick(t, ['scheduled_start', 'scheduled_end']) } } });
    rt.dirty();
    return { event: slimEvent(ev), task: { id: t.id, scheduled_start: s, scheduled_end: e } };
  },

  // ── write: planning ──
  async set_day_mode({ from_date, to_date, mode, note, capacity_override_min, project }, rt) {
    if (!isDate(from_date)) throw new ToolError('from_date must be YYYY-MM-DD');
    to_date = to_date && isDate(to_date) ? to_date : from_date;
    if (to_date < from_date) [from_date, to_date] = [to_date, from_date];
    if (!MODES.includes(mode)) throw new ToolError(`mode must be one of ${MODES.join(', ')}`);
    const dates = dateRange(from_date, to_date, 31);
    const project_id = await resolveId(rt, 'projects', project, 'project');
    const existing = await rt.db.select('day_modes', { date: dates, person_id: 'is.null' });
    if (existing.length) await rt.db.del('day_modes', { id: existing.map(x => x.id) });
    let rows = [];
    if (mode !== 'normal') rows = await rt.db.insert('day_modes', dates.map(date => ({ date, mode, note: note || null, capacity_override_min: capacity_override_min ?? null, project_id })));
    const span = dates.length === 1 ? from_date : `${from_date} → ${to_date}`;
    await rt.act({ entity_type: 'day_mode', entity_id: rows[0]?.id || null, action: mode === 'normal' ? 'delete' : 'create', before: existing.map(x => pick(x, ['date', 'mode', 'note', 'capacity_override_min'])), after: rows.map(x => pick(x, ['id', 'date', 'mode', 'note'])), reason: `mode:${mode}`, summary: mode === 'normal' ? `Cleared day mode for ${span}` : `Set ${span} to ${mode}`, undo: { op: 'restore_day_modes', table: 'day_modes', dates, rows: existing } });
    rt.dirty();
    const ctx = await rt.getCtx();
    if (mode === 'normal') return { mode, dates, restored: await restoreReplanned(rt, dates) };

    const res = replan(dates, mode, ctx);
    const moved = [], unplaced = [];
    for (const { task: t, to } of res.move) {
      if (!to) { unplaced.push(t.title); await rt.act({ entity_type: 'task', entity_id: t.id, action: 'replan', before: pick(t, ['due_date', 'scheduled_start']), after: null, reason: `replan:${mode}:unplaced`, summary: `Could not place "${t.title}" within 10 days`, quiet: true }); continue; }
      const sd = D.dateOf(t.scheduled_start, ctx.tz);
      const patch = { original_date: t.original_date || sd || t.due_date };
      if (sd && dates.includes(sd)) { patch.scheduled_start = D.toISO(to, D.timeOf(t.scheduled_start, ctx.tz), ctx.tz); patch.scheduled_end = t.scheduled_end ? D.toISO(to, D.timeOf(t.scheduled_end, ctx.tz), ctx.tz) : null; }
      if (t.due_date && dates.includes(t.due_date)) patch.due_date = to;
      if (!patch.due_date && !patch.scheduled_start) patch.due_date = to;
      await rt.db.update('tasks', { id: t.id }, patch);
      await rt.act({ entity_type: 'task', entity_id: t.id, action: 'replan', before: pick(t, ['due_date', 'scheduled_start', 'scheduled_end', 'original_date']), after: patch, reason: `replan:${mode}`, summary: `Moved "${t.title}" to ${D.humanDate(to, ctx.today)}` });
      moved.push({ id: t.id, title: t.title, to });
    }
    const reduced = [];
    for (const { task: t, to } of res.reduce) {
      await rt.act({ entity_type: 'task', entity_id: t.id, action: 'replan', before: null, after: { reduced_to: to }, reason: `replan:${mode}`, summary: `Reduced "${t.title}" to ${to}` });
      reduced.push({ id: t.id, title: t.title, min_version: to });
    }
    rt.dirty();
    const byDay = {}; for (const m of moved) byDay[m.to] = (byDay[m.to] || 0) + 1;
    return { mode, dates, kept: res.keep.map(t => t.title), reduced, moved, unplaced, summary: `Kept ${res.keep.length}, reduced ${reduced.length}, moved ${moved.length}${moved.length ? ` (${Object.entries(byDay).map(([d, n]) => `${n} to ${D.dayName(d)} ${d}`).join(', ')})` : ''}${unplaced.length ? `, ${unplaced.length} unplaced` : ''}` };
  },

  async replan_day({ date }, rt) { return schedulePlan(rt, date || rt.today, { reason: 'replan' }); },

  async replan_week({ from }, rt) {
    const ctx = await rt.getCtx();
    from = from || ctx.today;
    if (!isDate(from)) throw new ToolError('from must be YYYY-MM-DD');
    const exclude = new Set(), days = [];
    for (const d of dateRange(from, D.addDays(from, 6))) {
      const r = await schedulePlan(rt, d, { exclude, reason: 'replan' });
      r.scheduled.forEach(s => exclude.add(s.id));
      days.push({ date: d, day: r.day, capacity: r.capacity.minutes, mode: r.capacity.mode, used: r.used, must: r.must.map(c => c.title), planned: r.planned.map(c => c.title), scheduled: r.scheduled.length });
    }
    return { from, days };
  },

  // ── write: projects ──
  async update_project_step({ id, project, status, note, actual_min }, rt) {
    const filter = project ? { project_id: await resolveId(rt, 'projects', project, 'project') } : {};
    const s = await resolve(rt, 'project_steps', id, { label: 'step', filter });
    const patch = {};
    if (status) { if (!['todo', 'doing', 'done', 'skipped'].includes(status)) throw new ToolError('bad status'); patch.status = status; patch.done_at = status === 'done' ? nowIso() : null; }
    if (note != null) patch.note = note;
    if (actual_min != null) patch.actual_min = clampInt(actual_min, 0, 100000, null);
    if (!Object.keys(patch).length) throw new ToolError('nothing to change');
    const [u] = await rt.db.update('project_steps', { id: s.id }, patch);
    await rt.act({ entity_type: 'project_step', entity_id: s.id, action: 'update', before: pick(s, Object.keys(patch)), after: patch, summary: status ? `Step "${s.title}" → ${status}` : `Updated step "${s.title}"` });
    const closed = status === 'done' || status === 'skipped' ? await closeLinkedTasks(rt, 'step_id', s.id, 'step done') : [];
    rt.dirty();
    return { step: slimStep(u), closed_tasks: closed };
  },

  async add_project_step({ project_id, title, phase, after_step_id, est_min }, rt) {
    const p = await resolve(rt, 'projects', project_id, { label: 'project' });
    if (!title) throw new ToolError('title is required');
    const steps = await rt.db.select('project_steps', { project_id: p.id, order: 'sort.asc' });
    const after = after_step_id ? await resolve(rt, 'project_steps', after_step_id, { label: 'step', filter: { project_id: p.id } }) : null;
    const sort = after ? after.sort + 1 : (steps.length ? Math.max(...steps.map(s => s.sort)) + 1 : 0);
    for (const s of steps.filter(s => s.sort >= sort)) await rt.db.update('project_steps', { id: s.id }, { sort: s.sort + 1 });
    const [row] = await rt.db.insert('project_steps', { project_id: p.id, title: String(title).trim(), phase: phase || after?.phase || null, sort, depends_on: after ? [after.id] : [], est_min: est_min ?? null });
    await rt.act({ entity_type: 'project_step', entity_id: row.id, action: 'create', after: slimStep(row), summary: `Added step "${row.title}" to ${p.name}` });
    rt.dirty();
    return { step: slimStep(row) };
  },

  async add_project_cost({ project_id, item, qty, projected, actual, vendor, purchased_at }, rt) {
    const p = await resolve(rt, 'projects', project_id, { label: 'project' });
    if (!item) throw new ToolError('item is required');
    const [row] = await rt.db.insert('project_costs', { project_id: p.id, item, qty: qty || null, projected: projected ?? null, actual: actual ?? null, vendor: vendor || null, purchased_at: isDate(purchased_at) ? purchased_at : null });
    await rt.act({ entity_type: 'project_cost', entity_id: row.id, action: 'create', after: row, summary: `Added cost "${item}"${actual != null ? ` $${actual}` : projected != null ? ` (~$${projected})` : ''} to ${p.name}` });
    return { cost: pick(row, ['id', 'item', 'qty', 'projected', 'actual', 'vendor', 'purchased_at']) };
  },

  // ── write: home / plants / pets / routines ──
  async record_maintenance({ rule_id, done_at, note, cost }, rt) {
    const rule = await resolve(rt, 'maintenance_rules', rule_id, { label: 'maintenance rule' });
    const res = await coreRecordMaintenance(rt, rule, { done_at, note, cost });
    const closed = await closeLinkedTasks(rt, 'maintenance_rule_id', rule.id, 'maintenance done');
    return { rule: { id: rule.id, name: rule.name, interval_days: rule.interval_days }, ...res, closed_tasks: closed };
  },

  async log_plant_observation({ plant_id, group_name, kind, note, soil_state, ph, ec, water_level, at }, rt) {
    const plant = plant_id ? await resolve(rt, 'plants', plant_id, { label: 'plant' }) : null;
    if (!plant && !group_name) throw new ToolError('plant_id or group_name is required');
    if (!plant && group_name) {                              // snap to an existing group name, case-insensitively
      const [g] = await rt.db.select('plants', { group_name: `ilike.${likePattern(group_name)}`, select: 'group_name', limit: 1 });
      if (g) group_name = g.group_name;
    }
    const row = { plant_id: plant?.id || null, group_name: plant ? null : group_name, at: at ? normalizeTs(at, rt.tz, rt.now) : nowIso(), kind, note: note || null, soil_state: soil_state || null, ph: ph ?? null, ec: ec ?? null, water_level: water_level || null };
    const [o] = await rt.db.insert('plant_observations', row);
    await rt.act({ entity_type: 'plant_observation', entity_id: o.id, action: 'log', after: o, summary: `Logged ${kind} for ${plant ? plant.name : group_name}` });
    rt.dirty();
    return { observation: pick(o, ['id', 'plant_id', 'group_name', 'at', 'kind', 'soil_state', 'ph', 'ec', 'water_level', 'note']) };
  },


  async log_pet_activity({ pet_id, kind, duration_min, focus, note, at }, rt) {
    const pet = pet_id ? await resolve(rt, 'pets', pet_id, { label: 'pet' }) : (await rt.db.select('pets', { limit: 1 }))[0];
    if (!pet) throw new ToolError('No pet found — add one first');
    const atIso = at ? normalizeTs(at, rt.tz, rt.now) : nowIso();
    const [a] = await rt.db.insert('pet_activities', { pet_id: pet.id, at: atIso, kind, duration_min: duration_min ?? null, focus: focus || null, note: note || null, by_person_id: rt.personId });
    await rt.act({ entity_type: 'pet_activity', entity_id: a.id, action: 'log', after: a, summary: `Logged ${pet.name} ${kind}${focus ? ` (${focus})` : ''}${duration_min ? ` ${duration_min} min` : ''}` });
    const out = { activity: pick(a, ['id', 'pet_id', 'at', 'kind', 'duration_min', 'focus', 'note']) };
    if (kind === 'training') {                              // also counts as the pet's daily training routine
      const r = (await rt.db.select('routines', { pet_id: pet.id, active: true, name: 'ilike.*train*', limit: 1 }))[0];
      if (r && D.dateOf(r.last_done_at, rt.tz) !== D.dateOf(atIso, rt.tz)) {
        out.routine_log = await coreLogRoutine(rt, r, { done_at: atIso, duration_min, detail: focus ? { focus } : null, note });
        out.closed_tasks = await closeLinkedTasks(rt, 'routine_id', r.id, 'routine logged');
      }
    }
    rt.dirty();
    return out;
  },

  async log_routine({ routine_id, done_at, duration_min, detail, note }, rt) {
    const r = await resolve(rt, 'routines', routine_id, { label: 'routine' });
    const log = await coreLogRoutine(rt, r, { done_at, duration_min, detail, note });
    const closed = await closeLinkedTasks(rt, 'routine_id', r.id, 'routine logged');
    return { routine: { id: r.id, name: r.name, streak: log.streak }, log: pick(log, ['id', 'done_at', 'duration_min', 'detail', 'note']), closed_tasks: closed };
  },

  async add_list_item({ list_name_or_id, text, qty, project }, rt) {
    if (!text) throw new ToolError('text is required');
    let list = await resolve(rt, 'lists', list_name_or_id, { label: 'list', filter: { archived: false }, required: false });
    if (!list) {
      if (isUuid(String(list_name_or_id))) throw new ToolError('No list with that id');
      [list] = await rt.db.insert('lists', { name: String(list_name_or_id).trim(), kind: /pack/i.test(list_name_or_id) ? 'packing' : 'shopping' });
      await rt.act({ entity_type: 'list', entity_id: list.id, action: 'create', after: list, summary: `Created list "${list.name}"` });
    }
    const [item] = await rt.db.insert('list_items', { list_id: list.id, text: String(text).trim(), qty: qty || null, project_id: await resolveId(rt, 'projects', project, 'project') });
    await rt.act({ entity_type: 'list_item', entity_id: item.id, action: 'create', after: item, summary: `Added "${item.text}"${qty ? ` ×${qty}` : ''} to ${list.name}` });
    return { list: pick(list, ['id', 'name', 'kind']), item: pick(item, ['id', 'text', 'qty', 'done']) };
  },

  async create_note({ title, body, vendor, phone, url, area, project }, rt) {
    if (!title) throw new ToolError('title is required');
    const [n] = await rt.db.insert('notes', { title: String(title).trim(), body: body || null, vendor: !!vendor || !!phone, phone: phone || null, url: url || null, area_id: await resolveId(rt, 'areas', area, 'area'), project_id: await resolveId(rt, 'projects', project, 'project') });
    await rt.act({ entity_type: 'note', entity_id: n.id, action: 'create', after: pick(n, ['id', 'title', 'vendor']), summary: `Saved note "${n.title}"` });
    return { note: pick(n, ['id', 'title', 'body', 'vendor', 'phone', 'url', 'area_id', 'project_id']) };
  },

  async link({ from_type, from_id, to_type, to_id, rel }, rt) {
    if (!isUuid(from_id) || !isUuid(to_id)) throw new ToolError('from_id and to_id must be uuids');
    const [l] = await rt.db.upsert('links', { from_type, from_id, to_type, to_id, rel: rel || 'related' }, 'from_type,from_id,to_type,to_id,rel');
    await rt.act({ entity_type: 'link', entity_id: l.id, action: 'create', after: l, summary: `Linked ${from_type} → ${to_type} (${l.rel})` });
    return { link: l };
  },

  // ── write: memory ──
  async save_memory({ subject, kind, content, confidence, entity_type, entity_id }, rt) {
    if (!content || !subject || !kind) throw new ToolError('subject, kind and content are required');
    const [dup] = await rt.db.select('memories', { content: `ilike.${likePattern(content)}`, status: 'active', limit: 1 });
    if (dup) return { memory: slimMemory(dup), already_known: true };
    const [m] = await rt.db.insert('memories', { subject, kind, content: String(content).trim(), source: 'stated', confidence: Math.min(1, Math.max(0, Number(confidence ?? 0.9))).toFixed(2), entity_type: entity_type || null, entity_id: isUuid(String(entity_id)) ? entity_id : null, last_confirmed_at: nowIso() });
    await rt.act({ entity_type: 'memory', entity_id: m.id, action: 'create', after: slimMemory(m), summary: `Remembered: ${m.content}` });
    rt.dirty();
    return { memory: slimMemory(m), remembered: m.content };
  },

  async update_memory({ id, content, status, confidence }, rt) {
    if (!isUuid(String(id))) throw new ToolError('id must be a memory uuid');
    const [m] = await rt.db.select('memories', { id });
    if (!m) throw new ToolError('No memory with that id');
    const patch = {};
    if (content) patch.content = String(content).trim();
    if (status) { if (!['active', 'ignored'].includes(status)) throw new ToolError('status must be active | ignored'); patch.status = status; }
    if (confidence != null) { patch.confidence = Math.min(1, Math.max(0, Number(confidence))).toFixed(2); if (Number(confidence) >= 1) patch.last_confirmed_at = nowIso(); }
    if (!Object.keys(patch).length) throw new ToolError('nothing to change');
    const [u] = await rt.db.update('memories', { id }, patch);
    await rt.act({ entity_type: 'memory', entity_id: id, action: 'update', before: pick(m, Object.keys(patch)), after: patch, summary: status === 'ignored' ? `Ignoring memory: ${m.content}` : `Updated memory: ${u.content}` });
    rt.dirty();
    return { memory: slimMemory(u) };
  },

  async forget_memory({ id }, rt) {                          // executed only via /confirm
    if (!isUuid(String(id))) throw new ToolError('id must be a memory uuid');
    const [m] = await rt.db.select('memories', { id });
    if (!m) throw new ToolError('No memory with that id');
    await rt.db.update('memories', { id }, { status: 'rejected' });
    await rt.act({ entity_type: 'memory', entity_id: id, action: 'delete', before: pick(m, ['status']), after: { status: 'rejected' }, summary: `Forgot: ${m.content}` });
    rt.dirty();
    return { forgotten: m.content };
  },

  async bulk_update({ task_ids, patch }, rt) {               // executed only via /confirm
    const ids = (task_ids || []).filter(x => isUuid(String(x))).slice(0, 100);
    if (!ids.length) throw new ToolError('task_ids must contain uuids');
    const p = await normalizeTaskPatch(rt, patch || {});
    if (!Object.keys(p).length) throw new ToolError('patch is empty');
    const before = await rt.db.select('tasks', { id: ids });
    const rows = await rt.db.update('tasks', { id: ids }, p);
    await rt.act({ entity_type: 'task', entity_id: null, action: 'update', before: before.map(t => pick(t, ['id', ...Object.keys(p)])), after: { ids, patch: p }, reason: 'bulk', summary: `Updated ${rows.length} tasks (${Object.keys(p).join(', ')})`, undo: { op: 'bulk_update', table: 'tasks', rows: before.map(t => ({ id: t.id, patch: pick(t, Object.keys(p)) })) } });
    rt.dirty();
    return { updated: rows.length, tasks: rows.map(slimTask) };
  },
};

// Reversal of a replan (plan §6.6): tasks moved by replan:* and untouched since go back to `before`
async function restoreReplanned(rt, dates) {
  const logs = await rt.db.select('activity_log', { entity_type: 'task', action: 'replan', reason: 'like.replan:*', order: 'at.desc', limit: 200 });
  const wanted = logs.filter(l => l.before && l.after && (dates.includes(l.before.due_date) || dates.includes(D.dateOf(l.before.scheduled_start, rt.tz))));
  const ids = uniqBy(wanted.map(l => l.entity_id).filter(Boolean), x => x);
  if (!ids.length) return [];
  const tasks = await rt.db.select('tasks', { id: ids, status: 'open' });
  const restored = [];
  for (const t of tasks) {
    const log = wanted.find(l => l.entity_id === t.id);
    if (Math.abs(+new Date(t.updated_at) - +new Date(log.at)) > 5000) continue;   // user touched it since
    const patch = pick(log.before, ['due_date', 'scheduled_start', 'scheduled_end', 'original_date']);
    await rt.db.update('tasks', { id: t.id }, patch);
    await rt.act({ entity_type: 'task', entity_id: t.id, action: 'replan', before: pick(t, Object.keys(patch)), after: patch, reason: 'replan:normal', summary: `Restored "${t.title}" to ${patch.due_date || D.dateOf(patch.scheduled_start, rt.tz)}` });
    restored.push(t.title);
  }
  rt.dirty();
  return restored;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proposals (confirm-required tools). KV when bound; otherwise an in-memory Map that
// only survives within one Worker isolate — fine for a single household, documented in README.
// ─────────────────────────────────────────────────────────────────────────────
const proposalsMem = new Map();
const sweepProposals = () => { const now = Date.now(); for (const [k, v] of proposalsMem) if (now - v.created > PROPOSAL_TTL_S * 1000) proposalsMem.delete(k); };

async function storeProposal(env, p) {
  const prop = { ...p, id: crypto.randomUUID(), created: Date.now() };
  if (env.RATE) await env.RATE.put(`prop:${prop.id}`, JSON.stringify(prop), { expirationTtl: PROPOSAL_TTL_S });
  else { sweepProposals(); proposalsMem.set(prop.id, prop); }
  return prop;
}
async function loadProposal(env, id) {
  if (!isUuid(String(id))) return null;
  const p = env.RATE ? await env.RATE.get(`prop:${id}`, 'json') : proposalsMem.get(id);
  return p && Date.now() - p.created <= PROPOSAL_TTL_S * 1000 ? p : null;
}
async function dropProposal(env, id) { if (env.RATE) await env.RATE.delete(`prop:${id}`).catch(() => {}); else proposalsMem.delete(id); }

async function proposalSummary(rt, tool, input) {
  if (tool === 'delete_task') { const t = await resolveTask(rt, input.id); input.id = t.id; return `Remove task "${t.title}"${t.due_date ? ` (due ${t.due_date})` : ''}`; }
  if (tool === 'forget_memory') { const [m] = await rt.db.select('memories', { id: input.id }); if (!m) throw new ToolError('No memory with that id'); return `Forget: "${m.content}"`; }
  if (tool === 'bulk_update') { const p = await normalizeTaskPatch(rt, input.patch || {}); return `Change ${(input.task_ids || []).length} tasks: ${Object.entries(p).map(([k, v]) => `${k} → ${v ?? 'cleared'}`).join(', ')}`; }
  return `${tool} ${JSON.stringify(input)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool dispatch (never throws — the model gets {error})
// ─────────────────────────────────────────────────────────────────────────────
const truncate = (s, n = TOOL_RESULT_MAX_CHARS) => (s.length > n ? s.slice(0, n) + `…(truncated ${s.length - n} chars)` : s);

async function runTool(rt, name, input, { bypassConfirm = false } = {}) {
  const tool = TOOL_INDEX[name];
  if (!tool || !TOOL_IMPL[name]) return { error: `Unknown tool ${name}` };
  try {
    if (tool.confirm && !bypassConfirm) {
      const summary = await proposalSummary(rt, name, input);
      const p = await storeProposal(rt.env, { hh: rt.hh, userId: rt.userId, personId: rt.personId, tool: name, input, summary });
      const view = { id: p.id, summary, tool: name, input };
      rt.proposals.push(view);
      await rt.emit('proposal', view);
      return { proposal_id: p.id, summary, status: 'awaiting_confirmation', note: 'Not executed. The user sees a confirm card; tell them in a few words what will happen once they confirm.' };
    }
    const out = await TOOL_IMPL[name](input || {}, rt);
    return out === undefined ? { ok: true } : out;
  } catch (e) {
    if (!(e instanceof ToolError)) console.error(`tool ${name}`, e);
    return { error: e.message || String(e), ...(e.candidates ? { candidates: e.candidates } : {}) };
  }
}

const TOOL_VERB = { search_everything: 'Searching', get_today: 'Checking the plan', list_tasks: 'Listing tasks', get_calendar: 'Reading the calendar', find_open_time: 'Looking for free time', list_projects: 'Checking projects', get_project: 'Opening project', list_maintenance: 'Checking maintenance', list_plants: 'Checking plants', get_pet_history: 'Checking pet history', search_memory: 'Recalling', search_history: 'Searching history', get_weather: 'Checking the weather', create_task: 'Adding task', update_task: 'Updating task', complete_task: 'Completing', postpone_task: 'Postponing', delete_task: 'Proposing removal', create_event: 'Adding event', move_event: 'Moving event', create_work_block: 'Reserving time', set_day_mode: 'Replanning', replan_day: 'Replanning the day', replan_week: 'Replanning the week', update_project_step: 'Updating step', add_project_step: 'Adding step', add_project_cost: 'Adding cost', record_maintenance: 'Logging maintenance', log_plant_observation: 'Logging plant care', log_pet_activity: 'Logging activity', log_routine: 'Logging routine', add_list_item: 'Adding to list', create_note: 'Saving note', link: 'Linking', save_memory: 'Remembering', update_memory: 'Updating memory', forget_memory: 'Proposing to forget', bulk_update: 'Proposing bulk change' };
function describeCall(name, input = {}) {
  const hint = ['title', 'q', 'text', 'content', 'item', 'id', 'task_id', 'rule_id', 'routine_id', 'plant_id', 'project_id', 'mode', 'date', 'to_date'].map(k => input[k]).find(v => typeof v === 'string' && v && !isUuid(v));
  return `${TOOL_VERB[name] || name.replace(/_/g, ' ')}${hint ? ` · ${String(hint).slice(0, 60)}` : ''}…`;
}
function describeResult(name, r = {}) {
  if (r.summary) return r.summary;
  if (r.remembered) return `Remembered: ${r.remembered}`;
  if (r.task?.title) return `"${r.task.title}"${r.next ? ` · next ${r.next.due_date || r.next.window_start}` : ''}`;
  if (r.event?.title) return `"${r.event.title}"`;
  if (Array.isArray(r.tasks)) return `${r.tasks.length} tasks`;
  if (Array.isArray(r.slots)) return `${r.slots.length} open slots`;
  if (r.next_due) return `next due ${r.next_due}`;
  return 'Done';
}

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic SSE parsing (pure; exported for tests)
// ─────────────────────────────────────────────────────────────────────────────
export function parseSSE(buffer) {
  const events = [];
  const norm = buffer.replace(/\r\n/g, '\n');
  const parts = norm.split('\n\n');
  const rest = parts.pop();
  for (const frame of parts) {
    let event = 'message'; const data = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) continue;
    const raw = data.join('\n');
    let parsed; try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    events.push({ event, data: parsed });
  }
  return { events, rest };
}

export function createMessageAssembler() {
  const message = { id: null, model: null, role: 'assistant', content: [], stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } };
  const partial = {};
  return {
    message,
    handle(ev) {
      const d = ev && ev.data;
      if (!d || typeof d !== 'object') return null;
      switch (d.type) {
        case 'message_start':
          Object.assign(message, pick(d.message || {}, ['id', 'model']));
          message.usage.input_tokens = d.message?.usage?.input_tokens || 0;
          message.usage.output_tokens = d.message?.usage?.output_tokens || 0;
          return null;
        case 'content_block_start': {
          const b = { ...d.content_block };
          if (b.type === 'text') b.text = b.text || '';
          if (b.type === 'tool_use') { b.input = b.input && Object.keys(b.input).length ? b.input : {}; partial[d.index] = ''; }
          message.content[d.index] = b;
          return null;
        }
        case 'content_block_delta': {
          const b = message.content[d.index]; if (!b) return null;
          if (d.delta?.type === 'text_delta') { b.text += d.delta.text; return { text: d.delta.text }; }
          if (d.delta?.type === 'input_json_delta') { partial[d.index] = (partial[d.index] || '') + d.delta.partial_json; }
          return null;
        }
        case 'content_block_stop': {
          const b = message.content[d.index];
          if (b?.type === 'tool_use' && partial[d.index] != null) {
            const raw = partial[d.index].trim();
            if (raw) { try { b.input = JSON.parse(raw); } catch { b.input = { _unparsed: raw }; } }
            delete partial[d.index];
          }
          return null;
        }
        case 'message_delta':
          if (d.delta?.stop_reason) message.stop_reason = d.delta.stop_reason;
          if (d.usage?.output_tokens != null) message.usage.output_tokens = d.usage.output_tokens;
          if (d.usage?.input_tokens != null) message.usage.input_tokens = d.usage.input_tokens;
          return null;
        case 'error':
          throw new Error(`Anthropic stream error: ${d.error?.message || JSON.stringify(d)}`);
        default:
          return null;
      }
    },
  };
}

export function parseAnthropicSSE(text) {
  const asm = createMessageAssembler();
  const { events } = parseSSE(String(text).replace(/\r\n/g, '\n') + '\n\n');
  for (const ev of events) asm.handle(ev);
  message_cleanup(asm.message);
  return asm.message;
}
function message_cleanup(m) { m.content = m.content.filter(Boolean); }

async function streamAnthropic(env, payload, onText) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': env.ANTHROPIC_VERSION || '2023-06-01', 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ ...payload, stream: true }),
    signal: timeoutSignal(120000),
  });
  if (!res.ok) { const t = await res.text(); throw new HttpError(502, `Anthropic ${res.status}: ${t.slice(0, 400)}`); }
  const asm = createMessageAssembler();
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  const pump = async (chunk) => { buf += chunk; const { events, rest } = parseSSE(buf); buf = rest; for (const ev of events) { const out = asm.handle(ev); if (out?.text) await onText(out.text); } };
  for (;;) { const { done, value } = await reader.read(); if (done) break; await pump(dec.decode(value, { stream: true })); }
  await pump(dec.decode() + '\n\n');
  message_cleanup(asm.message);
  return asm.message;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /chat — the tool-use loop (plan §7.2), streamed as SSE
// ─────────────────────────────────────────────────────────────────────────────
function sanitizeHistory(rows) {
  const out = [];
  for (const r of rows) {
    if (r.role !== 'user' && r.role !== 'assistant') continue;
    const blocks = (Array.isArray(r.content) ? r.content : [{ type: 'text', text: String(r.text || '') }]).filter(b => b?.type === 'text' && b.text && b.text.trim());
    if (!blocks.length) continue;
    const last = out[out.length - 1];
    if (last && last.role === r.role) last.content.push(...blocks); else out.push({ role: r.role, content: blocks });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (out.length && out[out.length - 1].role === 'user') out.pop();          // the new user turn follows
  return out;
}

async function runChat(env, auth, body, message, send) {
  const context = body.context || {};
  const rt = makeRuntime(env, { hh: auth.hh, userId: auth.userId, personId: auth.personId, actor: 'ai', emit: send });
  const db = rt.db;
  let thread = null;
  if (isUuid(String(body.thread_id))) [thread] = await db.select('ai_threads', { id: body.thread_id });
  if (!thread) [thread] = await db.insert('ai_threads', { user_id: auth.userId, title: message.slice(0, 80) });
  await send('thread', { thread_id: thread.id });

  const ctx = await rt.getCtx();
  const [history, mem] = await Promise.all([
    db.select('ai_messages', { thread_id: thread.id, select: 'role,content,text', order: 'created_at.desc', limit: HISTORY_TURNS }),
    retrieveMemories(ctx, message, context.view),
  ]);
  const plan = planDay(ctx.today, ctx);
  const attention = needsAttention(ctx);
  const system = buildSystemPrompt({ ctx, plan, attention, memories: mem.memories, context });
  const messages = sanitizeHistory(history.reverse());
  messages.push({ role: 'user', content: [{ type: 'text', text: message }] });
  db.insert('ai_messages', { thread_id: thread.id, role: 'user', content: [{ type: 'text', text: message }], text: message }).catch(e => console.error('persist user', e.message));

  const usage = { input_tokens: 0, output_tokens: 0 };
  const toolCalls = [], texts = [];
  let finished = false;
  for (let i = 0; i < MAX_ITER; i++) {
    const msg = await streamAnthropic(env, { model: env.MODEL, system, messages, tools: TOOL_SCHEMAS, max_tokens: MAX_TOKENS }, delta => send('text', { delta }));
    usage.input_tokens += msg.usage.input_tokens || 0; usage.output_tokens += msg.usage.output_tokens || 0;
    for (const b of msg.content) if (b.type === 'text' && b.text) texts.push(b.text);
    const uses = msg.content.filter(b => b.type === 'tool_use');
    if (msg.stop_reason !== 'tool_use' || !uses.length) { finished = true; break; }
    messages.push({ role: 'assistant', content: msg.content });
    const results = [];
    for (const u of uses) {
      await send('tool', { name: u.name, status: 'start', summary: describeCall(u.name, u.input) });
      const result = await runTool(rt, u.name, u.input || {});
      toolCalls.push({ name: u.name, input: u.input, ok: !result?.error, error: result?.error || null });
      await send('tool', { name: u.name, status: 'done', summary: result?.error ? `Couldn't: ${result.error}` : describeResult(u.name, result) });
      results.push({ type: 'tool_result', tool_use_id: u.id, content: truncate(JSON.stringify(result)), ...(result?.error ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
  }
  if (!finished) { const t = 'I did what I could in this turn — the actions above went through; ask me to continue if something is still missing.'; texts.push(t); await send('text', { delta: t }); }

  const text = texts.join('\n').trim();
  await Promise.all([
    db.insert('ai_messages', { thread_id: thread.id, role: 'assistant', content: text ? [{ type: 'text', text }] : [], text, tool_calls: toolCalls, actions: rt.actions, tokens_in: usage.input_tokens, tokens_out: usage.output_tokens }).catch(e => console.error('persist assistant', e.message)),
    db.update('ai_threads', { id: thread.id }, { updated_at: nowIso() }).catch(() => {}),
    mem.stamp,
  ]);
  await send('done', { thread_id: thread.id, usage, actions: rt.actions, proposals: rt.proposals.map(p => pick(p, ['id', 'summary', 'tool'])) });
}

async function handleChat(req, env, auth, cors, waitUntil) {
  const body = await req.json().catch(() => ({}));
  const message = String(body.message || '').trim();
  if (!message) throw new HttpError(400, 'message is required');
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(500, 'ANTHROPIC_API_KEY is not configured');
  const { response, send, close } = sseStream(cors);
  const work = runChat(env, auth, body, message, send)
    .catch(e => { console.error('chat', e); return send('error', { message: e.message || String(e) }); })
    .finally(close);
  waitUntil(work);
  return response;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /confirm · POST /plan · POST /learn
// ─────────────────────────────────────────────────────────────────────────────
async function handleConfirm(req, env, auth) {
  const body = await req.json().catch(() => ({}));
  const p = await loadProposal(env, body.proposal_id);
  if (!p || p.hh !== auth.hh) throw new HttpError(404, 'Proposal not found or expired (10 min)');
  const rt = makeRuntime(env, { hh: auth.hh, userId: auth.userId, personId: auth.personId, actor: 'ai' });
  await rt.getCtx();
  const result = await runTool(rt, p.tool, p.input, { bypassConfirm: true });
  await dropProposal(env, p.id);
  if (result?.error) throw new HttpError(400, result.error);
  return { ok: true, proposal_id: p.id, tool: p.tool, action: rt.actions[0] || null, actions: rt.actions, result };
}

// Undo an action emitted by /chat: body is the `undo` descriptor ({op, table, id, patch?, also?}).
// Household-scoped by makeDb(env, hh); only whitelisted tables.
const UNDO_TABLES = new Set(Object.values(TABLE_OF).filter(t => t !== 'households'));
async function handleUndo(req, env, auth) {
  const body = await req.json().catch(() => ({}));
  const db = makeDb(env, auth.hh);
  const steps = [body, body.also].filter(Boolean);
  const done = [];
  for (const u of steps) {
    if (!u || !UNDO_TABLES.has(u.table) || !u.id) throw new HttpError(400, 'Bad undo descriptor');
    if (u.op === 'delete') await db.del(u.table, { id: u.id });
    else if (u.op === 'update' && u.patch && typeof u.patch === 'object') await db.update(u.table, { id: u.id }, u.patch);
    else throw new HttpError(400, 'Bad undo op');
    done.push(`${u.op} ${u.table}`);
  }
  try { await db.insert('activity_log', { actor: auth.personId || 'user', entity_type: body.table.replace(/s$/, ''), entity_id: body.id, action: 'undo', after: body, reason: 'undo ai action' }); } catch {}
  return { ok: true, done };
}

async function handlePlan(req, env, auth) {
  const body = await req.json().catch(() => ({}));
  const rt = makeRuntime(env, { hh: auth.hh, userId: auth.userId, personId: auth.personId, actor: 'ai' });
  const ctx = await rt.getCtx();
  const date = isDate(body.date) ? body.date : ctx.today;
  const plan = await schedulePlan(rt, date, { reason: 'plan' });
  return { ...plan, needs_attention: date === ctx.today ? needsAttention(ctx) : [], actions: rt.actions.length };
}

async function runPlanForHousehold(env, hh) {
  const rt = makeRuntime(env, { hh, actor: 'system' });
  const ctx = await rt.getCtx();
  const plan = await schedulePlan(rt, ctx.today, { reason: 'plan' });
  return { hh, date: plan.date, scheduled: plan.scheduled.length, must: plan.must.length, planned: plan.planned.length };
}

// Nightly pattern job (plan §4.2). Observed memories are upserted by (entity_type, entity_id, kind).
async function upsertMemory(db, m) {
  const conf = Number(Math.min(1, Math.max(0, m.confidence || 0.5)).toFixed(2));
  const [existing] = await db.select('memories', { entity_type: m.entity_type, entity_id: m.entity_id, kind: m.kind, status: 'neq.rejected', limit: 1 });
  if (existing) { await db.update('memories', { id: existing.id }, { content: m.content, confidence: conf, evidence_count: m.evidence_count, data: m.data, subject: m.subject, source: 'observed' }); return 'updated'; }
  await db.insert('memories', { ...m, confidence: conf, source: 'observed', status: 'active' });
  return 'created';
}

export async function runLearn(env, hh) {
  const db = makeDb(env, hh);
  const [house] = await db.select('households', { select: 'id,name,tz,settings' });
  if (!house) throw new HttpError(404, 'Household not found');
  const tz = house.tz || DEFAULT_TZ, today = D.todayIn(tz);
  const sinceIso = D.toISO(D.addDays(today, -120), '00:00', tz);
  const [done, rlogs, mlogs, waters, routines, rules, plants] = await Promise.all([
    db.select('tasks', { status: 'done', completed_at: `gte.${sinceIso}`, select: 'id,title,series_id,routine_id,completed_at,actual_min,duration_min,postponed', order: 'completed_at.desc', limit: 2000 }),
    db.select('routine_log', { done_at: `gte.${sinceIso}`, select: 'routine_id,done_at,duration_min', order: 'done_at.desc', limit: 2000 }),
    db.select('maintenance_log', { select: 'rule_id,done_at', order: 'done_at.asc', limit: 1000 }),
    db.select('plant_observations', { kind: 'in.(water,topoff)', select: 'plant_id,group_name,at', order: 'at.asc', limit: 2000 }),
    db.select('routines', {}), db.select('maintenance_rules', {}), db.select('plants', { archived: false }),
  ]);
  const summary = { household: hh, name: house.name, usual_day: 0, duration: 0, postpone: 0, weekend_capacity: null, maintenance: 0, plants: 0, memories: [] };
  const remember = async m => { const r = await upsertMemory(db, m); summary.memories.push(`${r}: ${m.content}`); };

  // group completions by task series / routine
  const groups = new Map();
  const add = (type, id, title, e) => { if (!id) return; const k = `${type}:${id}`; if (!groups.has(k)) groups.set(k, { type, id, title, entries: [] }); groups.get(k).entries.push(e); };
  const rname = id => routines.find(r => r.id === id)?.name || 'Routine';
  for (const t of done) {
    const e = { date: D.dateOf(t.completed_at, tz), actual: t.actual_min, est: t.duration_min, postponed: t.postponed || 0 };
    if (t.series_id) add('task_series', t.series_id, t.title, e);
    else if (t.routine_id) add('routine', t.routine_id, rname(t.routine_id), e);
  }
  for (const l of rlogs) add('routine', l.routine_id, rname(l.routine_id), { date: D.dateOf(l.done_at, tz), actual: l.duration_min, est: routines.find(r => r.id === l.routine_id)?.default_min, postponed: 0 });

  for (const g of groups.values()) {
    const recent = uniqBy(g.entries.sort((a, b) => D.cmp(b.date, a.date)), e => e.date + (e.actual ?? '')).slice(0, 12);
    const n = recent.length;
    const hist = {}; for (const e of recent) hist[D.dow(e.date)] = (hist[D.dow(e.date)] || 0) + 1;
    const [best, count] = Object.entries(hist).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    const share = n ? count / n : 0;
    const parts = [], data = {}; let conf = 0;
    if (n >= 4 && share >= 0.6) { data.usual_day = best; conf = share; parts.push(`${g.title} usually happens on ${D.dayName(recent.find(e => D.dow(e.date) === best).date)}s.`); summary.usual_day++; }
    if (g.type === 'task_series' && n >= 4) {
      const rate = recent.reduce((a, e) => a + (e.postponed > 0 ? 1 : 0), 0) / n;
      if (rate >= 0.5) { data.postpone_rate = Number(rate.toFixed(2)); conf = Math.max(conf, 0.7); parts.push(`${g.title} tends to get postponed (${Math.round(rate * 100)}% of recent instances).`); summary.postpone++; }
    }
    if (parts.length) await remember({ entity_type: g.type, entity_id: g.id, kind: 'pattern', subject: 'scheduling', content: parts.join(' '), confidence: conf, evidence_count: n, data });
    const actuals = recent.map(e => e.actual).filter(v => Number.isFinite(v) && v > 0);
    const est = recent.find(e => e.est)?.est;
    if (actuals.length >= 3 && est) {
      const med = trimmedMedian(actuals);
      if (Math.abs(med - est) / est > 0.25) {
        const rounded = Math.round(med);
        await remember({ entity_type: g.type, entity_id: g.id, kind: 'stat', subject: 'scheduling', content: `${g.title} really takes about ${rounded} minutes (the estimate was ${est}).`, confidence: 0.8, evidence_count: actuals.length, data: { median_min: rounded, estimate_min: est } });
        if (g.type === 'task_series') await db.update('tasks', { series_id: g.id, status: 'open' }, { duration_min: rounded }).catch(() => {});
        else await db.update('routines', { id: g.id }, { default_min: rounded }).catch(() => {});
        summary.duration++;
      }
    }
  }

  // weekend capacity: minutes actually completed per Sat/Sun over the last 6 weekends
  const perDay = {};
  for (const t of done) { const d = D.dateOf(t.completed_at, tz); perDay[d] = (perDay[d] || 0) + (t.actual_min || t.duration_min || 30); }
  for (const l of rlogs) { const d = D.dateOf(l.done_at, tz); perDay[d] = (perDay[d] || 0) + (l.duration_min || 0); }
  const weekendDays = dateRange(D.addDays(today, -42), D.addDays(today, -1), 42).filter(D.isWeekend);
  const values = weekendDays.map(d => perDay[d] || 0).filter(v => v > 0);
  if (values.length) {
    const med = Math.round(median(values));
    const settings = { ...(house.settings || {}), learned_weekend_capacity: { minutes: med, n: values.length, updated: today } };
    await db.update('households', { id: hh }, { settings });
    await remember({ entity_type: 'household', entity_id: hh, kind: 'stat', subject: 'scheduling', content: `On weekend days about ${med} minutes of tasks actually get done (median of the last ${values.length} active weekend days).`, confidence: values.length >= 6 ? 0.8 : 0.5, evidence_count: values.length, data: { weekend_capacity_min: med } });
    summary.weekend_capacity = { minutes: med, n: values.length };
  }

  // real maintenance intervals (memory only; needs confirmation)
  const byRule = {}; for (const l of mlogs) if (l.rule_id) (byRule[l.rule_id] ||= []).push(l.done_at);
  for (const [ruleId, dates] of Object.entries(byRule)) {
    const ds = uniqBy(dates.sort(), x => x);
    const gaps = ds.slice(1).map((d, i) => D.diffDays(ds[i], d)).filter(g => g > 0);
    const rule = rules.find(r => r.id === ruleId);
    if (gaps.length < 2 || !rule) continue;
    const med = Math.round(median(gaps));
    await remember({ entity_type: 'maintenance_rule', entity_id: ruleId, kind: 'stat', subject: 'home', content: `${rule.name} has actually been done about every ${med} days (the rule says ${rule.interval_days}). Confirm to change the interval.`, confidence: 0.6, evidence_count: gaps.length, data: { interval_days: med, current_interval_days: rule.interval_days, needs_confirmation: true } });
    summary.maintenance++;
  }

  // plant watering intervals → plants.water_interval_days + memory
  for (const p of plants) {
    const mine = waters.filter(o => o.plant_id === p.id || (o.group_name && o.group_name === p.group_name));
    const ds = uniqBy(mine.map(o => D.dateOf(o.at, tz)).sort(), x => x);
    const gaps = ds.slice(1).map((d, i) => D.diffDays(ds[i], d)).filter(g => g > 0);
    if (gaps.length < 3) continue;
    const med = Math.round(median(gaps));
    if (p.water_interval_days !== med) await db.update('plants', { id: p.id }, { water_interval_days: med });
    await remember({ entity_type: 'plant', entity_id: p.id, kind: 'stat', subject: 'plants', content: `${p.name} gets watered about every ${med} days.`, confidence: Math.min(0.9, 0.5 + gaps.length * 0.05), evidence_count: gaps.length, data: { water_interval_days: med } });
    summary.plants++;
  }
  return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron + router
// ─────────────────────────────────────────────────────────────────────────────
async function runCron(env, cron) {
  const households = await makeDb(env).select('households', { select: 'id,name' });
  const job = cron === '30 4 * * *' ? 'learn' : 'plan';
  const results = await Promise.allSettled(households.map(h => (job === 'learn' ? runLearn(env, h.id) : runPlanForHousehold(env, h.id))));
  results.forEach((r, i) => { if (r.status === 'rejected') console.error(`cron ${job} ${households[i].id}:`, r.reason?.message || r.reason); });
  console.log(`cron ${job}: ${results.filter(r => r.status === 'fulfilled').length}/${households.length} households ok`);
}

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
    try {
      if (req.method === 'GET' && (path === '/health' || path === '/')) return json({ ok: true, model: env.MODEL || null, time: nowIso() }, 200, cors);
      if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
      if (!['/chat', '/confirm', '/undo', '/plan', '/learn'].includes(path)) throw new HttpError(404, 'Not found');
      const auth = await authenticate(req, env);
      await rateLimit(env, auth.userId);
      if (path === '/chat') return await handleChat(req, env, auth, cors, p => ctx.waitUntil(p));
      if (path === '/confirm') return json(await handleConfirm(req, env, auth), 200, cors);
      if (path === '/undo') return json(await handleUndo(req, env, auth), 200, cors);
      if (path === '/plan') return json(await handlePlan(req, env, auth), 200, cors);
      return json(await runLearn(env, auth.hh), 200, cors);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      return json({ error: e.message || 'Internal error' }, status, cors);
    }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(runCron(env, event.cron)); },
};
