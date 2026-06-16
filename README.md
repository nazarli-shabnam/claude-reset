# claude-reset

A background monitor that watches your Claude Code usage limits and sends a Slack notification the moment your session resets — no more manually refreshing the settings page.

Run multiple Claude accounts? claude-reset watches **all of them at once** and tags every notification with the account name — so it doesn't matter how you switch your active session (`cswap`, manual re-login, etc.); the monitor tracks each account independently.

---

## How it works

Claude enforces two rolling usage caps shared across the CLI and web UI:
- **5-hour window** — short-term rate limit
- **7-day window** — weekly cap

claude-reset polls a private Anthropic endpoint every few minutes. It detects a reset
when the `resets_at` timestamp jumps forward by more than an hour — the unambiguous signal
that Anthropic issued a fresh window. (Minor timestamp jitter and occasional epoch/`1970`
glitches from the API are filtered out so they can't trigger a false alarm.)

When a reset is detected it fires a Slack notification exactly once. Your Slack mobile app will receive it like any other message — no need to keep Slack web open.

**What you see in the terminal while it runs:**
```
[2026-05-21T10:00:00Z] claude-reset started — polling every 5 min — watching 2 account(s): work, personal
[2026-05-21T10:00:00Z] [work] 5h: 72% (resets 5/21/26, 4:45 PM)  |  7d: 31% (resets 5/28/26, 2:05 PM)
[2026-05-21T10:00:00Z] [personal] 5h: 12% (resets 5/21/26, 1:10 PM)  |  7d: 8% (resets 5/27/26, 9:00 AM)
[2026-05-21T16:46:00Z] [work] RESET DETECTED — 5-hour window. Sending notification.
```

---

## Prerequisites

- **Node.js ≥ 18** — [download here](https://nodejs.org)
- A **Claude Pro/Max account** with an active browser session
- A **Slack Incoming Webhook URL** — [create one here](https://api.slack.com/messaging/webhooks) (free, 2 min)

---

## Installation

The fastest way — install globally so the `claude-reset` command works from anywhere:

```bash
npm install -g claude-reset
# or straight from GitHub:
npm install -g github:nazarli-shabnam/claude-reset
```

Or work from a clone:

```bash
git clone https://github.com/nazarli-shabnam/claude-reset.git
cd claude-reset
npm install        # runs the build automatically (via the `prepare` script)
npm install -g .   # optional: expose the global `claude-reset` command
```

> Using [Bun](https://bun.sh) instead? `bun install` works the same way — it also
> runs the `prepare` build. Then use `bun run start` / `bun run dev` in place of
> the `npm` equivalents.

Because the `prepare` script builds `dist/` on install, the global `claude-reset`
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
claude-reset init
# or without global install:
node dist/index.js init
```

Your config is saved to `~/.config/claude-reset/config.json` (Windows: `%USERPROFILE%\.config\claude-reset\config.json`) with owner-only read permissions. **Setup only runs once** — future starts read the file silently. Re-run `init` only if your session key expires (you'll see a 401 error in logs) or you want to change settings.

### Watching more than one account

`init` configures your first account. Add others with `add-account`:

```bash
claude-reset add-account     # prompts for a name + that account's session key + org_id
claude-reset accounts        # list configured accounts
claude-reset remove-account work
```

Each account needs **its own** browser session key and org_id — grab them while logged
into that account (see *Finding your credentials* above). Account-switchers like
[`cswap`](https://github.com/realiti4/claude-swap) rotate Claude Code's OAuth tokens,
which are a *different* credential from the `sessionKey` cookie this tool uses, so they
can't be reused here. The Slack webhook and check interval are shared across all accounts.

Verify it works:
```bash
claude-reset status
```
```
  Claude usage snapshot

  work
    5-hour:   72%  →  resets 5/21/26, 4:45 PM
    7-day:    31%  →  resets 5/28/26, 2:05 PM

  personal
    5-hour:   12%  →  resets 5/21/26, 1:10 PM
    7-day:     8%  →  resets 5/27/26, 9:00 AM
```

---

## Running the monitor

| Command | What it does |
|---|---|
| `claude-reset start` | Start in background — silent, writes to log file |
| `claude-reset start --logs` | Start in terminal with live log output |
| `claude-reset stop` | Stop the background process |
| `claude-reset logs` | Tail the log file live (Ctrl+C to exit) |
| `claude-reset status` | One-shot usage snapshot for every account — current utilization and reset times |
| `claude-reset test-notify` | Send a test message to Slack — use this to verify your webhook works |
| `claude-reset add-account` | Add another Claude account to monitor |
| `claude-reset remove-account <name>` | Remove an account by name |
| `claude-reset accounts` | List configured accounts |
| `claude-reset init` | Re-run setup to update credentials or settings |

### Auto-start on login (Windows)

**Startup folder** (simplest):
1. Press **Win + R** → type `shell:startup` → Enter
2. Right-click → New → Shortcut
3. Location: `node C:\Users\YourName\projects\claude-reset\dist\index.js start`

**Task Scheduler** (more reliable, survives crashes):
```powershell
$action = New-ScheduledTaskAction -Execute "node" -Argument "C:\Users\$env:USERNAME\projects\claude-reset\dist\index.js start"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0
Register-ScheduledTask -TaskName "claude-reset" -Action $action -Trigger $trigger -Settings $settings
```

**macOS** (runs in background, auto-restarts):
```bash
# Create ~/Library/LaunchAgents/com.claude-reset.plist
# See full plist template in the wiki
launchctl load ~/Library/LaunchAgents/com.claude-reset.plist
```

**Linux (systemd)**:
```bash
# Create ~/.config/systemd/user/claude-reset.service
# ExecStart=/usr/local/bin/node /path/to/dist/index.js start
systemctl --user enable --now claude-reset
```

### Stopping the monitor

```bash
# If started with --logs (terminal)
Ctrl + C

# If running in background
claude-reset stop

# Remove Task Scheduler auto-start entry permanently
Unregister-ScheduledTask -TaskName "claude-reset" -Confirm:$false
```

---

## Configuration

`~/.config/claude-reset/config.json`

```json
{
  "accounts": [
    { "name": "work",     "session_key": "sk-ant-sid01-...", "org_id": "..." },
    { "name": "personal", "session_key": "sk-ant-sid01-...", "org_id": "..." }
  ],
  "slack_webhook_url": "https://hooks.slack.com/services/...",
  "check_interval_minutes": 15
}
```

| Field | Description | Default |
|---|---|---|
| `accounts[].name` | Label shown in logs and notifications | required |
| `accounts[].session_key` | `sk-ant-sid01-...` cookie value for that account | required |
| `accounts[].org_id` | Claude organization UUID for that account | required |
| `slack_webhook_url` | Slack Incoming Webhook URL (shared by all accounts) | required |
| `check_interval_minutes` | How often to poll | `15` |

> **Upgrading from a single-account version?** Old configs with top-level `session_key`
> and `org_id` are migrated automatically into a single account named `default` — no
> action needed.

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
| `Config not found` | Run `claude-reset init` first |
| Slack never fires | Run `claude-reset test-notify` to verify your webhook works. If that succeeds but resets still don't notify, check the logs with `claude-reset logs` to confirm the monitor is running and polling. |
| `node: command not found` | Node.js isn't installed or not on PATH — [download here](https://nodejs.org) |

---

## Testing

The test suite runs on [Bun](https://bun.sh):

```bash
bun test
```

It covers the reset-detection state machine, config load/save (including malformed and
BOM-prefixed files), the Slack/broadcast notifier fan-out, and the usage-API client's
error handling — all without network access. Tests use the `CLAUDE_RESET_CONFIG_DIR`
environment variable to point config I/O at a temp directory, so they never touch your
real `~/.config/claude-reset`.

---

## Project structure

```
src/
  types.ts          Shared interfaces — UsageResponse, Account, WatcherConfig, Notifier
  config.ts         Config file read/write, account management, interactive wizards
  claudeClient.ts   HTTP fetch to the private Anthropic usage endpoint
  notifier.ts       SlackNotifier, BroadcastNotifier, WhatsApp stub
  monitor.ts        Per-account polling loop + reset-detection state machine
  index.ts          CLI entry point — init / add-account / start / status / help
```

---

## License

MIT
