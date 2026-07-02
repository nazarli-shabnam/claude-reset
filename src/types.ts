// ─── API shapes ───────────────────────────────────────────────────────────────

export interface UsageWindow {
  utilization: number; // 0–100
  resets_at: string;   // ISO 8601
}

/**
 * One entry in the usage endpoint's `limits` array. The `session`-group entry carries
 * `is_active`, which is the only "the account is being used right now" signal Anthropic
 * exposes for a shared account. All fields are best-effort — the private API may omit them.
 */
export interface UsageLimit {
  kind: string;
  group: string;
  percent: number;
  severity: string;
  resets_at: string;
  is_active: boolean;
}

export interface UsageResponse {
  five_hour: UsageWindow;
  seven_day: UsageWindow;
  // Richer fields the usage endpoint also returns. Optional so older/partial payloads
  // (and the strict five_hour/seven_day validation in fetchUsage) keep working.
  seven_day_opus?: UsageWindow | null;
  seven_day_sonnet?: UsageWindow | null;
  limits?: UsageLimit[];
}

/** Condensed, human-facing view of a usage reading — see src/pulse.ts. */
export interface UsagePulse {
  active: boolean;             // session window currently in use (someone is working)
  five_hour_pct: number;
  seven_day_pct: number;
  opus_pct: number | null;     // 7-day Opus utilization, null when not reported
  sonnet_pct: number | null;   // 7-day Sonnet utilization, null when not reported
  severity: string | null;     // severity of the active session limit, if any
}

// ─── Config ───────────────────────────────────────────────────────────────────

/** A single Claude account to monitor. The name labels its logs and notifications. */
export interface Account {
  name: string;
  session_key: string;
  org_id: string;
}

export interface WatcherConfig {
  accounts: Account[];
  slack_webhook_url: string;
  check_interval_minutes: number;
}

// ─── Notifications ────────────────────────────────────────────────────────────

export type WindowKey = "five_hour" | "seven_day";

export interface NotificationContext {
  window: WindowKey;
  utilization_before: number;
  utilization_after: number;
  resets_at: string;
}

/** Implement this interface to add a new notification channel (Slack, WhatsApp, etc.) */
export interface Notifier {
  notify(message: string, context?: NotificationContext): Promise<void>;
}
