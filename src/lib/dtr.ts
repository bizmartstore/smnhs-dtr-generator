export type Employee = {
  empNo: string;
  name: string;
  officialAmArrival?: string; // "HH:MM"
  officialAmDeparture?: string;
  officialPmArrival?: string;
  officialPmDeparture?: string;
};

/** How official times map onto the DTR AM/PM columns. */
export type ShiftType = "am" | "hybrid" | "pm" | "full" | "custom";

export function getShiftType(emp: Employee): ShiftType {
  const hasAmA = !!emp.officialAmArrival?.trim();
  const hasAmD = !!emp.officialAmDeparture?.trim();
  const hasPmA = !!emp.officialPmArrival?.trim();
  const hasPmD = !!emp.officialPmDeparture?.trim();

  if (hasAmA && hasAmD && !hasPmA && !hasPmD) return "am";
  if (hasAmA && hasPmD && !hasAmD && !hasPmA) return "hybrid";
  if (hasPmA && hasPmD && !hasAmA && !hasAmD) return "pm";
  if (hasAmA && hasAmD && hasPmA && hasPmD) return "full";
  if (hasAmA && hasPmD) return "hybrid";
  if (hasPmA && hasPmD) return "pm";
  if (hasAmA && hasAmD) return "am";
  return "custom";
}

export type RawLog = {
  empNo: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM (24h)
};

// Per-day record after parsing/pairing. Each field is "HH:MM" or "".
export type DayRecord = {
  amArrival: string;
  amDeparture: string;
  pmArrival: string;
  pmDeparture: string;
};

// Overrides keyed by `${empNo}|${YYYY-MM-DD}`
export type DayOverrides = Record<string, Partial<DayRecord>>;

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function pad(n: number) {
  return n.toString().padStart(2, "0");
}

export function daysInMonth(year: number, monthIndex0: number) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

export function dateKey(year: number, monthIndex0: number, day: number) {
  return `${year}-${pad(monthIndex0 + 1)}-${pad(day)}`;
}

// Permissive raw-log parser. Auto-detects EmpNo + Date + Time anywhere on a
// line, ignoring extra whitespace, tabs, commas, and headers. Accepts:
//   "1 4/24/2024 13:38", "1\t4/24/2024\t1:38 PM",
//   "1, 04-24-2024, 13:38", "2024-04-24 1 13:38", multi-triplet lines, etc.
const DATE_RE =
  /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b|\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/g;
const TIME_RE = /\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm.]*)?/g;

export function parseRawLogs(text: string): RawLog[] {
  const logs: RawLog[] = [];
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^employee/i.test(line) && !/\d/.test(line.split(/\s+/)[0])) continue;

    // Find all dates and times in the line
    const dates: { idx: number; date: string }[] = [];
    const times: { idx: number; time: string }[] = [];
    let m: RegExpExecArray | null;
    DATE_RE.lastIndex = 0;
    while ((m = DATE_RE.exec(line))) {
      const d = m[1]
        ? normalizeDateParts(m[1], m[2], m[3])
        : normalizeDateParts(m[5], m[6], m[4]);
      if (d) dates.push({ idx: m.index, date: d });
    }
    TIME_RE.lastIndex = 0;
    while ((m = TIME_RE.exec(line))) {
      const t = normalizeTimeParts(m[1], m[2], m[3]);
      if (t) times.push({ idx: m.index, time: t });
    }

    if (dates.length === 0 || times.length === 0) continue;

    // Pair up: triplet = (empNo before first date, date[i], time[i])
    const n = Math.min(dates.length, times.length);
    for (let i = 0; i < n; i++) {
      const startIdx = i === 0 ? 0 : Math.max(dates[i - 1].idx, times[i - 1].idx);
      // Find empNo as last token before this date that isn't itself a date/time
      const prefix = line.slice(startIdx, dates[i].idx);
      const tokens = prefix.split(/[\s,;|]+/).filter(Boolean);
      const empNo = tokens.length ? tokens[tokens.length - 1] : "";
      if (!empNo || !/^\d+$/.test(empNo)) continue;
      logs.push({ empNo, date: dates[i].date, time: times[i].time });
    }
  }
  return logs;
}

function normalizeDateParts(a: string, b: string, c: string): string | null {
  // a/b/c can be M/D/YYYY or YYYY/M/D (when c is the 4-digit year passed as third)
  let year: number, month: number, day: number;
  if (a.length === 4) {
    year = +a; month = +b; day = +c;
  } else {
    month = +a; day = +b; year = +c;
    if (year < 100) year += year < 50 ? 2000 : 1900;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function normalizeTimeParts(hStr: string, mStr: string, ampm?: string): string | null {
  let h = parseInt(hStr, 10);
  const min = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(min) || min < 0 || min > 59 || h < 0 || h > 23) return null;
  if (ampm) {
    const p = ampm.toLowerCase().replace(/\./g, "");
    if (p.startsWith("p") && h < 12) h += 12;
    if (p.startsWith("a") && h === 12) h = 0;
  }
  return `${pad(h)}:${pad(min)}`;
}

const emptyDay = (): DayRecord => ({
  amArrival: "",
  amDeparture: "",
  pmArrival: "",
  pmDeparture: "",
});

function hourOf(t: string): number {
  return parseInt(t.slice(0, 2), 10);
}

/** Full-day pairing (AM + PM blocks with lunch). */
export function pairDay(times: string[]): DayRecord {
  const sorted = [...times].sort();
  const am = sorted.filter((t) => hourOf(t) < 12);
  const pm = sorted.filter((t) => hourOf(t) >= 12);
  const rec = emptyDay();
  if (am.length >= 2) {
    rec.amArrival = am[0];
    rec.amDeparture = am[am.length - 1];
  } else if (am.length === 1) {
    rec.amArrival = am[0];
  }
  if (pm.length >= 2) {
    rec.pmArrival = pm[0];
    rec.pmDeparture = pm[pm.length - 1];
  } else if (pm.length === 1) {
    if (am.length === 1) {
      rec.pmDeparture = pm[0];
    } else {
      rec.pmArrival = pm[0];
    }
  }
  return rec;
}

/** Pair one day's punches according to the employee's official shift pattern. */
export function pairDayForEmployee(times: string[], emp: Employee): DayRecord {
  const sorted = [...times].sort();
  const shift = getShiftType(emp);

  if (sorted.length === 0) return emptyDay();

  if (shift === "am") {
    const rec = emptyDay();
    rec.amArrival = sorted[0];
    if (sorted.length >= 2) rec.amDeparture = sorted[sorted.length - 1];
    return rec;
  }

  if (shift === "pm") {
    const rec = emptyDay();
    rec.pmArrival = sorted[0];
    if (sorted.length >= 2) rec.pmDeparture = sorted[sorted.length - 1];
    return rec;
  }

  if (shift === "hybrid") {
    const am = sorted.filter((t) => hourOf(t) < 12);
    const pm = sorted.filter((t) => hourOf(t) >= 12);
    const rec = emptyDay();
    if (am.length >= 1) rec.amArrival = am[0];
    if (pm.length >= 1) rec.pmDeparture = pm[pm.length - 1];
    if (am.length === 0 && pm.length === 1) {
      rec.amArrival = pm[0];
      rec.pmDeparture = "";
    } else if (pm.length === 0 && am.length === 1) {
      rec.pmDeparture = am[0];
      rec.amArrival = "";
    }
    return rec;
  }

  return pairDay(sorted);
}

/** Hide DTR columns that are not used for this employee's shift. */
export function maskRecordForShift(rec: DayRecord, emp: Employee): DayRecord {
  const shift = getShiftType(emp);
  const out = { ...rec };

  if (shift === "am") {
    out.pmArrival = "";
    out.pmDeparture = "";
    return out;
  }
  if (shift === "pm") {
    out.amArrival = "";
    out.amDeparture = "";
    return out;
  }
  if (shift === "hybrid") {
    out.amDeparture = "";
    out.pmArrival = "";
    return out;
  }
  if (shift === "custom") {
    if (!emp.officialAmArrival?.trim()) out.amArrival = "";
    if (!emp.officialAmDeparture?.trim()) out.amDeparture = "";
    if (!emp.officialPmArrival?.trim()) out.pmArrival = "";
    if (!emp.officialPmDeparture?.trim()) out.pmDeparture = "";
  }
  return out;
}

// Build records for an employee for a given month (shift-aware columns + masking).
export function buildMonthRecords(
  employee: Employee,
  year: number,
  monthIndex0: number,
  logs: RawLog[],
  overrides: DayOverrides,
): DayRecord[] {
  const empNo = employee.empNo;
  const total = daysInMonth(year, monthIndex0);
  const byDate: Record<string, string[]> = {};
  for (const l of logs) {
    if (l.empNo !== empNo) continue;
    const [y, m] = l.date.split("-").map((x) => parseInt(x, 10));
    if (y !== year || m !== monthIndex0 + 1) continue;
    (byDate[l.date] ||= []).push(l.time);
  }
  const records: DayRecord[] = [];
  for (let d = 1; d <= total; d++) {
    const key = dateKey(year, monthIndex0, d);
    const base = pairDayForEmployee(byDate[key] || [], employee);
    const ov = overrides[`${empNo}|${key}`];
    records.push(maskRecordForShift({ ...base, ...(ov || {}) }, employee));
  }
  return records;
}

export function fmt12(t: string): string {
  if (!t) return "";
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${pad(m)} ${period}`;
}

// Undertime / late: per active shift segment (late arrival + early departure).
export function computeUndertime(rec: DayRecord, emp: Employee): { h: number; m: number } {
  const masked = maskRecordForShift(rec, emp);
  let diff = 0;

  const addLate = (official: string | undefined, actual: string) => {
    const o = toMin(official);
    const a = toMin(actual);
    if (o != null && a != null && a > o) diff += a - o;
  };
  const addEarly = (official: string | undefined, actual: string) => {
    const o = toMin(official);
    const a = toMin(actual);
    if (o != null && a != null && a < o) diff += o - a;
  };

  const shift = getShiftType(emp);

  if (shift === "am") {
    addLate(emp.officialAmArrival, masked.amArrival);
    addEarly(emp.officialAmDeparture, masked.amDeparture);
  } else if (shift === "pm") {
    addLate(emp.officialPmArrival, masked.pmArrival);
    addEarly(emp.officialPmDeparture, masked.pmDeparture);
  } else if (shift === "hybrid") {
    addLate(emp.officialAmArrival, masked.amArrival);
    addEarly(emp.officialPmDeparture, masked.pmDeparture);
  } else {
    addLate(emp.officialAmArrival, masked.amArrival);
    addEarly(emp.officialAmDeparture, masked.amDeparture);
    addLate(emp.officialPmArrival, masked.pmArrival);
    addEarly(emp.officialPmDeparture, masked.pmDeparture);
  }

  if (diff <= 0) return { h: 0, m: 0 };
  return { h: Math.floor(diff / 60), m: diff % 60 };
}

function toMin(t?: string): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

export function formatOfficialHours(emp: Employee): string {
  const shift = getShiftType(emp);
  if (shift === "am" && emp.officialAmArrival && emp.officialAmDeparture) {
    return `${fmt12(emp.officialAmArrival)}-${fmt12(emp.officialAmDeparture)} (AM)`;
  }
  if (shift === "pm" && emp.officialPmArrival && emp.officialPmDeparture) {
    return `${fmt12(emp.officialPmArrival)}-${fmt12(emp.officialPmDeparture)} (PM)`;
  }
  if (shift === "hybrid" && emp.officialAmArrival && emp.officialPmDeparture) {
    return `${fmt12(emp.officialAmArrival)}-${fmt12(emp.officialPmDeparture)} (Hybrid)`;
  }
  const am =
    emp.officialAmArrival && emp.officialAmDeparture
      ? `${fmt12(emp.officialAmArrival)}-${fmt12(emp.officialAmDeparture)}`
      : "";
  const pm =
    emp.officialPmArrival && emp.officialPmDeparture
      ? `${fmt12(emp.officialPmArrival)}-${fmt12(emp.officialPmDeparture)}`
      : "";
  if (am && pm) return `${am} / ${pm}`;
  if (am) return am;
  if (pm) return pm;
  if (emp.officialAmArrival && emp.officialPmDeparture) {
    return `${fmt12(emp.officialAmArrival)}-${fmt12(emp.officialPmDeparture)}`;
  }
  return "";
}
