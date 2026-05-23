-- ============================================================
-- Run this once (or after pulling biometrics support) in the
-- Supabase SQL Editor for project qjkdhellmjwmpvwxhshi.
-- It is safe to re-run: all statements are idempotent.
-- ============================================================

-- Biometric devices (e.g. "Biometrics 1", "Biometrics 2").
create table if not exists public.dtr_biometrics (
  id text primary key,
  name text not null default '',
  created_at timestamptz not null default now()
);
insert into public.dtr_biometrics (id, name) values ('1', 'Biometrics 1')
  on conflict (id) do nothing;

create table if not exists public.dtr_employees (
  emp_no text primary key,
  name text not null default '',
  official_am_arrival text,
  official_am_departure text,
  official_pm_arrival text,
  official_pm_departure text,
  created_at timestamptz not null default now()
);

-- Add biometric scoping to employees. Old rows default to biometric '1'.
alter table public.dtr_employees
  add column if not exists biometric_id text not null default '1'
  references public.dtr_biometrics(id) on delete cascade;

-- Repoint the primary key so the same emp_no can repeat across biometrics.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'dtr_employees_pkey' and conrelid = 'public.dtr_employees'::regclass
  ) then
    alter table public.dtr_employees drop constraint dtr_employees_pkey;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'dtr_employees_bio_emp_pkey'
  ) then
    alter table public.dtr_employees
      add constraint dtr_employees_bio_emp_pkey primary key (biometric_id, emp_no);
  end if;
end $$;

-- Legacy raw-log table (no longer written from the app; logs now live in
-- IndexedDB on each device so they don't consume Supabase quota). Kept for
-- backwards compatibility / data export.
create table if not exists public.dtr_logs (
  id bigserial primary key,
  emp_no text not null,
  log_date date not null,
  log_time text not null,
  created_at timestamptz not null default now()
);
create index if not exists dtr_logs_emp_date_idx
  on public.dtr_logs (emp_no, log_date);

create table if not exists public.dtr_overrides (
  emp_no text not null,
  day_key date not null,
  am_arrival text,
  am_departure text,
  pm_arrival text,
  pm_departure text,
  updated_at timestamptz not null default now(),
  primary key (emp_no, day_key)
);

alter table public.dtr_overrides
  add column if not exists biometric_id text not null default '1'
  references public.dtr_biometrics(id) on delete cascade;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'dtr_overrides_pkey' and conrelid = 'public.dtr_overrides'::regclass
  ) then
    alter table public.dtr_overrides drop constraint dtr_overrides_pkey;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'dtr_overrides_bio_emp_day_pkey'
  ) then
    alter table public.dtr_overrides
      add constraint dtr_overrides_bio_emp_day_pkey primary key (biometric_id, emp_no, day_key);
  end if;
end $$;

create table if not exists public.dtr_settings (
  id int primary key default 1,
  verified_by text not null default '',
  updated_at timestamptz not null default now(),
  constraint dtr_settings_singleton check (id = 1)
);
insert into public.dtr_settings (id) values (1)
  on conflict (id) do nothing;

-- Permissive policies (single-user DTR app, no auth).
alter table public.dtr_biometrics enable row level security;
alter table public.dtr_employees  enable row level security;
alter table public.dtr_logs       enable row level security;
alter table public.dtr_overrides  enable row level security;
alter table public.dtr_settings   enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='dtr_biometrics' and policyname='dtr_biometrics_all') then
    create policy dtr_biometrics_all on public.dtr_biometrics for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='dtr_employees' and policyname='dtr_employees_all') then
    create policy dtr_employees_all on public.dtr_employees for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='dtr_logs' and policyname='dtr_logs_all') then
    create policy dtr_logs_all on public.dtr_logs for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='dtr_overrides' and policyname='dtr_overrides_all') then
    create policy dtr_overrides_all on public.dtr_overrides for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='dtr_settings' and policyname='dtr_settings_all') then
    create policy dtr_settings_all on public.dtr_settings for all using (true) with check (true);
  end if;
end $$;

-- Enable realtime for live updates in the app.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='dtr_biometrics'
  ) then
    alter publication supabase_realtime add table public.dtr_biometrics;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='dtr_employees'
  ) then
    alter publication supabase_realtime add table public.dtr_employees;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='dtr_overrides'
  ) then
    alter publication supabase_realtime add table public.dtr_overrides;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='dtr_settings'
  ) then
    alter publication supabase_realtime add table public.dtr_settings;
  end if;
end $$;
