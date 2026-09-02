import { execFile } from "child_process";
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
            text: `:bell: *claude-reset*\n${message}`,
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

// ─── Desktop (native OS notification — the zero-config default channel) ───────

/** Fires the platform's native notification. Injectable for tests. Returns a warning string
 *  on best-effort failure (missing `notify-send`, etc.) rather than throwing. */
export type DesktopSend = (title: string, body: string) => Promise<string | null>;

const TITLE = "claude-reset";

const osSend: DesktopSend = (title, body) =>
  new Promise((resolve) => {
    const done = (warn: string | null) => resolve(warn);

    if (process.platform === "darwin") {
      // argv-based AppleScript — no string escaping of the message needed.
      run("osascript", [
        "-e", "on run argv",
        "-e", "display notification (item 1 of argv) with title (item 2 of argv)",
        "-e", "end run",
        "--", body, title,
      ], done);
    } else if (process.platform === "win32") {
      // WinRT toast via PowerShell; text passed through env vars to dodge quoting.
      const ps =
        "$ErrorActionPreference='Stop';" +
        "[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]>$null;" +
        "$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);" +
        "$n=$t.GetElementsByTagName('text');" +
        "$n.Item(0).AppendChild($t.CreateTextNode($env:CR_TITLE))>$null;" +
        "$n.Item(1).AppendChild($t.CreateTextNode($env:CR_BODY))>$null;" +
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('claude-reset').Show([Windows.UI.Notifications.ToastNotification]::new($t))";
      run("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], done, { CR_TITLE: title, CR_BODY: body });
    } else {
      run("notify-send", [title, body], done);
    }
  });

function run(
  cmd: string,
  args: string[],
  done: (warn: string | null) => void,
  extraEnv?: Record<string, string>,
): void {
  execFile(cmd, args, { env: { ...process.env, ...extraEnv }, timeout: 10_000 }, (err) => {
    done(err ? `desktop notification via ${cmd} failed: ${err.message}` : null);
  });
}

export class DesktopNotifier implements Notifier {
  constructor(private readonly send: DesktopSend = osSend) {}

  async notify(message: string, context?: NotificationContext): Promise<void> {
    const body = context
      ? `${message}\n${context.utilization_before}% → ${context.utilization_after}% · resets ${formatDate(context.resets_at)}`
      : message;
    const warn = await this.send(TITLE, body);
    if (warn) console.warn(`[${new Date().toISOString()}] ${warn}`);
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
