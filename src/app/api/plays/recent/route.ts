import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";

export const runtime = "nodejs";

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // default: show a useful feed without being huge
    const limit = clampInt(url.searchParams.get("limit"), 50, 1, 200);
    const days = clampInt(url.searchParams.get("days"), 30, 1, 365);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Single-user behavior: anchor to the authenticated user if present
    const token = await prisma.token.findFirst({ select: { userId: true } });
    if (!token) {
      return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    }

    const plays = await prisma.play.findMany({
      where: {
        userId: token.userId,
        playedAt: { gte: since },
      },
      orderBy: { playedAt: "desc" },
      take: limit,
      select: {
        id: true,
        playedAt: true,
        contextType: true,
        contextUri: true,
        track: {
          select: {
            id: true,
            spotifyId: true,
            name: true,
            uri: true,
            spotifyUrl: true,
            previewUrl: true,
            durationMs: true,
            explicit: true,
            artists: {
              orderBy: { position: "asc" },
              select: {
                position: true,
                artist: {
                  select: {
                    id: true,
                    spotifyId: true,
                    name: true,
                    uri: true,
                    spotifyUrl: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const items = plays.map((p: { id: any; playedAt: { toISOString: () => any; }; contextType: any; contextUri: any; track: { id: any; spotifyId: any; name: any; uri: any; spotifyUrl: any; previewUrl: any; durationMs: any; explicit: any; artists: any[]; }; }) => ({
      playId: p.id,
      playedAt: p.playedAt.toISOString(),
      contextType: p.contextType ?? null,
      contextUri: p.contextUri ?? null,
      track: {
        id: p.track.id,
        spotifyId: p.track.spotifyId ?? null,
        name: p.track.name,
        uri: p.track.uri ?? null,
        spotifyUrl: p.track.spotifyUrl ?? null,
        previewUrl: p.track.previewUrl ?? null,
        durationMs: p.track.durationMs ?? null,
        explicit: p.track.explicit ?? null,
        artists: p.track.artists.map((ta) => ({
          position: ta.position,
          id: ta.artist.id,
          spotifyId: ta.artist.spotifyId ?? null,
          name: ta.artist.name,
          uri: ta.artist.uri ?? null,
          spotifyUrl: ta.artist.spotifyUrl ?? null,
        })),
      },
    }));

    return NextResponse.json({
      ok: true,
      days,
      limit,
      since: since.toISOString(),
      items,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
