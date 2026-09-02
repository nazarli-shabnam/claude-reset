import { describe, expect, test } from "bun:test";
import { BroadcastNotifier, DesktopNotifier } from "./notifier";
import type { Notifier } from "./types";

function recording(): { notifier: Notifier; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    notifier: { notify: async (message) => { calls.push(message); } },
  };
}

function failing(reason: string): Notifier {
  return { notify: async () => { throw new Error(reason); } };
}

describe("DesktopNotifier", () => {
  test("passes title + a context summary to the platform sender", async () => {
    const seen: { title: string; body: string }[] = [];
    const notifier = new DesktopNotifier(async (title, body) => { seen.push({ title, body }); return null; });

    await notifier.notify("5-hour window has reset!", {
      window: "five_hour", utilization_before: 92, utilization_after: 3,
      resets_at: "2026-09-02T18:00:00.000Z",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].title).toBe("claude-reset");
    expect(seen[0].body).toContain("5-hour window has reset!");
    expect(seen[0].body).toContain("92% → 3%");
  });

  test("a sender failure warns but does not throw", async () => {
    const notifier = new DesktopNotifier(async () => "notify-send not found");
    await expect(notifier.notify("hi")).resolves.toBeUndefined();
  });
});

describe("BroadcastNotifier", () => {
  test("fans out the message to every notifier", async () => {
    const a = recording();
    const b = recording();
    const broadcast = new BroadcastNotifier([a.notifier, b.notifier]);

    await broadcast.notify("hello");

    expect(a.calls).toEqual(["hello"]);
    expect(b.calls).toEqual(["hello"]);
  });

  test("still delivers to healthy notifiers when one fails, then re-throws", async () => {
    const ok = recording();
    const broadcast = new BroadcastNotifier([failing("boom"), ok.notifier]);

    await expect(broadcast.notify("hi")).rejects.toThrow(/boom/);
    expect(ok.calls).toEqual(["hi"]); // healthy channel was not skipped
  });

  test("aggregates every failure into one error", async () => {
    const broadcast = new BroadcastNotifier([failing("one"), failing("two")]);

    const promise = broadcast.notify("x");
    await expect(promise).rejects.toThrow(/one/);
    await expect(promise).rejects.toThrow(/two/);
  });
});
