import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { addAccount, getConfigPath, loadConfig, removeAccount, saveConfig } from "./config";
import type { WatcherConfig } from "./types";

let tmpDir: string;

const SAMPLE: WatcherConfig = {
  accounts: [
    { name: "default", session_key: "sk-ant-sid01-test", org_id: "00000000-0000-0000-0000-000000000000" },
  ],
  slack_webhook_url: "https://hooks.slack.com/services/T/B/X",
  check_interval_minutes: 7,
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-config-"));
  process.env.CLAUDE_RESET_CONFIG_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.CLAUDE_RESET_CONFIG_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("config", () => {
  test("getConfigPath honors CLAUDE_RESET_CONFIG_DIR", () => {
    expect(getConfigPath()).toBe(path.join(tmpDir, "config.json"));
  });

  test("saveConfig then loadConfig round-trips", () => {
    saveConfig(SAMPLE);
    expect(loadConfig()).toEqual(SAMPLE);
  });

  test("loadConfig applies the default check interval when absent", () => {
    const { check_interval_minutes, ...partial } = SAMPLE;
    fs.writeFileSync(getConfigPath(), JSON.stringify(partial));

    expect(loadConfig().check_interval_minutes).toBe(15);
  });

  test("loadConfig throws when the file is missing", () => {
    expect(() => loadConfig()).toThrow(/Config not found/);
  });

  test("loadConfig tolerates a UTF-8 BOM (Windows editors)", () => {
    fs.writeFileSync(getConfigPath(), "﻿" + JSON.stringify(SAMPLE));
    expect(loadConfig()).toEqual(SAMPLE);
  });

  test("loadConfig reports invalid JSON clearly", () => {
    fs.writeFileSync(getConfigPath(), "{ not json");
    expect(() => loadConfig()).toThrow(/not valid JSON/);
  });

  test("loadConfig throws on a missing required account field", () => {
    const broken = { ...SAMPLE, accounts: [{ name: "x", org_id: "o" }] };
    fs.writeFileSync(getConfigPath(), JSON.stringify(broken));

    expect(() => loadConfig()).toThrow(/session_key/);
  });

  test("loadConfig throws when there are no accounts", () => {
    const { accounts, ...partial } = SAMPLE;
    fs.writeFileSync(getConfigPath(), JSON.stringify(partial));

    expect(() => loadConfig()).toThrow(/no accounts/);
  });

  test("loadConfig migrates a legacy single-account config to a 'default' account", () => {
    const legacy = {
      session_key: "sk-ant-sid01-legacy",
      org_id: "legacy-org",
      slack_webhook_url: "https://hooks.slack.com/services/T/B/X",
      check_interval_minutes: 9,
    };
    fs.writeFileSync(getConfigPath(), JSON.stringify(legacy));

    const config = loadConfig();
    expect(config.accounts).toEqual([
      { name: "default", session_key: "sk-ant-sid01-legacy", org_id: "legacy-org" },
    ]);
    expect(config.check_interval_minutes).toBe(9);
  });

  describe("addAccount / removeAccount", () => {
    test("addAccount appends a new account", async () => {
      saveConfig(SAMPLE);
      await addAccount("work", "sk-ant-sid01-work", "work-org");

      expect(loadConfig().accounts.map((a) => a.name)).toEqual(["default", "work"]);
    });

    test("addAccount rejects a duplicate name", async () => {
      saveConfig(SAMPLE);
      await expect(addAccount("default", "k", "o")).rejects.toThrow(/already exists/);
    });

    test("removeAccount drops the named account", async () => {
      saveConfig(SAMPLE);
      await addAccount("work", "sk-ant-sid01-work", "work-org");
      removeAccount("default");

      expect(loadConfig().accounts.map((a) => a.name)).toEqual(["work"]);
    });

    test("removeAccount refuses to remove the last account", () => {
      saveConfig(SAMPLE);
      expect(() => removeAccount("default")).toThrow(/last account/);
    });

    test("removeAccount errors on an unknown name", () => {
      saveConfig(SAMPLE);
      expect(() => removeAccount("ghost")).toThrow(/No account named/);
    });

    test("addAccount auto-discovers org_id when omitted", async () => {
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        new Response(JSON.stringify([{ uuid: "discovered-org" }]), { status: 200 })) as typeof fetch;

      try {
        saveConfig(SAMPLE);
        await addAccount("work", "sk-ant-sid01-work");

        expect(loadConfig().accounts.find((a) => a.name === "work")?.org_id).toBe("discovered-org");
      } finally {
        globalThis.fetch = realFetch;
      }
    });
  });
});
