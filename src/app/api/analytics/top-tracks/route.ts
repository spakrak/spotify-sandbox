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

    const days = clampInt(url.searchParams.get("days"), 30, 1, 365);
    const limit = clampInt(url.searchParams.get("limit"), 20, 1, 100);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Count a concrete column Prisma can type-check everywhere: Play.id
    const grouped = await prisma.play.groupBy({
      by: ["trackId"],
      where: {
        playedAt: { gte: since },
      },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: limit,
    });

    const trackIds = grouped.map((g) => g.trackId);

    if (trackIds.length === 0) {
      return NextResponse.json({
        ok: true,
        days,
        limit,
        since: since.toISOString(),
        items: [],
      });
    }

    const tracks = await prisma.track.findMany({
      where: { id: { in: trackIds } },
      select: {
        id: true,
        spotifyId: true,
        name: true,
        uri: true,
        spotifyUrl: true,
        previewUrl: true,
        durationMs: true,
        explicit: true,
      },
    });

    const trackById = new Map(tracks.map((t) => [t.id, t]));

    const items = grouped.map((g) => {
      const t = trackById.get(g.trackId);
      return {
        trackId: g.trackId,
        spotifyId: t?.spotifyId ?? null,
        name: t?.name ?? null,
        uri: t?.uri ?? null,
        spotifyUrl: t?.spotifyUrl ?? null,
        previewUrl: t?.previewUrl ?? null,
        durationMs: t?.durationMs ?? null,
        explicit: t?.explicit ?? null,
        playCount: g._count.id,
      };
    });

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
