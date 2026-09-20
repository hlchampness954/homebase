-- HomeBase v2 — Row Level Security
-- Every household table: members of the household can read/write their rows.
-- Idempotent (drops + recreates policies).

do $$
declare t text;
begin
  foreach t in array array['people','areas','rooms','projects','project_steps','project_costs','pets','assets',
    'maintenance_rules','maintenance_log','routines','routine_log','tasks','events','plants','plant_observations',
    'pet_activities','lists','list_items','notes','files','links','day_modes','memories','ai_threads','ai_messages',
    'activity_log'] loop
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

-- households: members can read + update (settings); creation goes through create_household()
alter table public.households enable row level security;
drop policy if exists hh_select on public.households;
drop policy if exists hh_update on public.households;
create policy hh_select on public.households for select to authenticated using (id = any(public.my_households()));
create policy hh_update on public.households for update to authenticated using (id = any(public.my_households())) with check (id = any(public.my_households()));

-- household_members: members can see who else is in the household; changes via RPCs only
alter table public.household_members enable row level security;
drop policy if exists hm_select on public.household_members;
create policy hm_select on public.household_members for select to authenticated using (household_id = any(public.my_households()));

-- v17 archive tables: lock them down (read-only for authenticated, nothing for anon)
do $$
declare t text;
begin
  foreach t in array array['v17_tasks','v17_maintenance','v17_equipment','v17_notes','v17_projects','v17_events','v17_folders'] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists allow_all on public.%I', t);
      execute format('drop policy if exists v17_read on public.%I', t);
      execute format('create policy v17_read on public.%I for select to authenticated using (true)', t);
    end if;
  end loop;
end $$;

-- Storage bucket for photos/scans/manuals (private; signed URLs from the app)
insert into storage.buckets (id, name, public) values ('household-media','household-media', false)
  on conflict (id) do nothing;
drop policy if exists media_rw on storage.objects;
create policy media_rw on storage.objects for all to authenticated
  using (bucket_id = 'household-media' and (storage.foldername(name))[1]::uuid = any(public.my_households()))
  with check (bucket_id = 'household-media' and (storage.foldername(name))[1]::uuid = any(public.my_households()));

grant execute on function public.my_households() to authenticated;
grant execute on function public.create_household(text, text, boolean) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;