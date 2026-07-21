// Orchestrator hook. Public API preserved for existing components;
// internally now delegates to repository + import service + persistence.
//
// Architecture:
//   - Supabase = source of truth (scoped per biometric_id)
//   - IndexedDB (via cache-service) = warm cache for instant first paint
//   - dtr_sync_counters realtime (1 event per bulk import) + incremental log fetch
import { useEffect, useState } from "react";
import type { Employee, RawLog, DayRecord, DayOverrides, TermKey } from "./dtr";
import { supabase } from "./supabase";
import * as P from "./supabase-persistence";
import { attendanceRepository } from "./attendance-repository";
import { cacheService } from "./cache-service";
import { importLogs as importLogsService, type ImportProgress } from "./import-service";

export type Biometric = { id: string; name: string };

type Store = {
  // Biometrics catalog + currently-selected workspace
  biometrics: Biometric[];
  currentBiometricId: string;

  // Per-biometric data (current selection only)
  employees: Employee[];
  logs: RawLog[];
  overrides: DayOverrides;

  // Global
  verifiedBy: string;
  ready: boolean;
  /** Set when Supabase is missing the biometrics migration tables/columns. */
  schemaError: string | null;

  /** Currently-selected term (1/2/3). Persisted per-browser in localStorage. */
  activeTerm: TermKey;

  // Import UX
  importProgress: ImportProgress | null;
};

const LS_CURRENT = "dtr:currentBiometricId";
const LS_TERM = "dtr:activeTerm";

function loadActiveTerm(): TermKey {
  if (typeof localStorage === "undefined") return "1";
  const v = localStorage.getItem(LS_TERM);
  return v === "2" || v === "3" || v === "old" ? v : "1";
}

const DEFAULT: Store = {
  biometrics: [],
  currentBiometricId: (typeof localStorage !== "undefined" && localStorage.getItem(LS_CURRENT)) || "1",
  employees: [],
  logs: [],
  overrides: {},
  verifiedBy: "",
  ready: false,
  schemaError: null,
  activeTerm: loadActiveTerm(),
  importProgress: null,
};

const listeners = new Set<() => void>();
let state: Store = DEFAULT;
let bootstrapped = false;
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let syncSchemaReady = false;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let visibilitySyncSubscribed = false;

function notify() {
  listeners.forEach((l) => l());
}
function setState(patch: Partial<Store>) {
  state = { ...state, ...patch };
  notify();
}

function hasTermData(emp?: Employee) {
  return !!emp?.terms && Object.keys(emp.terms).length > 0;
}

function mergeLocalTerms(remote: Employee[], local: Employee[]) {
  const localByEmpNo = new Map(local.map((emp) => [emp.empNo, emp]));
  return remote.map((emp) => {
    if (hasTermData(emp)) return emp;
    const localEmp = localByEmpNo.get(emp.empNo);
    if (!hasTermData(localEmp)) return emp;
    return { ...emp, terms: localEmp!.terms };
  });
}

async function writeSnapshotCache(
  biometricId: string,
  employees: Employee[],
  logs: RawLog[],
  overrides: DayOverrides,
) {
  const cached = await cacheService.readSnapshot(biometricId);
  await cacheService.writeSnapshot(biometricId, {
    employees,
    logs,
    overrides,
    maxLogId: cached?.maxLogId,
    logsRev: cached?.logsRev,
  });
}

function persistCurrent(id: string) {
  try {
    localStorage.setItem(LS_CURRENT, id);
  } catch {
    /* ignore */
  }
}

function startKeepAlivePing() {
  if (keepAliveTimer || typeof window === "undefined") return;
  const ping = async () => {
    try {
      await supabase.from("dtr_settings").select("id").limit(1);
    } catch (e) {
      console.warn("[keepalive] ping failed", e);
    }
  };
  void ping();
  keepAliveTimer = setInterval(ping, 4 * 60 * 1000);
}

// ---------- bootstrap ----------
async function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;

  try {
    const schemaReady = await P.isBiometricsSchemaReady();
    if (!schemaReady) {
      setState({
        schemaError:
          "Database setup incomplete. In the Supabase SQL Editor, run SUPABASE_MIGRATION_BIOMETRICS.sql and SUPABASE_MIGRATION_SYNC.sql (in this project), then refresh this page.",
        ready: true,
      });
      return;
    }

    // Catalog + global settings
    const [biometrics, verifiedBy] = await Promise.all([
      P.fetchBiometrics(),
      P.fetchVerifiedBy(),
    ]);

    // Ensure Biometric 1 exists even on a fresh DB.
    let list: Biometric[] = biometrics.map((b) => ({ id: b.id, name: b.name }));
    if (list.length === 0) {
      try {
        await P.upsertBiometric({ id: "1", name: "Biometric 1" });
        list = [{ id: "1", name: "Biometric 1" }];
      } catch (e) {
        console.error("[bootstrap] failed to seed biometric", e);
      }
    }

    // Resolve current selection; fall back to first available.
    let current = state.currentBiometricId;
    if (!list.some((b) => b.id === current)) current = list[0]?.id ?? "1";
    persistCurrent(current);

    setState({ biometrics: list, currentBiometricId: current, verifiedBy });

    syncSchemaReady = await P.isSyncSchemaReady();

    // Warm-paint from cache (if any) then refresh from Supabase.
    const cached = await attendanceRepository.readCached(current);
    if (cached) {
      setState({
        employees: cached.employees,
        logs: cached.logs,
        overrides: cached.overrides,
      });
    }
    await loadBiometric(current, /* showStaleFirst */ false);
    setState({ ready: true });

    subscribeRealtime();
    subscribeVisibilitySync();
    startKeepAlivePing();
  } catch (err) {
    console.error("[dtr-store] bootstrap failed", err);
    setState({ ready: true });
  }
}

async function loadBiometric(id: string, showStaleFirst = true) {
  if (showStaleFirst) {
    const cached = await attendanceRepository.readCached(id);
    if (cached) {
      setState({
        employees: cached.employees,
        logs: cached.logs,
        overrides: cached.overrides,
      });
    } else {
      // Clear UI while waiting for fresh data
      setState({ employees: [], logs: [], overrides: {} });
    }
  }
  try {
    const snap = await attendanceRepository.refreshFromSupabase(id);
    if (state.currentBiometricId !== id) return; // user switched away
    setState({ employees: snap.employees, logs: snap.logs, overrides: snap.overrides });
  } catch (e) {
    console.error("[loadBiometric] refresh failed", e);
  }
}

function subscribeRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = supabase
    .channel("dtr-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "dtr_biometrics" }, async () => {
      const list = (await P.fetchBiometrics()).map((b) => ({ id: b.id, name: b.name }));
      setState({ biometrics: list });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "dtr_employees" }, (payload) => {
      const rec = (payload.new ?? payload.old) as { biometric_id?: string } | undefined;
      if (!rec || rec.biometric_id === state.currentBiometricId) {
        void refreshCurrentEmployees();
      }
    })
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "dtr_sync_counters" },
      (payload) => {
        const rec = (payload.new ?? payload.old) as { biometric_id?: string } | undefined;
        if (rec?.biometric_id === state.currentBiometricId) {
          void syncCurrentLogsIncremental();
        }
      },
    )
    // Legacy path if sync migration not applied yet (debounced incremental, not full refetch).
    .on("postgres_changes", { event: "*", schema: "public", table: "dtr_logs" }, (payload) => {
      if (syncSchemaReady) return;
      const rec = (payload.new ?? payload.old) as { biometric_id?: string } | undefined;
      if (rec?.biometric_id === state.currentBiometricId) {
        void syncCurrentLogsIncremental();
      }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "dtr_overrides" }, (payload) => {
      const rec = (payload.new ?? payload.old) as { biometric_id?: string } | undefined;
      if (!rec || rec.biometric_id === state.currentBiometricId) {
        void refreshCurrentOverrides();
      }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "dtr_settings" }, async () => {
      setState({ verifiedBy: await P.fetchVerifiedBy() });
    })
    .subscribe();
}

// Debounced per-entity refreshers for realtime fan-out.
let empTimer: ReturnType<typeof setTimeout> | null = null;
let logTimer: ReturnType<typeof setTimeout> | null = null;
let ovTimer: ReturnType<typeof setTimeout> | null = null;

async function refreshCurrentEmployees() {
  if (empTimer) clearTimeout(empTimer);
  empTimer = setTimeout(async () => {
    const id = state.currentBiometricId;
    const employees = await P.fetchEmployees(id);
    if (state.currentBiometricId !== id) return;
    setState({ employees });
    const cached = await cacheService.readSnapshot(id);
    await cacheService.writeSnapshot(id, {
      employees,
      logs: state.logs,
      overrides: state.overrides,
      maxLogId: cached?.maxLogId,
      logsRev: cached?.logsRev,
    });
  }, 250);
}
async function syncCurrentLogsIncremental() {
  if (logTimer) clearTimeout(logTimer);
  logTimer = setTimeout(async () => {
    const id = state.currentBiometricId;
    const cached = await cacheService.readSnapshot(id);
    const { logs, maxLogId, logsRev } = await attendanceRepository.syncLogsOnly(id, cached);
    if (state.currentBiometricId !== id) return;
    setState({ logs });
    await cacheService.writeSnapshot(id, {
      employees: state.employees,
      logs,
      overrides: state.overrides,
      maxLogId,
      logsRev,
    });
  }, 500);
}

function subscribeVisibilitySync() {
  if (typeof document === "undefined") return;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.ready && !state.schemaError) {
      void syncCurrentLogsIncremental();
    }
  });
}
async function refreshCurrentOverrides() {
  if (ovTimer) clearTimeout(ovTimer);
  ovTimer = setTimeout(async () => {
    const id = state.currentBiometricId;
    const overrides = await P.fetchOverrides(id);
    if (state.currentBiometricId !== id) return;
    setState({ overrides });
    const cached = await cacheService.readSnapshot(id);
    await cacheService.writeSnapshot(id, {
      employees: state.employees,
      logs: state.logs,
      overrides,
      maxLogId: cached?.maxLogId,
      logsRev: cached?.logsRev,
    });
  }, 250);
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

  const biometricId = state.currentBiometricId;

  return {
    state,

    // ---- Biometrics ----
    async setCurrentBiometric(id: string) {
      if (id === state.currentBiometricId) return;
      persistCurrent(id);
      setState({ currentBiometricId: id });
      await loadBiometric(id, true);
    },
    async createBiometric(name: string) {
      const trimmed = name.trim() || "Untitled biometric";
      // Generate next numeric id (string).
      const used = new Set(state.biometrics.map((b) => b.id));
      let n = state.biometrics.length + 1;
      while (used.has(String(n))) n++;
      const id = String(n);
      await P.upsertBiometric({ id, name: trimmed });
      const list = [...state.biometrics, { id, name: trimmed }];
      setState({ biometrics: list });
      return id;
    },
    async renameBiometric(id: string, name: string) {
      const trimmed = name.trim();
      if (!trimmed) return;
      await P.upsertBiometric({ id, name: trimmed });
      setState({
        biometrics: state.biometrics.map((b) => (b.id === id ? { ...b, name: trimmed } : b)),
      });
    },
    async deleteBiometric(id: string) {
      if (state.biometrics.length <= 1) {
        throw new Error("Cannot delete the last biometric");
      }
      await P.deleteBiometricCascade(id);
      await cacheService.clear(id);
      const list = state.biometrics.filter((b) => b.id !== id);
      setState({ biometrics: list });
      if (state.currentBiometricId === id) {
        const next = list[0].id;
        persistCurrent(next);
        setState({ currentBiometricId: next });
        await loadBiometric(next, true);
      }
    },

    // ---- Employees ----
    async addEmployee(emp: Employee) {
      setState({
        employees: [...state.employees.filter((e) => e.empNo !== emp.empNo), emp],
      });
      try {
        await P.upsertEmployee(biometricId, emp);
      } catch (e) {
        console.error("[addEmployee]", e);
      }
    },
    async saveEmployee(oldEmpNo: string, updated: Employee) {
      const newEmpNo = updated.empNo.trim();
      if (!newEmpNo) throw new Error("Employee No. required");
      const renaming = newEmpNo !== oldEmpNo;
      if (renaming && state.employees.some((e) => e.empNo === newEmpNo)) {
        throw new Error("Employee No. already exists");
      }
      const nextEmployees = state.employees
        .filter((e) => e.empNo !== oldEmpNo && e.empNo !== newEmpNo)
        .concat({ ...updated, empNo: newEmpNo });
      let nextLogs = state.logs;
      let nextOverrides = state.overrides;
      if (renaming) {
        nextLogs = state.logs.map((l) =>
          l.empNo === oldEmpNo ? { ...l, empNo: newEmpNo } : l,
        );
        nextOverrides = {};
        for (const k of Object.keys(state.overrides)) {
          const [emp, day] = k.split("|");
          const target = emp === oldEmpNo ? `${newEmpNo}|${day}` : k;
          nextOverrides[target] = state.overrides[k];
        }
      }
      setState({ employees: nextEmployees, logs: nextLogs, overrides: nextOverrides });

      try {
        if (renaming) {
          await P.renameEmployeeEverywhere(biometricId, oldEmpNo, newEmpNo);
          await P.deleteEmployee(biometricId, oldEmpNo);
        }
        await P.upsertEmployee(biometricId, { ...updated, empNo: newEmpNo });
      } catch (e) {
        console.error("[saveEmployee]", e);
        throw e;
      }
    },
    async removeEmployee(empNo: string) {
      setState({ employees: state.employees.filter((e) => e.empNo !== empNo) });
      try {
        await P.deleteEmployee(biometricId, empNo);
      } catch (e) {
        console.error("[removeEmployee]", e);
      }
    },

    // ---- Logs ----
    async addLogs(
      logs: RawLog[],
    ): Promise<{ inserted: number; skipped: number; error?: string }> {
      if (logs.length === 0) return { inserted: 0, skipped: 0 };
      // Local dedupe vs current state.
      const existing = new Set(state.logs.map((l) => `${l.empNo}|${l.date}|${l.time}`));
      const fresh: RawLog[] = [];
      for (const l of logs) {
        const k = `${l.empNo}|${l.date}|${l.time}`;
        if (existing.has(k)) continue;
        existing.add(k);
        fresh.push(l);
      }
      const skipped = logs.length - fresh.length;
      if (fresh.length === 0) {
        setState({ importProgress: null });
        return { inserted: 0, skipped };
      }
      // Optimistic UI.
      setState({ logs: [...state.logs, ...fresh], importProgress: { total: fresh.length, done: 0, chunkIndex: 0, chunkCount: 0, failedChunks: 0 } });

      const result = await importLogsService(fresh, {
        biometricId,
        chunkSize: 500,
        onProgress: (p) => setState({ importProgress: p }),
      });

      setState({ importProgress: null });

      // Merge any rows we missed ids for (incremental; no full-table refetch).
      await syncCurrentLogsIncremental();
      return {
        inserted: result.inserted,
        skipped,
        error: result.firstError,
      };
    },
    async clearLogs() {
      setState({ logs: [] });
      try {
        await P.clearLogsFor(biometricId);
        const logsRev = await P.fetchLogsRev(biometricId);
        await cacheService.writeSnapshot(biometricId, {
          employees: state.employees,
          logs: [],
          overrides: state.overrides,
          maxLogId: 0,
          logsRev,
        });
      } catch (e) {
        console.error("[clearLogs]", e);
      }
    },

    // ---- Overrides ----
    async setOverride(empNo: string, date: string, field: keyof DayRecord, value: string) {
      const key = `${empNo}|${date}`;
      const existing = state.overrides[key] || {};
      const next = { ...existing, [field]: value };
      setState({ overrides: { ...state.overrides, [key]: next } });
      try {
        await P.setOverrideRow(biometricId, empNo, date, next);
      } catch (e) {
        console.error("[setOverride]", e);
      }
    },
    async clearOverrides(empNo?: string) {
      if (!empNo) {
        setState({ overrides: {} });
      } else {
        const ov: DayOverrides = {};
        for (const k of Object.keys(state.overrides)) {
          if (!k.startsWith(`${empNo}|`)) ov[k] = state.overrides[k];
        }
        setState({ overrides: ov });
      }
      try {
        await P.clearOverridesFor(biometricId, empNo);
      } catch (e) {
        console.error("[clearOverrides]", e);
      }
    },

    // ---- Settings ----
    async setVerifiedBy(v: string) {
      setState({ verifiedBy: v });
      try {
        await P.setVerifiedByRow(v);
      } catch (e) {
        console.error("[setVerifiedBy]", e);
      }
    },

    setActiveTerm(t: TermKey) {
      if (t === state.activeTerm) return;
      try { localStorage.setItem(LS_TERM, t); } catch { /* ignore */ }
      setState({ activeTerm: t });
    },
  };
}
