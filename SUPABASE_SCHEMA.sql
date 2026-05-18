-- ============================================================
-- Run this once in the Supabase SQL Editor for project
-- qjkdhellmjwmpvwxhshi to set up the DTR Generator tables.
-- ============================================================

create table if not exists public.dtr_employees (
  emp_no text primary key,
  name text not null default '',
  official_am_arrival text,
  official_am_departure text,
  official_pm_arrival text,
  official_pm_departure text,
  created_at timestamptz not null default now()
);

create table if not exists public.dtr_logs (
  id bigserial primary key,
  emp_no text not null,
  log_date date not null,
  log_time text not null,           -- "HH:MM" 24h
  created_at timestamptz not null default now()
);
create index if not exists dtr_logs_emp_date_idx
  on public.dtr_logs (emp_no, log_date);

create table if not exists public.dtr_overrides (
  emp_no text not null,
  day_key date not null,            -- YYYY-MM-DD
  am_arrival text,
  am_departure text,
  pm_arrival text,
  pm_departure text,
  updated_at timestamptz not null default now(),
  primary key (emp_no, day_key)
);

create table if not exists public.dtr_settings (
  id int primary key default 1,
  verified_by text not null default '',
  updated_at timestamptz not null default now(),
  constraint dtr_settings_singleton check (id = 1)
);
insert into public.dtr_settings (id) values (1)
  on conflict (id) do nothing;

-- Permissive policies (single-user DTR app, no auth).
alter table public.dtr_employees enable row level security;
alter table public.dtr_logs      enable row level security;
alter table public.dtr_overrides enable row level security;
alter table public.dtr_settings  enable row level security;

do $$
begin
  perform 1;
  -- employees
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
alter publication supabase_realtime add table public.dtr_employees;
alter publication supabase_realtime add table public.dtr_logs;
alter publication supabase_realtime add table public.dtr_overrides;
alter publication supabase_realtime add table public.dtr_settings;
