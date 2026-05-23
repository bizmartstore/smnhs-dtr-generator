import { useEffect, useState } from "react";
import type { Employee, RawLog, DayOverrides, DayRecord } from "./dtr";
import { supabase } from "./supabase";
import {
  addLogsForBiometric,
  clearLogsForBiometric,
  getLogsForBiometric,
  renameEmpInBiometric,
} from "./biometrics-db";

export type Biometric = { id: string; name: string };

type EmployeeWithBio = Employee & { biometricId: string };

type Store = {
  biometrics: Biometric[];
  activeBiometric: string;
  employeesAll: EmployeeWithBio[]; // every biometric
  logs: RawLog[]; // logs for active biometric only (from IndexedDB)
  overridesAll: Record<string, DayOverrides>; // by biometricId
  verifiedBy: string;
  ready: boolean;
  // ---- Derived (filtered to active biometric) ----
  employees: Employee[];
  overrides: DayOverrides;
};

const ACTIVE_KEY = "dtr.activeBiometric";

function readActive(): string {
  if (typeof localStorage === "undefined") return "1";
  return localStorage.getItem(ACTIVE_KEY) || "1";
}

const DEFAULT: Store = {
  biometrics: [{ id: "1", name: "Biometrics 1" }],
  activeBiometric: "1",
  employeesAll: [],
  logs: [],
  overridesAll: {},
  verifiedBy: "",
  ready: false,
  employees: [],
  overrides: {},
};

const listeners = new Set<() => void>();
let state: Store = DEFAULT;
let bootstrapped = false;

function recompute(next: Partial<Store>): Store {
  const merged = { ...state, ...next };
  const active = merged.activeBiometric;
  merged.employees = merged.employeesAll
    .filter((e) => e.biometricId === active)
    .map(({ biometricId: _b, ...rest }) => rest);
  merged.overrides = merged.overridesAll[active] || {};
  return merged;
}

function setState(patch: Partial<Store>) {
  state = recompute(patch);
  listeners.forEach((l) => l());
}

// ---------- row <-> model ----------
type BioRow = { id: string; name: string };
type EmpRow = {
  emp_no: string;
  name: string;
  biometric_id: string;
  official_am_arrival: string | null;
  official_am_departure: string | null;
  official_pm_arrival: string | null;
  official_pm_departure: string | null;
};
function empFromRow(r: EmpRow): EmployeeWithBio {
  return {
    empNo: r.emp_no,
    name: r.name ?? "",
    biometricId: r.biometric_id ?? "1",
    officialAmArrival: r.official_am_arrival ?? undefined,
    officialAmDeparture: r.official_am_departure ?? undefined,
    officialPmArrival: r.official_pm_arrival ?? undefined,
    officialPmDeparture: r.official_pm_departure ?? undefined,
  };
}
function empToRow(e: EmployeeWithBio): EmpRow {
  return {
    emp_no: e.empNo,
    name: e.name ?? "",
    biometric_id: e.biometricId,
    official_am_arrival: e.officialAmArrival ?? null,
    official_am_departure: e.officialAmDeparture ?? null,
    official_pm_arrival: e.officialPmArrival ?? null,
    official_pm_departure: e.officialPmDeparture ?? null,
  };
}

type OvRow = {
  emp_no: string;
  biometric_id: string;
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
  const active = readActive();
  try {
    const [bios, emps, ovs, settings, logs] = await Promise.all([
      supabase.from("dtr_biometrics").select("*").order("id"),
      supabase.from("dtr_employees").select("*").order("emp_no"),
      supabase.from("dtr_overrides").select("*"),
      supabase.from("dtr_settings").select("*").eq("id", 1).maybeSingle(),
      getLogsForBiometric(active),
    ]);
    const biometrics: Biometric[] = ((bios.data ?? []) as BioRow[]).map((b) => ({
      id: b.id,
      name: b.name || `Biometrics ${b.id}`,
    }));
    if (biometrics.length === 0) biometrics.push({ id: "1", name: "Biometrics 1" });

    const employeesAll = ((emps.data ?? []) as EmpRow[]).map(empFromRow);
    const overridesAll: Record<string, DayOverrides> = {};
    for (const r of (ovs.data ?? []) as OvRow[]) {
      const bId = r.biometric_id ?? "1";
      overridesAll[bId] ||= {};
      overridesAll[bId][ovKey(r.emp_no, r.day_key)] = {
        amArrival: r.am_arrival ?? "",
        amDeparture: r.am_departure ?? "",
        pmArrival: r.pm_arrival ?? "",
        pmDeparture: r.pm_departure ?? "",
      };
    }
    setState({
      biometrics,
      activeBiometric: biometrics.some((b) => b.id === active) ? active : biometrics[0].id,
      employeesAll,
      overridesAll,
      logs,
      verifiedBy: (settings.data as { verified_by?: string } | null)?.verified_by ?? "",
      ready: true,
    });
  } catch (err) {
    console.error("[dtr-store] bootstrap failed", err);
    setState({ ready: true });
  }

  supabase
    .channel("dtr-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "dtr_biometrics" }, () => refreshBiometrics())
    .on("postgres_changes", { event: "*", schema: "public", table: "dtr_employees" }, () => refreshEmployees())
    .on("postgres_changes", { event: "*", schema: "public", table: "dtr_overrides" }, () => refreshOverrides())
    .on("postgres_changes", { event: "*", schema: "public", table: "dtr_settings" }, () => refreshSettings())
    .subscribe();
}

async function refreshBiometrics() {
  const { data } = await supabase.from("dtr_biometrics").select("*").order("id");
  const biometrics = ((data ?? []) as BioRow[]).map((b) => ({
    id: b.id,
    name: b.name || `Biometrics ${b.id}`,
  }));
  setState({ biometrics: biometrics.length ? biometrics : [{ id: "1", name: "Biometrics 1" }] });
}
async function refreshEmployees() {
  const { data } = await supabase.from("dtr_employees").select("*").order("emp_no");
  setState({ employeesAll: ((data ?? []) as EmpRow[]).map(empFromRow) });
}
async function refreshOverrides() {
  const { data } = await supabase.from("dtr_overrides").select("*");
  const overridesAll: Record<string, DayOverrides> = {};
  for (const r of (data ?? []) as OvRow[]) {
    const bId = r.biometric_id ?? "1";
    overridesAll[bId] ||= {};
    overridesAll[bId][ovKey(r.emp_no, r.day_key)] = {
      amArrival: r.am_arrival ?? "",
      amDeparture: r.am_departure ?? "",
      pmArrival: r.pm_arrival ?? "",
      pmDeparture: r.pm_departure ?? "",
    };
  }
  setState({ overridesAll });
}
async function refreshSettings() {
  const { data } = await supabase.from("dtr_settings").select("*").eq("id", 1).maybeSingle();
  setState({ verifiedBy: (data as { verified_by?: string } | null)?.verified_by ?? "" });
}
async function reloadActiveLogs() {
  const logs = await getLogsForBiometric(state.activeBiometric);
  setState({ logs });
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

  const active = state.activeBiometric;

  return {
    state,

    // -------- biometrics --------
    async setActiveBiometric(id: string) {
      if (typeof localStorage !== "undefined") localStorage.setItem(ACTIVE_KEY, id);
      setState({ activeBiometric: id, logs: [] });
      const logs = await getLogsForBiometric(id);
      setState({ logs });
    },
    async addBiometric(id: string, name: string) {
      const cleanId = id.trim();
      const cleanName = (name || `Biometrics ${cleanId}`).trim();
      if (!cleanId) throw new Error("Biometric ID required");
      if (state.biometrics.some((b) => b.id === cleanId)) {
        throw new Error("Biometric ID already exists");
      }
      setState({ biometrics: [...state.biometrics, { id: cleanId, name: cleanName }] });
      const { error } = await supabase
        .from("dtr_biometrics")
        .upsert({ id: cleanId, name: cleanName });
      if (error) console.error("[addBiometric]", error);
    },
    async renameBiometric(id: string, name: string) {
      setState({
        biometrics: state.biometrics.map((b) => (b.id === id ? { ...b, name } : b)),
      });
      const { error } = await supabase.from("dtr_biometrics").upsert({ id, name });
      if (error) console.error("[renameBiometric]", error);
    },
    async removeBiometric(id: string) {
      if (state.biometrics.length <= 1) throw new Error("At least one biometric is required");
      const remaining = state.biometrics.filter((b) => b.id !== id);
      const nextActive = state.activeBiometric === id ? remaining[0].id : state.activeBiometric;
      setState({
        biometrics: remaining,
        employeesAll: state.employeesAll.filter((e) => e.biometricId !== id),
      });
      await clearLogsForBiometric(id);
      const { error } = await supabase.from("dtr_biometrics").delete().eq("id", id);
      if (error) console.error("[removeBiometric]", error);
      if (nextActive !== state.activeBiometric) {
        if (typeof localStorage !== "undefined") localStorage.setItem(ACTIVE_KEY, nextActive);
        setState({ activeBiometric: nextActive, logs: [] });
        const logs = await getLogsForBiometric(nextActive);
        setState({ logs });
      }
    },

    // -------- employees (scoped to active biometric) --------
    async addEmployee(emp: Employee) {
      const withBio: EmployeeWithBio = { ...emp, biometricId: active };
      const filtered = state.employeesAll.filter(
        (e) => !(e.biometricId === active && e.empNo === emp.empNo)
      );
      setState({ employeesAll: [...filtered, withBio] });
      const { error } = await supabase.from("dtr_employees").upsert(empToRow(withBio));
      if (error) console.error("[addEmployee]", error);
    },
    async updateEmployee(empNo: string, patch: Partial<Employee>) {
      const next = state.employeesAll.map((e) =>
        e.biometricId === active && e.empNo === empNo ? { ...e, ...patch } : e
      );
      setState({ employeesAll: next });
      const row = next.find((e) => e.biometricId === active && e.empNo === empNo);
      if (row) {
        const { error } = await supabase.from("dtr_employees").upsert(empToRow(row));
        if (error) console.error("[updateEmployee]", error);
      }
    },
    async saveEmployee(oldEmpNo: string, updated: Employee) {
      const newEmpNo = updated.empNo.trim();
      if (!newEmpNo) throw new Error("Employee No. required");
      const renaming = newEmpNo !== oldEmpNo;
      if (
        renaming &&
        state.employeesAll.some((e) => e.biometricId === active && e.empNo === newEmpNo)
      ) {
        throw new Error("Employee No. already exists in this biometric");
      }
      const nextEmployeesAll = state.employeesAll
        .filter(
          (e) =>
            !(e.biometricId === active && (e.empNo === oldEmpNo || e.empNo === newEmpNo))
        )
        .concat({ ...updated, empNo: newEmpNo, biometricId: active });

      let nextLogs = state.logs;
      const nextOverridesAll = { ...state.overridesAll };
      if (renaming) {
        nextLogs = state.logs.map((l) => (l.empNo === oldEmpNo ? { ...l, empNo: newEmpNo } : l));
        const cur = { ...(nextOverridesAll[active] || {}) };
        const moved: DayOverrides = {};
        for (const k of Object.keys(cur)) {
          const [emp, day] = k.split("|");
          const target = emp === oldEmpNo ? `${newEmpNo}|${day}` : k;
          moved[target] = cur[k];
        }
        nextOverridesAll[active] = moved;
      }
      setState({ employeesAll: nextEmployeesAll, logs: nextLogs, overridesAll: nextOverridesAll });

      if (renaming) {
        await renameEmpInBiometric(active, oldEmpNo, newEmpNo).catch((e) =>
          console.error("[saveEmployee idb rename]", e)
        );
        const { error: e2 } = await supabase
          .from("dtr_overrides")
          .update({ emp_no: newEmpNo })
          .eq("emp_no", oldEmpNo)
          .eq("biometric_id", active);
        if (e2) console.error("[saveEmployee overrides]", e2);
        const { error: e3 } = await supabase
          .from("dtr_employees")
          .delete()
          .eq("emp_no", oldEmpNo)
          .eq("biometric_id", active);
        if (e3) console.error("[saveEmployee delete old]", e3);
        await reloadActiveLogs();
      }
      const { error: e4 } = await supabase
        .from("dtr_employees")
        .upsert(empToRow({ ...updated, empNo: newEmpNo, biometricId: active }));
      if (e4) console.error("[saveEmployee upsert]", e4);
    },
    async removeEmployee(empNo: string) {
      setState({
        employeesAll: state.employeesAll.filter(
          (e) => !(e.biometricId === active && e.empNo === empNo)
        ),
      });
      const { error } = await supabase
        .from("dtr_employees")
        .delete()
        .eq("emp_no", empNo)
        .eq("biometric_id", active);
      if (error) console.error("[removeEmployee]", error);
    },

    // -------- raw logs (IndexedDB, scoped to active biometric) --------
    async addLogs(logs: RawLog[]): Promise<{ inserted: number; skipped: number; error?: string }> {
      if (logs.length === 0) return { inserted: 0, skipped: 0 };
      try {
        const res = await addLogsForBiometric(active, logs);
        await reloadActiveLogs();
        return res;
      } catch (e) {
        console.error("[addLogs]", e);
        return { inserted: 0, skipped: 0, error: e instanceof Error ? e.message : String(e) };
      }
    },
    async clearLogs() {
      setState({ logs: [] });
      await clearLogsForBiometric(active).catch((e) => console.error("[clearLogs]", e));
    },

    // -------- overrides (scoped) --------
    async setOverride(empNo: string, date: string, field: keyof DayRecord, value: string) {
      const key = ovKey(empNo, date);
      const cur = state.overridesAll[active] || {};
      const next = { ...cur, [key]: { ...(cur[key] || {}), [field]: value } };
      setState({ overridesAll: { ...state.overridesAll, [active]: next } });
      const row: OvRow = {
        emp_no: empNo,
        biometric_id: active,
        day_key: date,
        am_arrival: next[key].amArrival ?? null,
        am_departure: next[key].amDeparture ?? null,
        pm_arrival: next[key].pmArrival ?? null,
        pm_departure: next[key].pmDeparture ?? null,
      };
      const { error } = await supabase.from("dtr_overrides").upsert(row);
      if (error) console.error("[setOverride]", error);
    },
    async clearOverrides(empNo?: string) {
      const cur = state.overridesAll[active] || {};
      if (!empNo) {
        setState({ overridesAll: { ...state.overridesAll, [active]: {} } });
        await supabase.from("dtr_overrides").delete().eq("biometric_id", active);
      } else {
        const filtered: DayOverrides = {};
        for (const k of Object.keys(cur)) if (!k.startsWith(`${empNo}|`)) filtered[k] = cur[k];
        setState({ overridesAll: { ...state.overridesAll, [active]: filtered } });
        await supabase
          .from("dtr_overrides")
          .delete()
          .eq("emp_no", empNo)
          .eq("biometric_id", active);
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
