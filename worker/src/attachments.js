// HomeBase v2 — attachment resolver (spec §5–6): authorize file ids for the caller's household,
// turn them into model input blocks through short-lived signed URLs, and describe them for the prompt.
// Provider adapter: only this module knows what the Anthropic Messages API accepts.

const IMAGE_OK = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const TEXT_OK = new Set(['text/plain', 'text/csv', 'text/markdown', 'application/json']);
const MAX_IMAGE = 5 * 1024 * 1024, MAX_PDF = 32 * 1024 * 1024, MAX_TEXT = 200 * 1024;
const SIGNED_TTL_S = 900;

export const slimFile = f => f && {
  id: f.id, name: f.original_name, kind: f.kind, mime_type: f.mime_type, size_bytes: f.size_bytes, caption: f.caption,
  ai_summary: f.ai_summary, extracted_text: f.extracted_text ? String(f.extracted_text).slice(0, 2000) : null,
  source: f.source, processing_status: f.processing_status, taken_at: f.taken_at, created_at: f.created_at,
  tags: f.metadata?.tags || [], receipt: f.metadata?.receipt || null, analyzable: analyzable(f),
};

export function analyzable(f) {
  const m = f.mime_type || '', size = Number(f.size_bytes) || 0;
  if (IMAGE_OK.has(m) && size <= MAX_IMAGE) return true;
  if (f.metadata?.derivative_path) return true;                       // JPEG derivative made by the app
  if (m === 'application/pdf' && size <= MAX_PDF) return true;
  return TEXT_OK.has(m) && size <= MAX_TEXT;
}

// Signed URL via the Storage API (service key). Never persisted.
export async function signedUrl(env, path, ttl = SIGNED_TTL_S) {
  const base = (env.SUPABASE_URL || '').replace(/\/$/, '');
  const res = await fetch(`${base}/storage/v1/object/sign/household-media/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: ttl }),
  });
  if (!res.ok) throw new Error(`sign ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return `${base}/storage/v1${j.signedURL.startsWith('/') ? '' : '/'}${j.signedURL}`;
}
export async function deleteObjects(env, paths) {
  const base = (env.SUPABASE_URL || '').replace(/\/$/, '');
  const res = await fetch(`${base}/storage/v1/object/household-media`, { method: 'DELETE', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths.filter(Boolean) }) });
  if (!res.ok) throw new Error(`storage delete ${res.status}`);
}

// Load + authorize: only rows of the caller's household come back (db is household-scoped).
export async function resolveAttachments(rt, ids = []) {
  const clean = [...new Set((ids || []).filter(x => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 8);
  if (!clean.length) return [];
  const rows = await rt.db.select('files', { id: clean });
  const links = rows.length ? await rt.db.select('file_links', { file_id: rows.map(r => r.id), select: 'file_id,entity_type,entity_id,rel' }) : [];
  return clean.map(id => rows.find(r => r.id === id)).filter(Boolean).map(f => ({ ...f, links: links.filter(l => l.file_id === f.id) }));
}

// Model input blocks for one file (image / pdf / text). Returns [] when the model cannot look at it.
export async function toContentBlocks(env, f) {
  const m = f.mime_type || '';
  try {
    if (f.metadata?.derivative_path || (IMAGE_OK.has(m) && f.size_bytes <= MAX_IMAGE)) {
      const url = await signedUrl(env, f.metadata?.derivative_path || f.storage_path);
      return [{ type: 'image', source: { type: 'url', url } }];
    }
    if (m === 'application/pdf' && f.size_bytes <= MAX_PDF) {
      const url = await signedUrl(env, f.storage_path);
      return [{ type: 'document', source: { type: 'url', url }, title: f.original_name || 'document', citations: { enabled: true } }];
    }
    if (TEXT_OK.has(m) && f.size_bytes <= MAX_TEXT) {
      const url = await signedUrl(env, f.storage_path);
      const text = await (await fetch(url)).text();
      return [{ type: 'document', source: { type: 'text', media_type: 'text/plain', data: text.slice(0, 60000) }, title: f.original_name || 'text' }];
    }
  } catch (e) { console.error('attachment block', f.id, e.message); }
  return [];
}

export function describeAttachment(f) {
  const links = (f.links || []).filter(l => l.entity_type !== 'ai_thread').map(l => `${l.entity_type}:${l.entity_id} (${l.rel})`);
  return `- file_id ${f.id} · "${f.original_name || 'file'}" · ${f.mime_type || '?'} · ${Math.round((f.size_bytes || 0) / 1024)} KB · kind ${f.kind}${f.taken_at ? ` · taken ${f.taken_at.slice(0, 10)}` : ''}${f.caption ? ` · caption "${f.caption}"` : ''}${f.ai_summary ? ` · previously: ${f.ai_summary}` : ''}${links.length ? ` · linked to ${links.join(', ')}` : ' · not linked yet'}${analyzable(f) ? '' : ' · (cannot view this file type directly; ask what it is if the message does not say)'}`;
}

// Build the user turn: text + attachment blocks + a short manifest so the model knows the ids.
export async function buildUserContent(env, text, files) {
  const blocks = [];
  for (const f of files) blocks.push(...await toContentBlocks(env, f));
  const manifest = files.length ? `\n\nATTACHMENTS (${files.length}):\n${files.map(describeAttachment).join('\n')}\nUse the message as the authority for what these are; otherwise look at them and search household context (search_everything, list_records, search_files) before filing. Link each one with link_file, save a one-line ai_summary with update_file_metadata, and ask one focused question only if the destination is genuinely ambiguous.` : '';
  blocks.push({ type: 'text', text: `${text}${manifest}` });
  return blocks;
}
