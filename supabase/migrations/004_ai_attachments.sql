-- HomeBase v2 — AI-first attachments (spec §3)
-- Extends public.files, adds file_links (many-to-many), RLS, indexes, realtime. Idempotent.
-- The private bucket `household-media` and its storage policy were created in 002_rls.sql.

alter table public.files add column if not exists original_name text;
alter table public.files add column if not exists mime_type text;
alter table public.files add column if not exists size_bytes bigint;
alter table public.files add column if not exists sha256 text;
alter table public.files add column if not exists width int;
alter table public.files add column if not exists height int;
alter table public.files add column if not exists source text not null default 'upload';          -- upload | camera | paste | drop | ai
alter table public.files add column if not exists processing_status text not null default 'ready'; -- queued | uploading | ready | processing | complete | error
alter table public.files add column if not exists extracted_text text;
alter table public.files add column if not exists ai_summary text;
alter table public.files add column if not exists metadata jsonb not null default '{}'::jsonb;     -- {derivative_path, derivative_mime, tags:[…], receipt:{merchant,date,total}, …}
alter table public.files add column if not exists created_by uuid;
alter table public.files add column if not exists updated_at timestamptz not null default now();
alter table public.files add column if not exists fts tsvector generated always as (
  to_tsvector('english', coalesce(original_name,'') || ' ' || coalesce(caption,'') || ' ' || coalesce(ai_summary,'') || ' ' || left(coalesce(extracted_text,''), 20000))
) stored;
create index if not exists files_fts on public.files using gin(fts);
create index if not exists files_hh_created on public.files(household_id, created_at desc);
create index if not exists files_sha on public.files(household_id, sha256);

create table if not exists public.file_links (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  entity_type text not null,        -- project | project_cost | plant | plant_observation | asset | maintenance_log | note | task | event | room | area | pet | routine | ai_thread | ai_message
  entity_id uuid not null,
  rel text not null default 'related',   -- related | receipt | manual | progress_photo | nameplate | observation | chat | before | after
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (file_id, entity_type, entity_id, rel)
);
create index if not exists file_links_entity on public.file_links(household_id, entity_type, entity_id);
create index if not exists file_links_file on public.file_links(file_id);

drop trigger if exists set_updated_at on public.files;
create trigger set_updated_at before update on public.files for each row execute function public.set_updated_at();

-- RLS (same household pattern as everything else)
do $$
declare t text;
begin
  foreach t in array array['files','file_links'] loop
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
  begin execute 'alter publication supabase_realtime add table public.files'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.file_links'; exception when duplicate_object then null; end;
end $$;

-- Storage: make sure the bucket is private and sized sensibly (policy media_rw from 002 stays)
insert into storage.buckets (id, name, public, file_size_limit)
  values ('household-media','household-media', false, 52428800)
  on conflict (id) do update set public = false, file_size_limit = 52428800;
