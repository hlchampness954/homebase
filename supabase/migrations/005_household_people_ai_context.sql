-- HomeBase v2 — one household, many people (spec §12–13)
-- people.kind/emoji, task_assignments (many-to-many, kept in sync with tasks.assignee_id during the
-- transition), household_devices (per-device default person), person-scoped memories, AI sender identity.
-- Idempotent.

alter table public.people add column if not exists kind text not null default 'adult';   -- adult | child
alter table public.people add column if not exists emoji text;
alter table public.people add column if not exists avatar_path text;                      -- storage path in household-media
alter table public.people add column if not exists birthdate date;
alter table public.people add column if not exists notes text;

create table if not exists public.task_assignments (
  household_id uuid not null references public.households(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  role text not null default 'owner',       -- owner | helper | watcher
  created_at timestamptz not null default now(),
  primary key (task_id, person_id)
);
create index if not exists task_assignments_person on public.task_assignments(household_id, person_id);

-- Backfill from the legacy single assignee
insert into public.task_assignments (household_id, task_id, person_id, role)
  select household_id, id, assignee_id, 'owner' from public.tasks where assignee_id is not null
  on conflict do nothing;

-- Keep tasks.assignee_id (= the owner) and task_assignments in sync both ways during the transition.
create or replace function public.sync_task_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'tasks' then
    if new.assignee_id is distinct from coalesce(old.assignee_id, null) then
      if old.assignee_id is not null then delete from task_assignments where task_id = new.id and person_id = old.assignee_id and role = 'owner'; end if;
      if new.assignee_id is not null then
        insert into task_assignments (household_id, task_id, person_id, role) values (new.household_id, new.id, new.assignee_id, 'owner')
          on conflict (task_id, person_id) do update set role = 'owner';
      end if;
    end if;
    return new;
  else
    if tg_op = 'DELETE' then
      if old.role = 'owner' then update tasks set assignee_id = (select person_id from task_assignments where task_id = old.task_id and role = 'owner' and person_id <> old.person_id limit 1) where id = old.task_id and assignee_id = old.person_id; end if;
      return old;
    end if;
    if new.role = 'owner' then update tasks set assignee_id = new.person_id where id = new.task_id and assignee_id is distinct from new.person_id; end if;
    return new;
  end if;
end $$;
drop trigger if exists sync_task_owner on public.tasks;
create trigger sync_task_owner after insert or update of assignee_id on public.tasks for each row execute function public.sync_task_owner();
drop trigger if exists sync_task_owner on public.task_assignments;
create trigger sync_task_owner after insert or update or delete on public.task_assignments for each row execute function public.sync_task_owner();

create table if not exists public.household_devices (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  device_key text not null,                 -- stable random key kept in localStorage
  label text,
  kind text not null default 'personal',    -- personal | shared | wall
  default_person_id uuid references public.people(id) on delete set null,
  user_id uuid,
  last_seen_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,  -- {ua, platform, notifications:{…}}
  created_at timestamptz not null default now(),
  unique (household_id, device_key)
);

alter table public.memories add column if not exists person_id uuid references public.people(id) on delete set null;   -- null = household-wide
create index if not exists memories_person on public.memories(household_id, person_id);

alter table public.ai_threads add column if not exists active_person_id uuid references public.people(id) on delete set null;
alter table public.ai_messages add column if not exists sender_person_id uuid references public.people(id) on delete set null;
alter table public.ai_messages add column if not exists attachment_ids uuid[] not null default '{}';

-- RLS
do $$
declare t text;
begin
  foreach t in array array['task_assignments','household_devices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists hh_select on public.%I', t);
    execute format('drop policy if exists hh_insert on public.%I', t);
    execute format('drop policy if exists hh_update on public.%I', t);
    execute format('drop policy if exists hh_delete on public.%I', t);
    execute format('create policy hh_select on public.%I for select to authenticated using (household_id = any(public.my_households()))', t);
    execute format('create policy hh_insert on public.%I for insert to authenticated with check (household_id = any(public.my_households()))', t);
    execute format('create policy hh_update on public.%I for update to authenticated using (household_id = any(public.my_households())) with check (household_id = any(public.my_households()))', t);
    execute format('create policy hh_delete on public.%I for delete to authenticated using (household_id = any(public.my_households()))', t);
  end loop;
end $$;

-- Realtime
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.task_assignments'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.household_devices'; exception when duplicate_object then null; end;
end $$;

-- Seeded people get emoji + kind
update public.people set emoji = coalesce(emoji, case when lower(name) = 'luke' then '👨' when lower(name) = 'hayley' then '👩' else '🙂' end) where emoji is null;
