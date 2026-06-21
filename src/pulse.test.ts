import { describe, expect, test } from "bun:test";
import { summarizePulse, detectActivation } from "./pulse";
import type { UsageResponse } from "./types";

// A realistic payload shaped like the live /usage response captured during the spike.
function usage(overrides: Partial<UsageResponse> = {}): UsageResponse {
  return {
    five_hour: { utilization: 34, resets_at: "2026-06-21T09:39:59Z" },
    seven_day: { utilization: 12, resets_at: "2026-06-22T00:59:59Z" },
    seven_day_opus: null,
    seven_day_sonnet: { utilization: 1, resets_at: "2026-06-22T00:59:59Z" },
    limits: [
      { kind: "session", group: "session", percent: 34, severity: "normal", resets_at: "2026-06-21T09:39:59Z", is_active: true },
      { kind: "weekly_all", group: "weekly", percent: 12, severity: "normal", resets_at: "2026-06-22T00:59:59Z", is_active: false },
    ],
    ...overrides,
  };
}

describe("summarizePulse", () => {
  test("extracts active flag, window percents, and model split", () => {
    const p = summarizePulse(usage());
    expect(p).toEqual({
      active: true,
      five_hour_pct: 34,
      seven_day_pct: 12,
      opus_pct: null,
      sonnet_pct: 1,
      severity: "normal",
    });
  });

  test("reports inactive when the session limit is not active", () => {
    const p = summarizePulse(
      usage({
        limits: [
          { kind: "session", group: "session", percent: 0, severity: "normal", resets_at: "x", is_active: false },
        ],
      })
    );
    expect(p.active).toBe(false);
    expect(p.severity).toBe("normal");
  });

  test("falls back gracefully when limits/model fields are absent", () => {
    const p = summarizePulse({
      five_hour: { utilization: 50, resets_at: "x" },
      seven_day: { utilization: 20, resets_at: "y" },
    });
    expect(p).toEqual({
      active: false,
      five_hour_pct: 50,
      seven_day_pct: 20,
      opus_pct: null,
      sonnet_pct: null,
      severity: null,
    });
  });
});

describe("detectActivation", () => {
  test("fires only on the idle→active transition", () => {
    expect(detectActivation(false, true)).toBe(true);
  });

  test("does not fire on the first reading (no prior state)", () => {
    expect(detectActivation(undefined, true)).toBe(false);
  });

  test("does not fire while it stays active", () => {
    expect(detectActivation(true, true)).toBe(false);
  });

  test("does not fire when it goes idle", () => {
    expect(detectActivation(true, false)).toBe(false);
  });
});
