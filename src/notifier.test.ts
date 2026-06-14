import { describe, expect, test } from "bun:test";
import { BroadcastNotifier } from "./notifier";
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
