import type { Account, Notifier, UsageResponse, UsageWindow, WatcherConfig, WindowKey } from "./types";
import { fetchUsage } from "./claudeClient";
import { summarizePulse } from "./pulse";
import { recordTransition, appendTimelineEntry } from "./history";
import { formatDashboard } from "./dashboard";

// A real reset pushes resets_at forward by 5 hours (5h window) or 7 days (7d window).
// We use 1 hour as the minimum threshold to ignore minor API timestamp fluctuations
// while still catching every legitimate reset.
const RESET_WINDOW_MIN_MS = 60 * 60 * 1000;

// Guard against the API occasionally returning epoch (1970-01-01) for resets_at.
// Storing that value would cause the next valid timestamp to look like a ~56-year jump
// and fire a bogus notification (or miss a real one). Only accept dates after Jan 2020.
const MIN_PLAUSIBLE_MS = new Date("2020-01-01T00:00:00Z").getTime();

export interface WindowState {
  lastResetsAt: string;
  lastUtilization: number;
}

/**
 * Pure reset-detection logic for a single usage window. No I/O — given the previous
 * baseline and the latest reading, returns whether a reset fired and the baseline to
 * persist next.
 *
 * - First poll (no prev): record baseline, never fire.
 * - Reset: resets_at moved forward by more than RESET_WINDOW_MIN_MS.
 * - Implausible/epoch resets_at: keep the previous baseline so it can't poison the
 *   next comparison.
 */
export function detectReset(
  prev: WindowState | undefined,
  data: UsageWindow,
  minJumpMs: number = RESET_WINDOW_MIN_MS,
): {
  fired: boolean;
  nextState: WindowState;
} {
  const fresh: WindowState = { lastResetsAt: data.resets_at, lastUtilization: data.utilization };

  if (!prev) {
    return { fired: false, nextState: fresh };
  }

  const prevMs = new Date(prev.lastResetsAt).getTime();
  const currMs = new Date(data.resets_at).getTime();
  // A jump only counts as a reset when it clearly exceeds the poll cadence — otherwise a long
  // check interval (or rolling-window creep in resets_at) could be misread as a fresh window.
  const fired = currMs - prevMs > Math.max(RESET_WINDOW_MIN_MS, minJumpMs);

  // Only persist a plausible timestamp — discard epoch/bogus values so they can't
  // poison the baseline and trigger a false positive (or hide a real one) next poll.
  const nextState = currMs >= MIN_PLAUSIBLE_MS ? fresh : prev;

  return { fired, nextState };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ts(): string {
  return new Date().toISOString();
}

function humanDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export interface CheckResult {
  usage: UsageResponse;
  /** Windows whose reset fired this check — so the caller can log timeline entries. */
  firedWindows: WindowKey[];
}

export async function checkOnce(
  account: Account,
  state: Map<WindowKey, WindowState>,
  notifier: Notifier,
  minJumpMs: number = RESET_WINDOW_MIN_MS,
): Promise<CheckResult> {
  const usage = await fetchUsage(account);
  const tag = `[${account.name}]`;
  const firedWindows: WindowKey[] = [];

  const windows = [
    { key: "five_hour" as WindowKey, data: usage.five_hour, label: "5-hour window" },
    { key: "seven_day" as WindowKey, data: usage.seven_day, label: "7-day window" },
  ];

  for (const { key, data, label } of windows) {
    const prev = state.get(key);
    const { fired, nextState } = detectReset(prev, data, minJumpMs);

    if (fired && prev) {
      firedWindows.push(key);
      console.log(`[${ts()}] ${tag} RESET DETECTED — ${label}. Sending notification.`);

      await notifier.notify(
        `${tag} *${label} has reset!* Your Claude usage window just refreshed — you're back at full capacity.\n` +
        `Next reset scheduled for: ${humanDate(data.resets_at)}`,
        {
          window: key,
          utilization_before: prev.lastUtilization,
          utilization_after: data.utilization,
          resets_at: data.resets_at,
        }
      );
    }

    if (nextState === prev) {
      // Implausible timestamp — detectReset kept the previous baseline.
      console.warn(`[${ts()}] ${tag} Ignoring suspicious resets_at value (${data.resets_at}) for ${label} — keeping previous baseline.`);
    } else {
      state.set(key, nextState);
    }
  }

  return { usage, firedWindows };
}

export async function runMonitor(config: WatcherConfig, notifier: Notifier): Promise<never> {
  // Each account gets its own per-window baseline map so they never cross-contaminate.
  const states = new Map<string, Map<WindowKey, WindowState>>(
    config.accounts.map((a) => [a.name, new Map<WindowKey, WindowState>()])
  );
  // Tracks the last-seen active flag per account so we alert once on idle→active,
  // not every poll. Undefined until the first reading (no spurious startup alert).
  const activeStates = new Map<string, boolean>();
  const intervalMs = config.check_interval_minutes * 60 * 1000;
  // Scale the reset threshold to the poll cadence so a long interval can't misfire.
  const minJumpMs = Math.max(RESET_WINDOW_MIN_MS, 2 * intervalMs);
  // Local date of the last daily digest send, so `notifications.digest: "daily"` fires once/day.
  let lastDigestDate: string | undefined;

  console.log(
    `[${ts()}] claude-reset started — polling every ${config.check_interval_minutes} min — ` +
    `watching ${config.accounts.length} account(s): ${config.accounts.map((a) => a.name).join(", ")}`
  );

  while (true) {
    const dashboardRows: { account: string; usage?: UsageResponse; error?: string }[] = [];

    for (const account of config.accounts) {
      // Isolate each account: an expired key on one must not block the others.
      try {
        const { usage, firedWindows } = await checkOnce(account, states.get(account.name)!, notifier, minJumpMs);
        dashboardRows.push({ account: account.name, usage });

        const pulse = summarizePulse(usage);

        // Log every reset to the activity timeline (notifications are sent by checkOnce).
        for (const window of firedWindows) {
          appendTimelineEntry({
            ts: ts(), account: account.name, event: "reset", window,
            five_hour_pct: pulse.five_hour_pct, seven_day_pct: pulse.seven_day_pct,
          });
        }

        // Alert + log once when the shared account flips idle↔active. This says the account is
        // being used — not who, how many, or whether it's Claude Code vs web.
        const transition = recordTransition(activeStates.get(account.name), pulse.active);
        if (transition) {
          appendTimelineEntry({
            ts: ts(), account: account.name, event: transition,
            five_hour_pct: pulse.five_hour_pct, seven_day_pct: pulse.seven_day_pct,
          });
        }
        if (transition === "active") {
          console.log(`[${ts()}] [${account.name}] ACTIVE — account just went in-use. Notifying.`);
          await notifier.notify(
            `[${account.name}] *Claude account is now active* — someone started using it ` +
            `(5h usage ${pulse.five_hour_pct}%, 7d ${pulse.seven_day_pct}%).`
          );
        }
        activeStates.set(account.name, pulse.active);

        console.log(
          `[${ts()}] [${account.name}] ` +
          `${pulse.active ? "active" : "idle"}  |  ` +
          `5h: ${usage.five_hour.utilization}% (resets ${humanDate(usage.five_hour.resets_at)})  |  ` +
          `7d: ${usage.seven_day.utilization}% (resets ${humanDate(usage.seven_day.resets_at)})`
        );
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        dashboardRows.push({ account: account.name, error: detail });
        console.error(`[${ts()}] [${account.name}] ERROR:`, detail);
      }
    }

    // Once-a-day rollup across all accounts, if enabled.
    const today = new Date().toDateString();
    if (config.notifications?.digest === "daily" && lastDigestDate !== today) {
      lastDigestDate = today;
      try {
        await notifier.notify(`*Daily usage digest*\n\`\`\`${formatDashboard(dashboardRows)}\`\`\``);
      } catch (err) {
        console.error(`[${ts()}] digest send failed:`, err instanceof Error ? err.message : String(err));
      }
    }

    await sleep(intervalMs);
  }
}
