export type Employee = {
  empNo: string;
  name: string;
  officialAmArrival?: string; // "HH:MM"
  officialAmDeparture?: string;
  officialPmArrival?: string;
  officialPmDeparture?: string;
};

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

// Pair logs for one employee on one day into AM/PM arrival/departure.
// Strategy:
//   - Sort the day's times ascending.
//   - Split AM (< 12:00) vs PM (>= 12:00).
//   - If 4+ entries: AM[0]=arrAm, AM[last]=depAm, PM[0]=arrPm, PM[last]=depPm.
//   - If only AM has multiple entries: first arrAm, last depAm.
//   - If only PM has multiple entries: first arrPm, last depPm.
//   - If exactly 1 AM and 1 PM: arrAm + depPm (typical: morning in, evening out).
//   - If only 1 entry: place by AM/PM as arrival.
export function pairDay(times: string[]): DayRecord {
  const sorted = [...times].sort();
  const am = sorted.filter((t) => parseInt(t.slice(0, 2), 10) < 12);
  const pm = sorted.filter((t) => parseInt(t.slice(0, 2), 10) >= 12);
  const rec: DayRecord = { amArrival: "", amDeparture: "", pmArrival: "", pmDeparture: "" };
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
    // If we also have an AM arrival but no AM departure, treat single PM as PM departure
    if (am.length === 1) {
      rec.pmDeparture = pm[0];
    } else {
      rec.pmArrival = pm[0];
    }
  }
  return rec;
}

// Build records for an employee for a given month
export function buildMonthRecords(
  empNo: string,
  year: number,
  monthIndex0: number,
  logs: RawLog[],
  overrides: DayOverrides
): DayRecord[] {
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
    const base = pairDay(byDate[key] || []);
    const ov = overrides[`${empNo}|${key}`];
    records.push({ ...base, ...(ov || {}) });
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

// Undertime: difference between actual span worked and official span.
// Returns { hours, minutes } (>=0). If insufficient data, returns zeros.
export function computeUndertime(rec: DayRecord, emp: Employee): { h: number; m: number } {
  // Need at least one official pair to compare
  const offMins = officialTotalMinutes(emp);
  const actMins = actualTotalMinutes(rec);
  if (offMins <= 0) return { h: 0, m: 0 };
  // No actual time entries for the day → no undertime (blank day = 0:00)
  if (actMins <= 0) return { h: 0, m: 0 };
  const diff = offMins - actMins;
  if (diff <= 0) return { h: 0, m: 0 };
  return { h: Math.floor(diff / 60), m: diff % 60 };
}

function toMin(t?: string): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function officialTotalMinutes(emp: Employee): number {
  const aA = toMin(emp.officialAmArrival);
  const aD = toMin(emp.officialAmDeparture);
  const pA = toMin(emp.officialPmArrival);
  const pD = toMin(emp.officialPmDeparture);
  let total = 0;
  if (aA != null && aD != null && aD > aA) total += aD - aA;
  if (pA != null && pD != null && pD > pA) total += pD - pA;
  // Fallback: full span minus 1h lunch if only outer bounds given (e.g., 8:30-17:30)
  if (total === 0 && aA != null && pD != null && pD > aA) {
    total = pD - aA - 60;
  }
  return total;
}

function actualTotalMinutes(rec: DayRecord): number {
  const aA = toMin(rec.amArrival);
  const aD = toMin(rec.amDeparture);
  const pA = toMin(rec.pmArrival);
  const pD = toMin(rec.pmDeparture);
  let total = 0;
  if (aA != null && aD != null && aD > aA) total += aD - aA;
  if (pA != null && pD != null && pD > pA) total += pD - pA;
  if (total === 0 && aA != null && pD != null && pD > aA) {
    total = pD - aA - 60;
  }
  return total;
}

export function formatOfficialHours(emp: Employee): string {
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
  // Outer bounds fallback
  if (emp.officialAmArrival && emp.officialPmDeparture)
    return `${fmt12(emp.officialAmArrival)}-${fmt12(emp.officialPmDeparture)}`;
  return "";
}
