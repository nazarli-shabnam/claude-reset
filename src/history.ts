import fs from "fs";
import path from "path";
import { getConfigDir } from "./config";
import type { WindowKey } from "./types";

// An append-only activity log the claude.ai UI has no equivalent for: every time an account
// flips idle↔active, and every window reset, gets one JSON line here. `timeline` reconstructs
// in-use / idle intervals from it.

export type TimelineEvent = "active" | "idle" | "reset";

export interface TimelineEntry {
  ts: string;                 // ISO 8601
  account: string;
  event: TimelineEvent;
  five_hour_pct: number;
  seven_day_pct: number;
  window?: WindowKey;         // set for "reset" events
}

export function getTimelinePath(): string {
  return path.join(getConfigDir(), "timeline.jsonl");
}

/**
 * Which transition, if any, this reading represents. Pure — generalises pulse.ts'
 * `detectActivation` to both directions. Returns null on the first reading (prev undefined)
 * so starting the monitor mid-session doesn't log a phantom flip.
 */
export function recordTransition(prev: boolean | undefined, curr: boolean): "active" | "idle" | null {
  if (prev === undefined || prev === curr) return null;
  return curr ? "active" : "idle";
}

/** Append one entry as a JSON line. Best-effort: a write failure is warned, never thrown. */
export function appendTimelineEntry(entry: TimelineEntry): void {
  try {
    fs.mkdirSync(path.dirname(getTimelinePath()), { recursive: true });
    fs.appendFileSync(getTimelinePath(), JSON.stringify(entry) + "\n");
  } catch (err) {
    console.warn(`[${new Date().toISOString()}] could not write timeline entry: ${(err as Error).message}`);
  }
}

export interface ReadOptions {
  account?: string;
  sinceMs?: number;           // epoch ms; entries older than this are dropped
}

export function readTimeline(opts: ReadOptions = {}): TimelineEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(getTimelinePath(), "utf-8");
  } catch {
    return [];
  }

  const entries: TimelineEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as TimelineEntry;
      if (opts.account && entry.account !== opts.account) continue;
      if (opts.sinceMs && new Date(entry.ts).getTime() < opts.sinceMs) continue;
      entries.push(entry);
    } catch {
      // Skip a corrupt line rather than failing the whole read.
    }
  }
  return entries;
}

export interface ActiveInterval {
  account: string;
  start: string;
  end: string | null;         // null = still active (no matching idle yet)
  duration_ms: number | null;
}

/**
 * Pair "active" → "idle" entries into in-use intervals. Pure. A trailing "active" with no
 * "idle" yields an open interval (end null). "reset" entries are ignored here — callers render
 * those as separate markers.
 */
export function summarizeIntervals(entries: TimelineEntry[]): ActiveInterval[] {
  const openByAccount = new Map<string, string>(); // account -> start ts
  const intervals: ActiveInterval[] = [];

  for (const entry of entries) {
    if (entry.event === "active") {
      if (!openByAccount.has(entry.account)) openByAccount.set(entry.account, entry.ts);
    } else if (entry.event === "idle") {
      const start = openByAccount.get(entry.account);
      if (start) {
        intervals.push({
          account: entry.account,
          start,
          end: entry.ts,
          duration_ms: new Date(entry.ts).getTime() - new Date(start).getTime(),
        });
        openByAccount.delete(entry.account);
      }
    }
  }

  for (const [account, start] of openByAccount) {
    intervals.push({ account, start, end: null, duration_ms: null });
  }
  return intervals;
}
