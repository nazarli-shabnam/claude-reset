import type { Account, UsageResponse } from "./types";

const BASE_URL = "https://claude.ai";

// Headers mimic the browser request fired by the claude.ai settings dashboard.
// A missing or wrong User-Agent / Referer can trigger Cloudflare bot challenges.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Referer: `${BASE_URL}/settings/limits`,
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};

// Every claude.ai account — including a solo Free/Pro account — belongs to exactly one
// internal "organization" record; that's why the usage endpoint is org-scoped. Users
// don't see this UUID anywhere in the UI, so rather than asking them to dig it out of
// DevTools we fetch it ourselves with just the session key.
export async function discoverOrgId(session_key: string): Promise<string> {
  const url = `${BASE_URL}/api/organizations`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        ...BROWSER_HEADERS,
        Cookie: `sessionKey=${session_key}`,
      },
    });
  } catch (err) {
    throw new Error(`Network error reaching ${url}: ${(err as Error).message}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(`Auth rejected (HTTP ${response.status}). Check that the session key was copied correctly.`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`Organizations endpoint returned HTTP ${response.status}: ${body}`);
  }

  const data = (await response.json()) as unknown;

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("No organizations found for this session key.");
  }

  const uuid = (data[0] as Record<string, unknown>)?.uuid;
  if (typeof uuid !== "string" || uuid === "") {
    throw new Error("Unexpected response shape from organizations endpoint.");
  }

  return uuid;
}

export async function fetchUsage(account: Pick<Account, "session_key" | "org_id">): Promise<UsageResponse> {
  const url = `${BASE_URL}/api/organizations/${account.org_id}/usage`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        ...BROWSER_HEADERS,
        Cookie: `sessionKey=${account.session_key}`,
      },
    });
  } catch (err) {
    throw new Error(`Network error reaching ${url}: ${(err as Error).message}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Auth rejected (HTTP ${response.status}). ` +
      "Your session key may have expired — re-run `claude-reset init` with a fresh key."
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`Usage endpoint returned HTTP ${response.status}: ${body}`);
  }

  const data = (await response.json()) as UsageResponse;

  if (
    typeof data?.five_hour?.utilization !== "number" ||
    typeof data?.seven_day?.utilization !== "number" ||
    typeof data?.five_hour?.resets_at !== "string" ||
    typeof data?.seven_day?.resets_at !== "string"
  ) {
    throw new Error(
      "Unexpected response shape from usage endpoint. " +
      "The private API may have changed — check for tool updates."
    );
  }

  return data;
}
