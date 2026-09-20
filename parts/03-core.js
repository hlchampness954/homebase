<script type="module">
// ═══════════════════════════════════════════════════════════════════════════
// HomeBase v2 — app
// Sections: config · utils · store · backend (supabase | demo) · auth · shell
//           today · tasks · home · projects · calendar · settings · ai · wall
// ═══════════════════════════════════════════════════════════════════════════
import * as D from './shared/dates.js';
import * as R from './shared/recurrence.js';
import * as P from './shared/planner.js';
import * as AT from './shared/attachments.js';

// ─── CONFIG ────────────────────────────────────────────────────────────────
const qs = new URLSearchParams(location.search);
const DEMO = qs.get('demo') === '1' || localStorage.getItem('hb_demo') === '1';
const WALL_START = qs.get('wall') === '1';
const CFG = {
  supabaseUrl: localStorage.getItem('hb_sb_url') || (window.HB_CONFIG && HB_CONFIG.supabaseUrl) || '',
  supabaseAnonKey: localStorage.getItem('hb_sb_key') || (window.HB_CONFIG && HB_CONFIG.supabaseAnonKey) || '',
  workerUrl: (localStorage.getItem('hb_worker_url') || (window.HB_CONFIG && HB_CONFIG.workerUrl) || '').replace(/\/$/, ''),
};
const TABLES = ['people','areas','rooms','projects','project_steps','project_costs','pets','assets','maintenance_rules','maintenance_log',
  'routines','routine_log','tasks','events','plants','plant_observations','pet_activities','lists','list_items','notes','day_modes','memories','activity_log',
  'files','file_links','task_assignments','household_devices'];
const DEVICE_KEY = localStorage.getItem('hb_device_key') || (() => { const k = uuidLite(); localStorage.setItem('hb_device_key', k); return k; })();
function uuidLite() { return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x'?r:(r&3|8)).toString(16); }); }

// ─── UTILS ─────────────────────────────────────────────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x'?r:(r&3|8)).toString(16); });
const isPhone = () => matchMedia('(max-width:767px)').matches;
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v); else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
};
const svgChev = () => { const s = document.createElementNS('http://www.w3.org/2000/svg','svg'); s.setAttribute('viewBox','0 0 24 24'); s.setAttribute('class','chev'); s.innerHTML = '<path d="M9 6l6 6-6 6"/>'; return s; };
const svgCheck = () => { const s = document.createElementNS('http://www.w3.org/2000/svg','svg'); s.setAttribute('viewBox','0 0 24 24'); s.innerHTML = '<path d="M5 12l5 5L20 7"/>'; return s; };
let toastTimer;
function toast(msg, undo) {
  const t = $('#toast'); t.innerHTML = esc(msg);
  if (undo) { const b = h('button', { onclick: () => { undo(); t.classList.remove('show'); } }, 'Undo'); t.append(b); }
  t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), undo ? 5000 : 2400);
}
const money = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const mins = m => !m ? '' : m < 60 ? `${m}m` : (m % 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m/60}h`);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
function confKey(c) { return c >= 0.95 ? 'sure' : c >= 0.7 ? 'likely' : 'guess'; }
function confLabel(c) { return { sure: 'Sure', likely: 'Likely', guess: 'Guess' }[confKey(c)]; }

// ─── STORE ─────────────────────────────────────────────────────────────────
const S = {
  hh: null, tz: 'America/Chicago', settings: {}, household: null, person: null, me: null, user: null, session: null, people: [],
  // person lens (spec §12): S.person = the active person for this device (null = Household); S.me = the person tied to the login
  scope: localStorage.getItem('hb_scope') || 'mine',                  // mine | household | all
  data: Object.fromEntries(TABLES.map(t => [t, new Map()])),
  weather: {}, listeners: new Set(),
  get(t, id) { return this.data[t].get(id); },
  all(t) { return [...this.data[t].values()]; },
  put(t, row) { this.data[t].set(row.id, row); },
  remove(t, id) { this.data[t].delete(id); },
  today() { return D.todayIn(this.tz); },
  now() { return D.nowHM(this.tz); },
};
// Who owns / helps with a task (task_assignments first, legacy assignee_id as fallback)
function taskPeople(t) { const a = S.all('task_assignments').filter(x => x.task_id === t.id).map(x => x.person_id); if (!a.length && t.assignee_id) a.push(t.assignee_id); return a; }
function isMine(t, person = S.person) { if (!person) return true; const ppl = taskPeople(t); return !ppl.length || ppl.includes(person.id); }   // unassigned = anyone's
function inScope(t) { if (!S.person || S.scope !== 'mine') return true; return isMine(t); }
function setActivePerson(id) {
  S.person = id ? S.people.find(p => p.id === id) || null : null;
  localStorage.setItem('hb_person', id || 'household');
  if (!DEMO && S.hh) api.deviceSync().catch(() => {});
  emit('people');
}
function setScope(v) { S.scope = v; localStorage.setItem('hb_scope', v); emit('tasks'); }
function resolveActivePerson() {
  const saved = localStorage.getItem('hb_person');
  if (WALL_START || localStorage.getItem('hb_device_kind') === 'wall') { if (!saved) return null; }
  if (saved === 'household') return null;
  return S.people.find(p => p.id === saved) || S.me || S.people.find(p => p.is_user) || null;
}
const changed = new Set(); let flushTimer;
function emit(table) { changed.add(table); clearTimeout(flushTimer); flushTimer = setTimeout(() => { const c = new Set(changed); changed.clear(); for (const l of S.listeners) l(c); }, 30); }
function onChange(fn) { S.listeners.add(fn); return () => S.listeners.delete(fn); }

// planner context from the store
function ctx() {
  const today = S.today();
  const plants = S.all('plants').map(p => {
    const obs = S.all('plant_observations').filter(o => o.plant_id === p.id).sort((a, b) => b.at.localeCompare(a.at));
    const w = obs.find(o => o.kind === 'water' || o.kind === 'topoff');
    return { ...p, last_water: w ? D.dateOf(w.at, S.tz) : null, last_observation: obs[0] ? D.dateOf(obs[0].at, S.tz) : null };
  });
  return {
    today, now: S.now(), tz: S.tz, settings: S.settings,
    tasks: S.all('tasks').filter(inScope), events: S.all('events'), routines: S.all('routines'), maintenance: S.all('maintenance_rules'),
    person: S.person, scope: S.scope,
    projects: S.all('projects'), steps: S.all('project_steps'), dayModes: S.all('day_modes'), memories: S.all('memories'),
    weather: S.weather, plants,
  };
}
const areaOf = id => S.get('areas', id);
const projOf = id => S.get('projects', id);
const personOf = id => S.get('people', id);
const areaLabel = id => { const a = areaOf(id); return a ? `${a.emoji || ''} ${a.name}`.trim() : ''; };

// ─── BACKEND: SUPABASE ─────────────────────────────────────────────────────
let sb = null, realtime = null;
function setSync(state, label) { const d = $('#sync-dot'); if (d) d.className = 'dot ' + state; const l = $('#sync-lbl'); if (l) l.textContent = label; }

const supa = {
  async init() {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    sb = createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    return sb;
  },
  async load() {
    setSync('syn', 'Loading…');
    const since = D.addDays(S.today(), -400);
    const q = t => {
      let r = sb.from(t).select('*').eq('household_id', S.hh);
      if (t === 'activity_log') r = r.order('at', { ascending: false }).limit(400);
      if (t === 'maintenance_log') r = r.gte('done_at', since);
      if (t === 'routine_log' || t === 'plant_observations' || t === 'pet_activities') r = r.gte(t === 'routine_log' ? 'done_at' : 'at', since + 'T00:00:00Z');
      if (t === 'tasks') r = r.or(`status.eq.open,completed_at.gte.${since}T00:00:00Z`);
      if (t === 'events') r = r.gte('starts_at', D.addDays(S.today(), -120) + 'T00:00:00Z');
      return r;
    };
    const res = await Promise.all(TABLES.map(t => q(t)));
    res.forEach((r, i) => { if (r.error) console.warn(TABLES[i], r.error.message); S.data[TABLES[i]] = new Map((r.data || []).map(x => [x.id, x])); });
    S.people = S.all('people').sort((a, b) => a.sort - b.sort);
    setSync('ok', 'Synced');
  },
  subscribe() {
    if (realtime) sb.removeChannel(realtime);
    realtime = sb.channel('hh-' + S.hh);
    for (const t of TABLES) realtime.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `household_id=eq.${S.hh}` }, p => {
      if (p.eventType === 'DELETE') S.remove(t, p.old.id); else S.put(t, p.new);
      if (t === 'people') S.people = S.all('people').sort((a, b) => a.sort - b.sort);
      emit(t);
    });
    realtime.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${S.hh}` }, p => { S.household = p.new; S.settings = p.new.settings || {}; emit('households'); });
    realtime.subscribe(st => setSync(st === 'SUBSCRIBED' ? 'ok' : st === 'CHANNEL_ERROR' ? 'err' : 'syn', st === 'SUBSCRIBED' ? 'Live' : st === 'CHANNEL_ERROR' ? 'Offline' : 'Connecting'));
  },
  async insert(t, row) { const { error } = await sb.from(t).insert(row); if (error) throw error; },
  async update(t, id, patch) { const { error } = await sb.from(t).update(patch).eq('id', id); if (error) throw error; },
  async remove(t, id) { const { error } = await sb.from(t).delete().eq('id', id); if (error) throw error; },
  async updateHousehold(patch) { const { error } = await sb.from('households').update(patch).eq('id', S.hh); if (error) throw error; },
  token() { return S.session?.access_token; },
  // ── attachments (spec §4): private bucket upload + files row; derivative JPEG for analysis/thumbnails
  async uploadFile(file, { source = 'upload', onState } = {}) {
    const ok = AT.allowed(file); if (!ok.ok) throw new Error(ok.reason);
    const id = uuid(); const mime = AT.mimeOf(file); const ext = AT.safeExt(file);
    const path = AT.storagePath(S.hh, id, ext);
    onState?.('uploading');
    const [buf, deriv] = await Promise.all([file.arrayBuffer(), AT.isImage(mime) ? AT.makeDerivative(file) : null]);
    const sha = await AT.sha256Hex(buf);
    const up = await sb.storage.from('household-media').upload(path, buf, { contentType: mime, upsert: false, cacheControl: '3600' });
    if (up.error) throw new Error(up.error.message);
    const meta = { device_key: DEVICE_KEY };
    if (deriv) { const dpath = AT.storagePath(S.hh, id + '-a', 'jpg'); const d = await sb.storage.from('household-media').upload(dpath, deriv.blob, { contentType: 'image/jpeg', upsert: false }); if (!d.error) { meta.derivative_path = dpath; meta.derivative_mime = 'image/jpeg'; meta.derivative_size = deriv.blob.size; } }
    const row = { id, storage_path: path, kind: AT.kindFor(mime, file.name), original_name: file.name || `${source}.${ext}`, mime_type: mime, size_bytes: file.size, sha256: sha, width: deriv?.srcWidth || null, height: deriv?.srcHeight || null, source, processing_status: 'ready', metadata: meta, created_by: S.user?.id || null, taken_at: file.lastModified ? new Date(file.lastModified).toISOString() : null };
    const { data, error } = await sb.from('files').insert({ household_id: S.hh, ...row }).select().single();
    if (error) { await sb.storage.from('household-media').remove([path]).catch(() => {}); throw error; }
    S.put('files', data); emit('files');
    onState?.('ready');
    return data;
  },
  _urls: new Map(),
  async signedUrl(path, ttl = 3600) {
    const c = this._urls.get(path); if (c && c.exp > Date.now() + 60000) return c.url;
    const { data, error } = await sb.storage.from('household-media').createSignedUrl(path, ttl); if (error) throw error;
    this._urls.set(path, { url: data.signedUrl, exp: Date.now() + ttl * 1000 }); return data.signedUrl;
  },
  async removeFile(f) { await sb.storage.from('household-media').remove([f.storage_path, f.metadata?.derivative_path].filter(Boolean)); const { error } = await sb.from('files').delete().eq('id', f.id); if (error) throw error; },
  // ── device profile (spec §12.1): which person this device defaults to
  async deviceSync() {
    const kind = localStorage.getItem('hb_device_kind') || (WALL_START ? 'wall' : 'personal');
    const row = { household_id: S.hh, device_key: DEVICE_KEY, label: localStorage.getItem('hb_device_label') || deviceLabel(), kind, default_person_id: S.person?.id || null, user_id: S.user?.id || null, last_seen_at: new Date().toISOString(), meta: { ua: navigator.userAgent.slice(0, 160), platform: navigator.platform || '' } };
    const { error } = await sb.from('household_devices').upsert(row, { onConflict: 'household_id,device_key' }); if (error) console.warn('device', error.message);
  },
};
function deviceLabel() { const ua = navigator.userAgent; const dev = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows PC' : /Mac/.test(ua) ? 'Mac' : 'Device'; return `${dev}${WALL_START ? ' (wall)' : ''}`; }

// ─── BACKEND: DEMO (no network; realistic seed for previews) ───────────────
const demo = {
  async init() { return null; },
  async load() { demoSeed(); setSync('off', 'Demo'); },
  subscribe() {},
  async insert() {}, async update() {}, async remove() {}, async updateHousehold(p) { Object.assign(S.household, p); },
  token() { return 'demo'; },
  async uploadFile(file, { source = 'upload' } = {}) { const mime = AT.mimeOf(file); const row = { id: uuid(), household_id: 'demo', storage_path: 'demo/' + file.name, kind: AT.kindFor(mime, file.name), original_name: file.name, mime_type: mime, size_bytes: file.size, source, processing_status: 'ready', metadata: {}, created_at: new Date().toISOString(), _blob: file }; S.put('files', row); emit('files'); return row; },
  async signedUrl(path) { const f = S.all('files').find(x => x.storage_path === path); return f?._blob ? URL.createObjectURL(f._blob) : ''; },
  async removeFile(f) { S.remove('files', f.id); emit('files'); },
  async deviceSync() {},
};
function demoSeed() {
  const T = S.today(), hh = 'demo';
  const id = () => uuid();
  const add = (t, row) => { const r = { id: id(), household_id: hh, created_at: new Date().toISOString(), ...row }; S.put(t, r); return r; };
  const luke = add('people', { name: 'Luke', is_user: true, sort: 0, color: 'accent' });
  const hayley = add('people', { name: 'Hayley', is_user: true, sort: 1, color: 'violet' });
  const ruby = add('pets', { name: 'Ruby', species: 'dog' });
  const A = {};
  [['Kitchen','room','🍳'],['Living Room','room','🛋️'],['Master Bedroom','room','🛏️'],['Nursery','room','🧸'],['Laundry','room','🧺'],['Garage','room','🚗'],['Yard & Patio','room','🌿'],['Whole House','room','🏠'],
   ['Relationship','relationship','💛'],['Family','life','👨‍👩‍👧'],['Errands','life','🛒'],['Ruby','life','🐾'],['Plants & Hydro','life','🌱']].forEach(([n,k,e],i) => A[n] = add('areas', { name: n, kind: k, emoji: e, sort: i }));
  const pN = add('projects', { name: 'Nursery', priority: 1, status: 'active', stage: 'Paint', area_id: A['Nursery'].id, description: 'Get the nursery ready before the due date.', budget: 1800, target_date: D.addDays(T, 45) });
  const nSteps = ['Clear room & protect floor','Patch and sand walls','Prime walls','Paint walls (2 coats)','Paint trim & door','Install crib','Dresser / changing station','Blackout curtains & rod','Decor, shelves, night light'];
  let prev = null;
  nSteps.forEach((t, i) => { const s = add('project_steps', { project_id: pN.id, title: t, phase: i < 2 ? 'Prep' : i < 5 ? 'Paint' : i < 8 ? 'Furnish' : 'Finish', sort: i, status: i < 2 ? 'done' : 'todo', done_at: i < 2 ? D.toISO(D.addDays(T, -6 + i), '11:00', S.tz) : null, est_min: [60,120,120,240,120,60,60,45,90][i], depends_on: prev ? [prev] : [] }); prev = s.id; });
  add('project_costs', { project_id: pN.id, item: 'Primer (2 gal)', qty: '2', projected: 60, actual: 58 });
  add('project_costs', { project_id: pN.id, item: 'Paint — BM Chantilly Lace', qty: '2 gal', projected: 140, actual: null });
  add('project_costs', { project_id: pN.id, item: 'Crib', qty: '1', projected: 450, actual: 429 });
  const pP = add('projects', { name: 'Paver Patio + French Drain', priority: 2, status: 'active', stage: 'Planning', area_id: A['Yard & Patio'].id, description: 'Drainage and patio as one dependency-driven project.', budget: 6500 });
  const ps = ['Excavation','Drainage planning (slopes, outlet)','French drain trench, pipe, fabric, gravel','Downspout connections','Grading','Base preparation (fabric + road base)','Compaction','Lay pavers','Edging','Gravel / landscaping','Finish work & cleanup'];
  const pids = []; ps.forEach((t, i) => { const dep = i === 0 ? [] : i === 1 ? [] : i === 2 ? [pids[0], pids[1]] : [pids[i-1]]; const s = add('project_steps', { project_id: pP.id, title: t, phase: i < 1 ? 'Site' : i < 4 ? 'Drainage' : i < 7 ? 'Base' : i < 9 ? 'Surface' : 'Finish', sort: i, status: 'todo', est_min: [480,90,480,180,240,360,120,600,120,240,120][i], depends_on: dep }); pids.push(s.id); });
  const asH = add('assets', { name: 'House HVAC', emoji: '🌬️', area_id: A['Whole House'].id, brand: 'Carrier', consumables: [{ name: 'Return filter', spec: '16×25×1 MERV-11' }] });
  const asP = add('assets', { name: 'Indoor air purifier', emoji: '💨', area_id: A['Living Room'].id, consumables: [{ name: 'Filter', spec: 'capture from nameplate' }] });
  const asA = add('assets', { name: 'AC condensate drain', emoji: '💧', area_id: A['Whole House'].id });
  add('maintenance_rules', { asset_id: asH.id, name: 'Replace house HVAC filter', interval_days: 90, importance: 'must', last_done_at: D.addDays(T, -96), next_due: D.addDays(T, -6), instructions: 'Arrows point toward the blower.' });
  add('maintenance_rules', { asset_id: asP.id, name: 'Replace air purifier filter', interval_days: 180, importance: 'should', last_done_at: D.addDays(T, -120), next_due: D.addDays(T, 60) });
  add('maintenance_rules', { asset_id: asA.id, name: 'Flush AC condensate drain', interval_days: 30, importance: 'should', season_months: [4,5,6,7,8,9,10], last_done_at: D.addDays(T, -25), next_due: D.addDays(T, 5) });
  add('maintenance_log', { asset_id: asH.id, done_at: D.addDays(T, -96), note: 'MERV-11' });
  const rt = (row) => add('routines', row);
  const rRuby = rt({ name: 'Ruby training', emoji: '🐾', area_id: A['Ruby'].id, pet_id: ruby.id, cadence: { freq: 'daily' }, min_version: '3-minute session', default_min: 10, importance: 'should', location: 'anywhere', last_done_at: D.toISO(D.addDays(T, -1), '19:10', S.tz), streak: 4 });
  rt({ name: 'Daily household reset', emoji: '🧹', area_id: A['Whole House'].id, cadence: { freq: 'daily', after: '19:00' }, min_version: 'Kitchen only', default_min: 15, importance: 'should', last_done_at: D.toISO(D.addDays(T, -1), '20:30', S.tz) });
  rt({ name: 'Flowers for Hayley', emoji: '💐', area_id: A['Relationship'].id, cadence: { freq: 'weekly', prefer: ['thu','fri'] }, default_min: 20, importance: 'should', location: 'away', last_done_at: D.toISO(D.addDays(T, -9), '17:30', S.tz) });
  rt({ name: 'Mow the grass', emoji: '🌱', area_id: A['Yard & Patio'].id, cadence: { freq: 'weekly', byweekday: ['sat','sun'] }, default_min: 60, importance: 'should', weather_dependent: true, last_done_at: D.toISO(D.addDays(T, -9), '09:00', S.tz) });
  rt({ name: 'Trash out', emoji: '🗑️', area_id: A['Whole House'].id, cadence: { freq: 'weekly', byweekday: ['wed'], after: '17:00', backup: { byweekday: ['thu'], before: '09:00' } }, default_min: 5, importance: 'must', last_done_at: D.toISO(D.addDays(T, -3), '20:00', S.tz) });
  rt({ name: 'Hydroponics check', emoji: '💧', area_id: A['Plants & Hydro'].id, cadence: { freq: 'daily', interval: 3, anchor: 'completion' }, min_version: 'Water level glance', default_min: 10, last_done_at: D.toISO(D.addDays(T, -3), '18:00', S.tz) });
  rt({ name: 'Outdoor plant check', emoji: '🪴', area_id: A['Plants & Hydro'].id, cadence: { freq: 'daily', interval: 4, anchor: 'completion' }, default_min: 10, weather_dependent: true, last_done_at: D.toISO(D.addDays(T, -2), '18:00', S.tz) });
  rt({ name: 'Date night', emoji: '🍷', area_id: A['Relationship'].id, cadence: { freq: 'monthly', nudge_after_day: 15 }, default_min: 180, location: 'away', last_done_at: D.toISO(D.addMonths(T, -1), '19:00', S.tz) });
  const tk = (row) => add('tasks', { status: 'open', importance: 'should', location: 'home', energy: 'med', source: 'user', postponed: 0, ...row });
  tk({ title: 'Buy primer and rollers', importance: 'should', due_date: D.addDays(T, 1), duration_min: 30, location: 'away', area_id: A['Errands'].id, project_id: pN.id, assignee_id: luke.id });
  tk({ title: 'Call about crib delivery window', importance: 'must', due_date: T, duration_min: 10, location: 'anywhere', project_id: pN.id });
  tk({ title: 'Renew car registration', importance: 'must', due_date: D.addDays(T, 4), duration_min: 15, location: 'anywhere', area_id: A['Errands'].id });
  tk({ title: 'Return Amazon package', importance: 'should', due_date: D.addDays(T, 2), duration_min: 20, location: 'away', area_id: A['Errands'].id, assignee_id: hayley.id });
  tk({ title: 'Wash bed linens', importance: 'should', duration_min: 20, area_id: A['Master Bedroom'].id, recurrence: { freq: 'weekly', byweekday: ['sat'] }, series_id: id(), due_date: D.addDays(T, 1) });
  tk({ title: 'Grocery run', importance: 'should', duration_min: 60, location: 'away', area_id: A['Errands'].id, due_date: D.addDays(T, 1), recurrence: { freq: 'weekly' }, series_id: id() });
  tk({ title: 'Tidy garage', importance: 'nice', duration_min: 90, area_id: A['Garage'].id });
  tk({ title: 'Go through old boxes', importance: 'nice', duration_min: 60, area_id: A['Garage'].id, energy: 'low' });
  tk({ title: 'Sort, donate or discard unneeded items', importance: 'nice', duration_min: 60, area_id: A['Garage'].id });
  tk({ title: 'Book Ruby’s annual vet visit', importance: 'should', due_date: D.addDays(T, 10), duration_min: 10, location: 'anywhere', area_id: A['Ruby'].id });
  tk({ title: 'Fix loose fence board', importance: 'should', duration_min: 45, area_id: A['Yard & Patio'].id, weather_dependent: true, window_start: T, window_end: D.addDays(T, 6) });
  for (let i = 1; i <= 12; i++) tk({ title: ['Vacuum living room','Mop kitchen','Clean bathrooms','Dust shelves'][i % 4], status: 'done', completed_at: D.toISO(D.addDays(T, -i * 2), '18:30', S.tz), duration_min: 30, actual_min: 25 + (i % 3) * 10, area_id: A['Whole House'].id });
  add('events', { title: 'Dentist — Luke', kind: 'fixed', starts_at: D.toISO(D.addDays(T, 2), '14:00', S.tz), ends_at: D.toISO(D.addDays(T, 2), '15:00', S.tz), color: 'sky' });
  add('events', { title: 'Dinner with the Millers', kind: 'fixed', starts_at: D.toISO(D.addDays(T, 5), '18:30', S.tz), ends_at: D.toISO(D.addDays(T, 5), '21:00', S.tz), color: 'violet' });
  add('events', { title: 'Team offsite', kind: 'fixed', starts_at: D.toISO(D.addDays(T, 8), '09:00', S.tz), ends_at: D.toISO(D.addDays(T, 8), '17:00', S.tz), color: 'sky' });
  add('events', { title: 'Lunch', kind: 'fixed', starts_at: D.toISO(T, '12:00', S.tz), ends_at: D.toISO(T, '13:00', S.tz), color: 'sky' });
  add('plants', { name: 'Rosemary', species: 'Salvia rosmarinus', kind: 'outdoor', location: 'Back porch', container: '12" terracotta', water_interval_days: 5 });
  add('plants', { name: 'Blueberries', kind: 'outdoor', location: 'Side yard', container: 'Half barrel ×2', water_interval_days: 3 });
  add('plants', { name: 'Lettuce (hydro)', kind: 'hydroponic', group_name: 'Hydro unit 1' });
  add('plant_observations', { plant_id: S.all('plants')[0].id, at: D.toISO(D.addDays(T, -6), '18:00', S.tz), kind: 'water', soil_state: 'dry' });
  add('plant_observations', { plant_id: S.all('plants')[1].id, at: D.toISO(D.addDays(T, -1), '18:00', S.tz), kind: 'water' });
  add('pet_activities', { pet_id: ruby.id, at: D.toISO(D.addDays(T, -1), '19:10', S.tz), kind: 'training', duration_min: 10, focus: 'recall' });
  add('pet_activities', { pet_id: ruby.id, at: D.toISO(D.addDays(T, -2), '19:00', S.tz), kind: 'training', duration_min: 8, focus: 'heel' });
  const gl = add('lists', { name: 'Groceries', kind: 'shopping' }); add('lists', { name: 'Hardware / Project', kind: 'shopping' });
  ['Milk','Eggs','Coffee','Dog food'].forEach((t, i) => add('list_items', { list_id: gl.id, text: t, sort: i }));
  add('notes', { title: "Mike's Plumbing", body: 'Reliable, $95/hr, did the water heater in 2025', vendor: true, phone: '(830) 555-0142' });
  add('notes', { title: 'Nursery paint', body: 'Walls: BM Chantilly Lace OC-65 eggshell · Trim: same, semi-gloss', project_id: pN.id });
  add('notes', { title: 'Lawn guy — Pedro', body: 'Backup mowing when traveling', vendor: true, phone: '(830) 555-0199' });
  const mem = (subject, kind, content, source = 'stated', confidence = 0.9, extra = {}) => add('memories', { subject, kind, content, source, confidence, evidence_count: 1, status: 'active', ...extra });
  mem('scheduling','preference','House projects usually happen on Saturday mornings.');
  mem('scheduling','preference','Trash goes out Wednesday night; Thursday morning is only a backup check.', 'stated', 0.95);
  mem('family','preference','Flowers for Hayley weekly, normally bought near the end of the week.');
  mem('family','preference','At least one intentional date night every month.', 'stated', 0.95);
  mem('projects','fact','Project priorities: 1) Nursery, 2) Paver Patio + French Drain.', 'stated', 1);
  mem('pets','preference','Ruby should get some intentional training every day, even if short.');
  mem('scheduling','pattern','Mowing has happened on Saturday 5 of the last 6 times.', 'observed', 0.83, { evidence_count: 6, entity_type: 'routine', entity_id: S.all('routines').find(r => r.name.startsWith('Mow')).id, data: { usual_day: 'sat' } });
  mem('home','stat','"Vacuum living room" usually takes about 35 minutes (estimate was 30).', 'observed', 0.7, { evidence_count: 4 });
  mem('plants','pattern','The rosemary dries out about every 5 days in summer.', 'observed', 0.75, { evidence_count: 5 });
  add('activity_log', { at: D.toISO(D.addDays(T, -1), '19:10', S.tz), actor: luke.id, entity_type: 'routine', action: 'log', after: { name: 'Ruby training' } });
  S.people = S.all('people').sort((a, b) => a.sort - b.sort);
  S.household = { id: hh, name: 'The Champness House', tz: S.tz, invite_code: 'DEMO1234', settings: {} };
  S.settings = { weather: { lat: 29.703, lon: -98.124, label: 'New Braunfels, TX' } };
  S.person = luke; S.hh = hh;
  S.weather = { [T]: { rain_prob: 10, tmax_f: 91, precip_in: 0 }, [D.addDays(T,1)]: { rain_prob: 65, tmax_f: 84, precip_in: 0.4 }, [D.addDays(T,2)]: { rain_prob: 20, tmax_f: 88, precip_in: 0 } };
}

let api = DEMO ? demo : supa;

// ─── DATA MUTATIONS (optimistic, logged) ───────────────────────────────────
async function dbInsert(t, row, opts = {}) {
  const r = { id: uuid(), household_id: S.hh, created_at: new Date().toISOString(), ...row };
  S.put(t, r); emit(t);
  try { await api.insert(t, stripLocal(r)); if (!opts.silent) logAct(t, r.id, 'create', null, r, opts.reason); }
  catch (e) { S.remove(t, r.id); emit(t); toast('Save failed: ' + e.message); throw e; }
  return r;
}
async function dbUpdate(t, id, patch, opts = {}) {
  const before = S.get(t, id); if (!before) return;
  const after = { ...before, ...patch }; S.put(t, after); emit(t);
  try { await api.update(t, id, patch); if (!opts.silent) logAct(t, id, opts.action || 'update', pick(before, Object.keys(patch)), patch, opts.reason); }
  catch (e) { S.put(t, before); emit(t); toast('Save failed: ' + e.message); throw e; }
  return after;
}
async function dbRemove(t, id, opts = {}) {
  const before = S.get(t, id); if (!before) return;
  S.remove(t, id); emit(t);
  try { await api.remove(t, id); if (!opts.silent) logAct(t, id, 'delete', before, null, opts.reason); }
  catch (e) { S.put(t, before); emit(t); toast('Delete failed: ' + e.message); throw e; }
}
function pick(o, keys) { const r = {}; for (const k of keys) r[k] = o[k]; return r; }
function stripLocal(r) { const c = { ...r }; for (const k of Object.keys(c)) if (k.startsWith('_')) delete c[k]; return c; }
function logAct(entity_type, entity_id, action, before, after, reason) {
  const row = { id: uuid(), household_id: S.hh, at: new Date().toISOString(), actor: S.person?.id || 'user', entity_type, entity_id, action, before, after, reason: reason || null };
  S.put('activity_log', row);
  api.insert('activity_log', row).catch(() => {});
}

// task lifecycle -----------------------------------------------------------
async function completeTask(id, { actual_min } = {}) {
  const t = S.get('tasks', id); if (!t || t.status !== 'open') return;
  const now = new Date().toISOString();
  await dbUpdate('tasks', id, { status: 'done', completed_at: now, actual_min: actual_min ?? null }, { action: 'complete' });
  let nextRow = null;
  if (t.recurrence) {
    const from = t.due_date || S.today();
    const next = R.nextOccurrence(t.recurrence, from < S.today() && R.normalizeRule(t.recurrence).anchor === 'completion' ? S.today() : from);
    nextRow = await dbInsert('tasks', { ...stripLocal(t), id: undefined, status: 'open', completed_at: null, actual_min: null, due_date: next, scheduled_start: null, scheduled_end: null, postponed: 0, original_date: null, series_id: t.series_id || t.id, created_at: undefined }, { silent: true });
  }
  if (t.routine_id) await logRoutine(t.routine_id, { fromTask: true });
  if (t.maintenance_rule_id) await recordMaintenance(t.maintenance_rule_id, { fromTask: true });
  toast(nextRow ? `Done · next ${D.humanDate(nextRow.due_date, S.today())}` : 'Done', async () => {
    await dbUpdate('tasks', id, { status: 'open', completed_at: null, actual_min: null }, { silent: true });
    if (nextRow) await dbRemove('tasks', nextRow.id, { silent: true });
  });
}
async function uncompleteTask(id) { await dbUpdate('tasks', id, { status: 'open', completed_at: null }, { action: 'reopen' }); }
async function postponeTask(id, to, reason) {
  const t = S.get('tasks', id); if (!t) return;
  await dbUpdate('tasks', id, { due_date: to, original_date: t.original_date || t.due_date || null, postponed: (t.postponed || 0) + 1, scheduled_start: null, scheduled_end: null }, { action: 'postpone', reason });
  toast(`Moved to ${D.humanDate(to, S.today())}`);
}
async function logRoutine(rid, { detail, duration_min, note, fromTask } = {}) {
  const r = S.get('routines', rid); if (!r) return;
  const now = new Date().toISOString();
  await dbInsert('routine_log', { routine_id: rid, done_at: now, duration_min: duration_min ?? r.default_min ?? null, detail: detail || null, note: note || null, by_person_id: S.person?.id || null }, { silent: true });
  const last = D.dateOf(r.last_done_at, S.tz); const gap = last ? D.diffDays(last, S.today()) : 99;
  const expected = R.expectedGapDays(r.cadence) || 1;
  await dbUpdate('routines', rid, { last_done_at: now, streak: gap <= expected + 1 ? (r.streak || 0) + 1 : 1 }, { action: 'log' });
  if (r.pet_id && !fromTask) await dbInsert('pet_activities', { pet_id: r.pet_id, at: now, kind: 'training', duration_min: duration_min ?? r.default_min ?? null, focus: detail?.focus || null, note: note || null, by_person_id: S.person?.id || null }, { silent: true });
  if (!fromTask) { const open = S.all('tasks').find(t => t.routine_id === rid && t.status === 'open'); if (open) await dbUpdate('tasks', open.id, { status: 'done', completed_at: now }, { silent: true }); toast(`Logged: ${r.name}`); }
}
async function recordMaintenance(mid, { done_at, note, cost, fromTask } = {}) {
  const m = S.get('maintenance_rules', mid); if (!m) return;
  const d = done_at || S.today();
  await dbInsert('maintenance_log', { rule_id: mid, asset_id: m.asset_id || null, done_at: d, note: note || null, cost: cost ?? null, by_person_id: S.person?.id || null }, { silent: true });
  await dbUpdate('maintenance_rules', mid, { last_done_at: d, next_due: D.addDays(d, m.interval_days) }, { action: 'log' });
  if (!fromTask) { const open = S.all('tasks').find(t => t.maintenance_rule_id === mid && t.status === 'open'); if (open) await dbUpdate('tasks', open.id, { status: 'done', completed_at: new Date().toISOString() }, { silent: true }); toast(`Recorded · next due ${D.humanDate(D.addDays(d, m.interval_days), S.today())}`); }
}
async function completeStep(sid, done = true) {
  const s = S.get('project_steps', sid); if (!s) return;
  await dbUpdate('project_steps', sid, { status: done ? 'done' : 'todo', done_at: done ? new Date().toISOString() : null }, { action: done ? 'complete' : 'reopen' });
  const p = projOf(s.project_id); if (p) { const steps = S.all('project_steps').filter(x => x.project_id === p.id); if (steps.every(x => x.status === 'done' || x.status === 'skipped') && p.status === 'active') toast(`${p.name} — all steps done!`); }
}
function projectProgress(pid) {
  const steps = S.all('project_steps').filter(s => s.project_id === pid);
  if (!steps.length) return 0;
  const tot = steps.reduce((a, s) => a + (s.est_min || 60), 0), done = steps.filter(s => s.status === 'done' || s.status === 'skipped').reduce((a, s) => a + (s.est_min || 60), 0);
  return Math.round(done / tot * 100);
}

// weather ------------------------------------------------------------------
async function loadWeather() {
  if (DEMO) return;
  const w = S.settings.weather || { lat: 29.703, lon: -98.124 };
  try {
    const cached = JSON.parse(localStorage.getItem('hb_wx') || 'null');
    if (cached && Date.now() - cached.at < 3600e3 && cached.today === S.today()) { S.weather = cached.data; return; }
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}&daily=precipitation_probability_max,precipitation_sum,temperature_2m_max&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=${encodeURIComponent(S.tz)}&forecast_days=7`);
    const j = await r.json(); const out = {};
    (j.daily?.time || []).forEach((d, i) => out[d] = { rain_prob: j.daily.precipitation_probability_max[i] ?? 0, precip_in: j.daily.precipitation_sum[i] ?? 0, tmax_f: Math.round(j.daily.temperature_2m_max[i]) });
    S.weather = out; localStorage.setItem('hb_wx', JSON.stringify({ at: Date.now(), today: S.today(), data: out })); emit('weather');
  } catch (e) { console.warn('weather', e); }
}

// ─── SHEETS / PICKERS ──────────────────────────────────────────────────────
let sheetState = null;
function openSheet({ title, build, onSave, saveLabel = 'Save', leftLabel = 'Cancel', onLeft, foot }) {
  const sh = $('#sheet'); $('#sheet-title').textContent = title;
  const body = $('#sheet-body'); body.innerHTML = ''; body.scrollTop = 0;
  const right = $('#sheet-right'), left = $('#sheet-left');
  right.textContent = saveLabel; right.classList.toggle('hidden', !onSave); left.textContent = leftLabel;
  const ft = $('#sheet-foot'); ft.innerHTML = ''; ft.classList.toggle('hidden', !foot); if (foot) foot(ft);
  sheetState = { onSave, onLeft };
  build(body);
  sh.classList.add('open'); sh.setAttribute('aria-hidden', 'false');
  setTimeout(() => { const f = body.querySelector('[autofocus]'); if (f && !isPhone()) f.focus(); }, 250);
}
function closeSheet() { const sh = $('#sheet'); sh.classList.remove('open'); sh.setAttribute('aria-hidden', 'true'); sheetState = null; }
$('#sheet-left').onclick = () => { if (sheetState?.onLeft) sheetState.onLeft(); else closeSheet(); };
$('#sheet-right').onclick = async () => { if (!sheetState?.onSave) return; try { const ok = await sheetState.onSave(); if (ok !== false) closeSheet(); } catch (e) { console.error(e); toast(e.message || 'Something went wrong'); } };
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
function pickOne(title, options, value) {
  return new Promise(res => {
    const pk = $('#picker'); $('#picker-title').textContent = title;
    const body = $('#picker-body'); body.innerHTML = '';
    let cur = value;
    const close = v => { pk.classList.remove('open'); res(v); };
    for (const o of options) {
      const it = h('div', { class: 'picker-item' + (o.value === cur ? ' sel' : '') }, h('div', { class: 'check' + (o.value === cur ? ' on' : '') }, svgCheck()), h('div', { style: 'flex:1' }, h('div', {}, o.label), o.sub ? h('div', { class: 'faint', style: 'font-size:12px' }, o.sub) : null));
      it.onclick = () => close(o.value);
      body.append(it);
    }
    $('#picker-done').onclick = () => close(cur);
    pk.onclick = e => { if (e.target === pk) close(cur); };
    pk.classList.add('open');
  });
}
// a labelled row inside a sheet
function srow(icon, label, valueEl, onclick) {
  const r = h('div', { class: 'srow' }, h('span', { class: 'ic' }, icon), h('span', { class: 'lb' }, label), valueEl);
  if (onclick) r.onclick = e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return; onclick(); };
  return r;
}
function vtext(txt) { return h('span', { class: 'vl' }, txt); }
function confirmSheet(title, text, { danger = 'Delete' } = {}) {
  return new Promise(res => openSheet({ title, build: b => b.append(h('p', { class: 'muted', style: 'font-size:15px' }, text)), onSave: () => { res(true); }, saveLabel: danger, onLeft: () => { closeSheet(); res(false); } }));
}

// ─── SHELL / ROUTER ────────────────────────────────────────────────────────
const VIEWS = { today: 'Today', tasks: 'Tasks', home: 'Home', projects: 'Projects', calendar: 'Calendar', settings: 'Settings' };
let view = 'today';
const renderers = {};
function nav(v, params) {
  view = v;
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === v));
  $$('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + v));
  $('#title').textContent = VIEWS[v]; $('#subtitle').textContent = '';
  $('#back-btn').classList.add('hidden');
  renderers[v]?.(params);
  history.replaceState(null, '', v === 'today' ? location.pathname + (DEMO ? '?demo=1' : '') : `#${v}`);
}
$$('.nav-btn').forEach(b => b.onclick = () => nav(b.dataset.nav));
document.addEventListener('keydown', e => {
  if (e.target.matches('input,textarea,select') || e.metaKey || e.ctrlKey) { if (e.key === 'Escape') e.target.blur(); return; }
  const map = { '1': 'today', '2': 'tasks', '3': 'home', '4': 'projects', '5': 'calendar' };
  if (map[e.key]) nav(map[e.key]);
  if (e.key === '/') { e.preventDefault(); $('#ask-input').focus(); }
  if (e.key === 'n') { e.preventDefault(); openTaskEditor(); }
  if (e.key === 'Escape') { closeSheet(); closeAI(); }
});
