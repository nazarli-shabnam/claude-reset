import type { UsageResponse } from "./types";
import { summarizePulse } from "./pulse";

export interface DashboardRow {
  account: string;
  usage?: UsageResponse;
  error?: string;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function pct(n: number | null): string {
  return n === null ? "  —" : `${String(n).padStart(3, " ")}%`;
}

/**
 * One combined view across every account — utilization, reset times, the Opus/Sonnet split,
 * live-activity dot, and the full `limits[]` breakdown the claude.ai settings page collapses.
 * Pure: takes already-fetched rows, returns the text block.
 */
export function formatDashboard(rows: DashboardRow[]): string {
  const out: string[] = ["", "  Claude usage dashboard", ""];

  for (const row of rows) {
    if (row.error || !row.usage) {
      out.push(`  ${row.account}`, `    failed: ${row.error ?? "no data"}`, "");
      continue;
    }

    const u = row.usage;
    const pulse = summarizePulse(u);
    const dot = pulse.active ? "● active now" : "○ idle";

    out.push(`  ${row.account}  —  ${dot}${pulse.severity ? `  (${pulse.severity})` : ""}`);
    out.push(`    5-hour:  ${pct(u.five_hour.utilization)}   →  resets ${fmtDate(u.five_hour.resets_at)}`);
    out.push(`    7-day:   ${pct(u.seven_day.utilization)}   →  resets ${fmtDate(u.seven_day.resets_at)}`);
    out.push(`    models:  Opus ${pct(pulse.opus_pct)}   Sonnet ${pct(pulse.sonnet_pct)}`);

    if (u.limits && u.limits.length > 0) {
      out.push(`    limits:`);
      for (const l of u.limits) {
        out.push(
          `      ${(l.group || l.kind).padEnd(10)} ${String(l.percent).padStart(3, " ")}%  ` +
          `${l.severity.padEnd(8)} resets ${fmtDate(l.resets_at)}`,
        );
      }
    }
    out.push("");
  }

  return out.join("\n");
}
