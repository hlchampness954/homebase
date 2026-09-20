// HomeBase v2 — one recurrence engine shared by the app and the Worker.
// Rule shape (jsonb):
// { freq: 'daily'|'weekly'|'monthly'|'yearly', interval: 1,
//   byweekday: ['sat','sun'],        // allowed weekdays (weekly/daily)
//   prefer: 'sat' | ['thu','fri'],   // planner hint, not a constraint
//   anchor: 'schedule'|'completion', // next = grid after last scheduled date, or last done + interval
//   after: '17:00', before: '09:00', // time-of-day hints (routines)
//   backup: { byweekday:['thu'], before:'09:00' },   // secondary check (trash)
//   nudge_after_day: 15 }            // monthly routines: start nudging after this day of month
import { addDays, addMonths, dow, diffDays, dayOfMonth } from './dates.js';

export function normalizeRule(r) {
  if (!r) return null;
  if (typeof r === 'string') r = legacyRepeatToRule(r);
  return { interval: 1, anchor: 'schedule', ...r };
}

// v17 strings: daily|weekly|biweekly|monthly|quarterly|biannual|yearly|custom:N:unit
export function legacyRepeatToRule(s) {
  if (!s) return null;
  const m = { daily: { freq: 'daily' }, weekly: { freq: 'weekly' }, biweekly: { freq: 'weekly', interval: 2 },
    monthly: { freq: 'monthly' }, quarterly: { freq: 'monthly', interval: 3 }, biannual: { freq: 'monthly', interval: 6 },
    yearly: { freq: 'yearly' } };
  if (m[s]) return m[s];
  if (s.startsWith('custom:')) {
    const [, n, unit = 'day'] = s.split(':');
    const N = parseInt(n) || 1;
    if (unit === 'day') return { freq: 'daily', interval: N };
    if (unit === 'week') return { freq: 'weekly', interval: N };
    if (unit === 'month') return { freq: 'monthly', interval: N };
  }
  return null;
}

function rollToAllowed(ds, byweekday, maxRoll = 7) {
  if (!byweekday || !byweekday.length) return ds;
  for (let i = 0; i < maxRoll; i++) {
    const d = addDays(ds, i);
    if (byweekday.includes(dow(d))) return d;
  }
  return ds;
}

// Next date strictly after `from` (a 'YYYY-MM-DD') on which the rule fires.
export function nextOccurrence(rule, from) {
  const r = normalizeRule(rule);
  if (!r || !from) return null;
  const n = Math.max(1, r.interval || 1);
  let next;
  if (r.anchor === 'completion') {
    if (r.freq === 'daily') next = addDays(from, n);
    else if (r.freq === 'weekly') next = addDays(from, 7 * n);
    else if (r.freq === 'monthly') next = addMonths(from, n);
    else if (r.freq === 'yearly') next = addMonths(from, 12 * n);
    return rollToAllowed(next, r.byweekday);
  }
  // schedule anchor
  if (r.freq === 'daily') {
    next = addDays(from, n);
    return rollToAllowed(next, r.byweekday);
  }
  if (r.freq === 'weekly') {
    if (r.byweekday && r.byweekday.length) {
      // next allowed weekday strictly after `from` (+ whole weeks for interval > 1)
      const base = addDays(from, 7 * (n - 1));
      return rollToAllowed(addDays(base, 1), r.byweekday);
    }
    return addDays(from, 7 * n);
  }
  if (r.freq === 'monthly') return addMonths(from, n);
  if (r.freq === 'yearly') return addMonths(from, 12 * n);
  return null;
}

// Is the rule "due" on `today` given the last completion date (or null)?
// Returns { due, next, overdueDays }
export function dueState(rule, lastDone, today) {
  const r = normalizeRule(rule);
  if (!r) return { due: false, next: null, overdueDays: 0 };
  if (!lastDone) return { due: true, next: today, overdueDays: 0 };
  const next = nextOccurrence(r, lastDone);
  const overdueDays = Math.max(0, diffDays(next, today));
  return { due: today >= next, next, overdueDays };
}

// Expected gap in days for a rule (for "gap" style nudges: flowers, date night)
export function expectedGapDays(rule) {
  const r = normalizeRule(rule);
  if (!r) return null;
  const n = r.interval || 1;
  if (r.freq === 'daily') return n;
  if (r.freq === 'weekly') return 7 * n;
  if (r.freq === 'monthly') return 30 * n;
  if (r.freq === 'yearly') return 365 * n;
  return null;
}

// For monthly "at least once" routines: has it happened this calendar month?
export function doneThisMonth(lastDone, today) {
  return !!lastDone && lastDone.slice(0, 7) === today.slice(0, 7);
}

export function describeRule(rule) {
  const r = normalizeRule(rule);
  if (!r) return 'Once';
  const n = r.interval || 1;
  const days = r.byweekday && r.byweekday.length ? ' on ' + r.byweekday.map(d => d[0].toUpperCase() + d.slice(1)).join('/') : '';
  if (r.freq === 'daily') return (n === 1 ? 'Daily' : `Every ${n} days`) + days;
  if (r.freq === 'weekly') return (n === 1 ? 'Weekly' : n === 2 ? 'Every 2 weeks' : `Every ${n} weeks`) + days;
  if (r.freq === 'monthly') return n === 1 ? 'Monthly' : n === 3 ? 'Quarterly' : n === 6 ? 'Every 6 months' : `Every ${n} months`;
  if (r.freq === 'yearly') return n === 1 ? 'Yearly' : `Every ${n} years`;
  return 'Repeats';
}

export { dayOfMonth };
