-- ============================================================
-- DTR Generator — Quota-efficient cross-device log sync
-- Run once in Supabase SQL Editor (after biometrics migration).
-- Safe to re-run.
-- ============================================================
-- One row per biometric; statement-level triggers bump logs_rev once
-- per INSERT/DELETE/UPDATE statement (not per log row), so importing
-- thousands of logs costs ONE realtime event + small incremental REST.

create table if not exists public.dtr_sync_counters (
  biometric_id text primary key references public.dtr_biometrics (id) on delete cascade,
  logs_rev bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.dtr_sync_counters (biometric_id, logs_rev)
select id, 0 from public.dtr_biometrics
on conflict (biometric_id) do nothing;

alter table public.dtr_sync_counters enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'dtr_sync_counters' and policyname = 'dtr_sync_counters_all'
  ) then
    create policy dtr_sync_counters_all on public.dtr_sync_counters
      for all using (true) with check (true);
  end if;
end $$;

create or replace function public.bump_logs_rev_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.dtr_sync_counters (biometric_id, logs_rev)
  select distinct biometric_id, 1 from inserted
  on conflict (biometric_id) do update
    set logs_rev = public.dtr_sync_counters.logs_rev + 1,
        updated_at = now();
  return null;
end;
$$;

create or replace function public.bump_logs_rev_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.dtr_sync_counters (biometric_id, logs_rev)
  select distinct biometric_id, 1 from deleted
  on conflict (biometric_id) do update
    set logs_rev = public.dtr_sync_counters.logs_rev + 1,
        updated_at = now();
  return null;
end;
$$;

create or replace function public.bump_logs_rev_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.dtr_sync_counters (biometric_id, logs_rev)
  select distinct biometric_id, 1 from new_rows
  on conflict (biometric_id) do update
    set logs_rev = public.dtr_sync_counters.logs_rev + 1,
        updated_at = now();
  return null;
end;
$$;

drop trigger if exists dtr_logs_sync_insert on public.dtr_logs;
create trigger dtr_logs_sync_insert
  after insert on public.dtr_logs
  referencing new table as inserted
  for each statement
  execute function public.bump_logs_rev_on_insert();

drop trigger if exists dtr_logs_sync_delete on public.dtr_logs;
create trigger dtr_logs_sync_delete
  after delete on public.dtr_logs
  referencing old table as deleted
  for each statement
  execute function public.bump_logs_rev_on_delete();

drop trigger if exists dtr_logs_sync_update on public.dtr_logs;
create trigger dtr_logs_sync_update
  after update on public.dtr_logs
  referencing new table as new_rows
  for each statement
  execute function public.bump_logs_rev_on_update();

-- Index for incremental client fetch (id > watermark).
create index if not exists dtr_logs_bio_id_idx
  on public.dtr_logs (biometric_id, id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'dtr_sync_counters'
  ) then
    alter publication supabase_realtime add table public.dtr_sync_counters;
  end if;
end $$;

-- Optional: stop listening to per-row log changes (saves realtime quota).
-- alter publication supabase_realtime drop table public.dtr_logs;
