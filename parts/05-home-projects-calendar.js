
// ═══════════════════════════════════════════════════════════════════════════
// HOME — assets, maintenance, plants, Ruby, vendors & notes, lists
// ═══════════════════════════════════════════════════════════════════════════
renderers.home = function renderHome() {
  const body = $('#home-body'); const sc = body.scrollTop; body.innerHTML = '';
  const today = S.today();
  const grid = h('div', { class: 'home-grid container' });

  // Maintenance
  const mc = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, '🔧 Maintenance'), h('button', { class: 'btn btn-quiet btn-sm', onclick: () => openMaintenanceEditor() }, '+ Rule')));
  const mb = h('div', { class: 'card-bd' });
  const rules = S.all('maintenance_rules').filter(m => m.active !== false).sort((a, b) => (a.next_due || '9').localeCompare(b.next_due || '9'));
  if (!rules.length) mb.append(h('div', { class: 'empty' }, 'No maintenance rules yet.'));
  rules.forEach(m => {
    const over = m.next_due && m.next_due < today, soon = m.next_due && !over && D.diffDays(today, m.next_due) <= 14;
    const off = m.season_months?.length && !m.season_months.includes(D.monthOf(today));
    mb.append(h('div', { class: 'row', onclick: () => openMaintenanceSheet(m) },
      h('div', { class: 'ico' }, h('span', { class: 'status-dot ' + (off ? '' : over ? 'st-over' : soon ? 'st-soon' : 'st-ok'), style: off ? 'background:var(--border2)' : '' })),
      h('div', { class: 'body' }, h('div', { class: 'title' }, m.name), h('div', { class: 'ctx', html: `${off ? 'Off-season' : m.next_due ? (over ? `<b style="color:var(--coral)">${D.diffDays(m.next_due, today)}d overdue</b>` : 'due ' + esc(D.humanDate(m.next_due, today))) : 'not scheduled'} · every ${m.interval_days}d${m.last_done_at ? ' · last ' + esc(D.humanDate(m.last_done_at, today)) : ''}` })),
      h('div', { class: 'right' }, h('button', { class: 'btn btn-ghost btn-sm', onclick: e => { e.stopPropagation(); recordMaintenance(m.id); } }, 'Done'), svgChev())));
  });
  mc.append(mb); grid.append(mc);

  // Assets
  const ac = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, '🏗️ Equipment'), h('button', { class: 'btn btn-quiet btn-sm', onclick: () => openAssetEditor() }, '+ Add')));
  const ab = h('div', { class: 'card-bd' });
  const assets = S.all('assets').sort((a, b) => a.name.localeCompare(b.name));
  if (!assets.length) ab.append(h('div', { class: 'empty' }, 'Add your HVAC, water heater, appliances — with nameplate photos later.'));
  assets.forEach(a => {
    const cons = (a.consumables || []).map(c => `${c.name}: ${c.spec}`).join(' · ');
    ab.append(h('div', { class: 'row', onclick: () => openAssetEditor(a) }, h('div', { class: 'ico' }, a.emoji || '🔧'), h('div', { class: 'body' }, h('div', { class: 'title' }, a.name), h('div', { class: 'ctx' }, [a.brand, a.model].filter(Boolean).join(' ') || cons || areaLabel(a.area_id) || '')), svgChev()));
  });
  ac.append(ab); grid.append(ac);

  // Plants
  const pc = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, '🌱 Plants & Hydro'), h('button', { class: 'btn btn-quiet btn-sm', onclick: () => openPlantEditor() }, '+ Add')));
  const pb = h('div', { class: 'card-bd' });
  const C = ctx();
  const plants = C.plants.filter(p => !p.archived);
  if (!plants.length) pb.append(h('div', { class: 'empty' }, 'Track outdoor plants and the hydro unit.'));
  plants.forEach(p => {
    const lastW = p.last_water, days = lastW ? D.diffDays(lastW, today) : null;
    const due = days != null && p.water_interval_days && days >= p.water_interval_days;
    pb.append(h('div', { class: 'row', onclick: () => openPlantLogSheet(p) }, h('div', { class: 'ico' }, p.kind === 'hydroponic' ? '💧' : '🪴'), h('div', { class: 'body' }, h('div', { class: 'title' }, p.name), h('div', { class: 'ctx', html: `${esc(p.location || p.group_name || '')}${lastW ? ` · watered ${days}d ago` : ' · no log yet'}${due ? ' · <b style="color:var(--amber)">check</b>' : ''}` })), h('div', { class: 'right' }, h('button', { class: 'btn btn-ghost btn-sm', onclick: e => { e.stopPropagation(); quickPlant(p, 'water'); } }, 'Watered'), svgChev())));
  });
  pc.append(pb); grid.append(pc);

  // Ruby
  S.all('pets').forEach(pet => {
    const acts = S.all('pet_activities').filter(a => a.pet_id === pet.id).sort((a, b) => b.at.localeCompare(a.at));
    const last7 = acts.filter(a => a.kind === 'training' && D.diffDays(D.dateOf(a.at, S.tz), today) < 7);
    const focusCounts = {}; acts.filter(a => a.kind === 'training' && a.focus).slice(0, 30).forEach(a => focusCounts[a.focus] = (focusCounts[a.focus] || 0) + 1);
    const rusty = ['recall','heel','sit/stay','place','leash manners'].filter(f => !acts.some(a => a.focus === f && D.diffDays(D.dateOf(a.at, S.tz), today) < 10));
    const rc = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, `🐾 ${pet.name}`), h('button', { class: 'btn btn-quiet btn-sm', onclick: () => { const r = S.all('routines').find(r => r.pet_id === pet.id); r ? openRoutineSheet(r) : null; } }, '+ Log')));
    const rb = h('div', { class: 'card-bd', style: 'padding:6px 16px 14px' });
    rb.append(h('div', { style: 'display:flex;gap:18px;padding:6px 0 10px' }, stat(last7.length, 'sessions / 7d'), stat(mins(last7.reduce((a, x) => a + (x.duration_min || 0), 0)) || '0m', 'training / 7d'), stat(acts[0] ? D.humanDate(D.dateOf(acts[0].at, S.tz), today) : '—', 'last')));
    if (rusty.length) rb.append(h('div', { class: 'note' }, `Not practiced lately: ${rusty.join(', ')}`));
    acts.slice(0, 4).forEach(a => rb.append(h('div', { class: 'faint', style: 'font-size:13px;padding:4px 0' }, `${D.humanDate(D.dateOf(a.at, S.tz), today)} · ${a.kind}${a.duration_min ? ' · ' + a.duration_min + ' min' : ''}${a.focus ? ' · ' + a.focus : ''}${a.note ? ' · ' + a.note : ''}`)));
    rc.append(rb); grid.append(rc);
  });

  // Vendors & notes
  const nc = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, '📇 Vendors & notes'), h('button', { class: 'btn btn-quiet btn-sm', onclick: () => openNoteEditor() }, '+ Add')));
  const nb = h('div', { class: 'card-bd' });
  const notes = S.all('notes').sort((a, b) => (b.pinned - a.pinned) || a.title.localeCompare(b.title));
  if (!notes.length) nb.append(h('div', { class: 'empty' }, 'Plumber, electrician, paint colors, filter sizes…'));
  notes.forEach(n => nb.append(h('div', { class: 'row', onclick: () => openNoteEditor(n) }, h('div', { class: 'ico' }, n.vendor ? '🧰' : '📝'), h('div', { class: 'body' }, h('div', { class: 'title' }, n.title), h('div', { class: 'ctx' }, [n.phone, n.body].filter(Boolean).join(' · '))), n.phone ? h('a', { href: 'tel:' + n.phone.replace(/[^\d+]/g, ''), class: 'btn btn-ghost btn-sm', onclick: e => e.stopPropagation() }, 'Call') : svgChev())));
  nc.append(nb); grid.append(nc);

  // Lists
  S.all('lists').filter(l => !l.archived).forEach(l => {
    const items = S.all('list_items').filter(i => i.list_id === l.id).sort((a, b) => a.done - b.done || a.sort - b.sort);
    const lc = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, `🛒 ${l.name}`), h('span', { class: 'cnt' }, `${items.filter(i => !i.done).length} open`)));
    const lb = h('div', { class: 'card-bd' });
    items.forEach(i => { const chk = h('div', { class: 'check' + (i.done ? ' on' : '') }, svgCheck()); chk.onclick = () => dbUpdate('list_items', i.id, { done: !i.done }, { silent: true }); lb.append(h('div', { class: 'row no-line' + (i.done ? ' done' : ''), style: 'min-height:42px;padding:6px 10px' }, chk, h('div', { class: 'body' }, h('div', { class: 'title' }, i.text + (i.qty ? ` × ${i.qty}` : ''))), h('button', { class: 'icon-btn', style: 'width:30px;height:30px', onclick: () => dbRemove('list_items', i.id, { silent: true }) }, '×'))); });
    const inp = h('input', { class: 'chip', style: 'width:100%;margin:6px 0 4px;font-weight:500', placeholder: 'Add item…', onkeydown: async e => { if (e.key === 'Enter' && e.target.value.trim()) { await dbInsert('list_items', { list_id: l.id, text: e.target.value.trim(), sort: items.length }, { silent: true }); e.target.value = ''; } } });
    lb.append(h('div', { style: 'padding:0 6px' }, inp)); lc.append(lb); grid.append(lc);
  });
  // Recent files & photos (household-wide; the AI files them, this is the browse view)
  const recent = S.all('files').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 12);
  if (recent.length) {
    const fcard = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, '📎 Recent files'), h('button', { class: 'btn btn-quiet btn-sm', onclick: () => { openAI(); $('#pick-files').click(); } }, '+ Add')));
    const fg = h('div', { class: 'files-grid' });
    recent.forEach(f => { const links = S.all('file_links').filter(l => l.file_id === f.id && l.entity_type !== 'ai_thread'); const el = h('div', { class: 'f', onclick: () => openFile(f), title: [f.ai_summary || f.caption || f.original_name, links.length ? `→ ${links.map(l => l.entity_type).join(', ')}` : 'not linked yet'].join('\n') }); const th = h('div', { class: 'th' }, fileIcon(f.mime_type)); el.append(th, h('div', { class: 'nm' }, f.caption || f.original_name || f.kind)); if (/^image\//.test(f.mime_type || '')) api.signedUrl(f.metadata?.derivative_path || f.storage_path).then(u => { if (u) th.replaceWith(h('img', { class: 'th', src: u, alt: '' })); }).catch(() => {}); fg.append(el); });
    fcard.append(fg); grid.append(fcard);
  }
  body.append(grid); body.scrollTop = sc;
};
function stat(v, l) { return h('div', {}, h('div', { class: 'display', style: 'font-size:22px' }, v), h('div', { class: 'faint', style: 'font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em' }, l)); }
async function quickPlant(p, kind) { await dbInsert('plant_observations', { plant_id: p.id, at: new Date().toISOString(), kind }, { silent: true }); toast(`${p.name}: ${kind}`); }

function openMaintenanceSheet(m) {
  const today = S.today(); let done = today, note = '', cost = null;
  const logs = S.all('maintenance_log').filter(l => l.rule_id === m.id || (m.asset_id && l.asset_id === m.asset_id)).sort((a, b) => b.done_at.localeCompare(a.done_at));
  const asset = S.get('assets', m.asset_id);
  openSheet({ title: m.name, saveLabel: 'Record done', build: b => {
    b.append(h('p', { class: 'muted', style: 'font-size:14px' }, `Every ${m.interval_days} days${asset ? ` · ${asset.name}` : ''}${m.next_due ? ` · next due ${D.humanDate(m.next_due, today)}` : ''}`));
    if (m.instructions) b.append(h('div', { class: 'note', style: 'margin-top:8px' }, m.instructions));
    if (asset?.consumables?.length) b.append(h('div', { class: 'note', style: 'margin-top:8px' }, asset.consumables.map(c => `${c.name}: ${c.spec}`).join(' · ')));
    b.append(h('div', { class: 'rows' }, srow('📅', 'Done on', h('input', { type: 'date', value: done, max: today, onchange: e => done = e.target.value })), srow('💵', 'Cost', h('input', { type: 'number', placeholder: '0', style: 'width:80px', onchange: e => cost = Number(e.target.value) || null }))));
    b.append(h('input', { class: 'big-input', style: 'margin-top:10px;font-size:15px', placeholder: 'Note (filter size, what you noticed…)', oninput: e => note = e.target.value }));
    if (logs.length) { b.append(h('div', { class: 'sec-title' }, 'History')); logs.slice(0, 8).forEach(l => b.append(h('div', { class: 'faint', style: 'font-size:13px;padding:3px 4px' }, `${l.done_at}${l.note ? ' · ' + l.note : ''}${l.cost ? ' · ' + money(l.cost) : ''}`))); if (logs.length >= 2) { const gaps = []; for (let i = 0; i < logs.length - 1; i++) gaps.push(D.diffDays(logs[i + 1].done_at, logs[i].done_at)); const med = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]; if (Math.abs(med - m.interval_days) > m.interval_days * 0.2) b.append(h('div', { class: 'note', style: 'margin-top:8px' }, `Real interval has been ~${med} days vs the ${m.interval_days}-day rule. Edit the rule if that's the new normal.`)); } }
    b.append(h('div', { style: 'display:flex;gap:8px;margin-top:16px' }, h('button', { class: 'btn btn-ghost', onclick: () => openMaintenanceEditor(m) }, 'Edit rule')));
  }, onSave: async () => { await recordMaintenance(m.id, { done_at: done, note, cost }); } });
}
function openMaintenanceEditor(m) {
  const x = m ? { ...m } : { name: '', interval_days: 90, importance: 'should', instructions: '', asset_id: null, next_due: S.today() };
  openSheet({ title: m ? 'Edit rule' : 'New maintenance rule', build: b => {
    b.append(h('input', { class: 'big-input', placeholder: 'e.g. Replace HVAC filter', value: x.name, autofocus: true, oninput: e => x.name = e.target.value }));
    const rows = h('div', { class: 'rows' });
    rows.append(srow('🔁', 'Every (days)', h('input', { type: 'number', min: 1, value: x.interval_days, style: 'width:70px', onchange: e => x.interval_days = Number(e.target.value) || 30 })));
    rows.append(srow('📅', 'Next due', h('input', { type: 'date', value: x.next_due || '', onchange: e => x.next_due = e.target.value || null })));
    const aV = vtext(x.asset_id ? S.get('assets', x.asset_id)?.name : 'None'); rows.append(srow('🏗️', 'Equipment', aV, async () => { const v = await pickOne('Equipment', [{ value: null, label: 'None' }, ...S.all('assets').map(a => ({ value: a.id, label: `${a.emoji || ''} ${a.name}` }))], x.asset_id); x.asset_id = v; aV.textContent = v ? S.get('assets', v)?.name : 'None'; }));
    rows.append(srow('❗', 'Importance', h('select', { onchange: e => x.importance = e.target.value }, ...['must','should','nice'].map(v => h('option', { value: v, selected: x.importance === v }, v)))));
    const seasons = h('input', { type: 'text', placeholder: 'e.g. 4-10', value: x.season_months?.length ? `${x.season_months[0]}-${x.season_months[x.season_months.length - 1]}` : '', style: 'text-align:right;background:none;border:none;width:90px', onchange: e => { const m2 = e.target.value.match(/(\d+)\s*-\s*(\d+)/); x.season_months = m2 ? Array.from({ length: Number(m2[2]) - Number(m2[1]) + 1 }, (_, i) => Number(m2[1]) + i) : null; } });
    rows.append(srow('🗓️', 'Months active', seasons));
    b.append(rows, h('textarea', { class: 'big-input', style: 'margin-top:10px', placeholder: 'Instructions', oninput: e => x.instructions = e.target.value }, x.instructions || ''));
    if (m) b.append(h('button', { class: 'btn btn-danger', style: 'margin-top:16px', onclick: async () => { closeSheet(); await dbUpdate('maintenance_rules', m.id, { active: false }); toast('Rule archived'); } }, 'Archive rule'));
  }, onSave: async () => { if (!x.name.trim()) return false; const patch = { name: x.name.trim(), interval_days: x.interval_days, next_due: x.next_due, asset_id: x.asset_id, importance: x.importance, instructions: x.instructions || null, season_months: x.season_months || null }; if (m) await dbUpdate('maintenance_rules', m.id, patch); else await dbInsert('maintenance_rules', { ...patch, active: true }); } });
}
function openAssetEditor(a) {
  const x = a ? { ...a, consumables: [...(a.consumables || [])] } : { name: '', emoji: '🔧', brand: '', model: '', serial: '', consumables: [], notes: '', area_id: null, warranty_until: null };
  openSheet({ title: a ? a.name : 'New equipment', build: b => {
    b.append(h('input', { class: 'big-input', placeholder: 'Name (e.g. Water heater)', value: x.name, autofocus: true, oninput: e => x.name = e.target.value }));
    const rows = h('div', { class: 'rows' });
    rows.append(srow('😀', 'Emoji', h('input', { type: 'text', value: x.emoji || '', maxlength: 2, style: 'width:50px;text-align:right;background:none;border:none;font-size:18px', oninput: e => x.emoji = e.target.value })));
    ['brand','model','serial'].forEach(k => rows.append(srow('🔤', k[0].toUpperCase() + k.slice(1), h('input', { type: 'text', value: x[k] || '', style: 'text-align:right;background:none;border:none;width:60%', oninput: e => x[k] = e.target.value }))));
    const aV = vtext(x.area_id ? areaLabel(x.area_id) : 'None'); rows.append(srow('📁', 'Area', aV, async () => { const v = await pickOne('Area', [{ value: null, label: 'None' }, ...S.all('areas').map(ar => ({ value: ar.id, label: `${ar.emoji || ''} ${ar.name}` }))], x.area_id); x.area_id = v; aV.textContent = v ? areaLabel(v) : 'None'; }));
    rows.append(srow('🛡️', 'Warranty until', h('input', { type: 'date', value: x.warranty_until || '', onchange: e => x.warranty_until = e.target.value || null })));
    b.append(rows);
    b.append(h('div', { class: 'sec-title' }, 'Consumables / filters', h('button', { class: 'link', onclick: () => { x.consumables.push({ name: '', spec: '' }); renderCons(); } }, '+ Add')));
    const consEl = h('div'); b.append(consEl);
    const renderCons = () => { consEl.innerHTML = ''; x.consumables.forEach((c, i) => consEl.append(h('div', { class: 'frow', style: 'margin-bottom:6px' }, h('input', { class: 'chip', style: 'font-weight:500', placeholder: 'Filter', value: c.name, oninput: e => c.name = e.target.value }), h('input', { class: 'chip', style: 'font-weight:500', placeholder: '16×25×1 MERV-11', value: c.spec, oninput: e => c.spec = e.target.value })))); };
    renderCons();
    b.append(h('textarea', { class: 'big-input', style: 'margin-top:10px', placeholder: 'Notes', oninput: e => x.notes = e.target.value }, x.notes || ''));
    if (a) { const rules = S.all('maintenance_rules').filter(r => r.asset_id === a.id && r.active !== false); if (rules.length) { b.append(h('div', { class: 'sec-title' }, 'Maintenance')); rules.forEach(r => b.append(h('div', { class: 'faint', style: 'font-size:13px;padding:3px 4px' }, `${r.name} · every ${r.interval_days}d · next ${r.next_due || '—'}`))); } b.append(h('button', { class: 'btn btn-danger', style: 'margin-top:16px', onclick: async () => { if (await confirmSheet('Remove equipment?', 'Maintenance rules linked to it are kept.')) { await dbRemove('assets', a.id); } } }, 'Remove')); }
  }, onSave: async () => { if (!x.name.trim()) return false; const patch = { name: x.name.trim(), emoji: x.emoji || null, brand: x.brand || null, model: x.model || null, serial: x.serial || null, area_id: x.area_id, warranty_until: x.warranty_until, consumables: x.consumables.filter(c => c.name || c.spec), notes: x.notes || null }; if (a) await dbUpdate('assets', a.id, patch); else await dbInsert('assets', patch); } });
}
function openNoteEditor(n) {
  const x = n ? { ...n } : { title: '', body: '', vendor: false, phone: '', url: '', pinned: false };
  openSheet({ title: n ? 'Note' : 'New note / vendor', build: b => {
    b.append(h('input', { class: 'big-input', placeholder: 'Title', value: x.title, autofocus: true, oninput: e => x.title = e.target.value }));
    b.append(h('textarea', { class: 'big-input', style: 'margin-top:8px;min-height:100px', placeholder: 'Details, paint codes, filter sizes, what they charged…', oninput: e => x.body = e.target.value }, x.body || ''));
    const rows = h('div', { class: 'rows' });
    rows.append(srow('🧰', 'Vendor', h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: x.vendor, onchange: e => x.vendor = e.target.checked }), h('i'))));
    rows.append(srow('📞', 'Phone', h('input', { type: 'tel', value: x.phone || '', style: 'text-align:right;background:none;border:none;width:60%', oninput: e => x.phone = e.target.value })));
    rows.append(srow('🔗', 'Link', h('input', { type: 'url', value: x.url || '', style: 'text-align:right;background:none;border:none;width:60%', oninput: e => x.url = e.target.value })));
    rows.append(srow('📌', 'Pinned', h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: x.pinned, onchange: e => x.pinned = e.target.checked }), h('i'))));
    b.append(rows);
    if (n) b.append(h('button', { class: 'btn btn-danger', style: 'margin-top:16px', onclick: async () => { closeSheet(); await dbRemove('notes', n.id); toast('Deleted'); } }, 'Delete'));
  }, onSave: async () => { if (!x.title.trim()) return false; const patch = { title: x.title.trim(), body: x.body || null, vendor: !!x.vendor, phone: x.phone || null, url: x.url || null, pinned: !!x.pinned }; if (n) await dbUpdate('notes', n.id, patch); else await dbInsert('notes', patch); } });
}
function openPlantEditor(p) {
  const x = p ? { ...p } : { name: '', kind: 'outdoor', location: '', container: '', group_name: '', water_interval_days: null };
  openSheet({ title: p ? p.name : 'New plant', build: b => {
    b.append(h('input', { class: 'big-input', placeholder: 'Name', value: x.name, autofocus: true, oninput: e => x.name = e.target.value }));
    const rows = h('div', { class: 'rows' });
    rows.append(srow('🌱', 'Kind', h('select', { onchange: e => x.kind = e.target.value }, ...[['outdoor','Outdoor'],['indoor','Indoor'],['hydroponic','Hydroponic']].map(([v, l]) => h('option', { value: v, selected: x.kind === v }, l)))));
    ['location','container','group_name','species'].forEach(k => rows.append(srow('🔤', k.replace('_', ' ')[0].toUpperCase() + k.replace('_', ' ').slice(1), h('input', { type: 'text', value: x[k] || '', style: 'text-align:right;background:none;border:none;width:60%', oninput: e => x[k] = e.target.value }))));
    rows.append(srow('💧', 'Check every (days)', h('input', { type: 'number', value: x.water_interval_days || '', style: 'width:64px', placeholder: 'auto', onchange: e => x.water_interval_days = Number(e.target.value) || null })));
    b.append(rows);
    if (p) b.append(h('button', { class: 'btn btn-danger', style: 'margin-top:16px', onclick: async () => { closeSheet(); await dbUpdate('plants', p.id, { archived: true }); } }, 'Archive'));
  }, onSave: async () => { if (!x.name.trim()) return false; const patch = { name: x.name.trim(), kind: x.kind, location: x.location || null, container: x.container || null, group_name: x.group_name || null, species: x.species || null, water_interval_days: x.water_interval_days }; if (p) await dbUpdate('plants', p.id, patch); else await dbInsert('plants', patch); } });
}
function openPlantLogSheet(p) {
  let kind = 'water', soil = '', note = '', ph = null, ec = null, level = '';
  const obs = S.all('plant_observations').filter(o => o.plant_id === p.id).sort((a, b) => b.at.localeCompare(a.at));
  openSheet({ title: p.name, saveLabel: 'Log', build: b => {
    const kinds = p.kind === 'hydroponic' ? ['topoff','nutrient','clean','observe','harvest','ph_ec'] : ['water','fertilize','prune','repot','observe','harvest'];
    const ch = h('div', { class: 'chips' }); kinds.forEach(k => { const btn = h('button', { class: k === kind ? 'active' : '' }, k.replace('_', '/')); btn.onclick = () => { kind = k; $$('button', ch).forEach(x => x.classList.toggle('active', x === btn)); }; ch.append(btn); }); b.append(ch);
    const rows = h('div', { class: 'rows' });
    if (p.kind !== 'hydroponic') rows.append(srow('🪨', 'Soil', h('select', { onchange: e => soil = e.target.value }, h('option', { value: '' }, '—'), ...['dry','moist','wet'].map(v => h('option', { value: v }, v)))));
    else { rows.append(srow('🧪', 'pH', h('input', { type: 'number', step: '0.1', style: 'width:70px', onchange: e => ph = Number(e.target.value) || null }))); rows.append(srow('⚡', 'EC', h('input', { type: 'number', step: '0.01', style: 'width:70px', onchange: e => ec = Number(e.target.value) || null }))); rows.append(srow('🌊', 'Water level', h('select', { onchange: e => level = e.target.value }, h('option', { value: '' }, '—'), ...['full','ok','low','empty'].map(v => h('option', { value: v }, v))))); }
    b.append(rows, h('input', { class: 'big-input', style: 'margin-top:10px;font-size:15px', placeholder: 'Observation', oninput: e => note = e.target.value }));
    if (obs.length) { b.append(h('div', { class: 'sec-title' }, 'History')); obs.slice(0, 8).forEach(o => b.append(h('div', { class: 'faint', style: 'font-size:13px;padding:3px 4px' }, `${D.humanDate(D.dateOf(o.at, S.tz), S.today())} · ${o.kind}${o.soil_state ? ' · ' + o.soil_state : ''}${o.ph ? ' · pH ' + o.ph : ''}${o.note ? ' · ' + o.note : ''}`))); }
    b.append(h('div', { style: 'display:flex;gap:8px;margin-top:16px' }, h('button', { class: 'btn btn-ghost', onclick: () => openPlantEditor(p) }, 'Edit plant')));
  }, onSave: async () => { await dbInsert('plant_observations', { plant_id: p.id, at: new Date().toISOString(), kind: kind === 'ph_ec' ? 'observe' : kind, soil_state: soil || null, ph, ec, water_level: level || null, note: note || null }, { silent: true }); toast(`${p.name}: ${kind}`); } });
}

// ═══════════════════════════════════════════════════════════════════════════
// PROJECTS
// ═══════════════════════════════════════════════════════════════════════════
const PS = { id: null, tab: 'steps' };
renderers.projects = function renderProjects(params) {
  if (params?.id) PS.id = params.id;
  const root = $('#proj-layout'); const sc = $('.proj-main .scroll', root)?.scrollTop || 0; root.innerHTML = '';
  const projects = S.all('projects').sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || a.priority - b.priority);
  if (!PS.id && !isPhone() && projects[0]) PS.id = projects[0].id;
  const side = h('div', { class: 'proj-side' + (isPhone() && !PS.id ? ' mobile-show' : '') });
  side.append(h('div', { class: 'list-hd' }, h('h2', {}, 'Projects'), h('button', { class: 'btn btn-primary btn-sm', onclick: () => openProjectEditor() }, '+ New')));
  const ss = h('div', { class: 'scroll', style: 'padding:0 10px 120px' });
  projects.forEach(p => { const pct = projectProgress(p.id); const next = P.nextStepOf(p.id, ctx()); const it = h('div', { class: 'proj-item' + (PS.id === p.id ? ' active' : ''), onclick: () => { PS.id = p.id; renderers.projects(); } }, h('div', { class: 'nm' }, h('span', {}, p.name), h('span', { class: 'pri' }, p.status === 'active' ? `P${p.priority}` : p.status)), h('div', { class: 'st' }, next ? `Next: ${next.title}` : p.status === 'done' ? 'Complete' : 'No steps yet'), h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` }))); ss.append(it); });
  side.append(ss);
  const main = h('div', { class: 'proj-main' + (isPhone() && !PS.id ? ' mobile-hide' : '') });
  const p = projOf(PS.id);
  if (!p) main.append(h('div', { class: 'empty', style: 'padding-top:80px' }, h('div', { class: 'big' }, '📐'), 'Pick a project'));
  else {
    const steps = S.all('project_steps').filter(s => s.project_id === p.id).sort((a, b) => a.sort - b.sort);
    const costs = S.all('project_costs').filter(c => c.project_id === p.id);
    const pct = projectProgress(p.id); const C = ctx(); const next = P.nextStepOf(p.id, C);
    const hd = h('div', { class: 'list-hd', style: 'align-items:flex-start' });
    if (isPhone()) hd.append(h('button', { class: 'icon-btn', onclick: () => { PS.id = null; renderers.projects(); } }, h('span', { html: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>' })));
    hd.append(h('div', { style: 'flex:1;min-width:0' }, h('h2', {}, p.name), h('div', { class: 'faint', style: 'font-size:13px;margin-top:2px' }, [p.status === 'active' ? `Priority ${p.priority}` : p.status, p.stage, p.target_date ? `target ${D.humanDate(p.target_date, S.today())}` : null, areaLabel(p.area_id)].filter(Boolean).join(' · '))), h('div', { style: 'text-align:right' }, h('div', { class: 'display', style: 'font-size:26px;color:var(--violet)' }, `${pct}%`), h('button', { class: 'btn btn-quiet btn-sm', onclick: () => openProjectEditor(p) }, 'Edit')));
    main.append(hd);
    const sc2 = h('div', { class: 'scroll', style: 'flex:1;padding:0 20px 140px' });
    if (p.description) sc2.append(h('p', { class: 'muted', style: 'font-size:14.5px;margin:0 0 14px' }, p.description));
    if (next) sc2.append(h('div', { class: 'card', style: 'margin-bottom:16px;border-color:rgba(109,91,208,.35)' }, h('div', { class: 'card-bd', style: 'padding:12px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap' }, h('div', { style: 'flex:1;min-width:200px' }, h('div', { class: 'faint', style: 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em' }, 'Next action'), h('div', { style: 'font-weight:600;font-size:16px' }, next.title), h('div', { class: 'faint', style: 'font-size:12.5px' }, [next.phase, next.est_min ? mins(next.est_min) : null].filter(Boolean).join(' · '))), h('button', { class: 'btn btn-primary btn-sm', onclick: () => scheduleStep(next) }, 'Block time'), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => completeStep(next.id) }, 'Done'))));
    // steps
    const card = h('div', { class: 'card' }, h('div', { class: 'card-hd' }, h('h3', {}, `Steps · ${steps.filter(s => s.status === 'done').length}/${steps.length}`), h('button', { class: 'btn btn-quiet btn-sm', onclick: () => openStepEditor(null, p) }, '+ Step')));
    const bd = h('div', { class: 'card-bd' }); let lastPhase = null;
    steps.forEach(s => {
      if (s.phase !== lastPhase) { bd.append(h('div', { class: 'phase-lbl' }, s.phase || 'Steps')); lastPhase = s.phase; }
      const blocked = !(s.depends_on || []).every(id => { const d = S.get('project_steps', id); return !d || d.status === 'done' || d.status === 'skipped'; });
      const done = s.status === 'done' || s.status === 'skipped';
      const chk = h('div', { class: 'check' + (done ? ' on' : ''), title: blocked ? 'Blocked by earlier steps' : '' }, svgCheck()); chk.onclick = e => { e.stopPropagation(); completeStep(s.id, !done); };
      const deps = (s.depends_on || []).map(id => S.get('project_steps', id)).filter(d => d && d.status !== 'done').map(d => d.title);
      bd.append(h('div', { class: 'step' + (done ? ' done' : '') + (blocked && !done ? ' blocked' : ''), onclick: () => openStepEditor(s, p) }, chk, h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 't' }, s.title), h('div', { class: 'm' }, [s.est_min ? mins(s.est_min) : null, done && s.done_at ? `done ${D.humanDate(D.dateOf(s.done_at, S.tz), S.today())}` : null, deps.length ? `after: ${deps.join(', ')}` : null, s.note].filter(Boolean).join(' · '))), svgChev()));
    });
    if (!steps.length) bd.append(h('div', { class: 'empty' }, 'Break it into steps — HomeBase plans from the next unblocked one.'));
    card.append(bd); sc2.append(card);
    // costs
    const tp = costs.reduce((a, c) => a + (Number(c.projected) || 0), 0), ta = costs.reduce((a, c) => a + (Number(c.actual) || 0), 0);
    const cc = h('div', { class: 'card', style: 'margin-top:16px' }, h('div', { class: 'card-hd' }, h('h3', {}, 'Costs'), h('div', { style: 'display:flex;gap:8px;align-items:center' }, p.budget ? h('span', { class: 'tag ' + (ta > p.budget ? 'coral' : 'sage') }, `${money(ta)} of ${money(p.budget)}`) : null, h('button', { class: 'btn btn-quiet btn-sm', onclick: () => openCostEditor(null, p) }, '+ Item'))));
    if (costs.length) { const tb = h('table', { class: 'costs' }, h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', {}, 'Qty'), h('th', { class: 'num' }, 'Planned'), h('th', { class: 'num' }, 'Actual'))), h('tbody', {}, ...costs.map(c => h('tr', { style: 'cursor:pointer', onclick: () => openCostEditor(c, p) }, h('td', {}, c.item), h('td', { class: 'faint' }, c.qty || ''), h('td', { class: 'num' }, money(c.projected)), h('td', { class: 'num', style: c.actual != null ? 'color:var(--sage)' : '' }, money(c.actual))))), h('tfoot', {}, h('tr', {}, h('td', { colspan: 2 }, 'Total'), h('td', { class: 'num' }, money(tp)), h('td', { class: 'num' }, money(ta))))); cc.append(h('div', { style: 'padding:0 8px 8px;overflow-x:auto' }, tb)); } else cc.append(h('div', { class: 'empty' }, 'Materials and purchases go here.'));
    sc2.append(cc);
    // files & photos linked by the AI (receipts, progress photos)
    const fc = filesCard('project', p.id, { extra: { name: p.name } }); if (fc) sc2.append(fc);
    // linked tasks & notes
    const linked = S.all('tasks').filter(t => t.project_id === p.id && t.status === 'open'); const pnotes = S.all('notes').filter(n => n.project_id === p.id);
    if (linked.length || pnotes.length) { const lc = h('div', { class: 'card', style: 'margin-top:16px' }, h('div', { class: 'card-hd' }, h('h3', {}, 'Linked'), h('button', { class: 'btn btn-quiet btn-sm', onclick: () => openTaskEditor(null, { project_id: p.id, area_id: p.area_id }) }, '+ Task'))); const lb = h('div', { class: 'card-bd' }); linked.forEach(t => lb.append(taskRow(t))); pnotes.forEach(n => lb.append(h('div', { class: 'row', onclick: () => openNoteEditor(n) }, h('div', { class: 'ico' }, '📝'), h('div', { class: 'body' }, h('div', { class: 'title' }, n.title), h('div', { class: 'ctx' }, n.body || '')), svgChev()))); lc.append(lb); sc2.append(lc); }
    else sc2.append(h('div', { style: 'margin-top:12px;display:flex;gap:8px' }, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => openTaskEditor(null, { project_id: p.id, area_id: p.area_id }) }, '+ Linked task'), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => openNoteEditor({ title: '', body: '', project_id: p.id }) }, '+ Note')));
    main.append(sc2);
  }
  root.append(side, main); const s2 = $('.proj-main .scroll', root); if (s2) s2.scrollTop = sc;
};
function openProjectEditor(p) {
  const x = p ? { ...p } : { name: '', priority: S.all('projects').filter(q => q.status === 'active').length + 1, status: 'active', stage: '', description: '', budget: null, area_id: null, target_date: null };
  openSheet({ title: p ? 'Edit project' : 'New project', build: b => {
    b.append(h('input', { class: 'big-input', placeholder: 'Project name', value: x.name, autofocus: true, oninput: e => x.name = e.target.value }));
    b.append(h('textarea', { class: 'big-input', style: 'margin-top:8px', placeholder: 'What done looks like', oninput: e => x.description = e.target.value }, x.description || ''));
    const rows = h('div', { class: 'rows' });
    rows.append(srow('🏆', 'Priority', h('input', { type: 'number', min: 1, max: 9, value: x.priority, style: 'width:60px', onchange: e => x.priority = Number(e.target.value) || 9 })));
    rows.append(srow('🚦', 'Status', h('select', { onchange: e => x.status = e.target.value }, ...['active','paused','idea','done'].map(v => h('option', { value: v, selected: x.status === v }, v)))));
    rows.append(srow('📍', 'Stage', h('input', { type: 'text', value: x.stage || '', style: 'text-align:right;background:none;border:none;width:60%', oninput: e => x.stage = e.target.value })));
    rows.append(srow('💵', 'Budget', h('input', { type: 'number', value: x.budget || '', style: 'width:90px', onchange: e => x.budget = Number(e.target.value) || null })));
    rows.append(srow('🎯', 'Target', h('input', { type: 'date', value: x.target_date || '', onchange: e => x.target_date = e.target.value || null })));
    const aV = vtext(x.area_id ? areaLabel(x.area_id) : 'None'); rows.append(srow('📁', 'Area', aV, async () => { const v = await pickOne('Area', [{ value: null, label: 'None' }, ...S.all('areas').map(a => ({ value: a.id, label: `${a.emoji || ''} ${a.name}` }))], x.area_id); x.area_id = v; aV.textContent = v ? areaLabel(v) : 'None'; }));
    b.append(rows);
    if (!p) b.append(h('p', { class: 'faint', style: 'font-size:12.5px;margin-top:12px' }, 'Tip: after creating it, ask HomeBase “break the fence project into steps” and it will draft the step list with dependencies.'));
    if (p) b.append(h('button', { class: 'btn btn-danger', style: 'margin-top:16px', onclick: async () => { if (await confirmSheet('Delete project?', 'Steps and costs go with it. Tasks linked to it stay.')) { await dbRemove('projects', p.id); PS.id = null; } } }, 'Delete project'));
  }, onSave: async () => { if (!x.name.trim()) return false; const patch = { name: x.name.trim(), description: x.description || null, priority: x.priority, status: x.status, stage: x.stage || null, budget: x.budget, target_date: x.target_date, area_id: x.area_id, completed_at: x.status === 'done' ? (p?.completed_at || new Date().toISOString()) : null }; if (p) await dbUpdate('projects', p.id, patch); else { const np = await dbInsert('projects', { ...patch, start_date: S.today() }); PS.id = np.id; } } });
}
function openStepEditor(s, p) {
  const steps = S.all('project_steps').filter(x => x.project_id === p.id).sort((a, b) => a.sort - b.sort);
  const x = s ? { ...s, depends_on: [...(s.depends_on || [])] } : { title: '', phase: steps[steps.length - 1]?.phase || '', est_min: 60, note: '', depends_on: steps.length ? [steps[steps.length - 1].id] : [], sort: steps.length };
  openSheet({ title: s ? 'Step' : 'New step', build: b => {
    b.append(h('input', { class: 'big-input', placeholder: 'Step', value: x.title, autofocus: true, oninput: e => x.title = e.target.value }));
    const rows = h('div', { class: 'rows' });
    rows.append(srow('🏷️', 'Phase', h('input', { type: 'text', value: x.phase || '', list: 'phases', style: 'text-align:right;background:none;border:none;width:60%', oninput: e => x.phase = e.target.value })));
    rows.append(srow('⏱️', 'Estimate (min)', h('input', { type: 'number', value: x.est_min || '', style: 'width:70px', onchange: e => x.est_min = Number(e.target.value) || null })));
    const depV = vtext(x.depends_on.length ? `${x.depends_on.length} step${x.depends_on.length > 1 ? 's' : ''}` : 'None');
    rows.append(srow('⛓️', 'Depends on', depV, () => { const others = steps.filter(o => o.id !== s?.id); openSheetNested('Depends on', bb => { others.forEach(o => { const on = x.depends_on.includes(o.id); const it = h('div', { class: 'picker-item' + (on ? ' sel' : '') }, h('div', { class: 'check' + (on ? ' on' : '') }, svgCheck()), h('div', {}, o.title)); it.onclick = () => { const i = x.depends_on.indexOf(o.id); if (i >= 0) x.depends_on.splice(i, 1); else x.depends_on.push(o.id); it.classList.toggle('sel'); $('.check', it).classList.toggle('on'); }; bb.append(it); }); }, () => { depV.textContent = x.depends_on.length ? `${x.depends_on.length} step${x.depends_on.length > 1 ? 's' : ''}` : 'None'; }); }));
    b.append(rows, h('input', { class: 'big-input', style: 'margin-top:10px;font-size:15px', placeholder: 'Note', value: x.note || '', oninput: e => x.note = e.target.value }));
    if (s) b.append(h('div', { style: 'display:flex;gap:8px;margin-top:16px;flex-wrap:wrap' }, h('button', { class: 'btn btn-ghost', onclick: () => { closeSheet(); scheduleStep(s); } }, 'Block time'), s.status !== 'skipped' ? h('button', { class: 'btn btn-ghost', onclick: async () => { closeSheet(); await dbUpdate('project_steps', s.id, { status: 'skipped', done_at: new Date().toISOString() }); } }, 'Skip') : null, h('button', { class: 'btn btn-danger', style: 'margin-left:auto', onclick: async () => { closeSheet(); await dbRemove('project_steps', s.id); } }, 'Delete')));
  }, onSave: async () => { if (!x.title.trim()) return false; const patch = { title: x.title.trim(), phase: x.phase || null, est_min: x.est_min, note: x.note || null, depends_on: x.depends_on }; if (s) await dbUpdate('project_steps', s.id, patch); else await dbInsert('project_steps', { ...patch, project_id: p.id, sort: x.sort, status: 'todo' }); } });
}
function openCostEditor(c, p) {
  const x = c ? { ...c } : { item: '', qty: '', projected: null, actual: null, vendor: '' };
  openSheet({ title: c ? 'Cost item' : 'New cost item', build: b => {
    b.append(h('input', { class: 'big-input', placeholder: 'Item', value: x.item, autofocus: true, oninput: e => x.item = e.target.value }));
    const rows = h('div', { class: 'rows' });
    rows.append(srow('#️⃣', 'Qty', h('input', { type: 'text', value: x.qty || '', style: 'text-align:right;background:none;border:none;width:80px', oninput: e => x.qty = e.target.value })));
    rows.append(srow('📐', 'Planned $', h('input', { type: 'number', value: x.projected ?? '', style: 'width:90px', onchange: e => x.projected = e.target.value === '' ? null : Number(e.target.value) })));
    rows.append(srow('🧾', 'Actual $', h('input', { type: 'number', value: x.actual ?? '', style: 'width:90px', onchange: e => x.actual = e.target.value === '' ? null : Number(e.target.value) })));
    rows.append(srow('🏪', 'Vendor', h('input', { type: 'text', value: x.vendor || '', style: 'text-align:right;background:none;border:none;width:60%', oninput: e => x.vendor = e.target.value })));
    b.append(rows);
    if (c) b.append(h('button', { class: 'btn btn-danger', style: 'margin-top:16px', onclick: async () => { closeSheet(); await dbRemove('project_costs', c.id); } }, 'Delete'));
  }, onSave: async () => { if (!x.item.trim()) return false; const patch = { item: x.item.trim(), qty: x.qty || null, projected: x.projected, actual: x.actual, vendor: x.vendor || null }; if (c) await dbUpdate('project_costs', c.id, patch); else await dbInsert('project_costs', { ...patch, project_id: p.id }); } });
}

// ═══════════════════════════════════════════════════════════════════════════
// CALENDAR
// ═══════════════════════════════════════════════════════════════════════════
const CS = { mode: 'month', y: null, m: null, day: null };
const MN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
renderers.calendar = function renderCalendar(params) {
  const today = S.today();
  if (params?.date) { CS.day = params.date; CS.y = Number(params.date.slice(0, 4)); CS.m = Number(params.date.slice(5, 7)) - 1; if (CS.mode === 'month') CS.mode = 'week'; }
  if (CS.y == null) { CS.y = Number(today.slice(0, 4)); CS.m = Number(today.slice(5, 7)) - 1; CS.day = today; if (isPhone()) CS.mode = 'list'; }
  const root = $('#cal-root'); root.innerHTML = '';
  const tb = h('div', { class: 'cal-tb' });
  const title = h('h2');
  tb.append(h('button', { class: 'icon-btn', onclick: () => calNav(-1) }, h('span', { html: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>' })), title, h('button', { class: 'icon-btn', onclick: () => calNav(1) }, h('span', { html: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>' })), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { CS.y = Number(today.slice(0, 4)); CS.m = Number(today.slice(5, 7)) - 1; CS.day = today; renderers.calendar(); } }, 'Today'));
  const seg = h('div', { class: 'seg', style: 'margin-left:auto' }); ['month','week','list'].forEach(m => seg.append(h('button', { class: CS.mode === m ? 'active' : '', onclick: () => { CS.mode = m; renderers.calendar(); } }, m[0].toUpperCase() + m.slice(1))));
  tb.append(seg, h('button', { class: 'btn btn-primary btn-sm', onclick: () => openEventEditor(null, { date: CS.day || today }) }, '+ Event'));
  root.append(tb);
  const C = ctx();
  if (CS.mode === 'month') {
    title.textContent = `${MN[CS.m]} ${CS.y}`;
    const first = `${CS.y}-${String(CS.m + 1).padStart(2, '0')}-01`; const fdow = D.DOW.indexOf(D.dow(first)); const start = D.addDays(first, -fdow);
    const wrap = h('div', { class: 'cal-month' }); wrap.append(h('div', { class: 'cal-dn' }, ...['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => h('div', {}, d))));
    const grid = h('div', { class: 'cal-grid' });
    for (let i = 0; i < 42; i++) {
      const d = D.addDays(start, i); const other = Number(d.slice(5, 7)) - 1 !== CS.m; const items = dayItems(d, C);
      const cell = h('div', { class: 'cal-cell' + (other ? ' other' : '') + (d === today ? ' today' : ''), onclick: () => { CS.day = d; CS.mode = 'week'; renderers.calendar(); } });
      const mode = P.modeFor(d, C); cell.append(h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline' }, h('span', { class: 'n' }, Number(d.slice(8))), mode.mode !== 'normal' ? h('span', { class: 'mode' }, mode.mode) : (S.weather[d] && S.weather[d].rain_prob >= 50 ? h('span', { style: 'font-size:10px' }, '🌧') : null)));
      const max = isPhone() ? 2 : 4;
      items.slice(0, max).forEach(it => cell.append(h('div', { class: 'cev ' + it.cls }, it.label)));
      if (items.length > max) cell.append(h('div', { class: 'cev more' }, `+${items.length - max}`));
      grid.append(cell);
    }
    wrap.append(grid); root.append(wrap);
  } else if (CS.mode === 'week') {
    const ws = D.addDays(CS.day, -D.DOW.indexOf(D.dow(CS.day)));
    title.textContent = `${D.humanDate(ws)} – ${D.humanDate(D.addDays(ws, 6))}`;
    const wrap = h('div', { class: 'cal-week scroll' });
    for (let i = 0; i < 7; i++) {
      const d = D.addDays(ws, i); const items = dayItems(d, C, true); const mode = P.modeFor(d, C);
      const col = h('div', { class: 'cal-day-col' + (d === today ? ' today' : '') });
      col.append(h('div', { class: 'hd', onclick: () => openDayModeSheet(d), style: 'cursor:pointer' }, h('b', {}, Number(d.slice(8))), h('span', {}, D.dow(d)), mode.mode !== 'normal' ? h('span', { class: 'tag should', style: 'margin-left:auto' }, mode.mode) : (S.weather[d] ? h('span', { style: 'margin-left:auto;font-size:11px;color:var(--text3)' }, `${S.weather[d].tmax_f}° ${S.weather[d].rain_prob >= 30 ? S.weather[d].rain_prob + '%🌧' : ''}`) : null)));
      const bd = h('div', { class: 'bd' });
      if (!items.length) bd.append(h('div', { class: 'faint', style: 'font-size:12px;padding:6px 8px' }, 'Free'));
      items.forEach(it => bd.append(h('div', { class: 'cal-item', onclick: it.open }, it.time ? h('span', { class: 'tm' }, D.fmtHM(it.time)) : h('span', { class: 'dt', style: `background:${it.color}` }), h('div', { class: 'nm' }, h('div', {}, it.label), it.sub ? h('div', { class: 'sub' }, it.sub) : null))));
      bd.append(h('button', { class: 'btn btn-quiet btn-sm', style: 'margin-top:4px;align-self:flex-start', onclick: () => openEventEditor(null, { date: d }) }, '+'));
      col.append(bd); wrap.append(col);
    }
    root.append(wrap);
  } else {
    title.textContent = 'Next 14 days';
    const wrap = h('div', { class: 'cal-list scroll', style: 'flex:1' });
    for (let i = 0; i < 14; i++) { const d = D.addDays(today, i); const items = dayItems(d, C, true); if (!items.length) continue; wrap.append(h('div', { class: 'dayhd' + (d === today ? ' today' : '') }, h('b', {}, Number(d.slice(8))), h('span', {}, `${D.dow(d)} · ${D.humanDate(d, today)}`))); const card = h('div', { class: 'card' }); const bd = h('div', { class: 'card-bd' }); items.forEach(it => bd.append(h('div', { class: 'cal-item', onclick: it.open }, it.time ? h('span', { class: 'tm' }, D.fmtHM(it.time)) : h('span', { class: 'dt', style: `background:${it.color}` }), h('div', { class: 'nm' }, h('div', {}, it.label), it.sub ? h('div', { class: 'sub' }, it.sub) : null)))); card.append(bd); wrap.append(card); }
    root.append(wrap);
  }
};
function calNav(dir) { if (CS.mode === 'month') { CS.m += dir; if (CS.m > 11) { CS.m = 0; CS.y++; } if (CS.m < 0) { CS.m = 11; CS.y--; } } else { CS.day = D.addDays(CS.day, 7 * dir); CS.y = Number(CS.day.slice(0, 4)); CS.m = Number(CS.day.slice(5, 7)) - 1; } renderers.calendar(); }
// everything that belongs to a day: fixed events, work blocks, tasks due/scheduled, maintenance due, routines due (planner view)
function dayItems(d, C, rich = false) {
  const out = [];
  eventsOn(d).forEach(e => out.push({ time: e.all_day ? null : D.timeOf(e.starts_at, S.tz), label: e.title, cls: e.kind === 'work_block' ? 'block' : '', color: e.kind === 'work_block' ? 'var(--violet)' : 'var(--sky)', sub: e.kind === 'work_block' ? 'Work block' : (e.ends_at && !e.all_day ? `until ${D.fmtHM(D.timeOf(e.ends_at, S.tz))}` : ''), open: () => openEventEditor(e), sort: e.all_day ? '00:00' : D.timeOf(e.starts_at, S.tz) }));
  S.all('tasks').filter(t => t.status === 'open' && (t.due_date === d || D.dateOf(t.scheduled_start, S.tz) === d) && !(t.scheduled_start && D.dateOf(t.scheduled_start, S.tz) === d && S.all('events').some(e => e.task_id === t.id))).forEach(t => out.push({ time: D.dateOf(t.scheduled_start, S.tz) === d ? D.timeOf(t.scheduled_start, S.tz) : null, label: t.title, cls: t.importance === 'must' ? 'must' : 'task', color: t.importance === 'must' ? 'var(--coral)' : 'var(--accent)', sub: [t.importance === 'must' ? 'Must do' : 'Due', t.project_id ? projOf(t.project_id)?.name : areaOf(t.area_id)?.name].filter(Boolean).join(' · '), open: () => openTaskEditor(t), sort: D.dateOf(t.scheduled_start, S.tz) === d ? D.timeOf(t.scheduled_start, S.tz) : '99' }));
  S.all('maintenance_rules').filter(m => m.active !== false && m.next_due === d).forEach(m => out.push({ time: null, label: m.name, cls: 'maint', color: 'var(--amber)', sub: 'Maintenance due', open: () => openMaintenanceSheet(m), sort: '98' }));
  if (rich && d >= C.today) P.candidatesFor(d, C).filter(c => c.kind === 'routine' && c.due_date === d).forEach(c => out.push({ time: null, label: c.title, cls: 'task', color: 'var(--sage)', sub: 'Routine', open: () => openRoutineSheet(c.ref), sort: '97' }));
  return out.sort((a, b) => a.sort.localeCompare(b.sort));
}
function openEventEditor(ev, defaults = {}) {
  const isNew = !ev; const d0 = defaults.date || S.today();
  const x = ev ? { ...ev } : { title: '', kind: 'fixed', date: d0, time: '18:00', end: '19:00', all_day: false, color: 'sky', notes: '', people_ids: [] };
  if (ev) { x.date = D.dateOf(ev.starts_at, S.tz); x.time = D.timeOf(ev.starts_at, S.tz); x.end = ev.ends_at ? D.timeOf(ev.ends_at, S.tz) : ''; x.endDate = ev.ends_at ? D.dateOf(ev.ends_at, S.tz) : x.date; }
  openSheet({ title: isNew ? 'New event' : (ev.kind === 'work_block' ? 'Work block' : 'Event'), saveLabel: isNew ? 'Add' : 'Save', build: b => {
    b.append(h('input', { class: 'big-input', placeholder: 'Title', value: x.title, autofocus: true, oninput: e => x.title = e.target.value }));
    const rows = h('div', { class: 'rows' });
    rows.append(srow('📅', 'Date', h('input', { type: 'date', value: x.date, onchange: e => x.date = e.target.value })));
    rows.append(srow('🌞', 'All day', h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: x.all_day, onchange: e => { x.all_day = e.target.checked; tRow.style.display = eRow.style.display = x.all_day ? 'none' : ''; } }), h('i'))));
    const tRow = srow('🕐', 'Start', h('input', { type: 'time', value: x.time, onchange: e => x.time = e.target.value })); const eRow = srow('🕓', 'End', h('input', { type: 'time', value: x.end, onchange: e => x.end = e.target.value }));
    if (x.all_day) tRow.style.display = eRow.style.display = 'none';
    rows.append(tRow, eRow);
    rows.append(srow('🏷️', 'Type', h('select', { onchange: e => x.kind = e.target.value }, ...[['fixed','Fixed event'],['travel','Travel'],['deadline','Deadline'],['work_block','Work block']].map(([v, l]) => h('option', { value: v, selected: x.kind === v }, l)))));
    rows.append(srow('🎨', 'Color', h('select', { onchange: e => x.color = e.target.value }, ...['sky','violet','coral','sage','amber'].map(v => h('option', { value: v, selected: x.color === v }, v)))));
    const who = h('div', { class: 'chips', style: 'padding:0' }); S.people.forEach(p => { const on = (x.people_ids || []).includes(p.id); const c = h('button', { class: on ? 'active' : '', type: 'button' }, p.name); c.onclick = () => { const i = x.people_ids.indexOf(p.id); if (i >= 0) x.people_ids.splice(i, 1); else x.people_ids.push(p.id); c.classList.toggle('active'); }; who.append(c); }); rows.append(srow('👥', 'Who', who));
    b.append(rows, h('textarea', { class: 'big-input', style: 'margin-top:10px', placeholder: 'Notes / location', oninput: e => x.notes = e.target.value }, x.notes || ''));
    if (!isNew) b.append(h('button', { class: 'btn btn-danger', style: 'margin-top:16px', onclick: async () => { closeSheet(); await dbRemove('events', ev.id); if (ev.task_id) { const t = S.get('tasks', ev.task_id); if (t) dbUpdate('tasks', t.id, { scheduled_start: null, scheduled_end: null }, { silent: true }); } toast('Removed'); } }, 'Delete'));
  }, onSave: async () => {
    if (!x.title.trim()) return false;
    const starts_at = x.all_day ? D.toISO(x.date, '00:00', S.tz) : D.toISO(x.date, x.time || '09:00', S.tz);
    const ends_at = x.all_day ? D.toISO(x.date, '23:59', S.tz) : (x.end ? D.toISO(x.date, x.end, S.tz) : null);
    const patch = { title: x.title.trim(), kind: x.kind, starts_at, ends_at, all_day: !!x.all_day, color: x.color, notes: x.notes || null, people_ids: x.people_ids || [] };
    if (isNew) { await dbInsert('events', patch); toast('Added'); } else { await dbUpdate('events', ev.id, patch); if (ev.task_id) dbUpdate('tasks', ev.task_id, { scheduled_start: starts_at, scheduled_end: ends_at }, { silent: true }); }
  } });
}
