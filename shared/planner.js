// HomeBase v2 — deterministic Today planner + Needs Attention rules (plan §5) and
// replanning helpers (plan §6). Pure functions; same code runs in the browser and the Worker.
import { addDays, diffDays, dow, isWeekend, dayOfMonth, monthOf, dateOf, timeOf, hmToMin, dayName } from './dates.js';
import { dueState, doneThisMonth, normalizeRule } from './recurrence.js';

export const IMPORTANCE_W = { must: 100, should: 40, nice: 10 };
export const DEFAULT_SETTINGS = {
  capacity: {
    normal:   { weekday: 90,  weekend: 300 },
    busy:     { weekday: 30,  weekend: 180 },
    travel:   { weekday: 0,   weekend: 0, remote: 30 },
    sick:     { weekday: 20,  weekend: 20, must_only: true },
    vacation: { weekday: 0,   weekend: 0 },
    project:  { weekday: 90,  weekend: 360 },
  },
  windows: { weekday: [{ start: '17:30', end: '21:00' }], weekend: [{ start: '08:00', end: '18:00' }] },
  today_cap: 7,
  attention_cap: 6,
};

export function settingsOf(ctx) {
  const s = ctx.settings || {};
  return { ...DEFAULT_SETTINGS, ...s, capacity: { ...DEFAULT_SETTINGS.capacity, ...(s.capacity || {}) }, windows: { ...DEFAULT_SETTINGS.windows, ...(s.windows || {}) } };
}

export function modeFor(ds, ctx) {
  const m = (ctx.dayModes || []).find(x => x.date === ds);
  return m ? { mode: m.mode, override: m.capacity_override_min, project_id: m.project_id, note: m.note } : { mode: 'normal' };
}

function windowsFor(ds, settings) {
  return (isWeekend(ds) ? settings.windows.weekend : settings.windows.weekday) || [];
}

// minutes of fixed events overlapping the discretionary windows of `ds`
function fixedMinutes(ds, ctx, settings) {
  const wins = windowsFor(ds, settings).map(w => [hmToMin(w.start), hmToMin(w.end)]);
  let used = 0;
  for (const e of ctx.events || []) {
    if (e.kind === 'work_block') continue;                  // planner's own blocks don't consume capacity
    const sd = dateOf(e.starts_at, ctx.tz); if (sd !== ds) continue;
    if (e.all_day) { used += wins.reduce((a, [s, en]) => a + (en - s), 0); continue; }
    const s = hmToMin(timeOf(e.starts_at, ctx.tz));
    const en = e.ends_at ? hmToMin(timeOf(e.ends_at, ctx.tz)) : s + 60;
    for (const [ws, we] of wins) used += Math.max(0, Math.min(en, we) - Math.max(s, ws));
  }
  return used;
}

export function capacityFor(ds, ctx) {
  const settings = settingsOf(ctx);
  const { mode, override, project_id } = modeFor(ds, ctx);
  const table = settings.capacity[mode] || settings.capacity.normal;
  const base = override != null ? override : (isWeekend(ds) ? table.weekend : table.weekday);
  const minutes = Math.max(0, base - fixedMinutes(ds, ctx, settings));
  return { minutes, base, mode, mustOnly: !!table.must_only, remoteMinutes: mode === 'travel' ? (table.remote || 0) : null, project_id };
}

// ── candidates ─────────────────────────────────────────────────────────────
function projectPriority(t, ctx) {
  if (!t.project_id) return null;
  const p = (ctx.projects || []).find(p => p.id === t.project_id);
  return p ? p.priority : null;
}
function stepUnblocked(step, ctx) {
  if (!step.depends_on || !step.depends_on.length) return true;
  const steps = ctx.steps || [];
  return step.depends_on.every(id => { const d = steps.find(s => s.id === id); return !d || d.status === 'done' || d.status === 'skipped'; });
}
export function nextStepOf(projectId, ctx) {
  return (ctx.steps || []).filter(s => s.project_id === projectId && (s.status === 'todo' || s.status === 'doing'))
    .sort((a, b) => a.sort - b.sort).find(s => stepUnblocked(s, ctx)) || null;
}

function patternFor(entityType, entityId, ctx) {
  return (ctx.memories || []).find(m => m.kind === 'pattern' && m.status === 'active' && m.entity_type === entityType && m.entity_id === entityId);
}

// Normalise real tasks + routines + maintenance + project steps into one candidate shape
export function candidatesFor(ds, ctx) {
  const out = [];
  const seenSteps = new Set();
  for (const t of ctx.tasks || []) {
    if (t.status !== 'open') continue;
    const schedDate = dateOf(t.scheduled_start, ctx.tz);
    const inWindow = t.window_start && t.window_end && t.window_start <= ds && ds <= t.window_end;
    const dueSoon = t.due_date && diffDays(ds, t.due_date) <= 7;                  // includes overdue
    const backlog = !t.due_date && !t.window_start && !schedDate;
    if (!(schedDate === ds || inWindow || dueSoon || backlog)) continue;
    if (t.step_id) seenSteps.add(t.step_id);
    out.push({
      id: t.id, kind: 'task', ref: t, title: t.title, importance: t.importance || 'should',
      due_date: t.due_date, scheduled: schedDate === ds, duration_min: t.duration_min || 30,
      location: t.location || 'home', weather_dependent: !!t.weather_dependent, energy: t.energy || 'med',
      project_priority: projectPriority(t, ctx), postponed: t.postponed || 0,
      pattern: patternFor('task_series', t.series_id, ctx) || patternFor('routine', t.routine_id, ctx),
      area_id: t.area_id, project_id: t.project_id,
    });
  }
  // routines due
  for (const r of ctx.routines || []) {
    if (r.active === false) continue;
    const rule = normalizeRule(r.cadence);
    if (rule && rule.freq === 'monthly' && rule.nudge_after_day) continue;            // date night: attention-only
    const last = dateOf(r.last_done_at, ctx.tz);
    const st = dueState(rule, last, ds);
    if (!st.due) continue;
    if (last === ds) continue;
    if (rule.after && ds === ctx.today && hmToMin(ctx.now || '00:00') < hmToMin(rule.after) - 240) { /* still show; time hint only */ }
    out.push({
      id: 'routine:' + r.id, kind: 'routine', ref: r, title: r.name, importance: r.importance || 'should',
      due_date: st.overdueDays > 0 ? st.next : ds, duration_min: r.default_min || 15,
      location: r.location || 'home', weather_dependent: !!r.weather_dependent, energy: 'low',
      project_priority: null, postponed: 0, pattern: patternFor('routine', r.id, ctx), area_id: r.area_id,
      overdueDays: st.overdueDays, min_version: r.min_version, rule,
    });
  }
  // maintenance due
  for (const m of ctx.maintenance || []) {
    if (m.active === false || !m.next_due) continue;
    if (m.season_months && m.season_months.length && !m.season_months.includes(monthOf(ds))) continue;
    if (diffDays(ds, m.next_due) > 7) continue;
    out.push({
      id: 'maint:' + m.id, kind: 'maintenance', ref: m, title: m.name, importance: m.importance || 'should',
      due_date: m.next_due, duration_min: 20, location: 'home', weather_dependent: false, energy: 'low',
      project_priority: null, postponed: 0, pattern: null, area_id: null,
    });
  }
  // next unblocked step of each active project (if no real task already represents it)
  for (const p of (ctx.projects || []).filter(p => p.status === 'active')) {
    const s = nextStepOf(p.id, ctx);
    if (!s || seenSteps.has(s.id)) continue;
    out.push({
      id: 'step:' + s.id, kind: 'step', ref: s, title: `${p.name}: ${s.title}`, importance: 'should',
      due_date: null, duration_min: s.est_min || 90, location: 'home', weather_dependent: /patio|drain|excavat|grad|paver|mow|yard|gravel/i.test(p.name + ' ' + s.title),
      energy: (s.est_min || 90) >= 180 ? 'high' : 'med', project_priority: p.priority, postponed: 0,
      pattern: patternFor('project', p.id, ctx), area_id: p.area_id, project_id: p.id,
    });
  }
  return out;
}

// ── scoring (plan §5.2) ────────────────────────────────────────────────────
export function scoreCandidate(c, ds, ctx, cap) {
  let s = IMPORTANCE_W[c.importance] ?? 40;
  const reasons = [];
  if (c.due_date) {
    const d = diffDays(ds, c.due_date);           // days until due (negative = overdue)
    if (d < 0) { const o = Math.min(90, 60 + 5 * -d); s += o; reasons.push(`overdue ${-d}d`); }
    else { const u = 50 * Math.max(0, 1 - d / 7); s += u; if (u > 0) reasons.push(`due in ${d}d`); }
  }
  if (c.project_priority != null) {
    const b = c.project_priority === 1 ? 25 : c.project_priority === 2 ? 15 : 5; s += b; reasons.push(`P${c.project_priority}`);
  }
  if (c.pattern && c.pattern.data && c.pattern.data.usual_day === dow(ds)) { s += 15; reasons.push('usual day'); }
  if (c.postponed) s += Math.min(20, 2 * c.postponed);
  if (c.duration_min <= cap.minutes) s += 10;
  const wx = ctx.weather && ctx.weather[ds];
  if (c.weather_dependent && wx && wx.rain_prob >= 50) { s -= 100; reasons.push(`rain ${wx.rain_prob}%`); }
  if (cap.mode === 'travel' && c.location === 'home') { s -= 1000; reasons.push('away'); }
  if (cap.mode === 'sick' && c.energy === 'high') { s -= 50; reasons.push('sick'); }
  if (c.scheduled) { s += 30; reasons.push('scheduled'); }
  if (c.kind === 'step' && c.project_priority <= 2 && (isWeekend(ds) || cap.mode === 'project')) { s += 35; reasons.push('project day'); }
  return { score: Math.round(s), reasons };
}

// ── day plan (plan §5.3) ───────────────────────────────────────────────────
export function planDay(ds, ctx) {
  const settings = settingsOf(ctx);
  const cap = capacityFor(ds, ctx);
  const cands = candidatesFor(ds, ctx).map(c => ({ ...c, ...scoreCandidate(c, ds, ctx, cap) }));
  const isMustToday = c => c.importance === 'must' && (c.scheduled || (c.due_date && c.due_date <= ds) || c.kind === 'routine');
  const must = cands.filter(c => isMustToday(c) && c.score > -500).sort((a, b) => b.score - a.score);
  let used = must.reduce((a, c) => a + c.duration_min, 0);
  const rest = cands.filter(c => !must.includes(c) && c.score > 0).sort((a, b) => b.score - a.score || (a.due_date || '9').localeCompare(b.due_date || '9') || a.duration_min - b.duration_min);
  const planned = [], comingUp = [];
  const capMin = cap.mustOnly ? 0 : cap.minutes;
  for (const c of rest) {
    if (planned.length < settings.today_cap && used + c.duration_min <= capMin) { planned.push(c); used += c.duration_min; }
    else if (c.kind !== 'step' || c.project_priority <= 2) comingUp.push(c);
  }
  return { date: ds, capacity: cap, must, planned, comingUp: comingUp.slice(0, 8), used, overloaded: used > cap.minutes && must.length > 0 };
}

export function planWeek(ctx, from = ctx.today, days = 7) {
  const out = [];
  for (let i = 0; i < days; i++) out.push(planDay(addDays(from, i), ctx));
  return out;
}

// ── Needs Attention (plan §5.4) ────────────────────────────────────────────
export function needsAttention(ctx) {
  const settings = settingsOf(ctx);
  const today = ctx.today, now = ctx.now || '12:00', items = [];
  const push = (rank, key, title, detail, action) => items.push({ rank, key, title, detail, action });

  // 1 overdue must-do tasks
  for (const t of (ctx.tasks || []).filter(t => t.status === 'open' && t.importance === 'must' && t.due_date && t.due_date < today))
    push(1, 'task:' + t.id, `Overdue: ${t.title}`, `Was due ${dayName(t.due_date)}`, { type: 'open_task', id: t.id });

  // 2 maintenance overdue
  for (const m of (ctx.maintenance || []).filter(m => m.active !== false && m.next_due && m.next_due < today))
    push(2, 'maint:' + m.id, m.name, `${diffDays(m.next_due, today)} days overdue`, { type: 'record_maintenance', id: m.id });

  // 2 trash (routine with a backup rule)
  for (const r of (ctx.routines || []).filter(r => r.active !== false && normalizeRule(r.cadence)?.backup)) {
    const rule = normalizeRule(r.cadence); const last = dateOf(r.last_done_at, ctx.tz);
    const d = dow(today);
    const doneThisCycle = last && diffDays(last, today) < 6;
    if (!doneThisCycle) {
      if (rule.byweekday.includes(d) && hmToMin(now) >= hmToMin(rule.after || '17:00')) push(2, 'routine:' + r.id, `${r.name} tonight`, 'Pickup is in the morning', { type: 'log_routine', id: r.id });
      else if (rule.backup.byweekday.includes(d) && hmToMin(now) < hmToMin(rule.backup.before || '09:00')) push(2, 'routine:' + r.id, `Verify: ${r.name}`, 'Not logged last night', { type: 'log_routine', id: r.id });
    }
  }

  // 3 flowers gap / date night / mowing / other weekly-or-longer routine gaps
  for (const r of (ctx.routines || []).filter(r => r.active !== false)) {
    const rule = normalizeRule(r.cadence); if (!rule || rule.backup) continue;
    const last = dateOf(r.last_done_at, ctx.tz);
    if (rule.freq === 'monthly' && rule.nudge_after_day) {
      const scheduled = (ctx.events || []).some(e => e.title && e.title.toLowerCase().includes(r.name.toLowerCase().split(' ')[0]) && dateOf(e.starts_at, ctx.tz)?.slice(0, 7) === today.slice(0, 7) && dateOf(e.starts_at, ctx.tz) >= today);
      if (!doneThisMonth(last, today) && !scheduled && dayOfMonth(today) >= rule.nudge_after_day)
        push(3, 'routine:' + r.id, `No ${r.name.toLowerCase()} this month yet`, 'Find an evening and put it on the calendar', { type: 'schedule_routine', id: r.id });
      continue;
    }
    if (rule.freq === 'weekly') {
      const gap = last ? diffDays(last, today) : 99;
      const weatherDep = r.weather_dependent;
      if (weatherDep) {
        // mowing-style: ≥ 8 days and a weekend within 2 days → recommend the better day
        const wk = [0, 1, 2].map(i => addDays(today, i)).filter(isWeekend);
        if (gap >= 8 && wk.length) {
          const best = wk.map(d => ({ d, rain: ctx.weather?.[d]?.rain_prob ?? 0, load: planDay(d, ctx).used })).sort((a, b) => a.rain - b.rain || a.load - b.load)[0];
          push(3, 'routine:' + r.id, `${r.name} — ${best.d === today ? 'today' : dayName(best.d)}`, `${gap} days since last · ${best.rain}% rain`, { type: 'schedule_routine', id: r.id, date: best.d });
        }
      } else {
        const preferDays = Array.isArray(rule.prefer) ? rule.prefer : rule.prefer ? [rule.prefer] : [];
        const nudgeToday = !preferDays.length || preferDays.includes(dow(today)) || gap >= 9;
        if (gap >= 7 && nudgeToday) push(3, 'routine:' + r.id, `${r.name} — ${gap === 99 ? 'not logged yet' : gap + ' days since last'}`, preferDays.length ? 'Usually end of week' : '', { type: 'log_routine', id: r.id });
      }
    }
  }

  // 4 stalled priority project / open-block opportunity
  for (const p of (ctx.projects || []).filter(p => p.status === 'active' && p.priority <= 2)) {
    const recent = (ctx.steps || []).filter(s => s.project_id === p.id && s.done_at && diffDays(dateOf(s.done_at, ctx.tz), today) <= 14);
    const next = nextStepOf(p.id, ctx);
    if (!recent.length && next) push(4, 'project:' + p.id, `${p.name} has stalled`, `Next: ${next.title}`, { type: 'open_project', id: p.id });
    if (next) {
      for (const d of [0, 1, 2].map(i => addDays(today, i)).filter(isWeekend)) {
        const cap = capacityFor(d, ctx); const pd = planDay(d, ctx);
        if (cap.minutes - pd.used >= 120 && !pd.planned.some(c => c.project_id === p.id) && !pd.must.some(c => c.project_id === p.id)) {
          push(4, 'block:' + p.id + d, `Open block ${d === today ? 'today' : dayName(d)} for ${p.name}`, `${Math.round((cap.minutes - pd.used) / 60 * 10) / 10} h free · ${next.title}`, { type: 'schedule_step', id: next.id, date: d });
          break;
        }
      }
    }
  }

  // 5 plant checks (adaptive) & Ruby training after 18:00
  for (const pl of (ctx.plants || []).filter(p => !p.archived)) {
    const last = pl.last_water || pl.last_observation;
    const interval = pl.water_interval_days || 5;
    const rained = ctx.weather && [today, addDays(today, -1)].some(d => (ctx.weather[d]?.precip_in ?? 0) >= 0.2);
    if (last && diffDays(last, today) >= interval && !rained) push(5, 'plant:' + pl.id, `Check ${pl.name}`, `${diffDays(last, today)} days since last look`, { type: 'log_plant', id: pl.id });
  }
  for (const r of (ctx.routines || []).filter(r => r.pet_id && r.active !== false)) {
    const last = dateOf(r.last_done_at, ctx.tz);
    if (last !== today && hmToMin(now) >= 18 * 60) push(5, 'routine:' + r.id, `${r.name} not logged today`, r.min_version ? `Even a ${r.min_version.toLowerCase()} counts` : '', { type: 'log_routine', id: r.id });
  }

  const seen = new Set();
  return items.sort((a, b) => a.rank - b.rank).filter(i => !seen.has(i.key) && seen.add(i.key)).slice(0, settings.attention_cap);
}

// ── replanning (plan §6) ───────────────────────────────────────────────────
// Given tasks scheduled/due in `dates` and a new mode, classify keep / reduce / move and
// place moved tasks on later days without exceeding each day's capacity.
export function replan(dates, mode, ctx) {
  const affected = new Set(dates);
  const ctx2 = { ...ctx, dayModes: [...(ctx.dayModes || []).filter(m => !affected.has(m.date)), ...dates.map(date => ({ date, mode }))] };
  const keep = [], reduce = [], move = [];
  for (const t of (ctx.tasks || []).filter(t => t.status === 'open')) {
    const d = dateOf(t.scheduled_start, ctx.tz) || t.due_date;
    if (!d || !affected.has(d)) continue;
    const cap = capacityFor(d, ctx2);
    if (t.importance === 'must' && !(mode === 'travel' && t.location === 'home')) { keep.push(t); continue; }
    if (mode === 'travel' && t.location !== 'home') { keep.push(t); continue; }
    if (t.routine_id) { const r = (ctx.routines || []).find(r => r.id === t.routine_id); if (r && r.min_version && mode !== 'travel') { reduce.push({ task: t, to: r.min_version }); continue; } }
    if (!cap.mustOnly && cap.minutes >= (t.duration_min || 30) && !(mode === 'travel' && t.location === 'home')) { keep.push(t); continue; }
    move.push(t);
  }
  // place moved work after the affected range (or before, for travel, if due before return)
  const last = dates.slice().sort().pop(), first = dates.slice().sort()[0];
  const placements = [];
  const load = {};
  const sorted = move.slice().sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9') || IMPORTANCE_W[b.importance] - IMPORTANCE_W[a.importance]);
  for (const t of sorted) {
    const dur = t.duration_min || 30;
    const days = [];
    if (mode === 'travel' && t.due_date && t.due_date <= last) for (let d = ctx.today; d < first; d = addDays(d, 1)) days.push(d);
    for (let i = 1; i <= 10; i++) days.push(addDays(last, i));
    let placed = null;
    for (const d of days) {
      const cap = capacityFor(d, ctx2); const used = (load[d] || 0) + planDay(d, ctx2).used;
      if (used + dur <= cap.minutes) { load[d] = (load[d] || 0) + dur; placed = d; break; }
    }
    placements.push({ task: t, to: placed, reason: placed ? `replan:${mode}` : 'unplaced' });
  }
  return { keep, reduce, move: placements };
}