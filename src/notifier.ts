import type { Notifier, NotificationContext } from "./types";

// ─── Slack ────────────────────────────────────────────────────────────────────

export class SlackNotifier implements Notifier {
  constructor(private readonly webhookUrl: string) {}

  async notify(message: string, context?: NotificationContext): Promise<void> {
    const contextBlock = context
      ? [
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: [
                  `Window: \`${context.window.replace("_", " ")}\``,
                  `Usage: *${context.utilization_before}%* → *${context.utilization_after}%*`,
                  `Next reset: ${formatDate(context.resets_at)}`,
                ].join("  ·  "),
              },
            ],
          },
        ]
      : [];

    const body = {
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:bell: *claude-watch*\n${message}`,
          },
        },
        ...contextBlock,
      ],
    };

    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook returned HTTP ${response.status}`);
    }
  }
}

// ─── WhatsApp (stub — wire up Twilio or Meta Cloud API here) ──────────────────

// export class WhatsAppNotifier implements Notifier {
//   constructor(
//     private readonly apiToken: string,
//     private readonly toNumber: string   // E.164 format, e.g. "+14155238886"
//   ) {}
//
//   async notify(message: string, _context?: NotificationContext): Promise<void> {
//     // POST to https://api.twilio.com/2010-04-01/Accounts/<SID>/Messages.json
//     // or the Meta Cloud API endpoint, using this.apiToken + this.toNumber.
//     throw new Error("WhatsAppNotifier not yet implemented.");
//   }
// }

// ─── Multi-channel broadcaster ────────────────────────────────────────────────

/** Broadcasts to every notifier in the list; collects and re-throws all failures. */
export class BroadcastNotifier implements Notifier {
  constructor(private readonly notifiers: Notifier[]) {}

  async notify(message: string, context?: NotificationContext): Promise<void> {
    const results = await Promise.allSettled(
      this.notifiers.map((n) => n.notify(message, context))
    );

    const failures = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => (r.reason as Error).message);

    if (failures.length > 0) {
      throw new Error(`Some notifiers failed:\n${failures.join("\n")}`);
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}
