// Supabase persistence layer for DTR entities.
// All reads/writes are scoped to a biometric_id.
import { supabase } from "./supabase";
import type { Employee, RawLog, DayOverrides, DayRecord } from "./dtr";

// ---- Row types ----
export type EmpRow = {
  biometric_id: string;
  emp_no: string;
  name: string;
  official_am_arrival: string | null;
  official_am_departure: string | null;
  official_pm_arrival: string | null;
  official_pm_departure: string | null;
  terms?: Employee["terms"] | null;
};
export type LogRow = {
  id?: number;
  biometric_id: string;
  emp_no: string;
  log_date: string;
  log_time: string;
};
export type OvRow = {
  biometric_id: string;
  emp_no: string;
  day_key: string;
  am_arrival: string | null;
  am_departure: string | null;
  pm_arrival: string | null;
  pm_departure: string | null;
};
export type BiometricRow = { id: string; name: string; created_at?: string };

export function empFromRow(r: EmpRow): Employee {
  return {
    empNo: r.emp_no,
    name: r.name ?? "",
    officialAmArrival: r.official_am_arrival ?? undefined,
    officialAmDeparture: r.official_am_departure ?? undefined,
    officialPmArrival: r.official_pm_arrival ?? undefined,
    officialPmDeparture: r.official_pm_departure ?? undefined,
    terms: (r.terms ?? undefined) as Employee["terms"],
  };
}
export function empToRow(biometricId: string, e: Employee): EmpRow {
  return {
    biometric_id: biometricId,
    emp_no: e.empNo,
    name: e.name ?? "",
    official_am_arrival: e.officialAmArrival ?? null,
    official_am_departure: e.officialAmDeparture ?? null,
    official_pm_arrival: e.officialPmArrival ?? null,
    official_pm_departure: e.officialPmDeparture ?? null,
    terms: e.terms ?? null,
  };
}
export function logFromRow(r: LogRow): RawLog {
  return { empNo: r.emp_no, date: r.log_date, time: r.log_time };
}
export function ovKey(empNo: string, day: string) {
  return `${empNo}|${day}`;
}

/** Returns false when the biometrics migration has not been applied yet. */
export async function isBiometricsSchemaReady(): Promise<boolean> {
  const { error } = await supabase.from("dtr_biometrics").select("id").limit(1);
  if (error) return false;
  const { error: colErr } = await supabase
    .from("dtr_employees")
    .select("biometric_id")
    .limit(1);
  return !colErr;
}

/** Sync-counter table (run SUPABASE_MIGRATION_SYNC.sql). */
export async function isSyncSchemaReady(): Promise<boolean> {
  const { error } = await supabase.from("dtr_sync_counters").select("biometric_id").limit(1);
  return !error;
}

export async function fetchLogsRev(biometricId: string): Promise<number> {
  const { data, error } = await supabase
    .from("dtr_sync_counters")
    .select("logs_rev")
    .eq("biometric_id", biometricId)
    .maybeSingle();
  if (error) {
    console.error("[fetchLogsRev]", error);
    return 0;
  }
  return Number((data as { logs_rev?: number } | null)?.logs_rev ?? 0);
}

export async function fetchLogCount(biometricId: string): Promise<number> {
  const { count, error } = await supabase
    .from("dtr_logs")
    .select("id", { count: "exact", head: true })
    .eq("biometric_id", biometricId);
  if (error) {
    console.error("[fetchLogCount]", error);
    return -1;
  }
  return count ?? 0;
}

export async function fetchMaxLogId(biometricId: string): Promise<number> {
  const { data, error } = await supabase
    .from("dtr_logs")
    .select("id")
    .eq("biometric_id", biometricId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[fetchMaxLogId]", error);
    return 0;
  }
  return Number((data as { id?: number } | null)?.id ?? 0);
}

export type LogsDelta = { logs: RawLog[]; maxId: number };

/** Fetches only rows with id greater than `afterId` (minimal egress). */
export async function fetchLogsAfter(biometricId: string, afterId: number): Promise<LogsDelta> {
  const rows = await paginate<LogRow>((from, to) =>
    supabase
      .from("dtr_logs")
      .select("id,emp_no,log_date,log_time")
      .eq("biometric_id", biometricId)
      .gt("id", afterId)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: LogRow[] | null; error: unknown }>,
  );
  let maxId = afterId;
  const logs: RawLog[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.id != null && r.id > maxId) maxId = r.id;
    const l = logFromRow(r);
    const k = `${l.empNo}|${l.date}|${l.time}`;
    if (seen.has(k)) continue;
    seen.add(k);
    logs.push(l);
  }
  return { logs, maxId };
}

// ---- Biometrics ----
export async function fetchBiometrics(): Promise<BiometricRow[]> {
  const { data, error } = await supabase
    .from("dtr_biometrics")
    .select("*")
    .order("id", { ascending: true });
  if (error) {
    console.error("[fetchBiometrics]", error);
    return [];
  }
  return (data ?? []) as BiometricRow[];
}
export async function upsertBiometric(row: BiometricRow) {
  const { error } = await supabase.from("dtr_biometrics").upsert(row);
  if (error) throw error;
  await ensureSyncCounter(row.id);
}

export async function ensureSyncCounter(biometricId: string) {
  const { error } = await supabase.from("dtr_sync_counters").upsert(
    { biometric_id: biometricId, logs_rev: 0 },
    { onConflict: "biometric_id", ignoreDuplicates: true },
  );
  if (error && !error.message.includes("does not exist")) {
    console.warn("[ensureSyncCounter]", error);
  }
}
export async function deleteBiometricCascade(id: string) {
  // Hard-delete a biometric and ALL its scoped data.
  await supabase.from("dtr_logs").delete().eq("biometric_id", id);
  await supabase.from("dtr_overrides").delete().eq("biometric_id", id);
  await supabase.from("dtr_employees").delete().eq("biometric_id", id);
  const { error } = await supabase.from("dtr_biometrics").delete().eq("id", id);
  if (error) throw error;
}

// ---- Paginated reads (PostgREST 1000-row cap) ----
async function paginate<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) {
      console.error("[paginate]", error);
      break;
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

export async function fetchEmployees(biometricId: string): Promise<Employee[]> {
  const rows = await paginate<EmpRow>((from, to) =>
    supabase
      .from("dtr_employees")
      .select("*")
      .eq("biometric_id", biometricId)
      .order("emp_no", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: EmpRow[] | null; error: unknown }>,
  );
  return rows.map(empFromRow);
}

export async function fetchLogs(biometricId: string): Promise<RawLog[]> {
  const rows = await paginate<LogRow>((from, to) =>
    supabase
      .from("dtr_logs")
      .select("id,emp_no,log_date,log_time")
      .eq("biometric_id", biometricId)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: LogRow[] | null; error: unknown }>,
  );
  // Dedup defensively in case the unique index is absent on older databases.
  const seen = new Set<string>();
  const out: RawLog[] = [];
  for (const r of rows) {
    const l = logFromRow(r);
    const k = `${l.empNo}|${l.date}|${l.time}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

export async function fetchOverrides(biometricId: string): Promise<DayOverrides> {
  const rows = await paginate<OvRow>((from, to) =>
    supabase
      .from("dtr_overrides")
      .select("*")
      .eq("biometric_id", biometricId)
      .range(from, to) as unknown as PromiseLike<{ data: OvRow[] | null; error: unknown }>,
  );

  const out: DayOverrides = {};
  for (const r of rows) {
    out[ovKey(r.emp_no, r.day_key)] = {
      amArrival: r.am_arrival ?? "",
      amDeparture: r.am_departure ?? "",
      pmArrival: r.pm_arrival ?? "",
      pmDeparture: r.pm_departure ?? "",
    };
  }
  return out;
}

// ---- Mutations ----
export async function upsertEmployee(biometricId: string, e: Employee) {
  const row = empToRow(biometricId, e);
  const { error } = await supabase
    .from("dtr_employees")
    .upsert(row, { onConflict: "biometric_id,emp_no" });
  if (!error) return;
  // Fallback: the `terms` column may not exist yet (migration not applied).
  // Retry without it so base official times still save.
  const msg = (error as { message?: string })?.message ?? "";
  const code = (error as { code?: string })?.code ?? "";
  const looksMissingTerms =
    /terms/i.test(msg) ||
    code === "PGRST204" ||
    code === "42703" ||
    /column .* does not exist/i.test(msg);
  if (looksMissingTerms) {
    const { terms: _omit, ...rest } = row;
    void _omit;
    const retry = await supabase
      .from("dtr_employees")
      .upsert(rest, { onConflict: "biometric_id,emp_no" });
    if (!retry.error) {
      console.warn(
        "[upsertEmployee] Saved without `terms` — run SUPABASE_MIGRATION_TERMS.sql to enable 3-term storage.",
      );
      return;
    }
    throw retry.error;
  }
  throw error;
}
export async function deleteEmployee(biometricId: string, empNo: string) {
  const { error } = await supabase
    .from("dtr_employees")
    .delete()
    .eq("biometric_id", biometricId)
    .eq("emp_no", empNo);
  if (error) throw error;
}
export async function renameEmployeeEverywhere(
  biometricId: string,
  oldEmpNo: string,
  newEmpNo: string,
) {
  const r1 = await supabase
    .from("dtr_logs")
    .update({ emp_no: newEmpNo })
    .eq("biometric_id", biometricId)
    .eq("emp_no", oldEmpNo);
  if (r1.error) throw r1.error;
  const r2 = await supabase
    .from("dtr_overrides")
    .update({ emp_no: newEmpNo })
    .eq("biometric_id", biometricId)
    .eq("emp_no", oldEmpNo);
  if (r2.error) throw r2.error;
}


export async function setOverrideRow(
  biometricId: string,
  empNo: string,
  day: string,
  patch: Partial<DayRecord>,
) {
  const row: OvRow = {
    biometric_id: biometricId,
    emp_no: empNo,
    day_key: day,
    am_arrival: patch.amArrival ?? null,
    am_departure: patch.amDeparture ?? null,
    pm_arrival: patch.pmArrival ?? null,
    pm_departure: patch.pmDeparture ?? null,
  };
  const { error } = await supabase
    .from("dtr_overrides")
    .upsert(row, { onConflict: "biometric_id,emp_no,day_key" });
  if (error) throw error;
}

export async function clearOverridesFor(biometricId: string, empNo?: string) {
  let q = supabase.from("dtr_overrides").delete().eq("biometric_id", biometricId);
  if (empNo) q = q.eq("emp_no", empNo);
  const { error } = await q;
  if (error) throw error;
}

export async function clearLogsFor(biometricId: string) {
  const { error } = await supabase
    .from("dtr_logs")
    .delete()
    .eq("biometric_id", biometricId);
  if (error) throw error;
}

export async function fetchVerifiedBy(): Promise<string> {
  const { data } = await supabase
    .from("dtr_settings")
    .select("verified_by")
    .eq("id", 1)
    .maybeSingle();
  return (data as { verified_by?: string } | null)?.verified_by ?? "";
}
export async function setVerifiedByRow(v: string) {
  const { error } = await supabase
    .from("dtr_settings")
    .upsert({ id: 1, verified_by: v, updated_at: new Date().toISOString() });
  if (error) throw error;
}
