import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { getConfigPath, loadConfig, saveConfig } from "./config";
import type { WatcherConfig } from "./types";

let tmpDir: string;

const SAMPLE: WatcherConfig = {
  session_key: "sk-ant-sid01-test",
  org_id: "00000000-0000-0000-0000-000000000000",
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

  test("loadConfig throws on a missing required field", () => {
    const { session_key, ...partial } = SAMPLE;
    fs.writeFileSync(getConfigPath(), JSON.stringify(partial));

    expect(() => loadConfig()).toThrow(/session_key/);
  });
});
