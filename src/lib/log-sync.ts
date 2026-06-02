import type { RawLog } from "./dtr";

export function logKey(l: RawLog): string {
  return `${l.empNo}|${l.date}|${l.time}`;
}

export function mergeLogs(existing: RawLog[], incoming: RawLog[]): RawLog[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map(logKey));
  const out = existing.slice();
  for (const l of incoming) {
    const k = logKey(l);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}
