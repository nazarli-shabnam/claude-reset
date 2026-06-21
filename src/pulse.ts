import type { UsagePulse, UsageResponse } from "./types";

// The usage endpoint returns a `limits` array; the entry whose group is "session" is the
// rolling 5-hour window. Its `is_active` flag is the only signal Anthropic exposes that the
// account is being used *right now*. We match on group first, then kind, to tolerate either.
function sessionLimit(usage: UsageResponse) {
  return usage.limits?.find((l) => l.group === "session" || l.kind === "session");
}

/**
 * Condense a raw usage reading into the human-facing pulse. Pure — no I/O.
 *
 * Note the hard limitation this whole feature lives under: because the account is shared,
 * this says whether *the account* is active and how much *aggregate* capacity is used — never
 * who, how many people, or whether it's Claude Code vs the web UI. None of that is in the data.
 */
export function summarizePulse(usage: UsageResponse): UsagePulse {
  const session = sessionLimit(usage);
  return {
    active: session?.is_active ?? false,
    five_hour_pct: usage.five_hour.utilization,
    seven_day_pct: usage.seven_day.utilization,
    opus_pct: usage.seven_day_opus?.utilization ?? null,
    sonnet_pct: usage.seven_day_sonnet?.utilization ?? null,
    severity: session?.severity ?? null,
  };
}

/**
 * Detect the idle→active transition so the monitor can alert once when the account starts
 * being used, rather than every poll. Returns false on the first reading (prev undefined) so
 * a startup mid-session doesn't fire a spurious alert.
 */
export function detectActivation(prev: boolean | undefined, curr: boolean): boolean {
  return prev === false && curr === true;
}
