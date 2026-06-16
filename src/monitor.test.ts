import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { checkOnce, detectReset, type WindowState } from "./monitor";
import type { Account, NotificationContext, Notifier, UsageWindow, WindowKey } from "./types";

const HOUR = 60 * 60 * 1000;

function window(resets_at: string, utilization = 50): UsageWindow {
  return { resets_at, utilization };
}

function isoFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

describe("detectReset", () => {
  test("first poll records baseline and never fires", () => {
    const data = window(isoFromNow(4 * HOUR), 72);
    const { fired, nextState } = detectReset(undefined, data);

    expect(fired).toBe(false);
    expect(nextState).toEqual({ lastResetsAt: data.resets_at, lastUtilization: 72 });
  });

  test("forward jump beyond the threshold fires and advances the baseline", () => {
    const prev: WindowState = { lastResetsAt: isoFromNow(0), lastUtilization: 89 };
    const data = window(isoFromNow(5 * HOUR), 2);

    const { fired, nextState } = detectReset(prev, data);

    expect(fired).toBe(true);
    expect(nextState).toEqual({ lastResetsAt: data.resets_at, lastUtilization: 2 });
  });

  test("does not fire twice — once the baseline advances, the next equal reading is quiet", () => {
    const prev: WindowState = { lastResetsAt: isoFromNow(5 * HOUR), lastUtilization: 2 };
    const data = window(prev.lastResetsAt, 4);

    const { fired } = detectReset(prev, data);

    expect(fired).toBe(false);
  });

  test("sub-threshold drift (under 1h) does not fire", () => {
    const base = isoFromNow(5 * HOUR);
    const prev: WindowState = { lastResetsAt: base, lastUtilization: 30 };
    const data = window(new Date(new Date(base).getTime() + 30 * 60 * 1000).toISOString(), 31);

    const { fired } = detectReset(prev, data);

    expect(fired).toBe(false);
  });

  test("epoch / implausible resets_at is ignored and the previous baseline is kept", () => {
    const prev: WindowState = { lastResetsAt: isoFromNow(5 * HOUR), lastUtilization: 40 };
    const data = window("1970-01-01T00:00:00.000Z", 0);

    const { fired, nextState } = detectReset(prev, data);

    expect(fired).toBe(false);
    expect(nextState).toBe(prev); // same reference — baseline preserved
  });
});

describe("checkOnce", () => {
  const realFetch = globalThis.fetch;
  let nextUsage: { five_hour: UsageWindow; seven_day: UsageWindow };

  function recordingNotifier(): { notifier: Notifier; messages: string[] } {
    const messages: string[] = [];
    return {
      messages,
      notifier: {
        async notify(message: string, _context?: NotificationContext) {
          messages.push(message);
        },
      },
    };
  }

  beforeEach(() => {
    globalThis.fetch = (async () => new Response(JSON.stringify(nextUsage), { status: 200 })) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const account: Account = { name: "work", session_key: "sk-ant-sid01-x", org_id: "o" };

  test("prefixes the notification with the account name on reset", async () => {
    const state = new Map<WindowKey, WindowState>();
    const { notifier, messages } = recordingNotifier();

    // First poll: record baseline, no notification.
    nextUsage = { five_hour: window(isoFromNow(1 * HOUR), 90), seven_day: window(isoFromNow(48 * HOUR), 50) };
    await checkOnce(account, state, notifier);
    expect(messages).toHaveLength(0);

    // Second poll: 5h window jumped forward → reset fires, tagged with the account name.
    nextUsage = { five_hour: window(isoFromNow(6 * HOUR), 1), seven_day: window(isoFromNow(48 * HOUR), 50) };
    await checkOnce(account, state, notifier);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("[work]");
  });

  test("per-account state maps stay independent", async () => {
    const stateA = new Map<WindowKey, WindowState>();
    const stateB = new Map<WindowKey, WindowState>();
    const { notifier } = recordingNotifier();

    nextUsage = { five_hour: window(isoFromNow(1 * HOUR), 90), seven_day: window(isoFromNow(48 * HOUR), 50) };
    await checkOnce(account, stateA, notifier);

    // stateB has never been seeded, so its first poll only records a baseline.
    expect(stateB.size).toBe(0);
    expect(stateA.get("five_hour")?.lastUtilization).toBe(90);
  });
});
