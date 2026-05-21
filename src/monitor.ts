import type { Notifier, UsageResponse, WatcherConfig, WindowKey } from "./types";
import { fetchUsage } from "./claudeClient";

const RESET_THRESHOLD_PCT = 5;

interface WindowState {
  lastUtilization: number;
  lastResetsAt: string;   // ISO — when this changes, a new window has definitively started
  resetFired: boolean;
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

async function checkOnce(
  config: WatcherConfig,
  state: Map<WindowKey, WindowState>,
  notifier: Notifier
): Promise<UsageResponse> {
  const usage = await fetchUsage(config);

  const windows = [
    { key: "five_hour" as WindowKey, data: usage.five_hour, label: "5-hour window" },
    { key: "seven_day" as WindowKey, data: usage.seven_day, label: "7-day window" },
  ];

  for (const { key, data, label } of windows) {
    const prev: WindowState = state.get(key) ?? {
      lastUtilization: data.utilization,
      lastResetsAt: data.resets_at,
      resetFired: false,
    };

    const current = data.utilization;

    // Primary signal: resets_at moved forward by more than 1 hour → Anthropic issued a new window.
    // We compare numeric timestamps rather than strings to avoid false positives from minor
    // API fluctuations (e.g. millisecond differences in the returned ISO string).
    const prevResetMs = prev.lastResetsAt ? new Date(prev.lastResetsAt).getTime() : 0;
    const currResetMs = new Date(data.resets_at).getTime();
    const windowRolled = prevResetMs > 0 && (currResetMs - prevResetMs) > 60 * 60 * 1000;

    // Secondary signal: utilization dropped sharply (catches edge cases where timestamp
    // doesn't change but usage is clearly reset)
    const utilizationDropped =
      prev.lastUtilization >= RESET_THRESHOLD_PCT && current < RESET_THRESHOLD_PCT;

    const shouldFire = (windowRolled || utilizationDropped) && !prev.resetFired;

    if (shouldFire) {
      const reason = windowRolled ? "new window issued" : "utilization dropped";
      console.log(`[${ts()}] RESET DETECTED — ${label} (${reason}). Sending notification.`);

      const message =
        `*${label} has reset!* Your Claude usage window just refreshed — you\'re back at full capacity.\n` +
        `Next reset scheduled for: ${humanDate(data.resets_at)}`;

      await notifier.notify(message, {
        window: key,
        utilization_before: prev.lastUtilization,
        utilization_after: current,
        resets_at: data.resets_at,
      });

      state.set(key, { lastUtilization: current, lastResetsAt: data.resets_at, resetFired: true });
    } else {
      state.set(key, {
        lastUtilization: current,
        lastResetsAt: data.resets_at,
        // Re-arm once usage climbs above threshold in the new window
        resetFired: current >= RESET_THRESHOLD_PCT ? false : prev.resetFired,
      });
    }
  }

  return usage;
}

export async function runMonitor(config: WatcherConfig, notifier: Notifier): Promise<never> {
  const state = new Map<WindowKey, WindowState>();
  const intervalMs = config.check_interval_minutes * 60 * 1000;

  console.log(`[${ts()}] claude-watcher started — polling every ${config.check_interval_minutes} min`);

  while (true) {
    try {
      const usage = await checkOnce(config, state, notifier);
      console.log(
        `[${ts()}] ` +
        `5h: ${usage.five_hour.utilization}% (resets ${humanDate(usage.five_hour.resets_at)})  |  ` +
        `7d: ${usage.seven_day.utilization}% (resets ${humanDate(usage.seven_day.resets_at)})`
      );
    } catch (err) {
      console.error(`[${ts()}] ERROR:`, err instanceof Error ? err.message : String(err));
    }

    await sleep(intervalMs);
  }
}
