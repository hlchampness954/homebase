// HomeBase v2 — attachment helpers shared by the app (and testable in Node).
// Pure functions: kind detection, safe names/paths, size rules, image downsizing for analysis.

export const MAX_FILE_BYTES = 50 * 1024 * 1024;      // matches the bucket limit
export const MAX_PER_MESSAGE = 6;
export const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif', 'image/bmp', 'image/tiff']);
export const DOC_TYPES = new Set(['application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'application/json',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
const EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', json: 'application/json', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const MIME_EXT = Object.fromEntries(Object.entries(EXT_MIME).map(([e, m]) => [m, e]));

export function extOf(name = '') { const m = /\.([a-z0-9]{1,6})$/i.exec(String(name)); return m ? m[1].toLowerCase() : ''; }
export function mimeOf(file) { return (file?.type || EXT_MIME[extOf(file?.name)] || 'application/octet-stream').toLowerCase(); }
export function safeExt(file) { const m = mimeOf(file); return MIME_EXT[m] || extOf(file?.name) || 'bin'; }
export function isImage(mime) { return IMAGE_TYPES.has(mime) || /^image\//.test(mime || ''); }
export function isDoc(mime) { return DOC_TYPES.has(mime); }
export function allowed(file) {
  const m = mimeOf(file);
  if (!(isImage(m) || isDoc(m))) return { ok: false, reason: 'Unsupported file type' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: 'File is larger than 50 MB' };
  if (!file.size) return { ok: false, reason: 'Empty file' };
  return { ok: true };
}
// What the model can look at directly: jpeg/png/webp/gif ≤ 5 MB, PDF ≤ 32 MB, plain text.
export function analyzable(mime, size) {
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime)) return size <= 5 * 1024 * 1024;
  if (mime === 'application/pdf') return size <= 32 * 1024 * 1024;
  return ['text/plain', 'text/csv', 'text/markdown', 'application/json'].includes(mime);
}
// Storage object path: <household>/<yyyy>/<mm>/<uuid>.<ext>  (spec §3)
export function storagePath(hh, id, ext, now = new Date()) {
  const y = now.getUTCFullYear(), m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${hh}/${y}/${m}/${id}.${ext}`;
}
export function kindFor(mime, name = '', hint = '') {
  const n = `${name} ${hint}`.toLowerCase();
  if (/receipt|invoice|order/.test(n)) return 'receipt';
  if (/manual|guide|spec|datasheet/.test(n)) return 'manual';
  if (mime === 'application/pdf') return /scan/.test(n) ? 'scan' : 'document';
  if (isImage(mime)) return /scan/.test(n) ? 'scan' : 'photo';
  return 'document';
}
export function fmtBytes(n) { if (n == null) return ''; if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`; return `${(n / 1048576).toFixed(1)} MB`; }
export function sha256Hex(buf) {
  return crypto.subtle.digest('SHA-256', buf).then(b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''));
}
// Browser only: downsized JPEG for analysis/thumbnails (max edge px). Returns null if the image can't be decoded (e.g. HEIC on Windows).
export async function makeDerivative(file, maxEdge = 1600, quality = 0.85) {
  if (typeof createImageBitmap === 'undefined' || typeof document === 'undefined') return null;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), hgt = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = hgt;
    c.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
    bmp.close?.();
    return blob ? { blob, width: w, height: hgt, srcWidth: bmp.width, srcHeight: bmp.height } : null;
  } catch { return null; }
}
