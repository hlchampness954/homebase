-- HomeBase v2 — seed a household with Luke's real setup (spec §7).
-- Called by create_household(); safe to call again (skips if areas already exist).

create or replace function public.seed_household(hh uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  a_kitchen uuid; a_living uuid; a_master uuid; a_nursery uuid; a_garage uuid; a_laundry uuid; a_home uuid;
  a_yard uuid; a_family uuid; a_errands uuid; a_pets uuid; a_rel uuid; a_plants uuid;
  p_nursery uuid; p_patio uuid;
  s_exc uuid; s_drainplan uuid; s_french uuid; s_down uuid; s_grade uuid; s_base uuid; s_comp uuid; s_pav uuid; s_edge uuid; s_grav uuid; s_fin uuid;
  ruby uuid; hayley uuid;
  as_hvac uuid; as_purifier uuid; as_ac uuid;
begin
  if exists (select 1 from areas where household_id = hh) then return; end if;

  -- settings: capacity table, discretionary windows, weather (New Braunfels)
  update households set settings = settings || jsonb_build_object(
    'capacity', jsonb_build_object(
      'normal',   jsonb_build_object('weekday', 90,  'weekend', 300),
      'busy',     jsonb_build_object('weekday', 30,  'weekend', 180),
      'travel',   jsonb_build_object('weekday', 0,   'weekend', 0,   'remote', 30),
      'sick',     jsonb_build_object('weekday', 20,  'weekend', 20,  'must_only', true),
      'vacation', jsonb_build_object('weekday', 0,   'weekend', 0),
      'project',  jsonb_build_object('weekday', 90,  'weekend', 360)
    ),
    'windows', jsonb_build_object(
      'weekday', jsonb_build_array(jsonb_build_object('start','17:30','end','21:00')),
      'weekend', jsonb_build_array(jsonb_build_object('start','08:00','end','18:00'))
    ),
    'weather', jsonb_build_object('lat', 29.703, 'lon', -98.124, 'label', 'New Braunfels, TX'),
    'today_cap', 7,
    'attention_cap', 6
  ) where id = hh;

  -- people (Luke is created by create_household as the first user)
  insert into people(household_id, name, is_user, sort, color) values (hh, 'Hayley', false, 1, 'violet') returning id into hayley;

  -- pets
  insert into pets(household_id, name, species) values (hh, 'Ruby', 'dog') returning id into ruby;

  -- areas
  insert into areas(household_id, name, kind, emoji, sort) values
    (hh,'Kitchen','room','🍳',0) returning id into a_kitchen;
  insert into areas(household_id, name, kind, emoji, sort) values (hh,'Living Room','room','🛋️',1) returning id into a_living;
  insert into areas(household_id, name, kind, emoji, sort) values (hh,'Master Bedroom','room','🛏️',2) returning id into a_master;
  insert into areas(household_id, name, kind, emoji, sort) values (hh,'Nursery','room','🧸',3) returning id into a_nursery;
  insert into areas(household_id, name, kind, emoji, sort) values (hh,'Laundry','room','🧺',4) returning id into a_laundry;
  insert into areas(household_id, name, kind, emoji, sort) values (hh,'Garage','room','🚗',5) returning id into a_garage;
  insert into areas(household_id, name, kind, emoji, sort) values (hh,'Yard & Patio','room','🌿',6) returning id into a_yard;
  insert into areas(household_id, name, kind, emoji, sort) values (hh,'Whole House','room','🏠',7) returning id into a_home;
  insert into areas(household_id, name, kind, emoji, sort) values (hh,'Relationship','relationship','💛',10) returning id into a_rel;
  insert into areas(household_id, name, kind, emoji, sort) values (hh,'Family','life','👨‍👩‍👧',11) returning id into a_family;
  insert into areas(household_id, name, kind, emoji, sort) values (hh,'Errands','life','🛒',12) returning id into a_errands;
  insert into areas(household_id, name, kind, emoji, sort) values (hh,'Ruby','life','🐾',13) returning id into a_pets;
  insert into areas(household_id, name, kind, emoji, sort) values (hh,'Plants & Hydro','life','🌱',14) returning id into a_plants;

  -- projects
  insert into projects(household_id, name, priority, status, stage, description, area_id, start_date)
    values (hh, 'Nursery', 1, 'active', 'Wall prep', 'Get the nursery ready. Highest active home-project priority.', a_nursery, current_date)
    returning id into p_nursery;
  insert into project_steps(household_id, project_id, title, phase, sort, est_min) values
    (hh, p_nursery, 'Clear room & protect floor', 'Prep', 0, 60),
    (hh, p_nursery, 'Patch and sand walls', 'Prep', 1, 120),
    (hh, p_nursery, 'Prime walls', 'Paint', 2, 120),
    (hh, p_nursery, 'Paint walls (2 coats)', 'Paint', 3, 240),
    (hh, p_nursery, 'Paint trim & door', 'Paint', 4, 120),
    (hh, p_nursery, 'Install crib', 'Furnish', 5, 60),
    (hh, p_nursery, 'Dresser / changing station', 'Furnish', 6, 60),
    (hh, p_nursery, 'Blackout curtains & rod', 'Furnish', 7, 45),
    (hh, p_nursery, 'Decor, shelves, night light', 'Finish', 8, 90);
  -- chain dependencies in order
  update project_steps s set depends_on = array(select id from project_steps p where p.project_id = p_nursery and p.sort = s.sort - 1)
    where s.project_id = p_nursery and s.sort > 0;

  insert into projects(household_id, name, priority, status, stage, description, area_id, start_date)
    values (hh, 'Paver Patio + French Drain', 2, 'active', 'Planning', 'Drainage and patio as one dependency-driven project.', a_yard, current_date)
    returning id into p_patio;
  insert into project_steps(household_id, project_id, title, phase, sort, est_min) values (hh, p_patio, 'Excavation', 'Site', 0, 480) returning id into s_exc;
  insert into project_steps(household_id, project_id, title, phase, sort, est_min) values (hh, p_patio, 'Drainage planning (slopes, outlet)', 'Drainage', 1, 90) returning id into s_drainplan;
  insert into project_steps(household_id, project_id, title, phase, sort, est_min, depends_on) values (hh, p_patio, 'French drain trench, pipe, fabric, gravel', 'Drainage', 2, 480, array[s_exc, s_drainplan]) returning id into s_french;
  insert into project_steps(household_id, project_id, title, phase, sort, est_min, depends_on) values (hh, p_patio, 'Downspout connections', 'Drainage', 3, 180, array[s_french]) returning id into s_down;
  insert into project_steps(household_id, project_id, title, phase, sort, est_min, depends_on) values (hh, p_patio, 'Grading', 'Base', 4, 240, array[s_down]) returning id into s_grade;
  insert into project_steps(household_id, project_id, title, phase, sort, est_min, depends_on) values (hh, p_patio, 'Base preparation (fabric + road base)', 'Base', 5, 360, array[s_grade]) returning id into s_base;
  insert into project_steps(household_id, project_id, title, phase, sort, est_min, depends_on) values (hh, p_patio, 'Compaction', 'Base', 6, 120, array[s_base]) returning id into s_comp;
  insert into project_steps(household_id, project_id, title, phase, sort, est_min, depends_on) values (hh, p_patio, 'Lay pavers', 'Surface', 7, 600, array[s_comp]) returning id into s_pav;
  insert into project_steps(household_id, project_id, title, phase, sort, est_min, depends_on) values (hh, p_patio, 'Edging', 'Surface', 8, 120, array[s_pav]) returning id into s_edge;
  insert into project_steps(household_id, project_id, title, phase, sort, est_min, depends_on) values (hh, p_patio, 'Gravel / landscaping', 'Finish', 9, 240, array[s_edge]) returning id into s_grav;
  insert into project_steps(household_id, project_id, title, phase, sort, est_min, depends_on) values (hh, p_patio, 'Finish work & cleanup', 'Finish', 10, 120, array[s_grav]) returning id into s_fin;

  -- assets + maintenance
  insert into assets(household_id, name, emoji, area_id, consumables) values (hh, 'House HVAC', '🌬️', a_home, '[{"name":"Return filter","spec":"(capture size/MERV from the unit)"}]') returning id into as_hvac;
  insert into assets(household_id, name, emoji, area_id, consumables) values (hh, 'Indoor air purifier', '💨', a_living, '[{"name":"Filter","spec":"(capture model from nameplate)"}]') returning id into as_purifier;
  insert into assets(household_id, name, emoji, area_id) values (hh, 'AC condensate drain', '💧', a_home) returning id into as_ac;
  insert into maintenance_rules(household_id, asset_id, name, interval_days, importance, instructions, next_due) values
    (hh, as_hvac, 'Replace house HVAC filter', 90, 'must', 'Check size on the old filter; arrows point toward the blower.', current_date + 14),
    (hh, as_purifier, 'Replace air purifier filter', 180, 'should', 'Reset the filter indicator after replacing.', current_date + 30),
    (hh, as_ac, 'Flush AC condensate drain', 30, 'should', 'Cup of vinegar or bleach solution down the drain line; check the pan.', current_date + 7);
  update maintenance_rules set season_months = '{4,5,6,7,8,9,10}' where household_id = hh and asset_id = as_ac;

  -- routines (adaptive recurring responsibilities)
  insert into routines(household_id, name, emoji, area_id, pet_id, cadence, min_version, default_min, importance, location, weather_dependent) values
    (hh, 'Ruby training', '🐾', a_pets, ruby, '{"freq":"daily","interval":1,"anchor":"schedule"}', '3-minute session', 10, 'should', 'anywhere', false),
    (hh, 'Daily household reset', '🧹', a_home, null, '{"freq":"daily","interval":1,"anchor":"schedule","after":"19:00"}', 'Kitchen only', 15, 'should', 'home', false),
    (hh, 'Flowers for Hayley', '💐', a_rel, null, '{"freq":"weekly","interval":1,"prefer":["thu","fri"],"anchor":"schedule"}', null, 20, 'should', 'away', false),
    (hh, 'Mow the grass', '🌱', a_yard, null, '{"freq":"weekly","interval":1,"byweekday":["sat","sun"],"anchor":"schedule"}', null, 60, 'should', 'home', true),
    (hh, 'Trash out', '🗑️', a_home, null, '{"freq":"weekly","interval":1,"byweekday":["wed"],"after":"17:00","backup":{"byweekday":["thu"],"before":"09:00"},"anchor":"schedule"}', null, 5, 'must', 'home', false),
    (hh, 'Hydroponics check', '💧', a_plants, null, '{"freq":"daily","interval":3,"anchor":"completion"}', 'Water level glance', 10, 'should', 'home', false),
    (hh, 'Outdoor plant check', '🪴', a_plants, null, '{"freq":"daily","interval":4,"anchor":"completion"}', null, 10, 'should', 'home', true),
    (hh, 'Date night', '🍷', a_rel, null, '{"freq":"monthly","interval":1,"anchor":"schedule","nudge_after_day":15}', null, 180, 'should', 'away', false);

  -- backlog (nice-to-do, fills open blocks)
  insert into tasks(household_id, title, importance, area_id, duration_min, location, energy, source) values
    (hh, 'Tidy garage', 'nice', a_garage, 90, 'home', 'med', 'user'),
    (hh, 'Go through old boxes', 'nice', a_garage, 60, 'home', 'low', 'user'),
    (hh, 'Sort, donate or discard unneeded items', 'nice', a_garage, 60, 'home', 'low', 'user'),
    (hh, 'Organize items being kept', 'nice', a_garage, 60, 'home', 'low', 'user');

  -- default shopping list
  insert into lists(household_id, name, kind) values (hh, 'Groceries', 'shopping'), (hh, 'Hardware / Project', 'shopping');

  -- starter memories (stated in the spec; editable in What HomeBase Knows)
  insert into memories(household_id, subject, kind, content, source, confidence) values
    (hh, 'scheduling', 'preference', 'House projects usually happen on Saturday mornings.', 'stated', 0.9),
    (hh, 'scheduling', 'preference', 'Mowing happens on the weekend; pick Saturday or Sunday based on weather and workload.', 'stated', 0.9),
    (hh, 'scheduling', 'preference', 'Trash goes out Wednesday night; Thursday morning is only a backup check.', 'stated', 0.95),
    (hh, 'family', 'preference', 'Flowers for Hayley weekly, normally bought near the end of the week.', 'stated', 0.9),
    (hh, 'family', 'preference', 'At least one intentional date night every month.', 'stated', 0.95),
    (hh, 'projects', 'fact', 'Project priorities: 1) Nursery, 2) Paver Patio + French Drain. Backlog (garage, boxes) must not compete with them.', 'stated', 1.0),
    (hh, 'pets', 'preference', 'Ruby should get some intentional training every day, even if short.', 'stated', 0.9),
    (hh, 'home', 'preference', 'Daily household reset is a short tidy, not a full cleaning session.', 'stated', 0.9),
    (hh, 'plants', 'preference', 'Prefer observation-based plant checks over rigid watering reminders.', 'stated', 0.9);
end $$;

grant execute on function public.seed_household(uuid) to authenticated;