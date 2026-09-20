
// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS + WHAT HOMEBASE KNOWS
// ═══════════════════════════════════════════════════════════════════════════
const SS = { tab: 'knows' };
renderers.settings = function renderSettings(params) {
  if (params?.tab) SS.tab = params.tab;
  const body = $('#settings-body'); body.innerHTML = '';
  const wrap = h('div', { class: 'container' });
  const seg = h('div', { class: 'seg', style: 'margin-bottom:18px;flex-wrap:wrap' });
  [['knows','What HomeBase knows'],['household','Household'],['planning','Planning'],['app','App & connections']].forEach(([k, l]) => seg.append(h('button', { class: SS.tab === k ? 'active' : '', onclick: () => { SS.tab = k; renderers.settings(); } }, l)));
  wrap.append(seg);
  if (SS.tab === 'knows') wrap.append(renderKnows());
  else if (SS.tab === 'household') wrap.append(renderHousehold());
  else if (SS.tab === 'planning') wrap.append(renderPlanning());
  else wrap.append(renderAppSettings());
  body.append(wrap);
};
function renderKnows() {
  const grid = h('div', { class: 'settings-grid' });
  const mems = S.all('memories').filter(m => m.status !== 'rejected').sort((a, b) => (a.status === 'ignored') - (b.status === 'ignored') || b.confidence - a.confidence);
  const subjects = ['preferences','scheduling','family','home','projects','plants','pets','people'];
  const intro = h('div', { class: 'note', style: 'grid-column:1/-1' }, 'Everything HomeBase has learned or been told, by subject. Confirm what is right, fix what is off, ignore what should not influence planning. Observed patterns come from your real history and update nightly.');
  grid.append(intro);
  const add = h('div', { style: 'grid-column:1/-1;display:flex;gap:8px' }, h('input', { class: 'chip', style: 'flex:1;font-weight:500', placeholder: 'Tell HomeBase something to remember…', onkeydown: async e => { if (e.key === 'Enter' && e.target.value.trim()) { await dbInsert('memories', { subject: 'preferences', kind: 'preference', content: e.target.value.trim(), source: 'stated', confidence: 0.95, evidence_count: 1, status: 'active', last_confirmed_at: new Date().toISOString() }, { silent: true }); e.target.value = ''; toast('Remembered'); } } }));
  grid.append(add);
  for (const s of subjects) {
    const list = mems.filter(m => m.subject === s); if (!list.length) continue;
    const card = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, s[0].toUpperCase() + s.slice(1)), h('span', { class: 'cnt' }, list.length)));
    const bd = h('div', { class: 'card-bd' });
    list.forEach(m => {
      const row = h('div', { class: 'mem' + (m.status === 'ignored' ? ' ignored' : '') });
      const content = h('div', { class: 'content', contenteditable: 'true', spellcheck: 'false', onblur: async e => { const v = e.target.textContent.trim(); if (v && v !== m.content) { await dbUpdate('memories', m.id, { content: v, source: 'stated', confidence: Math.max(m.confidence, 0.9), last_confirmed_at: new Date().toISOString() }, { silent: true }); toast('Updated'); } }, onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } } }, m.content);
      const meta = h('div', { class: 'meta' }, h('span', { class: 'conf ' + confKey(m.confidence) }, confLabel(m.confidence)), h('span', {}, m.source === 'observed' ? `observed · ${m.evidence_count}× ` : m.source === 'inferred' ? 'inferred' : 'you told me'), m.kind === 'pattern' || m.kind === 'stat' ? h('span', { class: 'tag' }, m.kind) : null, m.last_confirmed_at ? h('span', {}, `confirmed ${D.humanDate(D.dateOf(m.last_confirmed_at, S.tz), S.today())}`) : null);
      const acts = h('div', { class: 'acts' });
      if (m.status === 'ignored') acts.append(h('button', { class: 'btn btn-ghost btn-sm', onclick: () => dbUpdate('memories', m.id, { status: 'active' }, { silent: true }) }, 'Use'));
      else { if (m.confidence < 0.95 || !m.last_confirmed_at) acts.append(h('button', { class: 'icon-btn', title: 'Confirm', onclick: () => dbUpdate('memories', m.id, { confidence: 1, last_confirmed_at: new Date().toISOString() }, { silent: true }) }, h('span', { html: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>' }))); acts.append(h('button', { class: 'icon-btn', title: 'Ignore', onclick: () => dbUpdate('memories', m.id, { status: 'ignored' }, { silent: true }) }, h('span', { html: '<svg viewBox="0 0 24 24"><path d="M17.9 17.9A10 10 0 0 1 3.5 8.3M9.9 4.2A10 10 0 0 1 21.7 12M1 1l22 22"/></svg>' }))); }
      acts.append(h('button', { class: 'icon-btn', title: 'Forget', onclick: async () => { await dbUpdate('memories', m.id, { status: 'rejected' }, { silent: true }); toast('Forgotten', () => dbUpdate('memories', m.id, { status: 'active' }, { silent: true })); } }, h('span', { html: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>' })));
      row.append(h('div', { class: 'body' }, content, meta), acts); bd.append(row);
    });
    card.append(bd); grid.append(card);
  }
  if (!mems.length) grid.append(h('div', { class: 'empty', style: 'grid-column:1/-1' }, 'Nothing learned yet. Chat with HomeBase or complete a few tasks.'));
  return grid;
}
function renderHousehold() {
  const grid = h('div', { class: 'settings-grid' });
  const hc = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, 'Household')));
  const hb = h('div', { class: 'card-bd', style: 'padding:6px 16px 16px' });
  hb.append(h('div', { class: 'field' }, h('label', {}, 'Name'), h('input', { value: S.household?.name || '', onchange: async e => { await api.updateHousehold({ name: e.target.value }); S.household.name = e.target.value; toast('Saved'); } })));
  hb.append(h('div', { class: 'field' }, h('label', {}, 'Timezone'), h('input', { value: S.tz, onchange: async e => { try { new Intl.DateTimeFormat('en-US', { timeZone: e.target.value }); await api.updateHousehold({ tz: e.target.value }); S.tz = e.target.value; toast('Saved'); } catch { toast('Unknown timezone'); } } })));
  hb.append(h('div', { class: 'sec-title' }, 'People'));
  const pp = h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px' }); S.people.forEach(p => pp.append(h('span', { class: 'person-chip' }, h('span', { class: 'avatar ' + (p.color || '') }, p.name[0]), p.name, p.is_user ? h('span', { class: 'faint', style: 'font-size:11px' }, 'user') : null))); hb.append(pp);
  const addP = h('div', { style: 'display:flex;gap:8px;margin-top:10px' }, h('input', { class: 'chip', style: 'flex:1;font-weight:500', placeholder: 'Add a person (family member, kid)…', id: 'new-person' }), h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { const i = $('#new-person'); if (!i.value.trim()) return; await dbInsert('people', { name: i.value.trim(), is_user: false, sort: S.people.length }, { silent: true }); S.people = S.all('people').sort((a, b) => a.sort - b.sort); i.value = ''; renderers.settings(); } }, 'Add')); hb.append(addP);
  hb.append(h('div', { class: 'sec-title' }, 'Invite'), h('p', { class: 'muted', style: 'font-size:14px' }, 'Hayley (or anyone in the house) signs in with their own email, chooses “Join a household” and enters this code:'), h('div', { style: 'display:flex;align-items:center;gap:10px;margin-top:8px' }, h('code', { class: 'kbd', style: 'font-size:20px;padding:6px 12px;letter-spacing:.1em' }, S.household?.invite_code || '—'), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => navigator.clipboard?.writeText(S.household?.invite_code || '').then(() => toast('Copied')) }, 'Copy')));
  hc.append(hb); grid.append(hc);
  const ac = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, 'Areas'), h('button', { class: 'btn btn-quiet btn-sm', onclick: () => openAreaEditor() }, '+ Add')));
  const ab = h('div', { class: 'card-bd' }); S.all('areas').filter(a => !a.archived).sort((a, b) => a.kind.localeCompare(b.kind) || a.sort - b.sort).forEach(a => ab.append(h('div', { class: 'row', onclick: () => openAreaEditor(a) }, h('div', { class: 'ico' }, a.emoji || '📁'), h('div', { class: 'body' }, h('div', { class: 'title' }, a.name), h('div', { class: 'ctx' }, a.kind)), h('button', { class: 'icon-btn', title: 'Archive', onclick: e => { e.stopPropagation(); dbUpdate('areas', a.id, { archived: true }, { silent: true }); } }, '×')))); ac.append(ab); grid.append(ac);
  const rc = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, 'Routines'), h('button', { class: 'btn btn-quiet btn-sm', onclick: () => openRoutineEditor() }, '+ Add')));
  rc.append(routinesList().firstChild); grid.append(rc);
  const pc = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, 'Pets')));
  const pb = h('div', { class: 'card-bd' }); S.all('pets').forEach(p => pb.append(h('div', { class: 'row' }, h('div', { class: 'ico' }, '🐾'), h('div', { class: 'body' }, h('div', { class: 'title' }, p.name), h('div', { class: 'ctx' }, p.species || ''))))); pb.append(h('div', { style: 'display:flex;gap:8px;padding:6px' }, h('input', { class: 'chip', style: 'flex:1;font-weight:500', placeholder: 'Add a pet…', id: 'new-pet' }), h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { const i = $('#new-pet'); if (!i.value.trim()) return; await dbInsert('pets', { name: i.value.trim() }, { silent: true }); i.value = ''; renderers.settings(); } }, 'Add'))); pc.append(pb); grid.append(pc);
  return grid;
}
function renderPlanning() {
  const grid = h('div', { class: 'settings-grid' });
  const st = P.settingsOf(ctx());
  const cc = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, 'Capacity (minutes of discretionary time)')));
  const cb = h('div', { class: 'card-bd', style: 'padding:6px 16px 16px' });
  cb.append(h('p', { class: 'faint', style: 'font-size:13px;margin-bottom:10px' }, 'How much flexible time HomeBase plans per day for each kind of day. Fixed calendar events are subtracted automatically. Weekend capacity is replaced by what you actually complete once there is enough history.'));
  const tbl = h('table', { class: 'costs' }, h('thead', {}, h('tr', {}, h('th', {}, 'Day type'), h('th', { class: 'num' }, 'Weekday'), h('th', { class: 'num' }, 'Weekend'))));
  const tb = h('tbody'); const cap = JSON.parse(JSON.stringify(st.capacity));
  for (const k of ['normal','busy','travel','sick','vacation','project']) tb.append(h('tr', {}, h('td', {}, k), h('td', { class: 'num' }, h('input', { type: 'number', value: cap[k].weekday, style: 'width:70px;text-align:right', class: 'chip', onchange: e => cap[k].weekday = Number(e.target.value) || 0 })), h('td', { class: 'num' }, h('input', { type: 'number', value: cap[k].weekend, style: 'width:70px;text-align:right', class: 'chip', onchange: e => cap[k].weekend = Number(e.target.value) || 0 }))));
  tbl.append(tb); cb.append(tbl);
  const wins = JSON.parse(JSON.stringify(st.windows));
  cb.append(h('div', { class: 'sec-title' }, 'Discretionary windows'));
  cb.append(h('div', { class: 'frow' }, h('div', { class: 'field' }, h('label', {}, 'Weekday'), h('div', { style: 'display:flex;gap:6px;align-items:center' }, h('input', { type: 'time', value: wins.weekday[0].start, onchange: e => wins.weekday[0].start = e.target.value }), '–', h('input', { type: 'time', value: wins.weekday[0].end, onchange: e => wins.weekday[0].end = e.target.value }))), h('div', { class: 'field' }, h('label', {}, 'Weekend'), h('div', { style: 'display:flex;gap:6px;align-items:center' }, h('input', { type: 'time', value: wins.weekend[0].start, onchange: e => wins.weekend[0].start = e.target.value }), '–', h('input', { type: 'time', value: wins.weekend[0].end, onchange: e => wins.weekend[0].end = e.target.value })))));
  const wx = { ...(S.settings.weather || { lat: 29.703, lon: -98.124, label: 'New Braunfels, TX' }) };
  cb.append(h('div', { class: 'sec-title' }, 'Weather location'), h('div', { class: 'frow' }, h('div', { class: 'field' }, h('label', {}, 'Latitude'), h('input', { type: 'number', step: '0.001', value: wx.lat, onchange: e => wx.lat = Number(e.target.value) })), h('div', { class: 'field' }, h('label', {}, 'Longitude'), h('input', { type: 'number', step: '0.001', value: wx.lon, onchange: e => wx.lon = Number(e.target.value) }))));
  cb.append(h('button', { class: 'btn btn-primary', onclick: async () => { const settings = { ...S.settings, capacity: cap, windows: wins, weather: wx }; await api.updateHousehold({ settings }); S.settings = settings; localStorage.removeItem('hb_wx'); loadWeather(); toast('Planning settings saved'); } }, 'Save'));
  cc.append(cb); grid.append(cc);
  // day modes list
  const dm = S.all('day_modes').filter(m => m.date >= S.today()).sort((a, b) => a.date.localeCompare(b.date));
  const mc = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, 'Upcoming day modes'), h('button', { class: 'btn btn-quiet btn-sm', onclick: () => openDayModeSheet(S.today()) }, '+ Set')));
  const mb = h('div', { class: 'card-bd' }); if (!dm.length) mb.append(h('div', { class: 'empty' }, 'No special days ahead. Tell HomeBase “I’m traveling Tue–Thu” and it will replan.')); dm.forEach(m => mb.append(h('div', { class: 'row', onclick: () => openDayModeSheet(m.date) }, h('div', { class: 'ico' }, { sick: '🤒', travel: '✈️', busy: '💼', vacation: '🌴', project: '🔨' }[m.mode] || '☀️'), h('div', { class: 'body' }, h('div', { class: 'title' }, `${D.humanDate(m.date, S.today())} · ${m.mode}`), h('div', { class: 'ctx' }, m.note || '')), svgChev())));
  mc.append(mb); grid.append(mc);
  // recent activity
  const lc = h('div', { class: 'card', style: 'grid-column:1/-1' }, h('div', { class: 'card-hd' }, h('h3', {}, 'Recent activity')));
  const lb = h('div', { class: 'card-bd' }); S.all('activity_log').sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30).forEach(a => lb.append(h('div', { class: 'faint', style: 'font-size:13px;padding:4px 10px;display:flex;gap:8px' }, h('span', { style: 'min-width:90px' }, `${D.humanDate(D.dateOf(a.at, S.tz), S.today())} ${D.fmtHM(D.timeOf(a.at, S.tz))}`), h('span', { style: 'min-width:60px' }, a.actor === 'ai' ? '✨ HomeBase' : a.actor === 'system' ? '⚙️ planner' : (personOf(a.actor)?.name || 'you')), h('span', {}, `${a.action} ${a.entity_type}${a.after?.title || a.after?.name ? ' · ' + (a.after.title || a.after.name) : ''}${a.reason ? ' · ' + a.reason : ''}`)))); lc.append(lb); grid.append(lc);
  return grid;
}
function renderAppSettings() {
  const grid = h('div', { class: 'settings-grid' });
  const cc = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, 'Connections')));
  const cb = h('div', { class: 'card-bd', style: 'padding:6px 16px 16px' });
  cb.append(h('div', { class: 'field' }, h('label', {}, 'AI Worker URL'), h('input', { value: CFG.workerUrl, placeholder: 'https://homebase-ai.<you>.workers.dev', onchange: e => { CFG.workerUrl = e.target.value.trim().replace(/\/$/, ''); localStorage.setItem('hb_worker_url', CFG.workerUrl); toast('Saved'); } }), h('div', { class: 'help' }, 'The Cloudflare Worker that runs HomeBase’s brain. Keys stay there, never in this page.')));
  cb.append(h('div', { style: 'display:flex;gap:8px' }, h('button', { class: 'btn btn-ghost btn-sm', onclick: testWorker }, 'Test connection')));
  if (!DEMO) { cb.append(h('div', { class: 'sec-title' }, 'Supabase'), h('div', { class: 'field' }, h('label', {}, 'Project URL'), h('input', { value: CFG.supabaseUrl, onchange: e => { localStorage.setItem('hb_sb_url', e.target.value.trim()); toast('Saved — reload to apply'); } })), h('div', { class: 'field' }, h('label', {}, 'Anon key'), h('input', { value: CFG.supabaseAnonKey, onchange: e => { localStorage.setItem('hb_sb_key', e.target.value.trim()); toast('Saved — reload to apply'); } }))); }
  cc.append(cb); grid.append(cc);
  const ac = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, 'Appearance & wall')));
  const ab = h('div', { class: 'card-bd', style: 'padding:6px 16px 16px' });
  const theme = localStorage.getItem('hb_theme') || 'auto';
  const tseg = h('div', { class: 'seg' }); [['auto','Auto'],['light','Light'],['dark','Dark']].forEach(([v, l]) => tseg.append(h('button', { class: theme === v ? 'active' : '', onclick: () => { localStorage.setItem('hb_theme', v); applyTheme(); renderers.settings(); } }, l)));
  ab.append(h('div', { class: 'field' }, h('label', {}, 'Theme'), tseg));
  ab.append(h('div', { class: 'field' }, h('label', {}, 'Wall display PIN'), h('div', { style: 'display:flex;gap:8px' }, h('input', { type: 'password', inputmode: 'numeric', maxlength: 4, placeholder: '4 digits', id: 'pin-new', style: 'width:130px' }), h('button', { class: 'btn btn-ghost', onclick: async () => { const v = $('#pin-new').value; if (!/^\d{4}$/.test(v)) return toast('4 digits'); localStorage.setItem('hb_wall_pin', await sha(v)); $('#pin-new').value = ''; toast('PIN set'); } }, 'Set')), h('div', { class: 'help' }, 'A display lock for the mounted iPad. It is not a security boundary — the real login is your account.')));
  ab.append(h('div', { class: 'field' }, h('label', {}, 'Wall auto-dim'), h('div', { class: 'muted', style: 'font-size:14px' }, 'Dims 11 pm – 6 am. Open the wall view with the screen icon or add ', h('code', { class: 'kbd' }, '?wall=1'), ' to the URL on the mounted iPad.')));
  ac.append(ab); grid.append(ac);
  const pc = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, 'This device')));
  const pb = h('div', { class: 'card-bd', style: 'padding:6px 16px 16px' });
  const kind = localStorage.getItem('hb_device_kind') || (WALL_START ? 'wall' : 'personal');
  const kseg = h('div', { class: 'seg' }); [['personal', 'Personal'], ['shared', 'Shared'], ['wall', 'Wall iPad']].forEach(([v, l]) => kseg.append(h('button', { class: kind === v ? 'active' : '', onclick: () => { localStorage.setItem('hb_device_kind', v); if (v !== 'personal') setActivePerson(null); api.deviceSync?.().catch(() => {}); renderers.settings(); } }, l)));
  pb.append(h('div', { class: 'field' }, h('label', {}, 'Device type'), kseg, h('div', { class: 'help' }, 'Personal devices default to one person; shared and wall devices open in Household view.')));
  const pseg = h('div', { class: 'seg' }); [...S.people.map(p => [p.id, `${personEmoji(p)} ${p.name}`]), [null, '🏠 Household']].forEach(([v, l]) => pseg.append(h('button', { class: (S.person?.id || null) === v ? 'active' : '', onclick: () => { setActivePerson(v); renderers.settings(); } }, l)));
  pb.append(h('div', { class: 'field' }, h('label', {}, 'Default person on this device'), pseg, h('div', { class: 'help' }, `Currently viewing as ${S.person ? S.person.name : 'Household'}. Everyone shares one login; this only changes whose work shows first and who “me” means to the AI.`)));
  pb.append(h('div', { class: 'field' }, h('label', {}, 'Device name'), h('input', { value: localStorage.getItem('hb_device_label') || deviceLabel(), onchange: e => { localStorage.setItem('hb_device_label', e.target.value.trim()); api.deviceSync?.().catch(() => {}); toast('Saved'); } })));
  pc.append(pb); grid.append(pc);
  const dc = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, 'Account')));
  const db = h('div', { class: 'card-bd', style: 'padding:6px 16px 16px' });
  db.append(h('p', { class: 'muted', style: 'font-size:14px' }, DEMO ? 'Demo mode — nothing is saved.' : `Signed in as ${S.user?.email || ''}`));
  db.append(h('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, DEMO ? h('button', { class: 'btn btn-ghost', onclick: () => { localStorage.removeItem('hb_demo'); location.href = location.pathname; } }, 'Leave demo') : h('button', { class: 'btn btn-ghost', onclick: async () => { await sb.auth.signOut(); location.reload(); } }, 'Sign out'), h('button', { class: 'btn btn-quiet', onclick: () => { if (confirm('Clear cached settings on this device?')) { ['hb_wx','hb_snooze','hb_theme'].forEach(k => localStorage.removeItem(k)); location.reload(); } } }, 'Reset device cache')));
  db.append(h('p', { class: 'faint', style: 'font-size:12px;margin-top:14px' }, `HomeBase v2 · build ${BUILD}`));
  dc.append(db); grid.append(dc);
  return grid;
}
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
function applyTheme() { const t = localStorage.getItem('hb_theme') || 'auto'; if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }
async function testWorker() {
  if (!CFG.workerUrl) return toast('Set the Worker URL first');
  try { const r = await fetch(CFG.workerUrl + '/health'); const j = await r.json(); toast(j.ok ? `Worker OK · ${j.model}` : 'Worker responded oddly'); } catch (e) { toast('Cannot reach Worker: ' + e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════
// AI — Ask bar + panel, SSE client to the Worker
// ═══════════════════════════════════════════════════════════════════════════
const AI = { thread: null, busy: false, msgs: [] };
function openAI() { const p = $('#ai'); p.classList.add('open'); p.setAttribute('aria-hidden', 'false'); if (!AI.msgs.length) aiWelcome(); setTimeout(() => { if (!isPhone()) $('#ai-input').focus(); }, 300); }
function closeAI() { const p = $('#ai'); p.classList.remove('open'); p.setAttribute('aria-hidden', 'true'); }
$('#ai-btn').onclick = openAI; $('#ai-close').onclick = closeAI; $('#ai-scrim').onclick = closeAI;
$('#ai-new').onclick = () => { AI.thread = null; AI.msgs = []; $('#ai-msgs').innerHTML = ''; aiWelcome(); };
function aiWelcome() {
  const C = ctx(); const attn = attention(C);
  const box = $('#ai-msgs');
  box.append(aiBubble(`Hi${S.person ? ' ' + S.person.name.split(' ')[0] : ''}. Tell me what happened or what changed, and I’ll update HomeBase. Try:`));
  const chips = h('div', { class: 'chips' });
  const sug = [...attn.slice(0, 2).map(a => a.action?.type === 'log_routine' ? `Log ${S.get('routines', a.action.id)?.name.toLowerCase()}` : a.action?.type === 'record_maintenance' ? `I did the ${S.get('maintenance_rules', a.action.id)?.name.toLowerCase().replace(/^replace |^flush /, '')}` : a.title), 'What should I focus on today?', 'I’m traveling Tuesday through Thursday', 'What’s the next nursery step?'];
  [...new Set(sug)].slice(0, 5).forEach(s => chips.append(h('button', { onclick: () => sendAI(s) }, s)));
  box.append(chips);
}
function aiBubble(text, cls = 'ai') { const m = h('div', { class: 'msg ' + cls }); m.append(h('div', { class: 'bub', html: cls === 'ai' ? md(text) : esc(text) })); return m; }
// Small markdown renderer for AI replies: headings, bullet/numbered lists, tables, code, links, bold/italic.
function mdInline(t) {
  return esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_(?!_)([^_\n]+?)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])\*(?!\*)([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}
function md(t) {
  const lines = String(t || '').replace(/\r/g, '').split('\n');
  const out = []; let i = 0;
  const isTableRow = l => /^\s*\|.*\|\s*$/.test(l);
  const isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  while (i < lines.length) {
    let l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue; }
    const hm = /^(#{1,6})\s+(.*)$/.exec(l);
    if (hm) { out.push(`<${hm[1].length <= 2 ? 'h3' : 'h4'}>${mdInline(hm[2])}</${hm[1].length <= 2 ? 'h3' : 'h4'}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (isTableRow(l) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<div class="tbl"><table><thead><tr>${head.map(c => `<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*(?:[-*•]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d+[.)]\s+/.test(l); const items = [];
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*•]\s+(.*)$/;
      while (i < lines.length) {
        const m = re.exec(lines[i]);
        if (m) { items.push(mdInline(m[1])); i++; }
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1] += '<br>' + mdInline(lines[i].trim()); i++; }   // continuation line
        else break;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(x => `<li>${x}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const para = [l]; i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*(?:[-*•]|\d+[.)])\s+|\s*\|)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${para.map(mdInline).join('<br>')}</p>`);
  }
  return out.join('') || '<p></p>';
}
function sourcesBlock(list) {
  const s = h('div', { class: 'sources' }, h('span', { class: 'faint' }, 'Sources: '));
  (list || []).slice(0, 8).forEach((x, k) => { let host = x.title || x.url; try { host = x.title && x.title.length < 60 ? x.title : new URL(x.url).hostname.replace(/^www\./, ''); } catch {} s.append(h('span', {}, h('a', { href: x.url, target: '_blank', rel: 'noopener' }, `${k + 1}. ${host}`))); });
  return s;
}
async function sendAI(text, { fromWall } = {}) {
  text = (text || '').trim();
  const atts = AI.pending.filter(a => a.status === 'ready' && a.row);
  if (AI.pending.some(a => a.status === 'uploading' || a.status === 'queued')) return toast('Still uploading — one second');
  if ((!text && !atts.length) || AI.busy) return;
  if (!fromWall) openAI();
  const box = $('#ai-msgs');
  const ub = aiBubble(text || (atts.length ? '(attachment)' : ''), 'user'); if (atts.length) ub.querySelector('.bub').prepend(attChips(atts.map(a => a.row))); box.append(ub); AI.msgs.push({ role: 'user', text });
  const attachment_ids = atts.map(a => a.row.id);
  AI.pending.forEach(a => { if (a.thumb) URL.revokeObjectURL(a.thumb); }); AI.pending = []; renderTray();
  if (!text) text = attachment_ids.length ? '(I attached this — work out what it is and file it where it belongs; ask me one question if it is unclear.)' : '';
  const reply = h('div', { class: 'msg ai' }); const bub = h('div', { class: 'bub cursor', html: '' }); reply.append(bub); box.append(reply); box.scrollTop = box.scrollHeight;
  const wallReply = fromWall ? $('#wall-reply') : null; if (wallReply) { wallReply.textContent = '…'; wallReply.classList.add('show'); }
  AI.busy = true; $('#ai-send').disabled = true; $('#ask-send').disabled = true;
  let full = '';
  const finish = () => { AI.busy = false; $('#ai-send').disabled = false; $('#ask-send').disabled = false; bub.classList.remove('cursor'); box.scrollTop = box.scrollHeight; };
  if (!CFG.workerUrl) { bub.innerHTML = md(DEMO ? demoReply(text) : 'Set the **AI Worker URL** in Settings → App & connections to turn me on.'); if (wallReply) wallReply.textContent = bub.textContent; finish(); return; }
  try {
    const res = await fetch(CFG.workerUrl + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + api.token() }, body: JSON.stringify({ thread_id: AI.thread, message: text, attachment_ids, active_person_id: S.person?.id || null, context: { view, date: S.today(), now: S.now(), device: fromWall ? 'wall' : isPhone() ? 'phone' : 'desktop', scope: S.scope, device_key: DEVICE_KEY } }) });
    if (!res.ok || !res.body) throw new Error(`Worker ${res.status}`);
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    const toolLines = new Map();
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx; while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
        let ev = 'message', data = '';
        for (const line of frame.split('\n')) { if (line.startsWith('event:')) ev = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); }
        if (!data) continue; let j; try { j = JSON.parse(data); } catch { continue; }
        if (ev === 'thread') AI.thread = j.thread_id;
        else if (ev === 'text') { full += j.delta || ''; bub.innerHTML = md(full); if (wallReply) wallReply.textContent = full; }
        else if (ev === 'tool') { if (j.status === 'start') { const l = h('div', { class: 'tool-line' }, h('span', { class: 'sp' }), j.summary || j.name); toolLines.set(j.name + (j.id || ''), l); reply.before(l); } else { const l = toolLines.get(j.name + (j.id || '')); if (l) { l.innerHTML = `<span style="color:var(--sage)">✓</span> ${esc(j.summary || j.name)}`; } } }
        else if (ev === 'action') { reply.before(actionCard(j)); }
        else if (ev === 'proposal') { reply.before(proposalCard(j)); }
        else if (ev === 'error') { full += `\n\n⚠️ ${j.message}`; bub.innerHTML = md(full); }
        else if (ev === 'sources') { if (j.sources?.length) reply.append(sourcesBlock(j.sources)); }
        else if (ev === 'done') { /* usage */ }
        box.scrollTop = box.scrollHeight;
      }
    }
    if (!full.trim()) bub.innerHTML = md('Done.');
  } catch (e) { bub.innerHTML = md(`⚠️ Couldn’t reach HomeBase’s brain (${e.message}).`); }
  AI.msgs.push({ role: 'assistant', text: full }); finish();
  if (!DEMO && !realtime) api.load().then(() => emit('tasks'));
}
function actionCard(a) {
  const c = h('div', { class: 'action-card' }, h('span', { class: 'ok' }, '✓'), h('span', {}, a.summary || `${a.action} ${a.entity_type}`));
  if (a.undo) c.append(h('button', { onclick: async () => { try { await fetch(CFG.workerUrl + '/undo', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + api.token() }, body: JSON.stringify(a.undo) }); c.innerHTML = '<span class="faint">Undone</span>'; } catch { toast('Undo failed'); } } }, 'Undo'));
  return c;
}
function proposalCard(p) {
  const c = h('div', { class: 'proposal' }, h('div', {}, p.summary || 'Confirm this change?'));
  const acts = h('div', { class: 'acts' });
  acts.append(h('button', { class: 'btn btn-primary btn-sm', onclick: async () => { try { const r = await fetch(CFG.workerUrl + '/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + api.token() }, body: JSON.stringify({ proposal_id: p.id }) }); const j = await r.json(); c.innerHTML = j.ok ? `<span style="color:var(--sage)">✓</span> ${esc(j.action?.summary || 'Done')}` : `⚠️ ${esc(j.error || 'Failed')}`; } catch (e) { toast('Failed: ' + e.message); } } }, 'Confirm'), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { c.innerHTML = '<span class="faint">Skipped</span>'; } }, 'Skip'));
  c.append(acts); return c;
}
// demo-mode canned brain so the UI can be previewed without a Worker
function demoReply(t) {
  const C = ctx(); const plan = P.planDay(C.today, C); const attn = attention(C);
  const l = t.toLowerCase();
  if (l.includes('today') || l.includes('focus')) return `**Must do:** ${plan.must.map(c => c.title).join(', ') || 'nothing'}.\n\n**Planned:** ${plan.planned.map(c => c.title).join(', ') || 'nothing'} (${mins(plan.used)} of ${mins(plan.capacity.minutes)}).\n\n**Watch:** ${attn.slice(0, 3).map(a => a.title).join(' · ')}`;
  if (l.includes('travel')) return 'In demo mode I can’t write changes, but with the Worker connected I’d set Tue–Thu to travel mode, keep must-dos, move home-only work to the weekend without piling it on Friday, and tell you what moved.';
  if (l.includes('nursery')) { const n = P.nextStepOf(S.all('projects').find(p => p.name === 'Nursery')?.id, C); return n ? `Next nursery step: **${n.title}** (${mins(n.est_min)}). Saturday morning has room — want me to block it?` : 'Nursery is done!'; }
  return 'Demo mode: this is a canned reply. Connect the Worker in Settings to get the real assistant with full read/write access and memory.';
}
$('#ai-send').onclick = () => { const i = $('#ai-input'); sendAI(i.value); i.value = ''; i.style.height = 'auto'; };
$('#ai-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#ai-send').click(); } });
$('#ai-input').addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 130) + 'px'; });
$('#ask-form').onsubmit = e => { e.preventDefault(); const i = $('#ask-input'); const v = i.value; i.value = ''; i.blur(); sendAI(v); };
// voice
function wireMic(btn, input) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) { btn.style.display = 'none'; return; }
  let rec = null;
  btn.onclick = () => { if (rec) { rec.stop(); return; } rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; btn.classList.add('listening'); rec.onresult = e => { input.value = [...e.results].map(r => r[0].transcript).join(''); }; rec.onend = () => { btn.classList.remove('listening'); rec = null; if (input.value.trim()) input.form?.requestSubmit ? input.form.requestSubmit() : sendAI(input.value); }; rec.onerror = () => { btn.classList.remove('listening'); rec = null; }; rec.start(); };
}
wireMic($('#mic-btn'), $('#ask-input')); wireMic($('#wall-mic'), $('#wall-input'));

// ═══════════════════════════════════════════════════════════════════════════
// WALL DISPLAY
// ═══════════════════════════════════════════════════════════════════════════
const W = { open: false, mode: 'day', timer: null };
function openWall() { W.open = true; $('#wall').classList.add('open'); renderWall(); clearInterval(W.timer); W.timer = setInterval(renderWall, 30000); if (localStorage.getItem('hb_wall_pin')) armWallLock(); }
function closeWall() { W.open = false; $('#wall').classList.remove('open'); clearInterval(W.timer); }
$('#wall-btn').onclick = openWall; $('#wall-exit').onclick = () => { if (localStorage.getItem('hb_wall_pin')) askPin(closeWall); else closeWall(); };
$$('[data-wall]').forEach(b => b.onclick = () => { W.mode = b.dataset.wall; $$('[data-wall]').forEach(x => x.classList.toggle('active', x === b)); renderWall(); });
$('#wall-ask').onsubmit = e => { e.preventDefault(); const i = $('#wall-input'); const v = i.value; i.value = ''; sendAI(v, { fromWall: true }); setTimeout(() => $('#wall-reply').classList.remove('show'), 45000); };
let wallSwipeX = 0; $('#wall').addEventListener('touchstart', e => wallSwipeX = e.touches[0].clientX, { passive: true }); $('#wall').addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - wallSwipeX; if (Math.abs(dx) > 80) { W.mode = dx < 0 ? 'week' : 'day'; $$('[data-wall]').forEach(x => x.classList.toggle('active', x.dataset.wall === W.mode)); renderWall(); } }, { passive: true });
function renderWall() {
  if (!W.open) return;
  const C = ctx(); const today = C.today; const now = new Date();
  $('#wall-time').textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: S.tz });
  $('#wall-date').textContent = D.longDate(today);
  const wx = S.weather[today]; $('#wall-wx').innerHTML = wx ? `<b>${wx.tmax_f}°</b>${wx.rain_prob}% rain` : '';
  const hr = Number(C.now.slice(0, 2)); $('#wall').classList.toggle('dim', hr >= 23 || hr < 6);
  const day = $('#wall-day'), week = $('#wall-week'); day.classList.toggle('hidden', W.mode !== 'day'); week.classList.toggle('hidden', W.mode !== 'week');
  if (W.mode === 'day') {
    day.innerHTML = '';
    const plan = P.planDay(today, C); const attn = attention(C);
    const card = (title, sub, cls = '') => { const c = h('div', { class: 'wall-card ' + cls }); c.append(h('div', { class: 'hd' }, h('span', {}, title), sub ? h('span', {}, sub) : null)); const bd = h('div', { class: 'bd' }); c.append(bd); return [c, bd]; };
    const [c1, b1] = card('Today', `${plan.must.length + plan.planned.length} items`, 'tall');
    eventsOn(today).filter(e => e.kind !== 'work_block').forEach(e => b1.append(h('div', { class: 'wall-item' }, h('span', { class: 'dot fixed' }), h('div', {}, e.title, h('span', { class: 'sub' }, e.all_day ? 'All day' : D.fmtHM(D.timeOf(e.starts_at, S.tz)))))));
    [...plan.must, ...plan.planned].forEach(c => b1.append(h('div', { class: 'wall-item' }, h('span', { class: 'dot ' + (c.importance === 'must' ? 'must' : '') }), h('div', {}, c.title, h('span', { class: 'sub' }, c.kind === 'task' && c.ref.assignee_id ? personOf(c.ref.assignee_id)?.name : c.kind === 'step' ? 'Project' : c.kind === 'routine' ? 'Routine' : c.kind === 'maintenance' ? 'Maintenance' : '')))));
    S.all('tasks').filter(t => t.status === 'done' && D.dateOf(t.completed_at, S.tz) === today).slice(0, 4).forEach(t => b1.append(h('div', { class: 'wall-item done' }, h('span', { class: 'dot' }), h('div', {}, t.title))));
    if (!b1.children.length) b1.append(h('div', { class: 'wall-item' }, h('div', { class: 'faint' }, 'Clear day')));
    const [c2, b2] = card('Needs attention', attn.length ? `${attn.length}` : '');
    attn.slice(0, 5).forEach(a => b2.append(h('div', { class: 'wall-item', style: 'font-size:17px' }, h('span', { class: `rank r${a.rank}`, style: 'width:10px;height:10px;border-radius:50%;flex-shrink:0' }), h('div', {}, a.title, a.detail ? h('span', { class: 'sub' }, a.detail) : null))));
    if (!attn.length) b2.append(h('div', { class: 'wall-item' }, h('div', { class: 'faint' }, 'Nothing slipping')));
    const [c3, b3] = card('Projects', '');
    S.all('projects').filter(p => p.status === 'active').sort((a, b) => a.priority - b.priority).slice(0, 2).forEach(p => { const n = P.nextStepOf(p.id, C); const pct = projectProgress(p.id); b3.append(h('div', { class: 'wall-item', style: 'flex-direction:column;align-items:stretch;gap:6px' }, h('div', { style: 'display:flex;justify-content:space-between' }, h('span', {}, p.name), h('span', { class: 'faint' }, `${pct}%`)), h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })), h('span', { class: 'sub' }, n ? `Next: ${n.title}` : 'Done'))); });
    const [c4, b4] = card('Tomorrow', D.dayName(D.addDays(today, 1)));
    const tm = D.addDays(today, 1); const tp = P.planDay(tm, C);
    eventsOn(tm).filter(e => e.kind !== 'work_block').forEach(e => b4.append(h('div', { class: 'wall-item', style: 'font-size:17px' }, h('span', { class: 'dot fixed' }), h('div', {}, e.title, h('span', { class: 'sub' }, e.all_day ? 'All day' : D.fmtHM(D.timeOf(e.starts_at, S.tz)))))));
    [...tp.must, ...tp.planned.slice(0, 4)].forEach(c => b4.append(h('div', { class: 'wall-item', style: 'font-size:17px' }, h('span', { class: 'dot ' + (c.importance === 'must' ? 'must' : '') }), h('div', {}, c.title))));
    if (!b4.children.length) b4.append(h('div', { class: 'wall-item' }, h('div', { class: 'faint' }, 'Open')));
    const [c5, b5] = card('Ruby & routines', '');
    S.all('routines').filter(r => r.active !== false && ['daily'].includes(R.normalizeRule(r.cadence)?.freq)).forEach(r => { const done = D.dateOf(r.last_done_at, S.tz) === today; b5.append(h('div', { class: 'wall-item' + (done ? ' done' : ''), style: 'font-size:17px' }, h('span', { class: 'dot', style: done ? 'background:var(--sage)' : 'background:var(--border2)' }), h('div', {}, `${r.emoji || ''} ${r.name}`, r.streak ? h('span', { class: 'sub' }, `streak ${r.streak}`) : null))); });
    day.append(c1, c2, c3, c4, c5);
  } else {
    week.innerHTML = '';
    for (let i = 0; i < 7; i++) { const d = D.addDays(today, i); const p = P.planDay(d, C); const col = h('div', { class: 'd' + (d === today ? ' today' : '') }); col.append(h('div', { class: 'h' }, D.dow(d), h('b', {}, Number(d.slice(8))))); const mode = P.modeFor(d, C); if (mode.mode !== 'normal') col.append(h('div', { class: 'it', style: 'color:var(--amber);font-weight:700;border-top:none' }, mode.mode)); eventsOn(d).filter(e => e.kind !== 'work_block').forEach(e => col.append(h('div', { class: 'it' }, e.title, h('small', {}, e.all_day ? 'All day' : D.fmtHM(D.timeOf(e.starts_at, S.tz)))))); [...p.must, ...p.planned.filter(c => c.importance !== 'nice')].slice(0, 5).forEach(c => col.append(h('div', { class: 'it' }, c.title, c.importance === 'must' ? h('small', { style: 'color:var(--coral)' }, 'must') : null))); if (col.children.length === 1) col.append(h('div', { class: 'it faint' }, 'Free')); week.append(col); }
  }
}
// PIN display lock
let pinBuf = '', pinCb = null;
$('#pin-keys').append(...['1','2','3','4','5','6','7','8','9','','0','⌫'].map(k => h('button', { onclick: () => pinPress(k), style: k === '' ? 'visibility:hidden' : '' }, k)));
function askPin(cb) { pinBuf = ''; pinCb = cb; $('#pin-err').textContent = ''; pinDots(); $('#pin').classList.add('open'); }
function pinDots() { $$('#pin .dots i').forEach((d, i) => d.classList.toggle('on', i < pinBuf.length)); }
async function pinPress(k) { if (k === '⌫') pinBuf = pinBuf.slice(0, -1); else if (k && pinBuf.length < 4) pinBuf += k; pinDots(); if (pinBuf.length === 4) { const ok = await sha(pinBuf) === localStorage.getItem('hb_wall_pin'); if (ok) { $('#pin').classList.remove('open'); pinCb && pinCb(); } else { $('#pin-err').textContent = 'Wrong PIN'; pinBuf = ''; setTimeout(pinDots, 300); } } }
document.addEventListener('keydown', e => { if ($('#pin').classList.contains('open')) { if (/^\d$/.test(e.key)) pinPress(e.key); if (e.key === 'Backspace') pinPress('⌫'); } });
let lockTimer; function armWallLock() { clearInterval(lockTimer); }

// ═══════════════════════════════════════════════════════════════════════════
// PERSON LENS (spec §12) — "View as" pill, scope, device default
// ═══════════════════════════════════════════════════════════════════════════
function personEmoji(p) { return p ? (p.emoji || (p.kind === 'child' ? '🧒' : '🙂')) : '🏠'; }
function renderPersonPill() {
  const e = $('#person-emoji'), l = $('#person-lbl'); if (!e) return;
  e.textContent = personEmoji(S.person); l.textContent = S.person ? S.person.name.split(' ')[0] : 'Household';
  $('#person-pill').title = S.person ? `Viewing as ${S.person.name} · tap to switch` : 'Viewing the whole household · tap to switch';
}
function openPersonMenu(anchor) {
  const m = $('#person-menu'); m.innerHTML = '';
  m.append(h('div', { class: 'hint' }, 'View as'));
  S.people.forEach(p => m.append(h('button', { class: S.person?.id === p.id ? 'on' : '', onclick: () => { setActivePerson(p.id); closeMenus(); renderers[view]?.(); toast(`Viewing as ${p.name}`); } }, h('span', {}, personEmoji(p)), h('span', { style: 'flex:1' }, p.name), p.id === S.me?.id ? h('span', { class: 'faint', style: 'font-size:11px' }, 'you') : null)));
  m.append(h('button', { class: !S.person ? 'on' : '', onclick: () => { setActivePerson(null); closeMenus(); renderers[view]?.(); toast('Viewing the whole household'); } }, h('span', {}, '🏠'), h('span', { style: 'flex:1' }, 'Household')));
  m.append(h('div', { class: 'sep' }), h('div', { class: 'hint' }, 'Task scope'));
  const seg = h('div', { class: 'scope-seg seg' });
  [['mine', 'Mine'], ['household', 'Household'], ['all', 'All']].forEach(([v, lab]) => seg.append(h('button', { class: S.scope === v ? 'on' : '', onclick: () => { setScope(v); openPersonMenu(anchor); renderers[view]?.(); } }, lab)));
  m.append(seg);
  m.append(h('div', { class: 'sep' }), h('button', { onclick: () => { closeMenus(); nav('settings'); } }, h('span', {}, '⚙️'), h('span', {}, 'This device…')));
  placeMenu(m, anchor);
}
function placeMenu(m, anchor) {
  m.hidden = false; const r = anchor.getBoundingClientRect();
  m.style.top = Math.min(window.innerHeight - m.offsetHeight - 12, r.bottom + 6) + 'px';
  m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', closeMenusOnOutside, { once: true }), 0);
}
function closeMenus() { $$('.popmenu').forEach(x => { x.hidden = true; }); }
function closeMenusOnOutside(e) { if (!e.target.closest('.popmenu')) closeMenus(); else document.addEventListener('pointerdown', closeMenusOnOutside, { once: true }); }
$('#person-pill').onclick = e => { e.stopPropagation(); const m = $('#person-menu'); if (!m.hidden) return closeMenus(); openPersonMenu(e.currentTarget); };

// ═══════════════════════════════════════════════════════════════════════════
// ATTACHMENTS (spec §1, §4) — one universal flow: give it to HomeBase
// ═══════════════════════════════════════════════════════════════════════════
AI.pending = [];            // [{ key, file, name, mime, status: queued|uploading|ready|error, row, thumb, err }]
function initAttachments() {
  const open = e => { e.stopPropagation(); e.preventDefault(); const m = $('#attach-menu'); if (!m.hidden) return closeMenus(); placeMenu(m, e.currentTarget); };
  $('#ask-attach').onclick = open; $('#ai-attach').onclick = open;
  $$('#attach-menu button[data-pick]').forEach(b => { b.onclick = () => { closeMenus(); $('#pick-' + b.dataset.pick).click(); }; });
  ['camera', 'photos', 'files'].forEach(k => { const inp = $('#pick-' + k); inp.onchange = () => { addAttachments([...inp.files], k === 'camera' ? 'camera' : 'upload'); inp.value = ''; }; });
  // drag & drop anywhere on the app or the AI panel
  const panel = $('#ai .panel'); let dragDepth = 0;
  document.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); panel.classList.add('dragover'); } });
  document.addEventListener('dragenter', e => { dragDepth++; });
  document.addEventListener('dragleave', e => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) panel.classList.remove('dragover'); });
  document.addEventListener('drop', e => { dragDepth = 0; panel.classList.remove('dragover'); const files = [...(e.dataTransfer?.files || [])]; if (!files.length) return; e.preventDefault(); openAI(); addAttachments(files, 'drop'); });
  // paste a screenshot / image (Windows Ctrl+V, iPad paste)
  document.addEventListener('paste', e => { const items = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file'); if (!items.length) return; const files = items.map(i => i.getAsFile()).filter(Boolean); if (!files.length) return; e.preventDefault(); openAI(); addAttachments(files.map((f, i) => f.name ? f : new File([f], `pasted-${Date.now()}-${i}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type })), 'paste'); });
}
async function addAttachments(files, source) {
  if (!files.length) return;
  if (!navigator.onLine && !DEMO) return toast('Attachments need a connection — try again when you’re online');
  const room = Math.max(0, AT.MAX_PER_MESSAGE - AI.pending.length);
  if (files.length > room) toast(`Up to ${AT.MAX_PER_MESSAGE} files per message`);
  openAI();
  for (const file of files.slice(0, room)) {
    const ok = AT.allowed(file); const a = { key: uuid(), file, name: file.name || 'file', mime: AT.mimeOf(file), status: ok.ok ? 'queued' : 'error', err: ok.ok ? null : ok.reason, row: null, thumb: null };
    if (AT.isImage(a.mime)) { try { a.thumb = URL.createObjectURL(file); } catch {} }
    AI.pending.push(a); renderTray();
    if (a.status === 'queued') uploadPending(a);
  }
}
async function uploadPending(a) {
  a.status = 'uploading'; renderTray();
  try { a.row = await api.uploadFile(a.file, { source: a.source || 'upload' }); a.status = 'ready'; }
  catch (e) { a.status = 'error'; a.err = e.message || 'Upload failed'; }
  renderTray();
}
function removePending(key) { const i = AI.pending.findIndex(a => a.key === key); if (i < 0) return; const [a] = AI.pending.splice(i, 1); if (a.row && a.status === 'ready') api.removeFile(a.row).catch(() => {}); if (a.thumb) URL.revokeObjectURL(a.thumb); renderTray(); }
function renderTray() {
  const tray = $('#ai-tray'); tray.innerHTML = ''; tray.hidden = !AI.pending.length;
  $('#ai-attach').classList.toggle('has', !!AI.pending.length); $('#ask-attach').classList.toggle('has', !!AI.pending.length);
  for (const a of AI.pending) {
    const el = h('div', { class: 'att' + (a.status === 'error' ? ' err' : ''), title: a.name });
    el.append(a.thumb ? h('img', { class: 'th', src: a.thumb, alt: '' }) : h('div', { class: 'th' }, fileIcon(a.mime)));
    el.append(h('div', { class: 'nm' }, a.name), h('div', { class: 'st' }, a.status === 'error' ? (a.err || 'Failed') : a.status === 'ready' ? AT.fmtBytes(a.file.size) : a.status === 'uploading' ? 'Uploading…' : 'Queued'));
    if (a.status === 'uploading') el.append(h('div', { class: 'bar' }, h('i')));
    if (a.status === 'error') el.onclick = () => { if (a.err && /type|larger|Empty/i.test(a.err)) return; a.status = 'queued'; uploadPending(a); };
    el.append(h('button', { class: 'x', 'aria-label': 'Remove', onclick: e => { e.stopPropagation(); removePending(a.key); } }, '×'));
    tray.append(el);
  }
}
function fileIcon(mime = '') { return mime === 'application/pdf' ? '📕' : /image/.test(mime) ? '🖼️' : /csv|excel|sheet/.test(mime) ? '📊' : /word|document/.test(mime) ? '📝' : '📄'; }
function attChips(rows) {
  const c = h('div', { class: 'att-chips' });
  rows.forEach(f => { const chip = h('button', { class: 'att-chip', title: f.original_name || '', onclick: () => openFile(f) }); const th = h('div', { class: 'ico' }, fileIcon(f.mime_type)); chip.append(th, h('span', { class: 'nm' }, f.original_name || f.kind || 'file')); if (/^image\//.test(f.mime_type || '')) api.signedUrl(f.metadata?.derivative_path || f.storage_path).then(u => { if (u) th.replaceWith(h('img', { src: u, alt: '' })); }).catch(() => {}); c.append(chip); });
  return c;
}
async function openFile(f) { try { const u = await api.signedUrl(f.storage_path, 600); if (u) window.open(u, '_blank', 'noopener'); } catch (e) { toast('Could not open file'); } }
function filesFor(entity_type, id) { const ids = new Set(S.all('file_links').filter(l => l.entity_type === entity_type && l.entity_id === id).map(l => l.file_id)); return S.all('files').filter(f => ids.has(f.id)).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')); }
function filesCard(entity_type, id, { title = 'Files & photos', extra } = {}) {
  const files = filesFor(entity_type, id); if (!files.length && !extra) return null;
  const card = h('div', { class: 'card', style: 'margin-top:16px' }, h('div', { class: 'card-hd' }, h('h3', {}, `${title} · ${files.length}`), h('button', { class: 'btn btn-quiet btn-sm', onclick: () => { openAI(); $('#ai-input').value = `Attach this to ${extra?.name || 'this'}: `; $('#pick-files').click(); } }, '+ Add')));
  const grid = h('div', { class: 'files-grid' });
  files.slice(0, 24).forEach(f => { const el = h('div', { class: 'f', onclick: () => openFile(f) }); const th = h('div', { class: 'th' }, fileIcon(f.mime_type)); el.append(th, h('div', { class: 'nm', title: f.ai_summary || f.caption || f.original_name }, f.caption || f.original_name || f.kind)); if (/^image\//.test(f.mime_type || '')) api.signedUrl(f.metadata?.derivative_path || f.storage_path).then(u => { if (u) th.replaceWith(h('img', { class: 'th', src: u, alt: '' })); }).catch(() => {}); grid.append(el); });
  if (!files.length) grid.append(h('div', { class: 'empty', style: 'grid-column:1/-1' }, 'No files yet — attach a photo or receipt in Ask HomeBase and say what it’s for.'));
  card.append(grid); return card;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH + BOOT
// ═══════════════════════════════════════════════════════════════════════════
const BUILD = '2.1.0-p2';
function authScreen(html) { $('#auth').classList.remove('hidden'); $('#auth-box').innerHTML = html; }
function showApp() { $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden'); }
async function boot() {
  applyTheme();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (DEMO) { await api.load(); S.me = S.person; S.person = resolveActivePerson(); return start(); }
  if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) return setupScreen();
  try { await api.init(); } catch (e) { return authScreen(`<h1>HomeBase</h1><p class="sub">Couldn’t load Supabase client (${esc(e.message)}). Check your connection.</p>`); }
  sb.auth.onAuthStateChange((ev, session) => { S.session = session; S.user = session?.user || null; if (ev === 'SIGNED_OUT') location.reload(); });
  const { data: { session } } = await sb.auth.getSession(); S.session = session; S.user = session?.user || null;
  if (!session) return signInScreen();
  await afterSignIn();
}
function setupScreen() {
  authScreen(`<h1>HomeBase</h1><p class="sub">Connect your Supabase project once on this device.</p>
    <div class="field"><label>Supabase URL</label><input id="su" placeholder="https://xxxx.supabase.co"></div>
    <div class="field"><label>Anon key</label><input id="sk" placeholder="eyJ…"></div>
    <div class="field"><label>AI Worker URL (optional now)</label><input id="sw" placeholder="https://homebase-ai.you.workers.dev"></div>
    <button class="btn btn-primary btn-lg btn-block" id="sgo">Continue</button>
    <div class="alt"><button id="sdemo">Try the demo instead</button></div>`);
  $('#sgo').onclick = () => { localStorage.setItem('hb_sb_url', $('#su').value.trim()); localStorage.setItem('hb_sb_key', $('#sk').value.trim()); if ($('#sw').value.trim()) localStorage.setItem('hb_worker_url', $('#sw').value.trim()); location.reload(); };
  $('#sdemo').onclick = () => { localStorage.setItem('hb_demo', '1'); location.href = location.pathname + '?demo=1'; };
}
function signInScreen(msg = '', keepEmail = '') {
  authScreen(`<h1>HomeBase</h1><p class="sub">Sign in to your household.</p>${msg ? `<div class="note" style="margin-bottom:12px">${esc(msg)}</div>` : ''}
    <div class="field"><label>Email</label><input id="em" type="email" autocomplete="email" placeholder="you@example.com" value="${esc(keepEmail || localStorage.getItem('hb_last_email') || '')}"></div>
    <div class="field" id="pwf"><label>Password</label><input id="pw" type="password" autocomplete="current-password"></div>
    <button class="btn btn-primary btn-lg btn-block" id="go">Sign in</button>
    <div class="alt"><button id="magic">Email me a sign-in link instead</button> · <button id="signup">Create account</button></div>
    <div class="alt" style="margin-top:22px"><button id="demo2">Try the demo</button></div>`);
  $('#go').onclick = async () => { const email = $('#em').value.trim(); if (!email || !$('#pw').value) return signInScreen('Enter your email and password first.', email); localStorage.setItem('hb_last_email', email); const { error } = await sb.auth.signInWithPassword({ email, password: $('#pw').value }); if (error) return signInScreen(error.message, email); await afterSignIn(); };
  $('#pw').onkeydown = e => { if (e.key === 'Enter') $('#go').click(); };
  $('#magic').onclick = async () => { const email = $('#em').value.trim(); if (!email) return signInScreen('Enter your email first.'); localStorage.setItem('hb_last_email', email); const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } }); signInScreen(error ? error.message : 'Check your email for the link.', email); };
  $('#signup').onclick = async () => { const email = $('#em').value.trim(); if (!email || $('#pw').value.length < 8) return signInScreen('Type your email and a new password (8+ characters) in the boxes above, then tap Create account.', email); localStorage.setItem('hb_last_email', email); const { error } = await sb.auth.signUp({ email, password: $('#pw').value, options: { emailRedirectTo: location.origin + location.pathname } }); signInScreen(error ? error.message : 'Account created. Check your email for the confirmation link, then sign in here.', email); };
  $('#demo2').onclick = () => { localStorage.setItem('hb_demo', '1'); location.href = location.pathname + '?demo=1'; };
}
async function afterSignIn() {
  const { data: mem, error } = await sb.from('household_members').select('household_id, person_id, households(*)').limit(1);
  if (error) return signInScreen('Could not read membership: ' + error.message + ' — did you run the v2 migrations?');
  if (!mem?.length) return householdScreen();
  S.hh = mem[0].household_id; S.household = mem[0].households; S.tz = S.household?.tz || S.tz; S.settings = S.household?.settings || {};
  await api.load();
  S.me = S.get('people', mem[0].person_id) || S.people.find(p => p.is_user) || null;
  S.person = resolveActivePerson();
  api.subscribe();
  api.deviceSync().catch(() => {});
  start();
}
function householdScreen(msg = '') {
  const first = (S.user?.email || '').split('@')[0];
  authScreen(`<h1>Welcome</h1><p class="sub">Create your household, or join one with an invite code.</p>${msg ? `<div class="note" style="margin-bottom:12px">${esc(msg)}</div>` : ''}
    <div class="field"><label>Your name</label><input id="pn" value="${esc(first.charAt(0).toUpperCase() + first.slice(1))}"></div>
    <div class="field"><label>Household name</label><input id="hn" placeholder="The Champness House"></div>
    <button class="btn btn-primary btn-lg btn-block" id="mk">Create household (with Luke’s starter setup)</button>
    <div class="sec-title" style="margin-top:14px">or join</div>
    <div class="field"><label>Invite code</label><input id="ic" placeholder="8 characters" style="text-transform:uppercase"></div>
    <button class="btn btn-ghost btn-lg btn-block" id="jn">Join household</button>`);
  $('#mk').onclick = async () => { const { error } = await sb.rpc('create_household', { p_name: $('#hn').value.trim() || 'Home', p_person_name: $('#pn').value.trim() || 'Me', p_seed: true }); if (error) return householdScreen(error.message); await afterSignIn(); };
  $('#jn').onclick = async () => { const { error } = await sb.rpc('join_household', { p_code: $('#ic').value.trim(), p_person_name: $('#pn').value.trim() || 'Me' }); if (error) return householdScreen(error.message); await afterSignIn(); };
}
function start() {
  showApp();
  loadWeather();
  renderPersonPill(); onChange(t => { if (t.has('people')) renderPersonPill(); });
  initAttachments();
  onChange(tables => { if (W.open) renderWall(); if ($('#sheet').classList.contains('open') && !tables.has('list_items') && !tables.has('memories')) return; renderers[view]?.(); if (tables.has('tasks') || tables.has('maintenance_rules')) updateBadges(); });
  updateBadges();
  const initial = WALL_START ? 'today' : (location.hash.slice(1) || 'today');
  nav(VIEWS[initial] ? initial : 'today');
  if (WALL_START) openWall();
  // midnight rollover + periodic refresh
  let lastDay = S.today();
  setInterval(() => { const t = S.today(); if (t !== lastDay) { lastDay = t; localStorage.removeItem('hb_wx'); loadWeather(); renderers[view]?.(); if (W.open) renderWall(); } }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (!DEMO) api.load().then(() => { emit('tasks'); }); loadWeather(); } });
  window.addEventListener('resize', debounce(() => renderers[view]?.(), 150));
}
function updateBadges() {
  const today = S.today();
  const n = S.all('tasks').filter(t => t.status === 'open' && t.importance === 'must' && t.due_date && t.due_date < today).length + S.all('maintenance_rules').filter(m => m.active !== false && m.next_due && m.next_due < today).length;
  $$('.nav-btn[data-nav="today"]').forEach(b => { let bd = b.querySelector('.badge'); if (n) { if (!bd) { bd = h('span', { class: 'badge' }); b.append(bd); } bd.textContent = n; } else bd?.remove(); });
}
boot().catch(e => { console.error(e); authScreen(`<h1>HomeBase</h1><p class="sub">Something went wrong starting up: ${esc(e.message)}</p><button class="btn btn-ghost" onclick="location.reload()">Reload</button>`); });
</script>
</body>
</html>
