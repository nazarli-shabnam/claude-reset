import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fetchUsage } from "./claudeClient";
import type { Account } from "./types";

const CONFIG: Account = {
  name: "test",
  session_key: "sk-ant-sid01-test",
  org_id: "org-uuid",
};

const realFetch = globalThis.fetch;

function stubFetch(response: Response): void {
  globalThis.fetch = (async () => response) as typeof fetch;
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("fetchUsage", () => {
  test("parses a well-formed usage response", async () => {
    const payload = {
      five_hour: { utilization: 72, resets_at: "2026-06-14T20:00:00Z" },
      seven_day: { utilization: 31, resets_at: "2026-06-20T20:00:00Z" },
    };
    stubFetch(new Response(JSON.stringify(payload), { status: 200 }));

    expect(await fetchUsage(CONFIG)).toEqual(payload);
  });

  test("maps 401 to an auth-expired error", async () => {
    stubFetch(new Response("nope", { status: 401 }));

    await expect(fetchUsage(CONFIG)).rejects.toThrow(/Auth rejected \(HTTP 401\)/);
  });

  test("maps 403 to an auth-expired error", async () => {
    stubFetch(new Response("nope", { status: 403 }));

    await expect(fetchUsage(CONFIG)).rejects.toThrow(/Auth rejected \(HTTP 403\)/);
  });

  test("rejects an unexpected response shape", async () => {
    stubFetch(new Response(JSON.stringify({ five_hour: {} }), { status: 200 }));

    await expect(fetchUsage(CONFIG)).rejects.toThrow(/Unexpected response shape/);
  });

  test("surfaces non-auth HTTP errors with the status", async () => {
    stubFetch(new Response("server boom", { status: 500 }));

    await expect(fetchUsage(CONFIG)).rejects.toThrow(/HTTP 500/);
  });
});
