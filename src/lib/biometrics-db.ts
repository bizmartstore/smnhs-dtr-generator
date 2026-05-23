// IndexedDB-backed raw log storage, scoped per biometric device.
// Keeps raw logs off Supabase (which is row-limited) and on the user's device.

import type { RawLog } from "./dtr";

const DB_NAME = "dtr-logs-db";
const STORE = "logs";
const VERSION = 1;

type Row = {
  biometricId: string;
  empNo: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, {
          keyPath: ["biometricId", "empNo", "date", "time"],
        });
        os.createIndex("biometricId", "biometricId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode: IDBTransactionMode) {
  const db = await openDb();
  const t = db.transaction(STORE, mode);
  return { db, store: t.objectStore(STORE), tx: t };
}

function done(t: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export async function getLogsForBiometric(biometricId: string): Promise<RawLog[]> {
  try {
    const { store, tx: t } = await tx("readonly");
    const idx = store.index("biometricId");
    const out: RawLog[] = [];
    return await new Promise<RawLog[]>((resolve, reject) => {
      const req = idx.openCursor(IDBKeyRange.only(biometricId));
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          const v = cur.value as Row;
          out.push({ empNo: v.empNo, date: v.date, time: v.time });
          cur.continue();
        } else {
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error);
      t.onerror = () => reject(t.error);
    });
  } catch (err) {
    console.error("[biometrics-db] getLogs", err);
    return [];
  }
}

export async function addLogsForBiometric(
  biometricId: string,
  logs: RawLog[]
): Promise<{ inserted: number; skipped: number }> {
  if (logs.length === 0) return { inserted: 0, skipped: 0 };
  const { store, tx: t } = await tx("readwrite");
  let inserted = 0;
  let skipped = 0;
  await new Promise<void>((resolve, reject) => {
    let i = 0;
    const next = () => {
      if (i >= logs.length) return resolve();
      const l = logs[i++];
      const row: Row = { biometricId, empNo: l.empNo, date: l.date, time: l.time };
      const req = store.add(row);
      req.onsuccess = () => {
        inserted++;
        next();
      };
      req.onerror = (e) => {
        // Duplicate key → skip and continue.
        e.preventDefault();
        skipped++;
        next();
      };
    };
    next();
    t.onerror = () => reject(t.error);
  });
  await done(t);
  return { inserted, skipped };
}

export async function clearLogsForBiometric(biometricId: string): Promise<void> {
  const { store, tx: t } = await tx("readwrite");
  await new Promise<void>((resolve, reject) => {
    const idx = store.index("biometricId");
    const req = idx.openCursor(IDBKeyRange.only(biometricId));
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        cur.delete();
        cur.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
  await done(t);
}

export async function renameEmpInBiometric(
  biometricId: string,
  oldEmpNo: string,
  newEmpNo: string
): Promise<void> {
  if (oldEmpNo === newEmpNo) return;
  const { store, tx: t } = await tx("readwrite");
  await new Promise<void>((resolve, reject) => {
    const idx = store.index("biometricId");
    const req = idx.openCursor(IDBKeyRange.only(biometricId));
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        const v = cur.value as Row;
        if (v.empNo === oldEmpNo) {
          cur.delete();
          store.put({ ...v, empNo: newEmpNo });
        }
        cur.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
  await done(t);
}
