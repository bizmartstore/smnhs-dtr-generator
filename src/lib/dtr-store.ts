import { useEffect, useState } from "react";
import type { Employee, RawLog, DayOverrides } from "./dtr";

const KEY = "dtr-store-v1";

type Store = {
  employees: Employee[];
  logs: RawLog[];
  overrides: DayOverrides;
  verifiedBy: string;
};

const DEFAULT: Store = {
  employees: [],
  logs: [],
  overrides: {},
  verifiedBy: "",
};

function load(): Store {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    return DEFAULT;
  }
}

const listeners = new Set<() => void>();
let state: Store = DEFAULT;
let hydrated = false;

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

export function useDtrStore() {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!hydrated) {
      state = load();
      hydrated = true;
    }
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    fn();
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return {
    state,
    setEmployees(employees: Employee[]) {
      state = { ...state, employees };
      persist();
    },
    addEmployee(emp: Employee) {
      state = { ...state, employees: [...state.employees, emp] };
      persist();
    },
    updateEmployee(empNo: string, patch: Partial<Employee>) {
      state = {
        ...state,
        employees: state.employees.map((e) =>
          e.empNo === empNo ? { ...e, ...patch } : e
        ),
      };
      persist();
    },
    removeEmployee(empNo: string) {
      state = {
        ...state,
        employees: state.employees.filter((e) => e.empNo !== empNo),
      };
      persist();
    },
    addLogs(logs: RawLog[]) {
      state = { ...state, logs: [...state.logs, ...logs] };
      persist();
    },
    replaceLogs(logs: RawLog[]) {
      state = { ...state, logs };
      persist();
    },
    clearLogs() {
      state = { ...state, logs: [] };
      persist();
    },
    setOverride(empNo: string, date: string, field: keyof import("./dtr").DayRecord, value: string) {
      const key = `${empNo}|${date}`;
      const existing = state.overrides[key] || {};
      const next = { ...existing, [field]: value };
      state = { ...state, overrides: { ...state.overrides, [key]: next } };
      persist();
    },
    clearOverrides(empNo?: string) {
      if (!empNo) {
        state = { ...state, overrides: {} };
      } else {
        const ov: DayOverrides = {};
        for (const k of Object.keys(state.overrides)) {
          if (!k.startsWith(`${empNo}|`)) ov[k] = state.overrides[k];
        }
        state = { ...state, overrides: ov };
      }
      persist();
    },
    setVerifiedBy(v: string) {
      state = { ...state, verifiedBy: v };
      persist();
    },
  };
}
