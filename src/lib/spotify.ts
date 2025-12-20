import { prisma } from "./db";

export const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function basicAuthHeader(): string {
  const clientId = requireEnv("SPOTIFY_CLIENT_ID");
  const clientSecret = requireEnv("SPOTIFY_CLIENT_SECRET");
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

/**
 * Single-user: grabs the one Token row, refreshes access token if it’s expired (or about to),
 * persists the refreshed token, and returns a valid access token.
 */
export async function getValidAccessToken() {
  const tokenRow = await prisma.token.findFirst();
  if (!tokenRow) {
    throw new Error("Not authenticated. Go to /api/auth/login first.");
  }

  // Refresh early to avoid edge timing issues
  const refreshWindowMs = 60_000;
  const isExpiredSoon = tokenRow.expiresAt.getTime() - Date.now() < refreshWindowMs;

  if (!isExpiredSoon) {
    return { userId: tokenRow.userId, accessToken: tokenRow.accessToken };
  }

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenRow.refreshToken,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${JSON.stringify(json)}`);
  }

  const newAccessToken: string = json.access_token;
  const expiresIn: number = json.expires_in;
  const newExpiresAt = new Date(Date.now() + expiresIn * 1000);

  // Sometimes Spotify returns a new refresh token, often it doesn’t.
  const maybeNewRefresh: string | undefined = json.refresh_token;

  await prisma.token.update({
    where: { userId: tokenRow.userId },
    data: {
      accessToken: newAccessToken,
      expiresAt: newExpiresAt,
      ...(maybeNewRefresh ? { refreshToken: maybeNewRefresh } : {}),
      scope: json.scope ?? tokenRow.scope,
      tokenType: json.token_type ?? tokenRow.tokenType,
    },
  });

  return { userId: tokenRow.userId, accessToken: newAccessToken };
}

export async function spotifyGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${SPOTIFY_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Spotify GET ${path} failed: ${JSON.stringify(json)}`);
  return json as T;
}
