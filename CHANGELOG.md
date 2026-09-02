# Changelog

## 1.3.0 — 2026-09-02

### Added
- **Browser-assisted login.** `claude-reset login [--account <name>]` opens a real browser to
  the claude.ai login page, waits for you to sign in (password or Google/SSO), and captures the
  `sessionKey` for you — no more digging through DevTools. `init` and `add-account` offer it
  first, with manual paste as the fallback. (Anthropic's OAuth is locked to Claude Code /
  claude.ai, so a real browser login is the sanctioned path.)
- **Desktop notifications**, and Slack is now **optional**. With no webhook configured,
  notifications go to the native OS notification system (Windows toast, macOS Notification
  Center, Linux `notify-send`) — zero extra dependencies. New `notifications` config block:
  `{ desktop, slack, digest }`.
- **`claude-reset dashboard`** — every account in one view: utilization, reset times, the
  Opus/Sonnet split, a live-activity dot, and the full `limits[]` breakdown the claude.ai
  settings page collapses. `--json` for the raw payload.
- **`claude-reset timeline`** — reconstructs in-use / idle intervals and window resets from an
  activity log the monitor keeps (`~/.config/claude-reset/timeline.jsonl`). `--account`,
  `--days N`, `--json`.
- **`notifications.digest: "daily"`** — a once-a-day dashboard rollup through the configured
  channels.

### Fixed
- Removed an accidental self-referential dependency that pulled a stale copy of the package
  into `node_modules`.
- Reset detection no longer misfires on long check intervals — the forward-jump threshold now
  scales to the poll cadence (`max(1h, 2 × interval)`).
- `init` / `add-account` validate the session key and Slack webhook URL up front and re-prompt
  on bad input, instead of writing a config the daemon later rejects.
- Legacy configs missing `org_id` now load and self-heal (the UUID is discovered from the
  session key and persisted once) instead of hard-failing.
- Auth-expired errors now point at `claude-reset login`.
- `npm test` prints an actionable hint when Bun isn't installed.

### Dependencies
- Added `puppeteer-core` (the first runtime dependency) for browser login. It ships no bundled
  browser and is loaded lazily, so commands that don't use it pay nothing.

## 1.2.0 — 2026-07-02
- Activity pulse, active-account alerts, auto-detected `org_id`.

## 1.0.0 — 2026-06-14
- Initial release.
