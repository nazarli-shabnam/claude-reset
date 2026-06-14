# claude-watcher

A background monitor that watches your Claude Code usage limits and sends a Slack notification the moment your session resets — no more manually refreshing the settings page.

---

## How it works

Claude enforces two rolling usage caps shared across the CLI and web UI:
- **5-hour window** — short-term rate limit
- **7-day window** — weekly cap

claude-watcher polls a private Anthropic endpoint every few minutes. It detects a reset
when the `resets_at` timestamp jumps forward by more than an hour — the unambiguous signal
that Anthropic issued a fresh window. (Minor timestamp jitter and occasional epoch/`1970`
glitches from the API are filtered out so they can't trigger a false alarm.)

When a reset is detected it fires a Slack notification exactly once. Your Slack mobile app will receive it like any other message — no need to keep Slack web open.

**What you see in the terminal while it runs:**
```
[2026-05-21T10:00:00Z] claude-watcher started — polling every 5 min
[2026-05-21T10:00:00Z] 5h: 72% (resets 5/21/26, 4:45 PM)  |  7d: 31% (resets 5/28/26, 2:05 PM)
[2026-05-21T16:46:00Z] RESET DETECTED — 5-hour window. Sending notification.
```

---

## Prerequisites

- **Node.js ≥ 18** — [download here](https://nodejs.org)
- A **Claude Pro/Max account** with an active browser session
- A **Slack Incoming Webhook URL** — [create one here](https://api.slack.com/messaging/webhooks) (free, 2 min)

---

## Installation

```bash
git clone https://github.com/your-username/claude-watcher.git
cd claude-watcher
npm install        # runs the build automatically (via the `prepare` script)
```

> Using [Bun](https://bun.sh) instead? `bun install` works the same way — it also
> runs the `prepare` build. Then use `bun run start` / `bun run dev` in place of
> the `npm` equivalents.

Optional — install globally so `claude-watcher` works from anywhere:
```bash
npm install -g .
```

Because the `prepare` script builds `dist/` on install, the global `claude-watcher`
command works immediately — no separate build step needed.

---

## Finding your credentials

You need two things from your Claude account:

**Session key** (`sk-ant-sid01-...`)
1. Open [claude.ai](https://claude.ai) → F12 → **Application** tab → **Cookies** → `https://claude.ai`
2. Copy the value of the `sessionKey` cookie

**Organization UUID**
1. F12 → **Network** tab → reload the page → filter by `organizations`
2. Click any request — the URL contains `/api/organizations/<uuid>/...`
3. Copy the UUID

> The session key is equivalent to your password. Never share it or commit it to git.

---

## Setup

Run the interactive wizard once:

```bash
claude-watcher init
# or without global install:
node dist/index.js init
```

Your config is saved to `~/.config/claude-watcher/config.json` (Windows: `%USERPROFILE%\.config\claude-watcher\config.json`) with owner-only read permissions. **Setup only runs once** — future starts read the file silently. Re-run `init` only if your session key expires (you'll see a 401 error in logs) or you want to change settings.

Verify it works:
```bash
claude-watcher status
```
```
  Claude usage snapshot

  5-hour:   72%  →  resets 5/21/26, 4:45 PM
  7-day:    31%  →  resets 5/28/26, 2:05 PM
```

---

## Running the monitor

| Command | What it does |
|---|---|
| `claude-watcher start` | Start in background — silent, writes to log file |
| `claude-watcher start --logs` | Start in terminal with live log output |
| `claude-watcher stop` | Stop the background process |
| `claude-watcher logs` | Tail the log file live (Ctrl+C to exit) |
| `claude-watcher status` | One-shot usage snapshot — current utilization and reset times |
| `claude-watcher test-notify` | Send a test message to Slack — use this to verify your webhook works |
| `claude-watcher init` | Re-run setup to update credentials or settings |

### Auto-start on login (Windows)

**Startup folder** (simplest):
1. Press **Win + R** → type `shell:startup` → Enter
2. Right-click → New → Shortcut
3. Location: `node C:\Users\YourName\projects\claude-watcher\dist\index.js start`

**Task Scheduler** (more reliable, survives crashes):
```powershell
$action = New-ScheduledTaskAction -Execute "node" -Argument "C:\Users\$env:USERNAME\projects\claude-watcher\dist\index.js start"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0
Register-ScheduledTask -TaskName "claude-watcher" -Action $action -Trigger $trigger -Settings $settings
```

**macOS** (runs in background, auto-restarts):
```bash
# Create ~/Library/LaunchAgents/com.claude-watcher.plist
# See full plist template in the wiki
launchctl load ~/Library/LaunchAgents/com.claude-watcher.plist
```

**Linux (systemd)**:
```bash
# Create ~/.config/systemd/user/claude-watcher.service
# ExecStart=/usr/local/bin/node /path/to/dist/index.js start
systemctl --user enable --now claude-watcher
```

### Stopping the monitor

```bash
# If started with --logs (terminal)
Ctrl + C

# If running in background
claude-watcher stop

# Remove Task Scheduler auto-start entry permanently
Unregister-ScheduledTask -TaskName "claude-watcher" -Confirm:$false
```

---

## Configuration

`~/.config/claude-watcher/config.json`

| Field | Description | Default |
|---|---|---|
| `session_key` | `sk-ant-sid01-...` cookie value | required |
| `org_id` | Claude organization UUID | required |
| `slack_webhook_url` | Slack Incoming Webhook URL | required |
| `check_interval_minutes` | How often to poll | `15` |

---

## Adding notification channels

Every notifier implements one interface from `src/types.ts`:

```typescript
export interface Notifier {
  notify(message: string, context?: NotificationContext): Promise<void>;
}
```

A **WhatsApp stub** is already in `src/notifier.ts`. To activate it: uncomment `WhatsAppNotifier`, fill in the Twilio/Meta Cloud API call, add credentials to the config, and push it into the `notifiers` array in `src/index.ts`. The `BroadcastNotifier` fans out to all channels simultaneously.

---

## Troubleshooting

| Error | Fix |
|---|---|
| `Auth rejected (HTTP 401)` | Session key expired — grab a fresh cookie and re-run `init` |
| `Config not found` | Run `claude-watcher init` first |
| Slack never fires | Run `claude-watcher test-notify` to verify your webhook works. If that succeeds but resets still don't notify, check the logs with `claude-watcher logs` to confirm the monitor is running and polling. |
| `node: command not found` | Node.js isn't installed or not on PATH — [download here](https://nodejs.org) |

---

## Testing

The test suite runs on [Bun](https://bun.sh):

```bash
bun test
```

It covers the reset-detection state machine, config load/save (including malformed and
BOM-prefixed files), the Slack/broadcast notifier fan-out, and the usage-API client's
error handling — all without network access. Tests use the `CLAUDE_WATCHER_CONFIG_DIR`
environment variable to point config I/O at a temp directory, so they never touch your
real `~/.config/claude-watcher`.

---

## Project structure

```
src/
  types.ts          Shared interfaces — UsageResponse, WatcherConfig, Notifier
  config.ts         Config file read/write + interactive init wizard
  claudeClient.ts   HTTP fetch to the private Anthropic usage endpoint
  notifier.ts       SlackNotifier, BroadcastNotifier, WhatsApp stub
  monitor.ts        Polling loop + reset-detection state machine
  index.ts          CLI entry point — init / start / status / help
```

---

## License

MIT
