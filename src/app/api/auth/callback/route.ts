import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";

export const runtime = "nodejs";

function basicAuthHeader(clientId: string, clientSecret: string) {
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  return `Basic ${creds}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  if (!code || !state) {
    return NextResponse.json(
      { error: "Missing code or state in callback URL" },
      { status: 400 }
    );
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { error: "Missing Spotify env vars" },
      { status: 500 }
    );
  }

  // Validate state cookie
  const cookieHeader = req.headers.get("cookie") ?? "";
  const stateCookie = cookieHeader
    .split(";")
    .map((s) => s.trim())
    .find((c) => c.startsWith("spotify_auth_state="))
    ?.split("=")[1];

  if (!stateCookie || stateCookie !== state) {
    return NextResponse.json(
      { error: "State mismatch. Try /api/auth/login again." },
      { status: 400 }
    );
  }

  // Exchange code -> tokens
  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  const tokenJson = await tokenRes.json();

  if (!tokenRes.ok) {
    return NextResponse.json(
      { error: "Token exchange failed", details: tokenJson },
      { status: 500 }
    );
  }

  const accessToken: string = tokenJson.access_token;
  const refreshToken: string | undefined = tokenJson.refresh_token;
  const expiresIn: number = tokenJson.expires_in; // seconds
  const scope: string | undefined = tokenJson.scope;
  const tokenType: string | undefined = tokenJson.token_type;

  // Verify token works by calling /me
  const meRes = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const me = await meRes.json();

  if (!meRes.ok) {
    return NextResponse.json(
      { error: "Spotify /me failed", details: me },
      { status: 500 }
    );
  }

  const userId: string = me.id;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  // Upsert user profile
  await prisma.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      displayName: me.display_name ?? null,
      email: me.email ?? null,
      country: me.country ?? null,
      product: me.product ?? null,
      imageUrl: me.images?.[0]?.url ?? null,
    },
    update: {
      displayName: me.display_name ?? null,
      email: me.email ?? null,
      country: me.country ?? null,
      product: me.product ?? null,
      imageUrl: me.images?.[0]?.url ?? null,
    },
  });

  // Upsert token row (keyed by userId)
  await prisma.token.upsert({
    where: { userId },
    create: {
      userId,
      accessToken,
      refreshToken: refreshToken ?? "", // should exist on first consent; we force consent in /login
      expiresAt,
      scope,
      tokenType,
    },
    update: {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}), // don't erase refresh token if Spotify didn't return it
      expiresAt,
      scope,
      tokenType,
    },
  });

  const res = NextResponse.json({
    ok: true,
    message: "Spotify connected",
    user: {
      id: userId,
      displayName: me.display_name,
      email: me.email,
    },
    expiresAt,
  });

  // Clear the state cookie now that it's used
  res.cookies.set("spotify_auth_state", "", { path: "/", maxAge: 0 });

  return res;
}
