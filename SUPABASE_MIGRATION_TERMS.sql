-- Adds multi-term official time support to dtr_employees (Term 1, 2, 3, and Old).
-- Safe to re-run. Existing official_* columns are preserved and backfilled into term "1".
alter table public.dtr_employees
  add column if not exists terms jsonb;

update public.dtr_employees
   set terms = jsonb_build_object(
         '1', jsonb_build_object(
           'amArrival',   official_am_arrival,
           'amDeparture', official_am_departure,
           'pmArrival',   official_pm_arrival,
           'pmDeparture', official_pm_departure
         )
       )
 where terms is null;

-- Refresh Supabase/PostgREST schema cache so the app can save the `terms` column immediately.
notify pgrst, 'reload schema';
