
// ═══════════════════════════════════════════════════════════════════════════
// SHARED ROW COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════
function contextLine(t) {
  const parts = [];
  const today = S.today();
  if (t.due_date) parts.push(t.due_date < today && t.status === 'open' ? `<b style="color:var(--coral)">Overdue · ${D.humanDate(t.due_date, today)}</b>` : `<b>${esc(D.humanDate(t.due_date, today))}</b>`);
  const sd = D.dateOf(t.scheduled_start, S.tz); if (sd && sd !== t.due_date) parts.push(`${esc(D.humanDate(sd, today))} ${esc(D.fmtHM(D.timeOf(t.scheduled_start, S.tz)))}`);
  if (t.project_id) parts.push(esc(projOf(t.project_id)?.name || '')); else if (t.area_id) parts.push(esc(areaOf(t.area_id)?.name || ''));
  if (t.recurrence) parts.push('↻ ' + esc(R.describeRule(t.recurrence)));
  if (t.assignee_id && t.assignee_id !== S.person?.id) parts.push(esc(personOf(t.assignee_id)?.name || ''));
  if (t.duration_min) parts.push(mins(t.duration_min));
  return parts.join(' · ');
}
// Row for a planner candidate (task | routine | maintenance | step)
function candRow(c, { why = false } = {}) {
  const isTask = c.kind === 'task';
  const done = isTask && c.ref.status !== 'open';
  const chk = h('div', { class: 'check' + (done ? ' on' : '') + (c.importance === 'must' && !done ? ' must' : ''), role: 'checkbox', 'aria-checked': done, title: 'Mark done' }, svgCheck());
  chk.onclick = e => { e.stopPropagation(); doCandidate(c); };
  let ctxLine = '';
  if (isTask) ctxLine = contextLine(c.ref);
  else if (c.kind === 'routine') ctxLine = `${c.overdueDays > 0 ? `<b style="color:var(--amber)">${c.overdueDays}d late</b> · ` : ''}Routine · ${esc(R.describeRule(c.rule))}${c.ref.streak ? ` · 🔥 ${c.ref.streak}` : ''}`;
  else if (c.kind === 'maintenance') ctxLine = `Maintenance · ${c.due_date < S.today() ? `<b style="color:var(--coral)">${D.diffDays(c.due_date, S.today())}d overdue</b>` : 'due ' + esc(D.humanDate(c.due_date, S.today()))}`;
  else if (c.kind === 'step') ctxLine = `Next step · ${mins(c.duration_min)} · P${c.project_priority}`;
  if (why && c.reasons?.length) ctxLine += ` <span class="score-why">· ${esc(c.reasons.join(', '))}</span>`;
  const row = h('div', { class: 'row' + (done ? ' done' : ''), 'data-cid': c.id },
    chk,
    h('div', { class: 'body' }, h('div', { class: 'title' }, c.title), h('div', { class: 'ctx', html: ctxLine })),
    h('div', { class: 'right' }, c.importance === 'must' && !done ? h('span', { class: 'tag must' }, 'Must') : null, svgChev()));
  row.onclick = () => openCandidate(c);
  return row;
}
function taskRow(t, opts) { return candRow({ id: t.id, kind: 'task', ref: t, title: t.title, importance: t.importance }, opts); }
async function doCandidate(c) {
  if (c.kind === 'task') return c.ref.status === 'open' ? completeTask(c.ref.id) : uncompleteTask(c.ref.id);
  if (c.kind === 'routine') return quickLogRoutine(c.ref);
  if (c.kind === 'maintenance') return recordMaintenance(c.ref.id);
  if (c.kind === 'step') return completeStep(c.ref.id);
}
function openCandidate(c) {
  if (c.kind === 'task') return openTaskEditor(c.ref);
  if (c.kind === 'routine') return openRoutineSheet(c.ref);
  if (c.kind === 'maintenance') return openMaintenanceSheet(c.ref);
  if (c.kind === 'step') { nav('projects', { id: c.ref.project_id }); }
}
async function quickLogRoutine(r) {
  if (r.pet_id) return openRoutineSheet(r);   // ask duration/focus for Ruby
  await logRoutine(r.id);
}
// swipe-to-act wrapper for phones (left: snooze/delete)
function swipeable(row, { onSnooze, onDelete }) {
  const wrap = h('div', { class: 'swipe' });
  const under = h('div', { class: 'under' });
  if (onSnooze) under.append(h('button', { class: 'snooze', onclick: e => { e.stopPropagation(); reset(); onSnooze(); } }, 'Tomorrow'));
  if (onDelete) under.append(h('button', { class: 'del', onclick: e => { e.stopPropagation(); reset(); onDelete(); } }, 'Delete'));
  wrap.append(under, row);
  let sx = 0, sy = 0, dx = 0, active = false, horiz = null;
  const reset = () => { row.style.transform = ''; wrap.dataset.open = ''; };
  row.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; active = true; horiz = null; row.style.transition = 'none'; wrap.classList.add('dragging'); }, { passive: true });
  row.addEventListener('touchmove', e => {
    if (!active) return; const x = e.touches[0].clientX - sx, y = e.touches[0].clientY - sy;
    if (horiz === null && (Math.abs(x) > 6 || Math.abs(y) > 6)) horiz = Math.abs(x) > Math.abs(y);
    if (!horiz) return; dx = Math.min(0, x); row.style.transform = `translateX(${Math.max(dx, -150)}px)`;
  }, { passive: true });
  row.addEventListener('touchend', () => { active = false; row.style.transition = ''; wrap.classList.remove('dragging'); if (dx < -60) { row.style.transform = 'translateX(-150px)'; wrap.dataset.open = '1'; } else reset(); }, { passive: true });
  row.addEventListener('click', e => { if (wrap.dataset.open) { e.stopPropagation(); reset(); } }, true);
  return wrap;
}

// ═══════════════════════════════════════════════════════════════════════════
// TODAY
// ═══════════════════════════════════════════════════════════════════════════
renderers.today = function renderToday() {
  const body = $('#today-body'); const scroll = body.scrollTop;
  const C = ctx(); const today = C.today;
  const plan = P.planDay(today, C);
  const attn = attention(C);
  const mode = P.modeFor(today, C);
  const wx = S.weather[today];
  const doneToday = S.all('tasks').filter(t => t.status === 'done' && D.dateOf(t.completed_at, S.tz) === today);
  const person = S.person?.name?.split(' ')[0] || '';
  const hour = Number(C.now.slice(0, 2));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  body.innerHTML = '';
  const wrap = h('div', { class: 'container' });
  // hero
  const capPct = plan.capacity.minutes ? Math.min(100, Math.round(plan.used / plan.capacity.minutes * 100)) : 100;
  const modeChip = mode.mode !== 'normal' ? h('span', { class: 'mode-chip', onclick: () => openDayModeSheet(today) }, `${{ sick: '🤒', travel: '✈️', busy: '💼', vacation: '🌴', project: '🔨' }[mode.mode] || ''} ${mode.mode} day`) : h('span', { class: 'mode-chip', style: 'background:var(--bg3);color:var(--text3)', onclick: () => openDayModeSheet(today) }, 'normal day ▾');
  wrap.append(h('div', { class: 'today-hero' },
    h('div', {}, h('div', { class: 'date' }, `${D.longDate(today)}${wx ? ` · ${wx.tmax_f}° · ${wx.rain_prob}% rain` : ''}`), h('h2', {}, `${greet}${person ? ', ' + person : ''}.`), h('div', { style: 'margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, modeChip, plan.overloaded ? h('span', { class: 'tag coral' }, 'Overloaded') : null)),
    h('div', { class: 'cap-meter' + (capPct >= 100 && plan.used > plan.capacity.minutes ? ' over' : '') },
      h('div', { class: 'lbl' }, h('span', {}, 'Planned time'), h('b', {}, plan.capacity.mustOnly ? 'Must-dos only' : `${mins(plan.used) || '0m'} of ${mins(plan.capacity.minutes) || '0m'}`)),
      h('div', { class: 'bar' }, h('i', { style: `width:${capPct}%` })),
      h('div', { class: 'faint', style: 'font-size:11.5px;margin-top:5px' }, `${doneToday.length} done today · capacity from ${mode.mode} ${D.isWeekend(today) ? 'weekend' : 'weekday'}`))));

  const cols = h('div', { class: 'today-cols' });
  const left = h('div'), right = h('div');
  // Must do + Today
  const card1 = h('div', { class: 'card' });
  if (plan.must.length) { card1.append(h('div', { class: 'card-hd' }, h('h3', {}, 'Must do'), h('span', { class: 'cnt' }, `${plan.must.length}`))); const bd = h('div', { class: 'card-bd' }); plan.must.forEach(c => bd.append(candRow(c))); card1.append(bd); }
  card1.append(h('div', { class: 'card-hd' }, h('h3', {}, 'Today'), h('span', { class: 'cnt' }, plan.planned.length ? `${plan.planned.length} planned` : '')));
  const bd2 = h('div', { class: 'card-bd' });
  if (plan.planned.length) plan.planned.forEach(c => bd2.append(candRow(c)));
  else bd2.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, plan.must.length ? '👍' : '🎉'), plan.capacity.mustOnly ? 'Must-dos only today — rest up.' : plan.must.length ? 'Nothing else planned. Enjoy the room.' : 'Nothing planned. Enjoy your day.'));
  if (doneToday.length) { bd2.append(h('div', { class: 'sec-title' }, 'Completed today')); doneToday.slice(0, 6).forEach(t => bd2.append(taskRow(t))); }
  card1.append(bd2);
  left.append(card1);

  // Coming up
  const cu = h('div', { class: 'card', style: 'margin-top:20px' }, h('div', { class: 'card-hd' }, h('h3', {}, 'Coming up'), h('button', { class: 'btn btn-quiet btn-sm', onclick: () => nav('calendar') }, 'Calendar →')));
  const cub = h('div', { class: 'card-bd' });
  let any = false;
  for (let i = 1; i <= 5; i++) {
    const d = D.addDays(today, i);
    const evs = eventsOn(d).filter(e => e.kind !== 'work_block');
    const dp = P.planDay(d, C);
    const fresh = c => !(c.due_date && c.due_date <= today) && !(c.kind === 'routine' && c.overdueDays > 0);
    const items = [...evs.map(e => ({ ev: e })), ...dp.must.filter(fresh).map(c => ({ c })), ...dp.planned.filter(c => c.importance !== 'nice' && fresh(c)).slice(0, 3).map(c => ({ c }))];
    if (!items.length) continue; any = true;
    cub.append(h('div', { class: 'coming-day' }, `${D.humanDate(d, today)}${S.weather[d] && S.weather[d].rain_prob >= 50 ? ` · 🌧 ${S.weather[d].rain_prob}%` : ''}`));
    for (const it of items) {
      if (it.ev) cub.append(h('div', { class: 'row no-line', onclick: () => openEventEditor(it.ev) }, h('div', { class: 'ico' }, '📅'), h('div', { class: 'body' }, h('div', { class: 'title' }, it.ev.title), h('div', { class: 'ctx' }, it.ev.all_day ? 'All day' : `${D.fmtHM(D.timeOf(it.ev.starts_at, S.tz))}${it.ev.ends_at ? ' – ' + D.fmtHM(D.timeOf(it.ev.ends_at, S.tz)) : ''}`)), svgChev()));
      else { const r = candRow(it.c); r.classList.add('no-line'); cub.append(r); }
    }
  }
  if (!any) cub.append(h('div', { class: 'empty' }, 'A quiet few days ahead.'));
  cu.append(cub); left.append(cu);

  // Needs attention
  const na = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, 'Needs attention'), h('span', { class: 'cnt' }, attn.length ? `${attn.length}` : '')));
  const nab = h('div', { class: 'card-bd' });
  if (!attn.length) nab.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, '✨'), 'Nothing slipping through.'));
  attn.forEach(a => nab.append(attentionRow(a)));
  na.append(nab); right.append(na);

  // Projects
  const pr = h('div', { class: 'card', style: 'margin-top:20px' }, h('div', { class: 'card-hd' }, h('h3', {}, 'Projects'), h('button', { class: 'btn btn-quiet btn-sm', onclick: () => nav('projects') }, 'All →')));
  const prb = h('div', { class: 'card-bd' });
  S.all('projects').filter(p => p.status === 'active').sort((a, b) => a.priority - b.priority).slice(0, 3).forEach(p => {
    const next = P.nextStepOf(p.id, C); const pct = projectProgress(p.id);
    prb.append(h('div', { class: 'proj-mini', onclick: () => nav('projects', { id: p.id }) },
      h('div', { class: 'body' }, h('div', { class: 'title' }, h('span', { class: 'tag violet' }, `P${p.priority}`), p.name), h('div', { class: 'next' }, next ? `Next: ${next.title}${next.est_min ? ' · ' + mins(next.est_min) : ''}` : 'All steps done'), h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` }))),
      h('div', { class: 'faint', style: 'font-weight:700;font-size:13px' }, `${pct}%`)));
  });
  pr.append(prb); right.append(pr);

  // Ruby + relationship quick logs
  const ql = h('div', { class: 'card', style: 'margin-top:20px' }, h('div', { class: 'card-hd' }, h('h3', {}, 'Quick log')));
  const qlb = h('div', { class: 'card-bd', style: 'display:flex;flex-wrap:wrap;gap:8px;padding:8px 14px 14px' });
  S.all('routines').filter(r => r.active !== false).sort((a, b) => a.name.localeCompare(b.name)).forEach(r => {
    const last = D.dateOf(r.last_done_at, S.tz); const doneToday = last === today;
    qlb.append(h('button', { class: 'chip' + (doneToday ? ' active' : ''), onclick: () => doneToday ? openRoutineSheet(r) : quickLogRoutine(r), title: last ? `Last: ${D.humanDate(last, today)}` : 'Never logged' }, `${r.emoji || '•'} ${r.name}${doneToday ? ' ✓' : ''}`));
  });
  ql.append(qlb); right.append(ql);

  cols.append(left, right); wrap.append(cols); body.append(wrap); body.scrollTop = scroll;
};
function attentionRow(a) {
  const acts = h('div', { class: 'acts' });
  const primary = actionButtonFor(a);
  if (primary) acts.append(primary);
  acts.append(h('button', { class: 'btn btn-quiet btn-sm', title: 'Snooze a day', onclick: e => { e.stopPropagation(); snoozeAttention(a.key); } }, 'Later'));
  const row = h('div', { class: 'attn' }, h('span', { class: `rank r${a.rank}` }), h('div', { class: 'body' }, h('div', { class: 'title' }, a.title), a.detail ? h('div', { class: 'detail' }, a.detail) : null), acts);
  return row;
}
function actionButtonFor(a) {
  const ac = a.action; if (!ac) return null;
  const b = (label, fn) => h('button', { class: 'btn btn-primary btn-sm', onclick: e => { e.stopPropagation(); fn(); } }, label);
  switch (ac.type) {
    case 'open_task': return b('Open', () => openTaskEditor(S.get('tasks', ac.id)));
    case 'record_maintenance': return b('Done', () => openMaintenanceSheet(S.get('maintenance_rules', ac.id)));
    case 'log_routine': return b('Log it', () => quickLogRoutine(S.get('routines', ac.id)));
    case 'schedule_routine': return b(ac.date ? `Plan ${D.humanDate(ac.date, S.today())}` : 'Schedule', () => scheduleRoutine(S.get('routines', ac.id), ac.date));
    case 'open_project': return b('Open', () => nav('projects', { id: ac.id }));
    case 'schedule_step': return b('Block time', () => scheduleStep(S.get('project_steps', ac.id), ac.date));
    case 'log_plant': return b('Log', () => openPlantLogSheet(S.get('plants', ac.id)));
  }
  return null;
}
const snoozed = new Set(JSON.parse(localStorage.getItem('hb_snooze') || '[]').filter(x => x.until > Date.now()).map(x => x.key));
function snoozeAttention(key) { snoozed.add(key); const arr = JSON.parse(localStorage.getItem('hb_snooze') || '[]').filter(x => x.until > Date.now()); arr.push({ key, until: Date.now() + 86400e3 }); localStorage.setItem('hb_snooze', JSON.stringify(arr)); renderers.today(); }
const attention = c => P.needsAttention(c).filter(i => !snoozed.has(i.key));

async function scheduleRoutine(r, date) {
  if (!r) return;
  const rule = R.normalizeRule(r.cadence);
  if (rule?.freq === 'monthly') {   // date night → create an event on a free evening
    const day = date || findFreeEvening();
    await dbInsert('events', { title: r.name, kind: 'fixed', starts_at: D.toISO(day, '19:00', S.tz), ends_at: D.toISO(day, '22:00', S.tz), color: 'violet', notes: 'Planned from Needs Attention' });
    toast(`${r.name} on ${D.humanDate(day, S.today())} — tap to adjust`); nav('calendar', { date: day }); return;
  }
  const day = date || S.today();
  await dbInsert('tasks', { title: r.name, importance: r.importance || 'should', due_date: day, duration_min: r.default_min || 30, location: r.location || 'home', weather_dependent: !!r.weather_dependent, area_id: r.area_id || null, routine_id: r.id, source: 'routine' });
  toast(`${r.name} planned for ${D.humanDate(day, S.today())}`);
}
function findFreeEvening() {
  const t = S.today();
  for (let i = 1; i < 21; i++) { const d = D.addDays(t, i); const w = D.dow(d); if (!['fri','sat','thu'].includes(w)) continue; if (!eventsOn(d).some(e => e.kind !== 'work_block' && D.hmToMin(D.timeOf(e.starts_at, S.tz)) >= 17 * 60)) return d; }
  return D.addDays(t, 7);
}
async function scheduleStep(step, date) {
  if (!step) return; const p = projOf(step.project_id);
  const day = date || S.today();
  const start = D.isWeekend(day) ? '09:00' : '18:00';
  const t = await dbInsert('tasks', { title: step.title, importance: 'should', due_date: day, scheduled_start: D.toISO(day, start, S.tz), scheduled_end: D.toISO(day, D.minToHM(D.hmToMin(start) + (step.est_min || 90)), S.tz), duration_min: step.est_min || 90, location: 'home', project_id: p?.id || null, step_id: step.id, area_id: p?.area_id || null, source: 'planner' });
  await dbInsert('events', { title: `${p?.name || 'Project'}: ${step.title}`, kind: 'work_block', starts_at: t.scheduled_start, ends_at: t.scheduled_end, task_id: t.id, project_id: p?.id || null, color: 'violet' }, { silent: true });
  toast(`Blocked ${D.humanDate(day, S.today())} ${D.fmtHM(start)} for ${step.title}`);
}
function eventsOn(ds) { return S.all('events').filter(e => D.dateOf(e.starts_at, S.tz) === ds).sort((a, b) => a.starts_at.localeCompare(b.starts_at)); }

// day mode sheet -------------------------------------------------------------
function openDayModeSheet(date) {
  const cur = P.modeFor(date, ctx());
  let mode = cur.mode, to = date, note = cur.note || '';
  const MODES = [['normal','Normal','Full capacity'],['busy','Busy workday','Reduced discretionary time'],['sick','Sick','Must-dos only, routines reduced'],['travel','Travel','Only away-friendly tasks'],['project','Project day','Big block for a priority project'],['vacation','Vacation','Nothing planned unless you ask']];
  openSheet({ title: `Day mode · ${D.humanDate(date, S.today())}`, build: b => {
    const list = h('div', { class: 'rows' });
    MODES.forEach(([v, l, sub]) => { const it = h('div', { class: 'srow' }, h('span', { class: 'ic' }, { normal: '☀️', busy: '💼', sick: '🤒', travel: '✈️', project: '🔨', vacation: '🌴' }[v]), h('div', { style: 'flex:1' }, h('div', { class: 'lb', style: 'color:var(--text)' }, l), h('div', { class: 'faint', style: 'font-size:12px' }, sub)), h('div', { class: 'check' + (mode === v ? ' on' : ''), 'data-v': v }, svgCheck())); it.onclick = () => { mode = v; $$('.check', list).forEach(c => c.classList.toggle('on', c.dataset.v === v)); }; list.append(it); });
    b.append(list);
    const toI = h('input', { type: 'date', value: to, min: date, onchange: e => to = e.target.value });
    b.append(h('div', { class: 'rows' }, srow('📅', 'Through', toI)));
    const nI = h('input', { class: 'big-input', style: 'margin-top:12px;font-size:15px', placeholder: 'Note (optional) — “conference in Houston”', value: note, oninput: e => note = e.target.value }); b.append(nI);
    b.append(h('p', { class: 'faint', style: 'font-size:12.5px;margin-top:12px' }, 'HomeBase re-plans the affected days: must-dos stay, routines shrink to their short version, everything else moves without piling onto one day.'));
  }, onSave: async () => { await applyDayMode(date, to, mode, note); } });
}
async function applyDayMode(from, to, mode, note) {
  const days = []; for (let d = from; d <= to && days.length < 31; d = D.addDays(d, 1)) days.push(d);
  const C = ctx();
  const result = mode === 'normal' ? null : P.replan(days, mode, C);
  for (const d of days) {
    const ex = S.all('day_modes').find(m => m.date === d && !m.person_id);
    if (mode === 'normal') { if (ex) await dbRemove('day_modes', ex.id, { silent: true }); }
    else if (ex) await dbUpdate('day_modes', ex.id, { mode, note: note || null }, { silent: true });
    else await dbInsert('day_modes', { date: d, mode, note: note || null }, { silent: true });
  }
  if (mode === 'normal') {
    // restore tasks moved by a previous replan
    for (const t of S.all('tasks').filter(t => t.status === 'open' && t.original_date && days.includes(t.original_date))) await dbUpdate('tasks', t.id, { due_date: t.original_date, original_date: null }, { silent: true, reason: 'replan:normal' });
    toast('Back to normal'); return;
  }
  let moved = 0;
  for (const m of result.move) if (m.to) { await dbUpdate('tasks', m.task.id, { due_date: m.to, original_date: m.task.original_date || m.task.due_date || from, scheduled_start: null, scheduled_end: null, postponed: (m.task.postponed || 0) + 1 }, { action: 'replan', reason: `replan:${mode}` }); moved++; }
  logAct('day_mode', null, 'replan', null, { from, to, mode, kept: result.keep.length, reduced: result.reduce.length, moved }, note);
  toast(`${mode} mode: kept ${result.keep.length}, reduced ${result.reduce.length}, moved ${moved}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════════════════════
const TS = { list: 'today', filter: 'open', q: '' };
renderers.tasks = function renderTasks(params) {
  if (params?.list) TS.list = params.list;
  const root = $('#tasks-layout');
  const scrollPos = $('.tasks-main .scroll', root)?.scrollTop || 0;
  root.innerHTML = '';
  const today = S.today();
  const open = S.all('tasks').filter(t => t.status === 'open');
  const side = h('div', { class: 'tasks-side' + (isPhone() && TS.list === '_home' ? ' mobile-show' : '') });
  const sideScroll = h('div', { class: 'scroll' });
  const item = (key, em, label, cnt) => { const it = h('div', { class: 'side-item' + (TS.list === key ? ' active' : '') }, h('span', { class: 'em' }, em), label, cnt != null ? h('span', { class: 'cnt' }, cnt) : null); it.onclick = () => { TS.list = key; renderers.tasks(); }; return it; };
  sideScroll.append(h('div', { class: 'sec-title' }, 'Views'),
    item('today', '☀️', 'Today', open.filter(t => t.due_date && t.due_date <= today).length),
    item('week', '📆', 'This week', open.filter(t => t.due_date && t.due_date <= D.addDays(today, 7)).length),
    item('all', '📋', 'All open', open.length),
    item('mine', '👤', 'Mine', open.filter(t => t.assignee_id === S.person?.id).length),
    item('backlog', '🗂️', 'Backlog', open.filter(t => !t.due_date && !t.scheduled_start && !t.window_start).length),
    item('done', '✅', 'Done', null));
  const grp = (kind, label) => { const as = S.all('areas').filter(a => a.kind === kind && !a.archived).sort((a, b) => a.sort - b.sort); if (!as.length) return; sideScroll.append(h('div', { class: 'sec-title' }, label, h('button', { class: 'link', onclick: () => openAreaEditor(null, kind) }, '+ Add'))); as.forEach(a => sideScroll.append(item('area:' + a.id, a.emoji || '📁', a.name, open.filter(t => t.area_id === a.id).length))); };
  grp('room', 'Rooms'); grp('relationship', 'Relationship'); grp('life', 'Life');
  const rts = S.all('routines').filter(r => r.active !== false);
  if (rts.length) sideScroll.append(h('div', { class: 'sec-title' }, 'Routines'), item('routines', '🔁', 'Routines', rts.length));
  side.append(sideScroll);

  const main = h('div', { class: 'tasks-main' + (isPhone() && TS.list === '_home' ? ' mobile-hide' : '') });
  let title = 'Today', list = [];
  const sortDue = arr => arr.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || P.IMPORTANCE_W[b.importance] - P.IMPORTANCE_W[a.importance]);
  if (TS.list === 'today') { title = 'Today'; list = sortDue(open.filter(t => (t.due_date && t.due_date <= today) || D.dateOf(t.scheduled_start, S.tz) === today)); }
  else if (TS.list === 'week') { title = 'This week'; list = sortDue(open.filter(t => (t.due_date && t.due_date <= D.addDays(today, 7)) || (t.scheduled_start && D.dateOf(t.scheduled_start, S.tz) <= D.addDays(today, 7)))); }
  else if (TS.list === 'all') { title = 'All open'; list = sortDue(open); }
  else if (TS.list === 'mine') { title = 'Mine'; list = sortDue(open.filter(t => t.assignee_id === S.person?.id)); }
  else if (TS.list === 'backlog') { title = 'Backlog'; list = open.filter(t => !t.due_date && !t.scheduled_start && !t.window_start).sort((a, b) => P.IMPORTANCE_W[b.importance] - P.IMPORTANCE_W[a.importance]); }
  else if (TS.list === 'done') { title = 'Done'; list = S.all('tasks').filter(t => t.status === 'done').sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || '')).slice(0, 200); }
  else if (TS.list.startsWith('area:')) { const a = areaOf(TS.list.slice(5)); title = a ? `${a.emoji || ''} ${a.name}` : 'Area'; list = sortDue(open.filter(t => t.area_id === a?.id)); }
  if (TS.q) list = list.filter(t => t.title.toLowerCase().includes(TS.q.toLowerCase()));

  const hd = h('div', { class: 'list-hd' });
  if (isPhone()) hd.append(h('button', { class: 'icon-btn', onclick: () => { TS.list = '_home'; renderers.tasks(); }, 'aria-label': 'Lists' }, h('span', { html: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>' })));
  hd.append(h('h2', {}, title));
  const search = h('input', { class: 'chip', style: 'width:150px;font-weight:500', placeholder: 'Search', value: TS.q, oninput: debounce(e => { TS.q = e.target.value; renderers.tasks(); }, 200) });
  hd.append(search, h('button', { class: 'btn btn-primary btn-sm', onclick: () => openTaskEditor(null, TS.list.startsWith('area:') ? { area_id: TS.list.slice(5) } : {}) }, '+ Task'));
  main.append(hd);
  const sc = h('div', { class: 'scroll', style: 'flex:1;padding:0 12px 140px' });
  if (TS.list === 'routines') { sc.append(routinesList()); }
  else if (TS.list === '_home') { /* phone list picker shown in side */ }
  else if (!list.length) sc.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, '🎉'), 'Nothing here.'));
  else {
    const card = h('div', { class: 'card' }); const bd = h('div', { class: 'card-bd' });
    let lastHead = null;
    for (const t of list) {
      if (TS.list === 'today' || TS.list === 'week' || TS.list === 'all') {
        const head = !t.due_date ? 'No date' : t.due_date < today ? 'Overdue' : D.humanDate(t.due_date, today);
        if (head !== lastHead) { bd.append(h('div', { class: 'sec-title', style: head === 'Overdue' ? 'color:var(--coral)' : '' }, head)); lastHead = head; }
      }
      const row = taskRow(t); row.classList.add('no-line');
      bd.append(isPhone() && t.status === 'open' ? swipeable(row, { onSnooze: () => postponeTask(t.id, D.addDays(today, 1), 'snooze'), onDelete: () => deleteTaskConfirm(t) }) : row);
    }
    card.append(bd); sc.append(card);
  }
  main.append(sc);
  root.append(side, main);
  const s = $('.tasks-main .scroll', root); if (s) s.scrollTop = scrollPos;
  if (isPhone() && TS.list === '_home') { main.classList.add('mobile-hide'); side.classList.add('mobile-show'); }
};
function routinesList() {
  const card = h('div', { class: 'card' }); const bd = h('div', { class: 'card-bd' });
  const today = S.today();
  S.all('routines').filter(r => r.active !== false).sort((a, b) => a.name.localeCompare(b.name)).forEach(r => {
    const last = D.dateOf(r.last_done_at, S.tz); const st = R.dueState(r.cadence, last, today);
    const row = h('div', { class: 'row', onclick: () => openRoutineSheet(r) }, h('div', { class: 'ico' }, r.emoji || '🔁'), h('div', { class: 'body' }, h('div', { class: 'title' }, r.name), h('div', { class: 'ctx', html: `${esc(R.describeRule(r.cadence))} · last ${last ? esc(D.humanDate(last, today)) : 'never'}${r.streak ? ` · 🔥 ${r.streak}` : ''}${st.due && last !== today ? ' · <b style="color:var(--amber)">due</b>' : ''}` })), h('div', { class: 'right' }, h('button', { class: 'btn btn-ghost btn-sm', onclick: e => { e.stopPropagation(); quickLogRoutine(r); } }, last === today ? 'Log again' : 'Log'), svgChev()));
    bd.append(row);
  });
  card.append(bd); return card;
}
async function deleteTaskConfirm(t) {
  if (await confirmSheet('Delete task?', `“${t.title}” will be removed. Completed history stays in the log.`)) { await dbRemove('tasks', t.id); toast('Deleted'); }
}

// ─── TASK EDITOR ──────────────────────────────────────────────────────────
function openTaskEditor(task, defaults = {}) {
  const isNew = !task;
  const t = task ? { ...task } : { title: '', notes: '', importance: 'should', due_date: null, duration_min: 30, location: 'home', energy: 'med', weather_dependent: false, area_id: null, project_id: null, assignee_id: null, recurrence: null, scheduled_start: null, scheduled_end: null, ...defaults };
  openSheet({ title: isNew ? 'New task' : 'Task', saveLabel: isNew ? 'Add' : 'Save', build: b => {
    const title = h('input', { class: 'big-input', placeholder: 'What needs to happen?', value: t.title, autofocus: true, oninput: e => t.title = e.target.value, onkeydown: e => { if (e.key === 'Enter') $('#sheet-right').click(); } });
    const notes = h('textarea', { class: 'big-input', style: 'margin-top:8px', placeholder: 'Notes', rows: 2, oninput: e => t.notes = e.target.value }, t.notes || '');
    b.append(title, notes);
    const seg = h('div', { class: 'seg-imp' });
    [['must','Must do','Consequences if skipped'],['should','Should do','Important, movable'],['nice','Nice to do','When time permits']].forEach(([v, l, s]) => { const btn = h('button', { class: v + (t.importance === v ? ' active' : ''), title: s }, l); btn.onclick = () => { t.importance = v; $$('button', seg).forEach(x => x.classList.toggle('active', x.classList.contains(v))); }; seg.append(btn); });
    b.append(seg);
    const rows = h('div', { class: 'rows' });
    const due = h('input', { type: 'date', value: t.due_date || '', onchange: e => t.due_date = e.target.value || null });
    rows.append(srow('📅', 'Due', due));
    const schedV = vtext(t.scheduled_start ? `${D.humanDate(D.dateOf(t.scheduled_start, S.tz), S.today())} ${D.fmtHM(D.timeOf(t.scheduled_start, S.tz))}` : 'None');
    rows.append(srow('🕐', 'Work block', schedV, async () => {
      const d = t.scheduled_start ? D.dateOf(t.scheduled_start, S.tz) : (t.due_date || S.today()); const tm = t.scheduled_start ? D.timeOf(t.scheduled_start, S.tz) : (D.isWeekend(d) ? '09:00' : '18:00');
      const r = await scheduleSheet(d, tm, t.duration_min); if (r === null) return; if (r === false) { t.scheduled_start = t.scheduled_end = null; schedV.textContent = 'None'; return; }
      t.scheduled_start = D.toISO(r.date, r.time, S.tz); t.scheduled_end = D.toISO(r.date, D.minToHM(D.hmToMin(r.time) + (t.duration_min || 30)), S.tz); schedV.textContent = `${D.humanDate(r.date, S.today())} ${D.fmtHM(r.time)}`;
    }));
    const dur = h('input', { type: 'number', min: 5, step: 5, value: t.duration_min || '', placeholder: '30', style: 'width:64px', onchange: e => t.duration_min = Number(e.target.value) || null });
    rows.append(srow('⏱️', 'Duration (min)', dur));
    const areaV = vtext(t.area_id ? areaLabel(t.area_id) : 'None');
    rows.append(srow('📁', 'Area', areaV, async () => { const v = await pickOne('Area', [{ value: null, label: 'None' }, ...S.all('areas').filter(a => !a.archived).sort((a, b) => a.sort - b.sort).map(a => ({ value: a.id, label: `${a.emoji || ''} ${a.name}` }))], t.area_id); t.area_id = v; areaV.textContent = v ? areaLabel(v) : 'None'; }));
    const projV = vtext(t.project_id ? projOf(t.project_id)?.name : 'None');
    rows.append(srow('📐', 'Project', projV, async () => { const v = await pickOne('Project', [{ value: null, label: 'None' }, ...S.all('projects').filter(p => p.status === 'active').sort((a, b) => a.priority - b.priority).map(p => ({ value: p.id, label: p.name }))], t.project_id); t.project_id = v; projV.textContent = v ? projOf(v)?.name : 'None'; if (v && !t.area_id) { t.area_id = projOf(v)?.area_id || null; areaV.textContent = t.area_id ? areaLabel(t.area_id) : 'None'; } }));
    const repV = vtext(R.describeRule(t.recurrence) === 'Once' ? 'Never' : R.describeRule(t.recurrence));
    rows.append(srow('🔁', 'Repeat', repV, async () => { const v = await repeatPicker(t.recurrence); if (v === undefined) return; t.recurrence = v; repV.textContent = v ? R.describeRule(v) : 'Never'; }));
    const whoV = vtext(t.assignee_id ? personOf(t.assignee_id)?.name : 'Anyone');
    rows.append(srow('👤', 'Who', whoV, async () => { const v = await pickOne('Who', [{ value: null, label: 'Anyone' }, ...S.people.map(p => ({ value: p.id, label: p.name }))], t.assignee_id); t.assignee_id = v; whoV.textContent = v ? personOf(v)?.name : 'Anyone'; }));
    const loc = h('select', { onchange: e => t.location = e.target.value }, ...[['home','At home'],['anywhere','Anywhere'],['away','Out / errand']].map(([v, l]) => h('option', { value: v, selected: t.location === v }, l)));
    rows.append(srow('📍', 'Where', loc));
    const wx = h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: t.weather_dependent, onchange: e => t.weather_dependent = e.target.checked }), h('i'));
    rows.append(srow('🌦️', 'Needs dry weather', wx));
    const en = h('select', { onchange: e => t.energy = e.target.value }, ...[['low','Low'],['med','Medium'],['high','High']].map(([v, l]) => h('option', { value: v, selected: t.energy === v }, l)));
    rows.append(srow('⚡', 'Energy', en));
    b.append(rows);
    if (!isNew) {
      const acts = h('div', { style: 'display:flex;gap:8px;margin-top:16px;flex-wrap:wrap' });
      if (t.status === 'open') { acts.append(h('button', { class: 'btn btn-ghost', onclick: () => { closeSheet(); postponeTask(t.id, D.addDays(S.today(), 1), 'manual'); } }, 'Tomorrow'), h('button', { class: 'btn btn-ghost', onclick: () => { closeSheet(); postponeTask(t.id, D.addDays(S.today(), D.dow(S.today()) === 'sat' ? 7 : (6 - D.DOW.indexOf(D.dow(S.today())) + 7) % 7 || 7), 'manual'); } }, 'This weekend')); }
      acts.append(h('button', { class: 'btn btn-danger', style: 'margin-left:auto', onclick: () => { closeSheet(); deleteTaskConfirm(t); } }, 'Delete'));
      b.append(acts);
      const hist = S.all('activity_log').filter(a => a.entity_id === t.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
      if (hist.length) { b.append(h('div', { class: 'sec-title' }, 'History')); hist.forEach(a => b.append(h('div', { class: 'faint', style: 'font-size:12.5px;padding:3px 4px' }, `${D.humanDate(D.dateOf(a.at, S.tz), S.today())} · ${a.action}${a.reason ? ' · ' + a.reason : ''}${a.actor === 'ai' ? ' · HomeBase' : ''}`))); }
    }
  }, onSave: async () => {
    if (!t.title.trim()) { toast('Give it a name'); return false; }
    const patch = { title: t.title.trim(), notes: t.notes || null, importance: t.importance, due_date: t.due_date || null, duration_min: t.duration_min || null, location: t.location, energy: t.energy, weather_dependent: !!t.weather_dependent, area_id: t.area_id || null, project_id: t.project_id || null, assignee_id: t.assignee_id || null, recurrence: t.recurrence || null, scheduled_start: t.scheduled_start || null, scheduled_end: t.scheduled_end || null };
    if (isNew) { if (patch.recurrence) patch.series_id = uuid(); if (patch.recurrence && !patch.due_date) patch.due_date = S.today(); await dbInsert('tasks', { ...patch, status: 'open', source: 'user', postponed: 0 }); toast('Added'); }
    else { if (patch.recurrence && !task.series_id) patch.series_id = uuid(); await dbUpdate('tasks', task.id, patch); }
  } });
}
function scheduleSheet(date, time, duration) {
  return new Promise(res => {
    let d = date, tm = time;
    const inner = openSheetNested('Work block', b => {
      b.append(h('div', { class: 'rows' }, srow('📅', 'Date', h('input', { type: 'date', value: d, onchange: e => d = e.target.value })), srow('🕐', 'Start', h('input', { type: 'time', value: tm, onchange: e => tm = e.target.value }))));
      const free = freeSlots(d, duration || 30);
      if (free.length) { b.append(h('div', { class: 'sec-title' }, 'Open slots')); const ch = h('div', { class: 'chips' }); free.slice(0, 6).forEach(s => ch.append(h('button', { onclick: () => { tm = s; $$('input[type=time]', b)[0].value = s; } }, D.fmtHM(s)))); b.append(ch); }
      b.append(h('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:14px', onclick: () => { inner.close(); res(false); } }, 'Remove work block'));
    }, () => res({ date: d, time: tm }), () => res(null));
  });
}
// nested sheet = reuse picker panel for a second level
function openSheetNested(title, build, onSave, onCancel) {
  const pk = $('#picker'); $('#picker-title').textContent = title; const body = $('#picker-body'); body.innerHTML = ''; body.style.padding = '16px';
  build(body);
  const close = () => { pk.classList.remove('open'); body.style.padding = '8px'; };
  $('#picker-done').onclick = () => { close(); onSave(); };
  pk.onclick = e => { if (e.target === pk) { close(); onCancel && onCancel(); } };
  pk.classList.add('open');
  return { close };
}
function freeSlots(ds, dur) {
  const settings = P.settingsOf(ctx()); const wins = D.isWeekend(ds) ? settings.windows.weekend : settings.windows.weekday;
  const busy = eventsOn(ds).map(e => [D.hmToMin(D.timeOf(e.starts_at, S.tz)), e.ends_at ? D.hmToMin(D.timeOf(e.ends_at, S.tz)) : D.hmToMin(D.timeOf(e.starts_at, S.tz)) + 60]);
  const out = [];
  for (const w of wins) for (let m = D.hmToMin(w.start); m + dur <= D.hmToMin(w.end); m += 30) if (!busy.some(([s, e]) => m < e && m + dur > s)) out.push(D.minToHM(m));
  return out;
}
async function repeatPicker(cur) {
  const opts = [{ value: '', label: 'Never' }, { value: 'daily', label: 'Daily' }, { value: 'weekdays', label: 'Weekdays' }, { value: 'weekly', label: 'Weekly' }, { value: 'weekend', label: 'Weekly, Sat or Sun' }, { value: 'biweekly', label: 'Every 2 weeks' }, { value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Every 3 months' }, { value: 'biannual', label: 'Every 6 months' }, { value: 'yearly', label: 'Yearly' }, { value: 'custom', label: 'Custom…' }];
  const key = !cur ? '' : cur.freq === 'weekly' && cur.byweekday?.join() === 'sat,sun' ? 'weekend' : cur.freq === 'daily' && cur.byweekday?.length === 5 ? 'weekdays' : cur.freq === 'weekly' && (cur.interval || 1) === 2 ? 'biweekly' : cur.freq === 'monthly' && cur.interval === 3 ? 'quarterly' : cur.freq === 'monthly' && cur.interval === 6 ? 'biannual' : (cur.interval || 1) === 1 ? cur.freq : 'custom';
  const v = await pickOne('Repeat', opts, key);
  if (v === key) return undefined;
  if (v === '') return null;
  if (v === 'weekend') return { freq: 'weekly', byweekday: ['sat','sun'], anchor: 'schedule' };
  if (v === 'weekdays') return { freq: 'daily', byweekday: ['mon','tue','wed','thu','fri'], anchor: 'schedule' };
  if (v === 'custom') { const n = Number(prompt('Every how many…', '2')) || 2; const u = (prompt('days, weeks or months?', 'weeks') || 'weeks').toLowerCase(); return { freq: u.startsWith('d') ? 'daily' : u.startsWith('m') ? 'monthly' : 'weekly', interval: n, anchor: 'completion' }; }
  return { ...R.legacyRepeatToRule(v), anchor: 'schedule' };
}

// ─── ROUTINE SHEET (log with details, edit cadence) ───────────────────────
function openRoutineSheet(r) {
  const today = S.today(); const last = D.dateOf(r.last_done_at, S.tz);
  let dur = r.default_min || 10, focus = '', note = '', reduced = false;
  const logs = S.all('routine_log').filter(l => l.routine_id === r.id).sort((a, b) => b.done_at.localeCompare(a.done_at));
  openSheet({ title: `${r.emoji || ''} ${r.name}`, saveLabel: 'Log it', build: b => {
    b.append(h('p', { class: 'muted', style: 'font-size:14px' }, `${R.describeRule(r.cadence)} · last ${last ? D.humanDate(last, today) : 'never'}${r.streak ? ` · streak ${r.streak}` : ''}`));
    const rows = h('div', { class: 'rows' });
    rows.append(srow('⏱️', 'Minutes', h('input', { type: 'number', min: 1, value: dur, style: 'width:64px', onchange: e => dur = Number(e.target.value) || null })));
    if (r.pet_id) { const sel = h('select', { onchange: e => focus = e.target.value }, h('option', { value: '' }, 'Focus…'), ...['recall','heel','sit/stay','place','leash manners','crate','tricks','socialization'].map(f => h('option', { value: f }, f))); rows.append(srow('🎯', 'Focus', sel)); }
    if (r.min_version) rows.append(srow('🪶', `Short version (${r.min_version})`, h('label', { class: 'toggle' }, h('input', { type: 'checkbox', onchange: e => { reduced = e.target.checked; if (reduced) dur = Math.min(dur, 5); } }), h('i'))));
    b.append(rows, h('input', { class: 'big-input', style: 'margin-top:10px;font-size:15px', placeholder: 'Note (optional)', oninput: e => note = e.target.value }));
    if (logs.length) { b.append(h('div', { class: 'sec-title' }, 'Recent')); logs.slice(0, 7).forEach(l => b.append(h('div', { class: 'faint', style: 'font-size:13px;padding:3px 4px' }, `${D.humanDate(D.dateOf(l.done_at, S.tz), today)} · ${l.duration_min ? l.duration_min + ' min' : ''}${l.detail?.focus ? ' · ' + l.detail.focus : ''}${l.note ? ' · ' + l.note : ''}`))); }
    b.append(h('div', { style: 'display:flex;gap:8px;margin-top:16px' }, h('button', { class: 'btn btn-ghost', onclick: () => openRoutineEditor(r) }, 'Edit routine')));
  }, onSave: async () => { await logRoutine(r.id, { duration_min: dur, detail: focus || reduced ? { focus: focus || undefined, reduced } : null, note }); } });
}
function openRoutineEditor(r) {
  const isNew = !r; const x = r ? { ...r } : { name: '', emoji: '🔁', cadence: { freq: 'weekly' }, default_min: 15, importance: 'should', location: 'home', weather_dependent: false, min_version: '' };
  openSheet({ title: isNew ? 'New routine' : 'Edit routine', build: b => {
    b.append(h('input', { class: 'big-input', placeholder: 'Routine name', value: x.name, autofocus: true, oninput: e => x.name = e.target.value }));
    const rows = h('div', { class: 'rows' });
    rows.append(srow('😀', 'Emoji', h('input', { type: 'text', value: x.emoji || '', maxlength: 2, style: 'width:50px;text-align:right;background:none;border:none;font-size:18px', oninput: e => x.emoji = e.target.value })));
    const repV = vtext(R.describeRule(x.cadence)); rows.append(srow('🔁', 'Cadence', repV, async () => { const v = await repeatPicker(x.cadence); if (v === undefined) return; x.cadence = v || { freq: 'weekly' }; repV.textContent = R.describeRule(x.cadence); }));
    rows.append(srow('⏱️', 'Usual minutes', h('input', { type: 'number', value: x.default_min || '', style: 'width:64px', onchange: e => x.default_min = Number(e.target.value) || null })));
    rows.append(srow('🪶', 'Short version', h('input', { type: 'text', value: x.min_version || '', placeholder: 'e.g. 3-minute session', style: 'text-align:right;background:none;border:none;font-size:14px;width:60%', oninput: e => x.min_version = e.target.value })));
    const imp = h('select', { onchange: e => x.importance = e.target.value }, ...['must','should','nice'].map(v => h('option', { value: v, selected: x.importance === v }, v))); rows.append(srow('❗', 'Importance', imp));
    const areaV = vtext(x.area_id ? areaLabel(x.area_id) : 'None'); rows.append(srow('📁', 'Area', areaV, async () => { const v = await pickOne('Area', [{ value: null, label: 'None' }, ...S.all('areas').map(a => ({ value: a.id, label: `${a.emoji || ''} ${a.name}` }))], x.area_id); x.area_id = v; areaV.textContent = v ? areaLabel(v) : 'None'; }));
    rows.append(srow('🌦️', 'Needs dry weather', h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: x.weather_dependent, onchange: e => x.weather_dependent = e.target.checked }), h('i'))));
    b.append(rows);
    if (!isNew) b.append(h('button', { class: 'btn btn-danger', style: 'margin-top:16px', onclick: async () => { closeSheet(); await dbUpdate('routines', r.id, { active: false }); toast('Routine archived'); } }, 'Archive routine'));
  }, onSave: async () => {
    if (!x.name.trim()) return false;
    const patch = { name: x.name.trim(), emoji: x.emoji || null, cadence: x.cadence, default_min: x.default_min || null, importance: x.importance, area_id: x.area_id || null, weather_dependent: !!x.weather_dependent, min_version: x.min_version || null, location: x.location || 'home' };
    if (isNew) await dbInsert('routines', { ...patch, active: true, streak: 0 }); else await dbUpdate('routines', r.id, patch);
  } });
}
function openAreaEditor(a, kind = 'room') {
  const x = a ? { ...a } : { name: '', emoji: '📁', kind };
  openSheet({ title: a ? 'Edit area' : `New ${kind === 'room' ? 'room' : 'area'}`, build: b => {
    b.append(h('input', { class: 'big-input', placeholder: 'Name', value: x.name, autofocus: true, oninput: e => x.name = e.target.value }));
    b.append(h('div', { class: 'rows' }, srow('😀', 'Emoji', h('input', { type: 'text', value: x.emoji, maxlength: 2, style: 'width:50px;text-align:right;background:none;border:none;font-size:18px', oninput: e => x.emoji = e.target.value })), srow('🏷️', 'Kind', h('select', { onchange: e => x.kind = e.target.value }, ...[['room','Room'],['life','Life'],['relationship','Relationship']].map(([v, l]) => h('option', { value: v, selected: x.kind === v }, l))))));
  }, onSave: async () => { if (!x.name.trim()) return false; if (a) await dbUpdate('areas', a.id, { name: x.name.trim(), emoji: x.emoji, kind: x.kind }); else await dbInsert('areas', { name: x.name.trim(), emoji: x.emoji, kind: x.kind, sort: S.all('areas').length }); } });
}