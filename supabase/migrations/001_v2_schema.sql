-- HomeBase v2 — schema
-- Run in Supabase SQL editor (or `supabase db push`). Idempotent.
-- Archives v17 tables as v17_* (never drops), then creates the v2 life model.

create extension if not exists pgcrypto;

-- ───────────────────────────────────────────────────────────
-- 0. Archive v17 tables (only if they exist and are the old shape)
-- ───────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['tasks','maintenance','equipment','notes','projects','events','folders'] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t)
       and not exists (select 1 from information_schema.columns
                       where table_schema='public' and table_name=t and column_name='household_id') then
      execute format('alter table public.%I rename to %I', t, 'v17_'||t);
      raise notice 'archived % -> v17_%', t, t;
    end if;
  end loop;
end $$;

-- ───────────────────────────────────────────────────────────
-- 1. Helpers
-- ───────────────────────────────────────────────────────────
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create or replace function public.gen_invite_code() returns text
language sql volatile as $$
  select upper(substr(encode(gen_random_bytes(6),'hex'),1,8));
$$;

-- ───────────────────────────────────────────────────────────
-- 2. Household + membership
-- ───────────────────────────────────────────────────────────
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tz text not null default 'America/Chicago',
  invite_code text not null default public.gen_invite_code(),
  settings jsonb not null default '{}'::jsonb,   -- capacity table, windows, weather lat/lon, wall pin hash
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  color text,
  is_user boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  person_id uuid references public.people(id) on delete set null,
  role text not null default 'member',            -- owner | member
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Which households does the calling user belong to? (security definer so RLS on
-- household_members itself doesn't recurse)
create or replace function public.my_households() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(household_id), '{}') from public.household_members where user_id = auth.uid();
$$;

-- ───────────────────────────────────────────────────────────
-- 3. Life model
-- ───────────────────────────────────────────────────────────
create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  kind text not null default 'room',              -- room | life | relationship
  emoji text,
  sort int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  area_id uuid references public.areas(id) on delete set null,
  name text not null,
  floor text,
  dims jsonb,          -- {w_ft, l_ft, h_ft, sqft}
  finishes jsonb,      -- {paint, flooring, trim}
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  priority int not null default 9,                -- 1 = highest
  status text not null default 'active',          -- active | paused | done | idea
  stage text,
  description text,
  budget numeric(10,2),
  room_id uuid references public.rooms(id) on delete set null,
  area_id uuid references public.areas(id) on delete set null,
  start_date date,
  target_date date,
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_steps (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  phase text,
  sort int not null default 0,
  status text not null default 'todo',            -- todo | doing | done | skipped
  depends_on uuid[] not null default '{}',
  est_min int,
  actual_min int,
  note text,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_costs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  item text not null,
  qty text,
  projected numeric(10,2),
  actual numeric(10,2),
  vendor text,
  purchased_at date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  species text,
  breed text,
  birthdate date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  emoji text,
  room_id uuid references public.rooms(id) on delete set null,
  area_id uuid references public.areas(id) on delete set null,
  brand text, model text, serial text,
  purchased_at date,
  warranty_until date,
  consumables jsonb not null default '[]'::jsonb, -- [{name:'Filter', spec:'16x25x1 MERV-11', url}]
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.maintenance_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete set null,
  name text not null,
  interval_days int not null,
  season_months int[],                            -- e.g. {5,6,7,8,9} for condensate drain
  last_done_at date,
  next_due date,
  instructions text,
  importance text not null default 'should',      -- must | should | nice
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.maintenance_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  rule_id uuid references public.maintenance_rules(id) on delete set null,
  asset_id uuid references public.assets(id) on delete set null,
  done_at date not null default current_date,
  note text,
  cost numeric(10,2),
  by_person_id uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  emoji text,
  area_id uuid references public.areas(id) on delete set null,
  pet_id uuid references public.pets(id) on delete set null,
  cadence jsonb not null,           -- see shared/recurrence.js
  min_version text,                 -- reduced form used in sick/busy modes
  default_min int,
  importance text not null default 'should',
  location text not null default 'home',
  weather_dependent boolean not null default false,
  last_done_at timestamptz,
  streak int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.routine_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  routine_id uuid not null references public.routines(id) on delete cascade,
  done_at timestamptz not null default now(),
  duration_min int,
  detail jsonb,                     -- {focus:'recall'} for Ruby, {flowers:'tulips'} …
  note text,
  by_person_id uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  notes text,
  importance text not null default 'should',      -- must | should | nice
  status text not null default 'open',            -- open | done | skipped | cancelled
  due_date date,                                  -- deadline
  window_start date,                              -- flexible window
  window_end date,
  scheduled_start timestamptz,                    -- planned work block
  scheduled_end timestamptz,
  duration_min int,
  location text not null default 'home',          -- home | anywhere | away
  weather_dependent boolean not null default false,
  energy text not null default 'med',             -- low | med | high
  area_id uuid references public.areas(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  step_id uuid references public.project_steps(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  asset_id uuid references public.assets(id) on delete set null,
  routine_id uuid references public.routines(id) on delete set null,
  maintenance_rule_id uuid references public.maintenance_rules(id) on delete set null,
  assignee_id uuid references public.people(id) on delete set null,
  recurrence jsonb,                               -- null = one-off
  series_id uuid,                                 -- groups instances of a recurring task
  postponed int not null default 0,
  original_date date,                             -- where it was before a replan
  completed_at timestamptz,
  actual_min int,
  source text not null default 'user',            -- user | ai | routine | maintenance | planner
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_hh_status_due on public.tasks(household_id, status, due_date);
create index if not exists tasks_series on public.tasks(series_id);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  kind text not null default 'fixed',             -- fixed | work_block | travel | deadline
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  location text,
  task_id uuid references public.tasks(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  people_ids uuid[] not null default '{}',
  recurrence jsonb,
  series_id uuid,
  color text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists events_hh_start on public.events(household_id, starts_at);

create table if not exists public.plants (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  species text,
  kind text not null default 'outdoor',           -- outdoor | indoor | hydroponic
  group_name text,                                -- e.g. 'Hydro unit 1', 'Front bed'
  location text,
  container text,
  soil text,
  planted_at date,
  water_interval_days int,                        -- learned; null = unknown
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plant_observations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  plant_id uuid references public.plants(id) on delete cascade,
  group_name text,                                -- observation for a whole group/unit
  at timestamptz not null default now(),
  kind text not null,                             -- water | fertilize | prune | repot | observe | harvest | nutrient | clean | topoff
  soil_state text,                                -- dry | moist | wet
  ph numeric(4,2), ec numeric(6,3), water_level text,
  note text,
  file_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.pet_activities (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,                             -- training | walk | vet | med | grooming | other
  duration_min int,
  focus text,                                     -- 'recall', 'heel', 'stay' …
  note text,
  by_person_id uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  kind text not null default 'shopping',          -- shopping | packing | other
  store text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.list_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  list_id uuid not null references public.lists(id) on delete cascade,
  text text not null,
  qty text,
  done boolean not null default false,
  project_id uuid references public.projects(id) on delete set null,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  body text,
  vendor boolean not null default false,
  phone text, url text,
  area_id uuid references public.areas(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  asset_id uuid references public.assets(id) on delete set null,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  storage_path text not null,                     -- bucket household-media
  kind text not null default 'photo',             -- photo | scan | manual | receipt
  caption text,
  taken_at timestamptz,
  entity_type text, entity_id uuid,               -- what it belongs to
  created_at timestamptz not null default now()
);

create table if not exists public.links (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  from_type text not null, from_id uuid not null,
  to_type text not null,   to_id uuid not null,
  rel text not null default 'related',
  created_at timestamptz not null default now(),
  unique (from_type, from_id, to_type, to_id, rel)
);

create table if not exists public.day_modes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  date date not null,
  mode text not null,                             -- normal | busy | travel | sick | vacation | project
  person_id uuid references public.people(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  capacity_override_min int,
  note text,
  created_at timestamptz not null default now(),
  unique (household_id, date, person_id)
);

-- ───────────────────────────────────────────────────────────
-- 4. Memory, AI, history
-- ───────────────────────────────────────────────────────────
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  subject text not null,                          -- scheduling | home | projects | plants | pets | family | preferences | people
  kind text not null,                             -- fact | preference | pattern | stat
  content text not null,
  source text not null default 'stated',          -- stated | observed | inferred
  confidence numeric(3,2) not null default 0.8,
  evidence_count int not null default 1,
  status text not null default 'active',          -- active | ignored | rejected
  entity_type text, entity_id uuid,
  data jsonb,                                     -- structured payload for patterns: {usual_day, median_min, postpone_rate, interval_days}
  last_confirmed_at timestamptz,
  last_used_at timestamptz,
  expires_at timestamptz,
  fts tsvector generated always as (to_tsvector('english', coalesce(content,''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists memories_fts on public.memories using gin(fts);
create index if not exists memories_entity on public.memories(household_id, entity_type, entity_id, kind);

create table if not exists public.ai_threads (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  thread_id uuid not null references public.ai_threads(id) on delete cascade,
  role text not null,                             -- user | assistant
  content jsonb not null,                         -- Anthropic content blocks
  text text,                                      -- flattened text for search
  tool_calls jsonb,
  actions jsonb,                                  -- executed actions summary
  tokens_in int, tokens_out int,
  fts tsvector generated always as (to_tsvector('english', coalesce(text,''))) stored,
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_thread on public.ai_messages(thread_id, created_at);
create index if not exists ai_messages_fts on public.ai_messages using gin(fts);

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  at timestamptz not null default now(),
  actor text not null,                            -- person id, 'ai', 'system'
  entity_type text not null,
  entity_id uuid,
  action text not null,                           -- create | update | complete | postpone | delete | replan | log
  before jsonb, after jsonb,
  reason text
);
create index if not exists activity_hh_at on public.activity_log(household_id, at desc);
create index if not exists activity_entity on public.activity_log(entity_type, entity_id);

-- ───────────────────────────────────────────────────────────
-- 5. updated_at triggers
-- ───────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['households','people','areas','rooms','projects','project_steps','project_costs',
    'pets','assets','maintenance_rules','routines','tasks','events','plants','lists','list_items','notes',
    'memories','ai_threads'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ───────────────────────────────────────────────────────────
-- 6. Realtime publication
-- ───────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['people','areas','rooms','projects','project_steps','project_costs','pets','assets',
    'maintenance_rules','maintenance_log','routines','routine_log','tasks','events','plants','plant_observations',
    'pet_activities','lists','list_items','notes','day_modes','memories','ai_messages','activity_log'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ───────────────────────────────────────────────────────────
-- 7. Bootstrap RPCs (security definer so a fresh user can create/join)
-- ───────────────────────────────────────────────────────────
create or replace function public.create_household(p_name text, p_person_name text, p_seed boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare hh uuid; pid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into households(name) values (p_name) returning id into hh;
  insert into people(household_id, name, is_user, sort) values (hh, p_person_name, true, 0) returning id into pid;
  insert into household_members(household_id, user_id, person_id, role) values (hh, auth.uid(), pid, 'owner');
  if p_seed then perform public.seed_household(hh); end if;
  return hh;
end $$;

create or replace function public.join_household(p_code text, p_person_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare hh uuid; pid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into hh from households where invite_code = upper(trim(p_code));
  if hh is null then raise exception 'invalid invite code'; end if;
  -- reuse an existing person row with the same name (e.g. seeded "Hayley"), else create
  select id into pid from people where household_id = hh and lower(name) = lower(trim(p_person_name)) limit 1;
  if pid is null then
    insert into people(household_id, name, is_user, sort) values (hh, trim(p_person_name), true, 1) returning id into pid;
  else
    update people set is_user = true where id = pid;
  end if;
  insert into household_members(household_id, user_id, person_id, role) values (hh, auth.uid(), pid, 'member')
    on conflict (household_id, user_id) do update set person_id = excluded.person_id;
  return hh;
end $$;

-- Placeholder; real body in 003_seed_household.sql
create or replace function public.seed_household(hh uuid) returns void
language plpgsql security definer set search_path = public as $$ begin return; end $$;