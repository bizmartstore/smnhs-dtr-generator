// Attendance repository: Supabase as source of truth, IndexedDB as warm cache.
// Log sync is incremental (id watermark + logs_rev) to minimize API quota.
import * as P from "./supabase-persistence";
import { cacheService, type CachedSnapshot } from "./cache-service";
import { mergeLogs } from "./log-sync";
import type { Employee, RawLog, DayOverrides } from "./dtr";

export type Snapshot = {
  employees: Employee[];
  logs: RawLog[];
  overrides: DayOverrides;
};

export type SnapshotMeta = {
  maxLogId: number;
  logsRev: number;
};

/** Cache is never trusted for longer than this without a server check. */
const MAX_CACHE_AGE_MS = 6 * 60 * 60 * 1000;

async function resolveLogs(
  biometricId: string,
  cached: CachedSnapshot | null,
): Promise<{ logs: RawLog[]; maxLogId: number; logsRev: number }> {
  const logsRev = await P.fetchLogsRev(biometricId);
  const cachedRev = cached?.logsRev ?? -1;
  const cachedMaxId = cached?.maxLogId ?? 0;
  const hasCachedLogs = (cached?.logs.length ?? 0) > 0;
  const cacheFresh = Date.now() - (cached?.cachedAt ?? 0) < MAX_CACHE_AGE_MS;

  if (hasCachedLogs && logsRev === cachedRev && cacheFresh) {
    // Cheap sanity check: row count must still match what we cached.
    const remoteCount = await P.fetchLogCount(biometricId);
    if (remoteCount < 0 || remoteCount === cached!.logs.length) {
      return { logs: cached!.logs, maxLogId: cachedMaxId, logsRev };
    }
  }

  if (hasCachedLogs && logsRev > cachedRev && cacheFresh) {
    const delta = await P.fetchLogsAfter(biometricId, cachedMaxId);
    const logs = mergeLogs(cached!.logs, delta.logs);
    const maxLogId = Math.max(cachedMaxId, delta.maxId);

    const remoteCount = await P.fetchLogCount(biometricId);
    const countMatches = remoteCount >= 0 && remoteCount === logs.length;
    // In-place edits (UPDATE) bump the revision without changing the row
    // count or adding new ids — the delta can't see them, so refetch fully.
    const editLikely = delta.logs.length === 0;
    if (countMatches && !editLikely) {
      return { logs, maxLogId, logsRev };
    }
  }

  const logs = await P.fetchLogs(biometricId);
  const maxLogId = await P.fetchMaxLogId(biometricId);
  return { logs, maxLogId, logsRev };
}


export const attendanceRepository = {
  async readCached(biometricId: string): Promise<CachedSnapshot | null> {
    return cacheService.readSnapshot(biometricId);
  },

  /** Full sync: employees + overrides + incremental/full logs. */
  async refreshFromSupabase(biometricId: string): Promise<Snapshot & SnapshotMeta> {
    const cached = await cacheService.readSnapshot(biometricId);
    const [employees, overrides, logPack] = await Promise.all([
      P.fetchEmployees(biometricId),
      P.fetchOverrides(biometricId),
      resolveLogs(biometricId, cached),
    ]);
    const snap: Snapshot & SnapshotMeta = {
      employees,
      logs: logPack.logs,
      overrides,
      maxLogId: logPack.maxLogId,
      logsRev: logPack.logsRev,
    };
    await cacheService.writeSnapshot(biometricId, snap);
    return snap;
  },

  /** Logs only — used after realtime sync-counter bump or tab focus. */
  async syncLogsOnly(
    biometricId: string,
    cached: CachedSnapshot | null,
  ): Promise<{ logs: RawLog[]; maxLogId: number; logsRev: number }> {
    const logPack = await resolveLogs(biometricId, cached);
    if (cached) {
      await cacheService.writeSnapshot(biometricId, {
        employees: cached.employees,
        logs: logPack.logs,
        overrides: cached.overrides,
        maxLogId: logPack.maxLogId,
        logsRev: logPack.logsRev,
      });
    }
    return logPack;
  },

  async clearCache(biometricId: string) {
    await cacheService.clear(biometricId);
  },
};
