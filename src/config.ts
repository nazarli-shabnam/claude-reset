import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import type { Account, WatcherConfig } from "./types";
import { discoverOrgId } from "./claudeClient";

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

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Config at ${configPath} is not valid JSON: ${(err as Error).message}`);
  }

  const migrated = migrate(parsed);

  if (!migrated.slack_webhook_url) {
    throw new Error(`Config is missing required field: "slack_webhook_url". Re-run \`claude-reset init\`.`);
  }
  if (!Array.isArray(migrated.accounts) || migrated.accounts.length === 0) {
    throw new Error(`Config has no accounts. Run \`claude-reset init\` (or \`claude-reset add-account\`).`);
  }
  for (const account of migrated.accounts) {
    assertAccountField(account, "name");
    assertAccountField(account, "session_key");
    assertAccountField(account, "org_id");
  }

  return { ...DEFAULTS, ...migrated } as WatcherConfig;
}

// Migrate a legacy single-account config (top-level session_key/org_id) to the
// accounts[] shape so existing installs keep working without re-running `init`.
function migrate(parsed: Record<string, unknown>): Partial<WatcherConfig> {
  if (!parsed.accounts && (parsed.session_key || parsed.org_id)) {
    const { session_key, org_id, ...rest } = parsed;
    return {
      ...rest,
      accounts: [{ name: "default", session_key, org_id } as Account],
    } as Partial<WatcherConfig>;
  }
  return parsed as Partial<WatcherConfig>;
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

// Try to detect the org UUID from the session key so the user never has to dig it out
// of DevTools. Falls back to a manual prompt if detection fails for any reason.
async function resolveOrgId(rl: readline.Interface, session_key: string): Promise<string> {
  try {
    const org_id = await discoverOrgId(session_key);
    console.log("  Organization detected automatically.");
    return org_id;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.log(`  Could not auto-detect organization (${detail})`);
    console.log("  Find it in any authenticated request to claude.ai/api/organizations/<uuid>\n");
    return (await prompt(rl, "  Organization UUID:              ")).trim();
  }
}

export async function runInteractiveInit(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("\n  claude-reset — first-time setup\n");
    console.log("  Find your session key in browser DevTools → Application → Cookies → claude.ai → sessionKey\n");

    const nameRaw           = (await prompt(rl, "  Account name [default]:         ")).trim();
    const name              = nameRaw === "" ? "default" : nameRaw;
    const session_key       = (await prompt(rl, "  Session key (sk-ant-sid01-...): ")).trim();
    const org_id            = await resolveOrgId(rl, session_key);
    const slack_webhook_url = (await prompt(rl, "  Slack webhook URL:              ")).trim();
    const intervalRaw       = (await prompt(rl, "  Check interval in minutes [15]: ")).trim();

    const check_interval_minutes = intervalRaw === "" ? 15 : parseInt(intervalRaw, 10);
    if (isNaN(check_interval_minutes) || check_interval_minutes < 1) {
      throw new Error("Interval must be a positive integer.");
    }

    saveConfig({
      accounts: [{ name, session_key, org_id }],
      slack_webhook_url,
      check_interval_minutes,
    });
    console.log(`\n  Config saved to ${getConfigPath()} (account "${name}")\n`);
  } finally {
    rl.close();
  }
}

export async function runInteractiveAddAccount(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("\n  claude-reset — add an account\n");
    const name        = (await prompt(rl, "  Account name:                   ")).trim();
    const session_key = (await prompt(rl, "  Session key (sk-ant-sid01-...): ")).trim();
    const org_id      = await resolveOrgId(rl, session_key);

    await addAccount(name, session_key, org_id);
    console.log(`\n  Account "${name}" added.\n`);
  } finally {
    rl.close();
  }
}

// ─── Account management ────────────────────────────────────────────────────────

export async function addAccount(name: string, session_key: string, org_id?: string): Promise<void> {
  if (!name || !session_key) {
    throw new Error("Account name and session key are required.");
  }
  org_id ??= await discoverOrgId(session_key);
  const config = loadConfig();
  if (config.accounts.some((a) => a.name === name)) {
    throw new Error(`An account named "${name}" already exists.`);
  }
  config.accounts.push({ name, session_key, org_id });
  saveConfig(config);
}

export function removeAccount(name: string): void {
  const config = loadConfig();
  if (!config.accounts.some((a) => a.name === name)) {
    throw new Error(`No account named "${name}".`);
  }
  if (config.accounts.length === 1) {
    throw new Error(`Cannot remove the last account. Run \`claude-reset init\` to reconfigure instead.`);
  }
  config.accounts = config.accounts.filter((a) => a.name !== name);
  saveConfig(config);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertAccountField(account: Account, key: keyof Account): void {
  if (!account || !account[key]) {
    throw new Error(`An account in the config is missing required field: "${key}". Re-run \`claude-reset init\`.`);
  }
}
