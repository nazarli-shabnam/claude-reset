import type { Notifier, UsageResponse, UsageWindow, WatcherConfig, WindowKey } from "./types";
import { fetchUsage } from "./claudeClient";

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
export function detectReset(prev: WindowState | undefined, data: UsageWindow): {
  fired: boolean;
  nextState: WindowState;
} {
  const fresh: WindowState = { lastResetsAt: data.resets_at, lastUtilization: data.utilization };

  if (!prev) {
    return { fired: false, nextState: fresh };
  }

  const prevMs = new Date(prev.lastResetsAt).getTime();
  const currMs = new Date(data.resets_at).getTime();
  const fired = currMs - prevMs > RESET_WINDOW_MIN_MS;

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
    const prev = state.get(key);
    const { fired, nextState } = detectReset(prev, data);

    if (fired && prev) {
      console.log(`[${ts()}] RESET DETECTED — ${label}. Sending notification.`);

      await notifier.notify(
        `*${label} has reset!* Your Claude usage window just refreshed — you're back at full capacity.\n` +
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
      console.warn(`[${ts()}] Ignoring suspicious resets_at value (${data.resets_at}) for ${label} — keeping previous baseline.`);
    } else {
      state.set(key, nextState);
    }
  }

  return usage;
}

export async function runMonitor(config: WatcherConfig, notifier: Notifier): Promise<never> {
  const state = new Map<WindowKey, WindowState>();
  const intervalMs = config.check_interval_minutes * 60 * 1000;

  console.log(`[${ts()}] claude-watch started — polling every ${config.check_interval_minutes} min`);

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
