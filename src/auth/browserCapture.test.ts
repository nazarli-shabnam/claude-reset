import { describe, expect, test } from "bun:test";
import { findChrome, pickSessionKey } from "./browserCapture";

describe("pickSessionKey", () => {
  test("returns the sessionKey cookie value when present and well-formed", () => {
    const cookies = [
      { name: "cf_clearance", value: "abc" },
      { name: "sessionKey", value: "sk-ant-sid01-realkey" },
    ];
    expect(pickSessionKey(cookies)).toBe("sk-ant-sid01-realkey");
  });

  test("returns null before login (no sessionKey cookie)", () => {
    expect(pickSessionKey([{ name: "cf_clearance", value: "abc" }])).toBeNull();
  });

  test("ignores a sessionKey cookie that isn't a real key (e.g. a logged-out placeholder)", () => {
    expect(pickSessionKey([{ name: "sessionKey", value: "deleted" }])).toBeNull();
  });
});

describe("findChrome", () => {
  test("returns the first candidate path that exists", () => {
    const seen: string[] = [];
    const exists = (p: string) => {
      seen.push(p);
      return p.toLowerCase().includes("chrome");
    };
    expect(findChrome(exists).toLowerCase()).toContain("chrome");
    expect(seen.length).toBeGreaterThan(0);
  });

  test("throws actionable guidance when no browser is installed", () => {
    expect(() => findChrome(() => false)).toThrow(/No Chrome or Edge install found/);
  });
});
