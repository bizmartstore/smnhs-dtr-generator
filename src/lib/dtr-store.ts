import { useEffect, useState } from "react";
import type { Employee, RawLog, DayOverrides, DayRecord } from "./dtr";
import { supabase } from "./supabase";

type Store = {
  employees: Employee[];
  logs: RawLog[];
  overrides: DayOverrides;
  verifiedBy: string;
  ready: boolean;
};

const DEFAULT: Store = {
  employees: [],
  logs: [],
  overrides: {},
  verifiedBy: "",
  ready: false,
};

const listeners = new Set<() => void>();
let state: Store = DEFAULT;
let bootstrapped = false;

function notify() {
  listeners.forEach((l) => l());
}
function setState(patch: Partial<Store>) {
  state = { ...state, ...patch };
  notify();
}

// ---------- row <-> model ----------
type EmpRow = {
  emp_no: string;
  name: string;
  official_am_arrival: string | null;
  official_am_departure: string | null;
  official_pm_arrival: string | null;
  official_pm_departure: string | null;
};
function empFromRow(r: EmpRow): Employee {
  return {
    empNo: r.emp_no,
    name: r.name ?? "",
    officialAmArrival: r.official_am_arrival ?? undefined,
    officialAmDeparture: r.official_am_departure ?? undefined,
    officialPmArrival: r.official_pm_arrival ?? undefined,
    officialPmDeparture: r.official_pm_departure ?? undefined,
  };
}
function empToRow(e: Employee): EmpRow {
  return {
    emp_no: e.empNo,
    name: e.name ?? "",
    official_am_arrival: e.officialAmArrival ?? null,
    official_am_departure: e.officialAmDeparture ?? null,
    official_pm_arrival: e.officialPmArrival ?? null,
    official_pm_departure: e.officialPmDeparture ?? null,
  };
}

type LogRow = { id?: number; emp_no: string; log_date: string; log_time: string };
function logFromRow(r: LogRow): RawLog {
  return { empNo: r.emp_no, date: r.log_date, time: r.log_time };
}

type OvRow = {
  emp_no: string;
  day_key: string;
  am_arrival: string | null;
  am_departure: string | null;
  pm_arrival: string | null;
  pm_departure: string | null;
};
function ovKey(empNo: string, day: string) {
  return `${empNo}|${day}`;
}

// ---------- bootstrap ----------
async function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;
  try {
    const [emps, logs, ovs, settings] = await Promise.all([
      supabase.from("dtr_employees").select("*").order("emp_no"),
      supabase.from("dtr_logs").select("*"),
      supabase.from("dtr_overrides").select("*"),
      supabase.from("dtr_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    const employees = (emps.data ?? []).map((r) => empFromRow(r as EmpRow));
    const rawLogs = (logs.data ?? []).map((r) => logFromRow(r as LogRow));
    const overrides: DayOverrides = {};
    for (const r of (ovs.data ?? []) as OvRow[]) {
      overrides[ovKey(r.emp_no, r.day_key)] = {
        amArrival: r.am_arrival ?? "",
        amDeparture: r.am_departure ?? "",
        pmArrival: r.pm_arrival ?? "",
        pmDeparture: r.pm_departure ?? "",
      };
    }
    setState({
      employees,
      logs: rawLogs,
      overrides,
      verifiedBy: (settings.data as { verified_by?: string } | null)?.verified_by ?? "",
      ready: true,
    });
  } catch (err) {
    console.error("[dtr-store] bootstrap failed", err);
    setState({ ready: true });
  }

  // Realtime sync
  supabase
    .channel("dtr-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "dtr_employees" }, () => refreshEmployees())
    .on("postgres_changes", { event: "*", schema: "public", table: "dtr_logs" }, () => refreshLogs())
    .on("postgres_changes", { event: "*", schema: "public", table: "dtr_overrides" }, () => refreshOverrides())
    .on("postgres_changes", { event: "*", schema: "public", table: "dtr_settings" }, () => refreshSettings())
    .subscribe();
}

async function refreshEmployees() {
  const { data } = await supabase.from("dtr_employees").select("*").order("emp_no");
  setState({ employees: (data ?? []).map((r) => empFromRow(r as EmpRow)) });
}
async function refreshLogs() {
  const { data } = await supabase.from("dtr_logs").select("*");
  setState({ logs: (data ?? []).map((r) => logFromRow(r as LogRow)) });
}
async function refreshOverrides() {
  const { data } = await supabase.from("dtr_overrides").select("*");
  const overrides: DayOverrides = {};
  for (const r of (data ?? []) as OvRow[]) {
    overrides[ovKey(r.emp_no, r.day_key)] = {
      amArrival: r.am_arrival ?? "",
      amDeparture: r.am_departure ?? "",
      pmArrival: r.pm_arrival ?? "",
      pmDeparture: r.pm_departure ?? "",
    };
  }
  setState({ overrides });
}
async function refreshSettings() {
  const { data } = await supabase.from("dtr_settings").select("*").eq("id", 1).maybeSingle();
  setState({ verifiedBy: (data as { verified_by?: string } | null)?.verified_by ?? "" });
}

// ---------- public hook ----------
export function useDtrStore() {
  const [, setTick] = useState(0);
  useEffect(() => {
    void bootstrap();
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    fn();
    return () => {
      listeners.delete(fn);
    };
  }, []);

  return {
    state,

    async addEmployee(emp: Employee) {
      setState({ employees: [...state.employees.filter((e) => e.empNo !== emp.empNo), emp] });
      const { error } = await supabase.from("dtr_employees").upsert(empToRow(emp));
      if (error) console.error("[addEmployee]", error);
    },
    async updateEmployee(empNo: string, patch: Partial<Employee>) {
      const next = state.employees.map((e) => (e.empNo === empNo ? { ...e, ...patch } : e));
      setState({ employees: next });
      const row = next.find((e) => e.empNo === empNo);
      if (row) {
        const { error } = await supabase.from("dtr_employees").upsert(empToRow(row));
        if (error) console.error("[updateEmployee]", error);
      }
    },
    async removeEmployee(empNo: string) {
      setState({ employees: state.employees.filter((e) => e.empNo !== empNo) });
      const { error } = await supabase.from("dtr_employees").delete().eq("emp_no", empNo);
      if (error) console.error("[removeEmployee]", error);
    },
    async addLogs(logs: RawLog[]) {
      if (logs.length === 0) return;
      setState({ logs: [...state.logs, ...logs] });
      const rows = logs.map((l) => ({ emp_no: l.empNo, log_date: l.date, log_time: l.time }));
      // Chunk inserts to stay under PostgREST payload limits.
      const chunk = 500;
      for (let i = 0; i < rows.length; i += chunk) {
        const { error } = await supabase.from("dtr_logs").insert(rows.slice(i, i + chunk));
        if (error) console.error("[addLogs]", error);
      }
    },
    async clearLogs() {
      setState({ logs: [] });
      const { error } = await supabase.from("dtr_logs").delete().neq("id", -1);
      if (error) console.error("[clearLogs]", error);
    },
    async setOverride(empNo: string, date: string, field: keyof DayRecord, value: string) {
      const key = ovKey(empNo, date);
      const existing = state.overrides[key] || {};
      const next = { ...existing, [field]: value };
      setState({ overrides: { ...state.overrides, [key]: next } });
      const row: OvRow = {
        emp_no: empNo,
        day_key: date,
        am_arrival: next.amArrival ?? null,
        am_departure: next.amDeparture ?? null,
        pm_arrival: next.pmArrival ?? null,
        pm_departure: next.pmDeparture ?? null,
      };
      const { error } = await supabase.from("dtr_overrides").upsert(row);
      if (error) console.error("[setOverride]", error);
    },
    async clearOverrides(empNo?: string) {
      if (!empNo) {
        setState({ overrides: {} });
        await supabase.from("dtr_overrides").delete().neq("emp_no", "");
      } else {
        const ov: DayOverrides = {};
        for (const k of Object.keys(state.overrides)) {
          if (!k.startsWith(`${empNo}|`)) ov[k] = state.overrides[k];
        }
        setState({ overrides: ov });
        await supabase.from("dtr_overrides").delete().eq("emp_no", empNo);
      }
    },
    async setVerifiedBy(v: string) {
      setState({ verifiedBy: v });
      const { error } = await supabase
        .from("dtr_settings")
        .upsert({ id: 1, verified_by: v, updated_at: new Date().toISOString() });
      if (error) console.error("[setVerifiedBy]", error);
    },
  };
}
