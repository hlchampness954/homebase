// HomeBase v2 — date helpers. All calendar math is done on 'YYYY-MM-DD' strings
// so it is independent of the runtime timezone (browser or Worker).
// "Today" is always derived from the household timezone, never from Date#toISOString.

export const DOW = ['sun','mon','tue','wed','thu','fri','sat'];

export function todayIn(tz = 'America/Chicago', now = new Date()) {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function nowHM(tz = 'America/Chicago', now = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const h = p.find(x => x.type === 'hour').value, m = p.find(x => x.type === 'minute').value;
  return `${h === '24' ? '00' : h}:${m}`;
}

export function parse(ds) {           // -> ms at UTC noon (safe from DST edges)
  const [y, m, d] = ds.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12);
}
export function fmt(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
export function addDays(ds, n) { return fmt(parse(ds) + n * 86400000); }
export function addMonths(ds, n) {
  const d = new Date(parse(ds));
  const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return fmt(d.getTime());
}
export function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }   // b - a
export function dow(ds) { return DOW[new Date(parse(ds)).getUTCDay()]; }
export function isWeekend(ds) { const w = dow(ds); return w === 'sat' || w === 'sun'; }
export function dayOfMonth(ds) { return Number(ds.slice(8, 10)); }
export function monthOf(ds) { return Number(ds.slice(5, 7)); }
export function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

// Timestamp (ISO) -> local date string in tz
export function dateOf(iso, tz = 'America/Chicago') {
  if (!iso) return null;
  return todayIn(tz, new Date(iso));
}
export function timeOf(iso, tz = 'America/Chicago') {
  if (!iso) return null;
  return nowHM(tz, new Date(iso));
}
// Build an ISO timestamp for a local date+time in tz (no DST library: probe offsets)
export function toISO(ds, hm = '12:00', tz = 'America/Chicago') {
  const [y, mo, d] = ds.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // offset of tz at guess
  const off = tzOffsetMin(tz, new Date(guess));
  let ms = guess - off * 60000;
  const off2 = tzOffsetMin(tz, new Date(ms));
  if (off2 !== off) ms = guess - off2 * 60000;
  return new Date(ms).toISOString();
}
export function tzOffsetMin(tz, date) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date);
  const g = t => Number(p.find(x => x.type === t).value);
  const asUTC = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  return Math.round((asUTC - date.getTime()) / 60000);
}
export function hmToMin(hm) { const [h, m] = hm.split(':').map(Number); return h * 60 + m; }
export function minToHM(min) { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }

export function humanDate(ds, today) {
  if (!ds) return '';
  if (today) {
    const d = diffDays(today, ds);
    if (d === 0) return 'Today';
    if (d === 1) return 'Tomorrow';
    if (d === -1) return 'Yesterday';
    if (d > 1 && d < 7) return dayName(ds);
  }
  const dt = new Date(parse(ds));
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export function dayName(ds) { return new Date(parse(ds)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }); }
export function longDate(ds) { return new Date(parse(ds)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
export function fmtHM(hm) {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
