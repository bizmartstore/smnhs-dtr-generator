// Attendance repository: Supabase as source of truth, IndexedDB as warm cache.
// Use these reads when you want cache-first hydration; the orchestrator
// (`dtr-store`) calls into here on biometric switch and on startup.
import * as P from "./supabase-persistence";
import { cacheService, type CachedSnapshot } from "./cache-service";
import type { Employee, RawLog, DayOverrides } from "./dtr";

export type Snapshot = {
  employees: Employee[];
  logs: RawLog[];
  overrides: DayOverrides;
};

export const attendanceRepository = {
  /** Fast: returns cached snapshot synchronously-ish (single await). */
  async readCached(biometricId: string): Promise<CachedSnapshot | null> {
    return cacheService.readSnapshot(biometricId);
  },

  /** Slow: fetches everything from Supabase, writes cache, returns fresh snapshot. */
  async refreshFromSupabase(biometricId: string): Promise<Snapshot> {
    const [employees, logs, overrides] = await Promise.all([
      P.fetchEmployees(biometricId),
      P.fetchLogs(biometricId),
      P.fetchOverrides(biometricId),
    ]);
    const snap: Snapshot = { employees, logs, overrides };
    await cacheService.writeSnapshot(biometricId, snap);
    return snap;
  },

  async clearCache(biometricId: string) {
    await cacheService.clear(biometricId);
  },
};
