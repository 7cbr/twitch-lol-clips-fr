import {
  TwitchTokenResponse,
  TwitchClip,
  TwitchPaginatedResponse,
} from "@/types/twitch";
import { LOL_GAME_ID, DAYS_TO_FETCH } from "./constants";

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

export async function getAppToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID!,
      client_secret: process.env.TWITCH_CLIENT_SECRET!,
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to get Twitch token: ${res.status}`);
  }

  const data: TwitchTokenResponse = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;
  return cachedToken;
}

async function twitchFetch(url: string): Promise<Response> {
  const token = await getAppToken();
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Client-Id": process.env.TWITCH_CLIENT_ID!,
    },
  });
}

async function fetchClipsForRange(
  startedAt: string,
  endedAt: string
): Promise<TwitchClip[]> {
  const clips: TwitchClip[] = [];
  let cursor: string | undefined;

  for (;;) {
    const url = new URL("https://api.twitch.tv/helix/clips");
    url.searchParams.set("game_id", LOL_GAME_ID);
    url.searchParams.set("first", "100");
    url.searchParams.set("started_at", startedAt);
    url.searchParams.set("ended_at", endedAt);
    if (cursor) url.searchParams.set("after", cursor);

    const res = await twitchFetch(url.toString());
    if (!res.ok) throw new Error(`Failed to get clips: ${res.status}`);

    const data: TwitchPaginatedResponse<TwitchClip> = await res.json();
    clips.push(...data.data.filter((c) => c.language === "fr"));

    cursor = data.pagination?.cursor;
    if (!cursor || data.data.length === 0) break;
  }

  return clips;
}

export async function getAllFrenchClips(): Promise<TwitchClip[]> {
  const now = new Date();

  // Split into 30-minute ranges to work around Twitch API pagination limits.
  // The API stops returning cursors after ~1000 results per query.
  // During prime time, even 1-hour windows can exceed 1000 global LoL clips,
  // burying low-view FR clips. 30-min windows keep each query well under the limit.
  // d=0 is today, d=1 is yesterday, ..., d=DAYS_TO_FETCH is 3 days ago
  const MINUTES_PER_RANGE = 30;
  const ranges: { start: string; end: string }[] = [];
  for (let d = 0; d <= DAYS_TO_FETCH; d++) {
    for (let m = 0; m < 24 * 60; m += MINUTES_PER_RANGE) {
      const start = new Date(now);
      start.setDate(start.getDate() - d);
      start.setHours(0, 0, 0, 0);
      start.setMinutes(m);
      const end = new Date(start.getTime() + MINUTES_PER_RANGE * 60 * 1000);
      // Skip future ranges
      if (start.getTime() > now.getTime()) continue;
      // Clamp end to now
      if (end.getTime() > now.getTime()) {
        ranges.push({ start: start.toISOString(), end: now.toISOString() });
      } else {
        ranges.push({ start: start.toISOString(), end: end.toISOString() });
      }
    }
  }

  // Fetch in batches of 15 to avoid Twitch rate limits (800 req/min)
  const CONCURRENCY = 15;
  const results: TwitchClip[][] = [];
  for (let i = 0; i < ranges.length; i += CONCURRENCY) {
    const batch = ranges.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((r) => fetchClipsForRange(r.start, r.end))
    );
    results.push(...batchResults);
  }

  const allClips = results.flat();

  // Deduplicate by clip id (ranges might overlap at boundaries)
  const seen = new Set<string>();
  const unique = allClips.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  // Default sort: most viewed
  unique.sort((a, b) => b.view_count - a.view_count);

  return unique;
}
