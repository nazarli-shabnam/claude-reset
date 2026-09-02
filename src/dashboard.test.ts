import { describe, expect, test } from "bun:test";
import { formatDashboard } from "./dashboard";
import type { UsageResponse } from "./types";

const usage: UsageResponse = {
  five_hour: { utilization: 72, resets_at: "2026-09-02T16:45:00.000Z" },
  seven_day: { utilization: 31, resets_at: "2026-09-08T14:05:00.000Z" },
  seven_day_opus: { utilization: 12, resets_at: "2026-09-08T14:05:00.000Z" },
  limits: [
    { kind: "session", group: "session", percent: 72, severity: "warn", resets_at: "2026-09-02T16:45:00.000Z", is_active: true },
    { kind: "weekly", group: "seven_day", percent: 31, severity: "ok", resets_at: "2026-09-08T14:05:00.000Z", is_active: false },
  ],
};

describe("formatDashboard", () => {
  test("renders each account with utilization, the model split and the raw limits", () => {
    const text = formatDashboard([{ account: "work", usage }]);

    expect(text).toContain("work");
    expect(text).toContain("active now");
    expect(text).toContain("72%");
    expect(text).toContain("Opus  12%");
    expect(text).toContain("limits:");
    expect(text).toContain("seven_day   31%  ok");
  });

  test("shows a failed account inline without dropping the others", () => {
    const text = formatDashboard([
      { account: "work", usage },
      { account: "home", error: "Auth rejected (HTTP 401)" },
    ]);
    expect(text).toContain("home");
    expect(text).toContain("failed: Auth rejected (HTTP 401)");
    expect(text).toContain("work");
  });
});
