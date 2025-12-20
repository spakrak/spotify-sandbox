import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";

export const runtime = "nodejs";

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = clampInt(url.searchParams.get("limit"), 25, 1, 200);
    const days = clampInt(url.searchParams.get("days"), 30, 1, 365);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Single-user: grab the only token row for userId
    const token = await prisma.token.findFirst({ select: { userId: true } });
    if (!token) {
      return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    }

    // 1) Count plays per track in the window
    const perTrack = await prisma.play.groupBy({
      by: ["trackId"],
      where: {
        userId: token.userId,
        playedAt: { gte: since },
      },
      _count: { _all: true },
    });

    if (perTrack.length === 0) {
      return NextResponse.json({
        ok: true,
        days,
        limit,
        since: since.toISOString(),
        items: [],
        note: "No plays in this window.",
      });
    }

    const trackCountMap = new Map<string, number>();
    const trackIds: string[] = [];
    for (const row of perTrack) {
      const c = row._count._all;
      trackCountMap.set(row.trackId, c);
      trackIds.push(row.trackId);
    }

    // 2) Fetch TrackArtist rows for those tracks and roll up to artists
    const artistPlayCount = new Map<string, number>();
    const artistMeta = new Map<
      string,
      { id: string; spotifyId: string | null; name: string; uri: string | null; spotifyUrl: string | null }
    >();

    // Chunk to avoid SQLite param limits if your trackIds get large
    for (const ids of chunk(trackIds, 500)) {
      const rows = await prisma.trackArtist.findMany({
        where: { trackId: { in: ids } },
        include: {
          artist: { select: { id: true, spotifyId: true, name: true, uri: true, spotifyUrl: true } },
        },
      });

      for (const ta of rows) {
        const playsForTrack = trackCountMap.get(ta.trackId) ?? 0;
        if (playsForTrack === 0) continue;

        const prev = artistPlayCount.get(ta.artistId) ?? 0;
        artistPlayCount.set(ta.artistId, prev + playsForTrack);

        if (!artistMeta.has(ta.artistId)) {
          artistMeta.set(ta.artistId, {
            id: ta.artist.id,
            spotifyId: ta.artist.spotifyId ?? null,
            name: ta.artist.name,
            uri: ta.artist.uri ?? null,
            spotifyUrl: ta.artist.spotifyUrl ?? null,
          });
        }
      }
    }

    // 3) Sort + take top N
    const items = Array.from(artistPlayCount.entries())
      .map(([artistId, playCount]) => ({
        artist: artistMeta.get(artistId)!,
        playCount,
      }))
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, limit);

    return NextResponse.json({
      ok: true,
      days,
      limit,
      since: since.toISOString(),
      items,
      // Heads-up to prevent confusion:
      // total artist playCount can exceed total plays because collabs credit multiple artists per play.
      note: "Artist counts credit each play to every credited artist on that track (collabs will inflate totals vs raw play count).",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
