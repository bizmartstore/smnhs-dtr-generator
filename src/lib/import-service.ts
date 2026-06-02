// Chunked, retryable Supabase upsert for raw attendance logs.
// Does NOT freeze the UI: yields between chunks via micro-task scheduling.
import { supabase } from "./supabase";
import type { RawLog } from "./dtr";

export type ImportProgress = {
  total: number;
  done: number;
  chunkIndex: number;
  chunkCount: number;
  failedChunks: number;
};

export type ImportOptions = {
  biometricId: string;
  chunkSize?: number;       // default 500
  maxRetries?: number;      // default 3
  onProgress?: (p: ImportProgress) => void;
};

export type ImportResult = {
  inserted: number;        // best-effort count of rows the DB upserted
  failed: number;          // rows in failed chunks
  failedChunks: number;
  firstError?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function importLogs(
  logs: RawLog[],
  opts: ImportOptions,
): Promise<ImportResult> {
  const chunkSize = opts.chunkSize ?? 500;
  const maxRetries = opts.maxRetries ?? 3;
  const { biometricId, onProgress } = opts;

  // Pre-dedupe within the incoming batch (cheap).
  const seen = new Set<string>();
  const unique: RawLog[] = [];
  for (const l of logs) {
    const k = `${l.empNo}|${l.date}|${l.time}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(l);
  }

  const rows = unique.map((l) => ({
    biometric_id: biometricId,
    emp_no: l.empNo,
    log_date: l.date,
    log_time: l.time,
  }));

  const chunkCount = Math.max(1, Math.ceil(rows.length / chunkSize));
  let done = 0;
  let failedRows = 0;
  let failedChunks = 0;
  let firstError: string | undefined;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const chunkIndex = Math.floor(i / chunkSize);

    let attempt = 0;
    let ok = false;
    while (attempt < maxRetries && !ok) {
      attempt++;
      const { error } = await supabase
        .from("dtr_logs")
        .upsert(chunk, {
          onConflict: "biometric_id,emp_no,log_date,log_time",
          ignoreDuplicates: true,
        });
      if (!error) {
        ok = true;
        break;
      }
      console.warn(`[importLogs] chunk ${chunkIndex} attempt ${attempt} failed`, error);
      firstError ??= error.message;
      if (attempt < maxRetries) await sleep(300 * attempt);
    }

    if (ok) {
      done += chunk.length;
    } else {
      failedRows += chunk.length;
      failedChunks++;
    }

    onProgress?.({
      total: rows.length,
      done,
      chunkIndex: chunkIndex + 1,
      chunkCount,
      failedChunks,
    });

    // Yield to the event loop so the UI stays responsive on huge imports.
    await sleep(0);
  }

  return { inserted: done, failed: failedRows, failedChunks, firstError };
}
