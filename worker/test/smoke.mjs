// HomeBase v2 Worker — offline smoke test. Run: `node worker/test/smoke.mjs`
// No network, no secrets: only the exported pure helpers are exercised.
import assert from 'node:assert/strict';
import { TOOLS, TOOL_SCHEMAS, buildSystemPrompt, parseAnthropicSSE, parseSSE, createMessageAssembler, SYSTEM_STATIC, WEB_TOOLS } from '../src/index.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok   ${name}`); } catch (e) { console.error(`FAIL ${name}\n     ${e.message}`); process.exitCode = 1; } };

// ── 1. tool schemas ────────────────────────────────────────────────────────
test('tool schemas are valid Anthropic tool definitions', () => {
  assert.ok(TOOLS.length >= 38, `expected ≥38 tools, got ${TOOLS.length}`);
  assert.equal(TOOL_SCHEMAS.length, TOOLS.length);
  const names = new Set();
  for (const t of TOOL_SCHEMAS) {
    assert.match(t.name, /^[a-z_]{3,64}$/, `bad name ${t.name}`);
    assert.ok(!names.has(t.name), `duplicate tool ${t.name}`); names.add(t.name);
    assert.ok(typeof t.description === 'string' && t.description.length > 10, `${t.name}: description`);
    assert.equal(t.input_schema?.type, 'object', `${t.name}: input_schema.type`);
    assert.equal(typeof t.input_schema.properties, 'object', `${t.name}: properties`);
    for (const r of t.input_schema.required || []) assert.ok(r in t.input_schema.properties, `${t.name}: required "${r}" missing from properties`);
    for (const [k, v] of Object.entries(t.input_schema.properties)) assert.ok(v.type, `${t.name}.${k}: missing type`);
    assert.equal(Object.keys(t).sort().join(','), 'description,input_schema,name', `${t.name}: extra keys leak into API schema`);
  }
  const expected = ['search_everything', 'get_today', 'list_tasks', 'get_calendar', 'find_open_time', 'list_projects', 'get_project', 'list_maintenance', 'list_plants', 'get_pet_history', 'search_memory', 'search_history', 'get_weather',
    'create_task', 'update_task', 'complete_task', 'postpone_task', 'delete_task', 'create_event', 'move_event', 'create_work_block', 'set_day_mode', 'replan_day', 'replan_week',
    'update_project_step', 'add_project_step', 'add_project_cost', 'record_maintenance', 'log_plant_observation', 'log_pet_activity', 'log_routine', 'add_list_item', 'create_note', 'link',
    'save_memory', 'update_memory', 'forget_memory', 'bulk_update'];
  for (const n of expected) assert.ok(names.has(n), `missing tool ${n}`);
  const confirm = TOOLS.filter(t => t.confirm).map(t => t.name).sort();
  assert.deepEqual(confirm, ['archive_record', 'bulk_update', 'delete_file', 'delete_task', 'forget_memory']);
});

// ── 2. SSE parser reassembles a streamed tool_use ─────────────────────────
const sample = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-sonnet-5","content":[],"stop_reason":null,"usage":{"input_tokens":812,"output_tokens":1}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Let me log"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" that."}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01","name":"record_maintenance","input":{}}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"rule_id\\": \\"HVAC fil"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"ter\\", \\"note\\": \\"MERV 11\\""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":", \\"cost\\": 18.5}"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":1}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":57}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join('\n');

test('parseAnthropicSSE reassembles text + tool_use from a streamed message', () => {
  const msg = parseAnthropicSSE(sample);
  assert.equal(msg.stop_reason, 'tool_use');
  assert.equal(msg.usage.input_tokens, 812);
  assert.equal(msg.usage.output_tokens, 57);
  assert.equal(msg.content.length, 2);
  assert.deepEqual(msg.content[0], { type: 'text', text: 'Let me log that.' });
  assert.equal(msg.content[1].type, 'tool_use');
  assert.equal(msg.content[1].id, 'toolu_01');
  assert.equal(msg.content[1].name, 'record_maintenance');
  assert.deepEqual(msg.content[1].input, { rule_id: 'HVAC filter', note: 'MERV 11', cost: 18.5 });
});

test('parseSSE handles chunk boundaries mid-frame and CRLF', () => {
  const crlf = sample.replace(/\n/g, '\r\n');
  const cut = Math.floor(crlf.length / 3);
  const asm = createMessageAssembler();
  let buf = '', texts = '';
  for (const chunk of [crlf.slice(0, cut), crlf.slice(cut, cut * 2), crlf.slice(cut * 2), '\n\n']) {
    buf += chunk;
    const { events, rest } = parseSSE(buf); buf = rest;
    for (const ev of events) { const out = asm.handle(ev); if (out?.text) texts += out.text; }
  }
  assert.equal(texts, 'Let me log that.');
  assert.equal(asm.message.content[1].input.cost, 18.5);
  assert.equal(asm.message.stop_reason, 'tool_use');
});

// ── 3. system prompt ──────────────────────────────────────────────────────
test('buildSystemPrompt contains the household name, people, snapshot and memories', () => {
  const ctx = {
    household: { id: 'hh1', name: 'Champness Home', tz: 'America/Chicago' },
    people: [{ id: 'p1', name: 'Luke', is_user: true }, { id: 'p2', name: 'Hayley', is_user: true }],
    pets: [{ id: 'pet1', name: 'Ruby', species: 'dog' }],
    areas: [{ id: 'a1', name: 'Kitchen' }, { id: 'a2', name: 'Relationship' }],
    projects: [{ id: 'pr1', name: 'Nursery', priority: 1, status: 'active', stage: 'painting' }],
    steps: [{ id: 's1', project_id: 'pr1', title: 'Paint walls', status: 'todo', sort: 1, depends_on: [] }],
    routines: [{ id: 'r1', name: 'Flowers for Hayley', cadence: { freq: 'weekly' }, last_done_at: null }],
    maintenance: [{ id: 'm1', name: 'HVAC filter', interval_days: 90, next_due: '2026-10-01' }],
    events: [], tasks: [], today: '2026-09-19', now: '14:05', tz: 'America/Chicago',
    weather: { '2026-09-19': { rain_prob: 20, precip_in: 0, tmax_f: 91 } },
  };
  const plan = { capacity: { mode: 'normal', minutes: 300 }, used: 45, overloaded: false, must: [{ id: 't1', kind: 'task', title: 'Pay water bill', importance: 'must', due_date: '2026-09-19', duration_min: 15, reasons: ['due in 0d'] }], planned: [{ id: 'step:s1', kind: 'step', title: 'Nursery: Paint walls', importance: 'should', duration_min: 90, reasons: ['P1', 'project day'] }], comingUp: [] };
  const attention = [{ title: 'Flowers for Hayley — not logged yet', detail: 'Usually end of week' }];
  const memories = [{ id: 'mem1', subject: 'family', kind: 'preference', confidence: 0.9, content: 'Hayley prefers tulips.' }];
  const prompt = buildSystemPrompt({ ctx, plan, attention, memories, context: { view: 'today', device: 'iphone' } });
  assert.ok(prompt.includes('Champness Home'), 'household name');
  assert.ok(prompt.includes('Luke & Hayley'), 'people');
  assert.ok(prompt.includes('Ruby'), 'pet');
  assert.ok(prompt.includes('New Braunfels'), 'location');
  assert.ok(prompt.includes('Pay water bill'), 'must-do in snapshot');
  assert.ok(prompt.includes('Nursery: Paint walls'), 'planned step');
  assert.ok(prompt.includes('Flowers for Hayley — not logged yet'), 'needs attention');
  assert.ok(prompt.includes('Hayley prefers tulips.'), 'memory');
  assert.ok(prompt.includes('Saturday, September 19'), 'today date');
  assert.ok(prompt.includes('20% rain'), 'weather');
  assert.ok(/delete_task, forget_memory, bulk_update and archive_record only create a proposal/.test(SYSTEM_STATIC), 'tool-use rules (static block)');
  assert.ok(/web_search/.test(SYSTEM_STATIC) && /create_project/.test(SYSTEM_STATIC), 'capabilities (static block)');
  assert.ok(prompt.length < 9000, `prompt too long: ${prompt.length} chars`);
});

test('buildSystemPrompt survives an empty ctx', () => {
  const p = buildSystemPrompt({ ctx: { household: { name: 'Test House' } } });
  assert.ok(p.includes('Test House'));
  assert.ok(p.includes('WHAT YOU REMEMBER'));
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);

// ── 5. thinking / server-tool blocks round-trip through the assembler ─────
test('assembler keeps thinking signatures and server tool blocks', () => {
  const asm = createMessageAssembler();
  const evs = [
    { type: 'message_start', message: { id: 'm', model: 'x', usage: { input_tokens: 10, cache_read_input_tokens: 5 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 'st1', name: 'web_search', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"paver price"}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'web_search_tool_result', tool_use_id: 'st1', content: [{ type: 'web_search_result', url: 'https://x', title: 'X', encrypted_content: 'e' }] } },
    { type: 'content_block_stop', index: 2 },
    { type: 'content_block_start', index: 3, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: 'About $4' } },
    { type: 'content_block_delta', index: 3, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: 'https://x', title: 'X', cited_text: 'a' } } },
    { type: 'content_block_stop', index: 3 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } },
  ];
  const outs = evs.map(e => asm.handle({ event: e.type, data: e })).filter(Boolean);
  const m = asm.message;
  assert.equal(m.content[0].signature, 'SIG');
  assert.equal(m.content[1].input.query, 'paver price');
  assert.equal(m.content[2].type, 'web_search_tool_result');
  assert.equal(m.content[3].citations.length, 1);
  assert.ok(outs.some(o => o.tool?.status === 'start' && /paver price/.test(o.tool.summary)), 'start event');
  assert.ok(outs.some(o => o.tool?.status === 'done' && /1 result/.test(o.tool.summary)), 'done event');
  assert.equal(m.usage.cache_read_input_tokens, 5);
  assert.equal(WEB_TOOLS.length, 2);
});

test('tool schemas include the generic record tools and create_project', () => {
  const names = TOOLS.map(t => t.name);
  for (const n of ['create_project', 'update_project', 'list_records', 'create_record', 'update_record', 'archive_record']) assert.ok(names.includes(n), n);
  assert.ok(TOOLS.find(t => t.name === 'archive_record').confirm, 'archive_record needs confirmation');
});
