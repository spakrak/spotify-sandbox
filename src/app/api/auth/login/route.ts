import { NextResponse } from "next/server";

export const runtime = "nodejs";

function randomState(len = 24) {
  // Simple state string to prevent CSRF (good enough for your single-user sandbox)
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function GET() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "Missing SPOTIFY_CLIENT_ID or SPOTIFY_REDIRECT_URI" },
      { status: 500 }
    );
  }

  const scope = [
    "user-read-private",
    "user-read-email",
    "user-read-recently-played",
  ].join(" ");

  const state = randomState();

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scope);

  // Forces Spotify to show the consent dialog, which makes getting a refresh token more reliable while developing.
  authUrl.searchParams.set("show_dialog", "true");

  authUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authUrl);

  // Store state in an httpOnly cookie so callback can verify it.
  res.cookies.set("spotify_auth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // local dev
    path: "/",
    maxAge: 60 * 10, // 10 min
  });

  return res;
}
