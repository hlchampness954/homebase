// Offline tests for the attachment resolver / provider adapter (no network, no secrets).
import assert from 'node:assert/strict';
import { slimFile, analyzable, describeAttachment, buildUserContent, resolveAttachments } from '../src/attachments.js';
import { TOOLS } from '../src/index.js';

let pass = 0, fail = 0;
async function test(name, fn) { try { await fn(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n    ', e.message); } }

const jpg = { id: '11111111-1111-4111-8111-111111111111', original_name: 'receipt.jpg', mime_type: 'image/jpeg', size_bytes: 300000, kind: 'photo', storage_path: 'hh/2026/09/a.jpg', metadata: {}, links: [] };
const heic = { ...jpg, id: '22222222-2222-4222-8222-222222222222', original_name: 'IMG_1.HEIC', mime_type: 'image/heic', storage_path: 'hh/2026/09/b.heic' };
const heicDeriv = { ...heic, metadata: { derivative_path: 'hh/2026/09/b-a.jpg' } };
const pdf = { ...jpg, id: '33333333-3333-4333-8333-333333333333', original_name: 'manual.pdf', mime_type: 'application/pdf', size_bytes: 2_000_000, kind: 'manual' };
const bigPdf = { ...pdf, size_bytes: 40 * 1024 * 1024 };

await test('analyzable: jpeg yes, raw heic no, heic with derivative yes, pdf ≤32MB yes, huge pdf no', () => {
  assert.equal(analyzable(jpg), true); assert.equal(analyzable(heic), false); assert.equal(analyzable(heicDeriv), true);
  assert.equal(analyzable(pdf), true); assert.equal(analyzable(bigPdf), false);
});
await test('slimFile never leaks storage paths or huge text', () => {
  const s = slimFile({ ...jpg, extracted_text: 'x'.repeat(5000) });
  assert.ok(!('storage_path' in s)); assert.equal(s.extracted_text.length, 2000); assert.equal(s.analyzable, true);
});
await test('describeAttachment mentions id, name, links and viewability', () => {
  const d = describeAttachment({ ...heic, links: [{ entity_type: 'project', entity_id: 'p1', rel: 'receipt' }, { entity_type: 'ai_thread', entity_id: 't', rel: 'chat' }] });
  assert.ok(d.includes(heic.id) && d.includes('IMG_1.HEIC') && d.includes('project:p1 (receipt)') && !d.includes('ai_thread') && d.includes('cannot view'));
});
await test('buildUserContent: text-only when nothing is viewable; manifest appended', async () => {
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
  const blocks = await buildUserContent(env, 'what is this?', [heic]);   // signing is skipped for non-analyzable → no fetch
  assert.equal(blocks.length, 1); assert.equal(blocks[0].type, 'text'); assert.ok(blocks[0].text.startsWith('what is this?')); assert.ok(blocks[0].text.includes('ATTACHMENTS (1)'));
});
await test('resolveAttachments: only rows the scoped db returns, junk ids ignored, order preserved', async () => {
  const calls = [];
  const rt = { db: { select: async (t, q) => { calls.push([t, q]); if (t === 'files') return [jpg, pdf].filter(f => q.id.includes(f.id)); if (t === 'file_links') return [{ file_id: jpg.id, entity_type: 'project', entity_id: 'p', rel: 'receipt' }]; return []; } } };
  const out = await resolveAttachments(rt, [pdf.id, 'not-a-uuid', jpg.id, '99999999-9999-4999-8999-999999999999']);
  assert.deepEqual(out.map(f => f.id), [pdf.id, jpg.id]);
  assert.equal(out[1].links.length, 1);
  assert.ok(!calls[0][1].id.includes('not-a-uuid'));
});
await test('file + context + person tools are registered; delete_file needs confirmation', () => {
  const names = new Set(TOOLS.map(t => t.name));
  for (const n of ['get_file', 'search_files', 'link_file', 'unlink_file', 'update_file_metadata', 'delete_file', 'get_household_overview', 'get_person_context', 'get_recent_changes', 'assign_task']) assert.ok(names.has(n), n);
  assert.ok(TOOLS.find(t => t.name === 'delete_file').confirm);
  assert.ok(TOOLS.find(t => t.name === 'save_memory').input_schema.properties.person, 'save_memory.person');
});
console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ''}`);
if (fail) process.exit(1);
