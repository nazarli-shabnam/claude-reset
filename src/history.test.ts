import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  appendTimelineEntry,
  getTimelinePath,
  readTimeline,
  recordTransition,
  summarizeIntervals,
  type TimelineEntry,
} from "./history";

describe("recordTransition", () => {
  test("null on the first reading and when unchanged", () => {
    expect(recordTransition(undefined, true)).toBeNull();
    expect(recordTransition(false, false)).toBeNull();
    expect(recordTransition(true, true)).toBeNull();
  });

  test("names the direction of a flip", () => {
    expect(recordTransition(false, true)).toBe("active");
    expect(recordTransition(true, false)).toBe("idle");
  });
});

describe("summarizeIntervals", () => {
  const e = (account: string, event: TimelineEntry["event"], ts: string): TimelineEntry =>
    ({ account, event, ts, five_hour_pct: 0, seven_day_pct: 0 });

  test("pairs active→idle into intervals with a duration", () => {
    const intervals = summarizeIntervals([
      e("work", "active", "2026-09-02T10:00:00.000Z"),
      e("work", "idle", "2026-09-02T10:30:00.000Z"),
    ]);
    expect(intervals).toEqual([
      { account: "work", start: "2026-09-02T10:00:00.000Z", end: "2026-09-02T10:30:00.000Z", duration_ms: 30 * 60 * 1000 },
    ]);
  });

  test("a trailing active with no idle is an open interval", () => {
    const [iv] = summarizeIntervals([e("work", "active", "2026-09-02T10:00:00.000Z")]);
    expect(iv.end).toBeNull();
    expect(iv.duration_ms).toBeNull();
  });

  test("keeps accounts separate and ignores reset entries", () => {
    const intervals = summarizeIntervals([
      e("a", "active", "2026-09-02T10:00:00.000Z"),
      e("b", "active", "2026-09-02T10:05:00.000Z"),
      e("a", "reset", "2026-09-02T10:10:00.000Z"),
      e("a", "idle", "2026-09-02T10:20:00.000Z"),
    ]);
    expect(intervals.map((i) => i.account)).toEqual(["a", "b"]);
    expect(intervals[0].end).toBe("2026-09-02T10:20:00.000Z");
    expect(intervals[1].end).toBeNull();
  });
});

describe("append + read round-trip", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-hist-"));
    process.env.CLAUDE_RESET_CONFIG_DIR = tmpDir;
  });
  afterEach(() => {
    delete process.env.CLAUDE_RESET_CONFIG_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("readTimeline returns [] when nothing was written", () => {
    expect(readTimeline()).toEqual([]);
  });

  test("entries round-trip and filter by account and age", () => {
    const old: TimelineEntry = { account: "work", event: "active", ts: "2000-01-01T00:00:00.000Z", five_hour_pct: 1, seven_day_pct: 2 };
    const recent: TimelineEntry = { account: "work", event: "idle", ts: new Date().toISOString(), five_hour_pct: 3, seven_day_pct: 4 };
    const other: TimelineEntry = { account: "home", event: "active", ts: new Date().toISOString(), five_hour_pct: 5, seven_day_pct: 6 };
    appendTimelineEntry(old);
    appendTimelineEntry(recent);
    appendTimelineEntry(other);

    expect(readTimeline().length).toBe(3);
    expect(readTimeline({ account: "work" }).map((e) => e.event)).toEqual(["active", "idle"]);
    expect(readTimeline({ sinceMs: Date.now() - 60_000 }).map((e) => e.account).sort()).toEqual(["home", "work"]);
  });

  test("a corrupt line is skipped, not fatal", () => {
    fs.mkdirSync(path.dirname(getTimelinePath()), { recursive: true });
    fs.writeFileSync(getTimelinePath(), '{"account":"work","event":"active","ts":"2026-09-02T10:00:00.000Z","five_hour_pct":0,"seven_day_pct":0}\n{ broken\n');
    expect(readTimeline().length).toBe(1);
  });
});
