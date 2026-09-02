import fs from "fs";
import os from "os";
import path from "path";
import type { Cookie } from "puppeteer-core";

// ─── Why browser capture, not OAuth ──────────────────────────────────────────
// The usage endpoints this tool calls (claude.ai/api/organizations/*) are authenticated by
// the `sessionKey` browser cookie. Anthropic's OAuth flow is locked to Claude Code / claude.ai
// (no third-party client registration, no device-code grant) and reusing Claude Code's own
// token against a different app violates their credential-use policy and is actively blocked.
// So the easiest *sanctioned* path is what a user does by hand today — log in to claude.ai in a
// real browser — just automated: we drive the user's own Chrome/Edge to the login page, wait
// for them to sign in (password or Google/SSO), then read the cookie they just received. The
// cookie never leaves the machine.

const SESSION_COOKIE = "sessionKey";

/** Extract the `sessionKey` value from a cookie list, or null if the user isn't logged in yet. */
export function pickSessionKey(cookies: Pick<Cookie, "name" | "value">[]): string | null {
  const hit = cookies.find((c) => c.name === SESSION_COOKIE && c.value.startsWith("sk-ant-sid01-"));
  return hit ? hit.value : null;
}

// Common install locations, checked in order. Env overrides win.
function chromeCandidates(): string[] {
  const env = [process.env.PUPPETEER_EXECUTABLE_PATH, process.env.CHROME_PATH].filter(Boolean) as string[];
  const home = os.homedir();

  if (process.platform === "win32") {
    const pf = process.env["PROGRAMFILES"] ?? "C:\\Program Files";
    const pf86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    const local = process.env["LOCALAPPDATA"] ?? path.join(home, "AppData", "Local");
    return [
      ...env,
      path.join(pf, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(pf86, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(local, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(pf, "Microsoft\\Edge\\Application\\msedge.exe"),
      path.join(pf86, "Microsoft\\Edge\\Application\\msedge.exe"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      ...env,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  return [
    ...env,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
}

/** First browser executable that exists on disk. Throws with guidance if none is found. */
export function findChrome(exists: (p: string) => boolean = fs.existsSync): string {
  const found = chromeCandidates().find((p) => exists(p));
  if (!found) {
    throw new Error(
      "No Chrome or Edge install found. Install one, or set CHROME_PATH to its executable, " +
      "then re-run `claude-reset login`. (Or use the paste flow: `claude-reset add-account`.)",
    );
  }
  return found;
}

export interface CaptureOptions {
  /** Dedicated browser profile directory — keeps this out of the user's main profile and
   *  remembers the login for next time. */
  userDataDir: string;
  /** Seconds to wait for the user to finish logging in. */
  timeoutSec?: number;
  /** Override the browser executable (tests / unusual setups). */
  executablePath?: string;
}

/**
 * Open a visible browser at the claude.ai login page and resolve with the `sessionKey` cookie
 * once the user has signed in. Uses a dedicated profile dir under the config directory so it
 * never touches the user's main browser profile and remembers the login next time.
 */
export async function captureSessionKey(opts: CaptureOptions): Promise<string> {
  const timeoutMs = (opts.timeoutSec ?? 300) * 1000;
  // Loaded lazily so `require("./auth/browserCapture")` stays cheap for unrelated commands.
  const puppeteer = (await import("puppeteer-core")).default;

  const userDataDir = opts.userDataDir;
  fs.mkdirSync(userDataDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: opts.executablePath ?? findChrome(),
    userDataDir,
    defaultViewport: null,
    args: ["--no-first-run", "--no-default-browser-check"],
  });

  try {
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    await page.goto("https://claude.ai/login", { waitUntil: "domcontentloaded" });

    console.log("\n  A browser window opened. Log in to claude.ai (password or Google/SSO).");
    console.log("  This window will close automatically once you're signed in.\n");

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const key = pickSessionKey(await browser.cookies());
      if (key) return key;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error("Timed out waiting for login. Re-run `claude-reset login` when you're ready.");
  } finally {
    await browser.close();
  }
}
