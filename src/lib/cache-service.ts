// Thin IndexedDB cache layer (offline fallback + warm reads).
// Keys are scoped per biometric.
import { get, set, del } from "idb-keyval";
import type { Employee, RawLog, DayOverrides } from "./dtr";

export type CachedSnapshot = {
  employees: Employee[];
  logs: RawLog[];
  overrides: DayOverrides;
  cachedAt: number;
};

const key = (biometricId: string) => `dtr:snapshot:${biometricId}`;

export const cacheService = {
  async readSnapshot(biometricId: string): Promise<CachedSnapshot | null> {
    try {
      const v = await get(key(biometricId));
      return (v as CachedSnapshot | undefined) ?? null;
    } catch (e) {
      console.warn("[cache.readSnapshot]", e);
      return null;
    }
  },
  async writeSnapshot(biometricId: string, snap: Omit<CachedSnapshot, "cachedAt">) {
    try {
      await set(key(biometricId), { ...snap, cachedAt: Date.now() });
    } catch (e) {
      console.warn("[cache.writeSnapshot]", e);
    }
  },
  async clear(biometricId: string) {
    try {
      await del(key(biometricId));
    } catch (e) {
      console.warn("[cache.clear]", e);
    }
  },
};
