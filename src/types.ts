// ─── API shapes ───────────────────────────────────────────────────────────────

export interface UsageWindow {
  utilization: number; // 0–100
  resets_at: string;   // ISO 8601
}

export interface UsageResponse {
  five_hour: UsageWindow;
  seven_day: UsageWindow;
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
