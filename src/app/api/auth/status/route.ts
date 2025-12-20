import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";

export const runtime = "nodejs";

function basicAuthHeader(clientId: string, clientSecret: string) {
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  return `Basic ${creds}`;
}

export async function GET() {
  const tokenRow = await prisma.token.findFirst();

  if (!tokenRow) {
    return NextResponse.json({ connected: false });
  }

  const user = await prisma.user.findUnique({ where: { id: tokenRow.userId } });

  const now = Date.now();
  const expiresAtMs = tokenRow.expiresAt.getTime();
  const isExpiredSoon = expiresAtMs - now < 60_000; // < 60 seconds

  if (!isExpiredSoon) {
    return NextResponse.json({
      connected: true,
      user,
      expiresAt: tokenRow.expiresAt,
    });
  }

  // Refresh access token
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Missing Spotify client env vars" },
      { status: 500 }
    );
  }

  const refreshRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenRow.refreshToken,
    }),
  });

  const refreshJson = await refreshRes.json();

  if (!refreshRes.ok) {
    return NextResponse.json(
      { error: "Refresh failed", details: refreshJson },
      { status: 500 }
    );
  }

  const accessToken: string = refreshJson.access_token;
  const expiresIn: number = refreshJson.expires_in;
  const scope: string | undefined = refreshJson.scope;
  const tokenType: string | undefined = refreshJson.token_type;
  const maybeNewRefresh: string | undefined = refreshJson.refresh_token;

  const newExpiresAt = new Date(Date.now() + expiresIn * 1000);

  await prisma.token.update({
    where: { userId: tokenRow.userId },
    data: {
      accessToken,
      expiresAt: newExpiresAt,
      scope,
      tokenType,
      ...(maybeNewRefresh ? { refreshToken: maybeNewRefresh } : {}),
    },
  });

  return NextResponse.json({
    connected: true,
    user,
    refreshed: true,
    expiresAt: newExpiresAt,
  });
}
