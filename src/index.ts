#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import {
  loadConfig,
  runInteractiveInit,
  runInteractiveAddAccount,
  removeAccount,
  configExists,
  getConfigPath,
  getConfigDir,
} from "./config";
import { runMonitor } from "./monitor";
import { SlackNotifier, BroadcastNotifier } from "./notifier";
import { fetchUsage } from "./claudeClient";
import { summarizePulse } from "./pulse";

const LOG_PATH = path.join(getConfigDir(), "watcher.log");
const PID_PATH = path.join(getConfigDir(), "watcher.pid");

const COMMANDS = ["init", "start", "status", "pulse", "stop", "logs", "test-notify", "add-account", "remove-account", "accounts", "help"] as const;
type Command = (typeof COMMANDS)[number];

const [, , rawCommand = "start"] = process.argv;
const command = COMMANDS.includes(rawCommand as Command) ? (rawCommand as Command) : "help";
const args = process.argv.slice(3);

async function main(): Promise<void> {
  switch (command) {
    case "init":
      await runInteractiveInit();
      break;

    case "status": {
      const config = loadConfig();
      console.log("\n  Claude usage snapshot\n");
      for (const account of config.accounts) {
        try {
          const usage = await fetchUsage(account);
          console.log(`  ${account.name}`);
          console.log(`    5-hour:  ${pad(usage.five_hour.utilization)}%  →  resets ${fmtDate(usage.five_hour.resets_at)}`);
          console.log(`    7-day:   ${pad(usage.seven_day.utilization)}%  →  resets ${fmtDate(usage.seven_day.resets_at)}`);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          console.log(`  ${account.name}`);
          console.log(`    failed: ${detail}`);
        }
        console.log();
      }
      break;
    }

    case "pulse": {
      // Best-effort "is the account being used right now, and how hard" view.
      // Cannot identify who, how many people, or CLI-vs-web — that data isn't exposed
      // for a shared account. See src/pulse.ts.
      const config = loadConfig();
      const asJson = args.includes("--json");
      const rows: Record<string, unknown>[] = [];

      for (const account of config.accounts) {
        try {
          const pulse = summarizePulse(await fetchUsage(account));
          if (asJson) {
            rows.push({ account: account.name, ...pulse });
          } else {
            const dot = pulse.active ? "● active now" : "○ idle";
            console.log(`\n  ${account.name}  —  ${dot}`);
            console.log(`    5-hour:  ${pad(pulse.five_hour_pct)}%     7-day: ${pad(pulse.seven_day_pct)}%`);
            console.log(`    models:  Opus ${fmtPct(pulse.opus_pct)}   Sonnet ${fmtPct(pulse.sonnet_pct)}`);
          }
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          if (asJson) rows.push({ account: account.name, error: detail });
          else console.log(`\n  ${account.name}\n    failed: ${detail}`);
        }
      }

      if (asJson) console.log(JSON.stringify(rows, null, 2));
      else console.log();
      break;
    }

    case "add-account":
      await runInteractiveAddAccount();
      break;

    case "remove-account": {
      const name = args[0];
      if (!name) die("Usage: claude-reset remove-account <name>");
      try {
        removeAccount(name);
        console.log(`Account "${name}" removed.`);
      } catch (err) {
        die("Failed to remove account:", err);
      }
      break;
    }

    case "accounts": {
      const config = loadConfig();
      console.log("\n  Configured accounts\n");
      for (const account of config.accounts) {
        console.log(`  - ${account.name}  (org ${account.org_id})`);
      }
      console.log();
      break;
    }

    case "start": {
      if (!configExists()) {
        console.error(`No config found at ${getConfigPath()}.\nRun \`claude-reset init\` first.`);
        process.exit(1);
      }

      const showLogs = args.includes("--logs");
      const isDaemon = args.includes("--daemon");

      if (!showLogs && !isDaemon) {
        // Spawn a detached background process that writes to the log file
        fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
        const logFd = fs.openSync(LOG_PATH, "a");

        const child = spawn(process.execPath, [__filename, "start", "--daemon"], {
          detached: true,
          stdio: ["ignore", logFd, logFd],
          windowsHide: true,
        });
        child.unref();
        fs.closeSync(logFd);

        console.log("claude-reset running in background.");
        console.log(`Logs  → ${LOG_PATH}`);
        console.log(`Stop  → claude-reset stop`);
        break;
      }

      // --logs or --daemon: run the monitor directly in this process.
      // The background daemon records its PID so `stop` can kill it reliably,
      // without grepping the OS process list.
      if (isDaemon) {
        fs.mkdirSync(path.dirname(PID_PATH), { recursive: true });
        fs.writeFileSync(PID_PATH, String(process.pid));
        const cleanup = () => {
          try { fs.unlinkSync(PID_PATH); } catch { /* already gone */ }
        };
        process.on("exit", cleanup);
        process.on("SIGTERM", () => { cleanup(); process.exit(0); });
        process.on("SIGINT", () => { cleanup(); process.exit(0); });
      }

      const config = loadConfig();
      const notifier = new BroadcastNotifier([new SlackNotifier(config.slack_webhook_url)]);
      await runMonitor(config, notifier);
      break;
    }

    case "test-notify": {
      const config = loadConfig();
      const notifier = new SlackNotifier(config.slack_webhook_url);
      try {
        await notifier.notify(
          "Test message from claude-reset — if you see this, your Slack webhook is working correctly.",
          { window: "five_hour", utilization_before: 89, utilization_after: 2, resets_at: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString() }
        );
        console.log("Test notification sent. Check your Slack channel.");
      } catch (err) {
        die("Failed to send test notification:", err);
      }
      break;
    }

    case "stop": {
      // Kill the background daemon by the PID it recorded on start. This is
      // path/name independent and works identically on Windows and Unix.
      if (!fs.existsSync(PID_PATH)) {
        console.log("claude-reset is not running.");
        break;
      }

      const raw = fs.readFileSync(PID_PATH, "utf-8").trim();
      const pid = Number.parseInt(raw, 10);

      const removePidFile = () => {
        try { fs.unlinkSync(PID_PATH); } catch { /* already gone */ }
      };

      if (!Number.isInteger(pid) || pid <= 0) {
        console.log("claude-reset is not running.");
        removePidFile();
        break;
      }

      try {
        if (process.platform === "win32") {
          // taskkill terminates the whole tree and is reliable for detached procs.
          const { execSync } = await import("child_process");
          execSync(`taskkill /PID ${pid} /F /T`, { stdio: "ignore" });
        } else {
          process.kill(pid, "SIGTERM");
        }
        console.log("claude-reset stopped.");
      } catch {
        // ESRCH / "not found" means the recorded process is already gone (stale PID).
        console.log("claude-reset is not running (stale PID file removed).");
      }
      removePidFile();
      break;
    }

    case "logs": {
      if (!fs.existsSync(LOG_PATH)) {
        console.error(`No log file found at ${LOG_PATH}. Has the monitor been started yet?`);
        process.exit(1);
      }
      // Tail the log file — Ctrl+C to exit
      console.log(`Tailing ${LOG_PATH}  (Ctrl+C to stop)\n`);
      const tail = spawn(
        process.platform === "win32" ? "powershell" : "tail",
        process.platform === "win32"
          ? ["-Command", `Get-Content '${LOG_PATH}' -Tail 20 -Wait`]
          : ["-f", "-n", "20", LOG_PATH],
        { stdio: "inherit" }
      );
      await new Promise<void>((resolve, reject) => {
        tail.on("error", reject);
        tail.on("close", resolve);
      });
      break;
    }

    case "help":
    default:
      printHelp();
  }
}

function printHelp(): void {
  console.log(`
  claude-reset — Claude Code usage limit monitor

  Commands:
    init                   Interactive setup — first account, Slack webhook, interval
    add-account            Add another Claude account to monitor
    remove-account <name>  Remove an account by name
    accounts               List configured accounts
    start                  Start in background — silent, writes to log file
    start --logs           Start in terminal with live log output
    stop                   Stop the background process
    logs                   Tail the log file (Ctrl+C to exit)
    status                 One-shot usage snapshot for every account
    pulse [--json]         Is the account active now? + 5h/7d + Opus/Sonnet split
    test-notify            Send a test message to your Slack channel
    help                   Show this help text

  The daemon watches all configured accounts at once and prefixes
  every notification with the account name, e.g. "[work] …".

  Config file: ${getConfigPath()}
  Log file:    ${LOG_PATH}
  `);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function pad(n: number): string {
  return String(n).padStart(3, " ");
}

function fmtPct(n: number | null): string {
  return n === null ? " — " : `${n}%`;
}

function die(msg: string, err?: unknown): never {
  const detail = err instanceof Error ? err.message : String(err ?? "");
  console.error(detail ? `${msg} ${detail}` : msg);
  process.exit(1);
}

main().catch((err) => die("Fatal error:", err));
