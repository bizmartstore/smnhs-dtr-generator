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

// Parse raw logs text. Accepts header line "EmployeeNumber DateTime" (optional)
// and lines like: "1 11/3/2025 9:56"  OR  "1\t11/3/2025\t9:56"
// Date formats supported: M/D/YYYY or YYYY-MM-DD
export function parseRawLogs(text: string): RawLog[] {
  const logs: RawLog[] = [];
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^employee/i.test(line)) continue; // header
    // tokens separated by whitespace
    const tokens = line.split(/\s+/);
    // Could be 3 tokens (emp, date, time) or could be many concatenated triplets
    // Handle case where the entire blob was pasted on one line by chunking.
    if (tokens.length >= 3 && tokens.length % 3 === 0) {
      for (let i = 0; i < tokens.length; i += 3) {
        const parsed = tryParseTriplet(tokens[i], tokens[i + 1], tokens[i + 2]);
        if (parsed) logs.push(parsed);
      }
    } else if (tokens.length >= 3) {
      const parsed = tryParseTriplet(tokens[0], tokens[1], tokens[2]);
      if (parsed) logs.push(parsed);
    }
  }
  return logs;
}

function tryParseTriplet(empNo: string, dateStr: string, timeStr: string): RawLog | null {
  const date = normalizeDate(dateStr);
  const time = normalizeTime(timeStr);
  if (!date || !time || !empNo) return null;
  return { empNo: empNo.trim(), date, time };
}

function normalizeDate(s: string): string | null {
  // M/D/YYYY
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  // YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    return `${m[1]}-${pad(parseInt(m[2], 10))}-${pad(parseInt(m[3], 10))}`;
  }
  return null;
}

function normalizeTime(s: string): string | null {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
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
