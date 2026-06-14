import type { UsageResponse, WatcherConfig } from "./types";

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

export async function fetchUsage(config: WatcherConfig): Promise<UsageResponse> {
  const url = `${BASE_URL}/api/organizations/${config.org_id}/usage`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        ...BROWSER_HEADERS,
        Cookie: `sessionKey=${config.session_key}`,
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
