-- ============================================================
-- DTR Generator — Biometrics migration
-- Run this ONCE in the Supabase SQL Editor.
-- Safe to re-run (uses IF [NOT] EXISTS guards).
-- ============================================================

-- 1) Biometrics catalog ---------------------------------------------------
create table if not exists public.dtr_biometrics (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

insert into public.dtr_biometrics (id, name)
values ('1', 'Biometric 1')
on conflict (id) do nothing;

alter table public.dtr_biometrics enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename='dtr_biometrics' and policyname='dtr_biometrics_all'
  ) then
    create policy dtr_biometrics_all on public.dtr_biometrics
      for all using (true) with check (true);
  end if;
end $$;

-- 2) Add biometric_id columns (default '1' backfills existing data) -------
alter table public.dtr_employees
  add column if not exists biometric_id text not null default '1';
alter table public.dtr_logs
  add column if not exists biometric_id text not null default '1';
alter table public.dtr_overrides
  add column if not exists biometric_id text not null default '1';

-- 3) Re-key dtr_employees (PK: biometric_id + emp_no) ---------------------
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.dtr_employees'::regclass
      and c.contype = 'p'
      and a.attname = 'biometric_id'
  ) then
    alter table public.dtr_employees drop constraint if exists dtr_employees_pkey;
    alter table public.dtr_employees
      add constraint dtr_employees_pkey primary key (biometric_id, emp_no);
  end if;
end $$;

-- 4) Re-key dtr_overrides (PK: biometric_id + emp_no + day_key) -----------
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.dtr_overrides'::regclass
      and c.contype = 'p'
      and a.attname = 'biometric_id'
  ) then
    alter table public.dtr_overrides drop constraint if exists dtr_overrides_pkey;
    alter table public.dtr_overrides
      add constraint dtr_overrides_pkey primary key (biometric_id, emp_no, day_key);
  end if;
end $$;

-- 5) Logs: unique constraint enables upsert-based dedup -------------------
-- First, purge accidental duplicates that may already exist.
delete from public.dtr_logs a
using public.dtr_logs b
where a.id > b.id
  and a.biometric_id = b.biometric_id
  and a.emp_no = b.emp_no
  and a.log_date = b.log_date
  and a.log_time = b.log_time;

create unique index if not exists dtr_logs_unique_idx
  on public.dtr_logs (biometric_id, emp_no, log_date, log_time);

create index if not exists dtr_logs_bio_emp_date_idx
  on public.dtr_logs (biometric_id, emp_no, log_date);

-- 6) Realtime -------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='dtr_biometrics'
  ) then
    alter publication supabase_realtime add table public.dtr_biometrics;
  end if;
end $$;
