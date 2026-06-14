import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import type { WatcherConfig } from "./types";

const DEFAULTS = {
  check_interval_minutes: 15,
} satisfies Partial<WatcherConfig>;

// Resolved lazily so tests (and unusual setups) can override the location via
// CLAUDE_RESET_CONFIG_DIR without affecting the default ~/.config path.
export function getConfigDir(): string {
  return process.env.CLAUDE_RESET_CONFIG_DIR ?? path.join(os.homedir(), ".config", "claude-reset");
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

export function loadConfig(): WatcherConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found at ${configPath}. Run \`claude-reset init\` to set up.`);
  }

  // Strip a leading UTF-8 BOM — editors on Windows often add one, and JSON.parse
  // rejects it. Without this, a hand-edited config silently crashes the daemon.
  const raw = fs.readFileSync(configPath, "utf-8").replace(/^﻿/, "");

  let parsed: Partial<WatcherConfig>;
  try {
    parsed = JSON.parse(raw) as Partial<WatcherConfig>;
  } catch (err) {
    throw new Error(`Config at ${configPath} is not valid JSON: ${(err as Error).message}`);
  }

  assertField(parsed, "session_key");
  assertField(parsed, "org_id");
  assertField(parsed, "slack_webhook_url");

  return { ...DEFAULTS, ...parsed } as WatcherConfig;
}

export function saveConfig(config: WatcherConfig): void {
  fs.mkdirSync(getConfigDir(), { recursive: true });
  // 0o600 = owner read/write only — protects the session key
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), { mode: 0o600 });
}

// ─── Interactive init ─────────────────────────────────────────────────────────

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function runInteractiveInit(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("\n  claude-reset — first-time setup\n");
    console.log("  Find your session key in browser DevTools → Application → Cookies → claude.ai → sessionKey");
    console.log("  Find your org_id in any authenticated request to claude.ai/api/organizations/<uuid>\n");

    const session_key       = (await prompt(rl, "  Session key (sk-ant-sid01-...): ")).trim();
    const org_id            = (await prompt(rl, "  Organization UUID:              ")).trim();
    const slack_webhook_url = (await prompt(rl, "  Slack webhook URL:              ")).trim();
    const intervalRaw       = (await prompt(rl, "  Check interval in minutes [15]: ")).trim();

    const check_interval_minutes = intervalRaw === "" ? 15 : parseInt(intervalRaw, 10);
    if (isNaN(check_interval_minutes) || check_interval_minutes < 1) {
      throw new Error("Interval must be a positive integer.");
    }

    saveConfig({ session_key, org_id, slack_webhook_url, check_interval_minutes });
    console.log(`\n  Config saved to ${getConfigPath()}\n`);
  } finally {
    rl.close();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertField(obj: Partial<WatcherConfig>, key: keyof WatcherConfig): void {
  if (!obj[key]) {
    throw new Error(`Config is missing required field: "${key}". Re-run \`claude-reset init\`.`);
  }
}
