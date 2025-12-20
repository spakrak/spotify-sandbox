import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { getValidAccessToken, spotifyGet } from "../../../../lib/spotify";

export const runtime = "nodejs";

type RecentlyPlayedResponse = {
  items: Array<{
    played_at: string;
    context: null | { type: string; uri: string };
    track: {
      id: string | null;
      name: string;
      uri: string;
      is_local: boolean;
      duration_ms: number;
      explicit: boolean;
      popularity?: number;
      preview_url: string | null;
      external_ids?: { isrc?: string };
      external_urls?: { spotify?: string };
      artists: Array<{
        id: string | null;
        name: string;
        uri: string;
        external_urls?: { spotify?: string };
      }>;
    };
  }>;
};

export async function GET() {
  const startedAt = new Date();

  // We'll fill these as we go so every run tells you exactly what happened.
  const summary = {
    ok: false,
    cursorUsed: null as string | null,
    spotifyFetched: 0,
    processed: 0,
    skippedLocalOrMissingTrackId: 0,
    tracksTouched: 0,
    artistsTouched: 0,
    playsInserted: 0,
    playsAlreadyPresent: 0,
    minPlayedAt: null as string | null,
    maxPlayedAt: null as string | null,
    newCursor: null as string | null,
    startedAt: startedAt.toISOString(),
    finishedAt: null as string | null,
  };

  try {
    const { userId, accessToken } = await getValidAccessToken();

    // 1) Read the cursor (singleton row)
    const state = await prisma.syncState.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });

    const afterMs = state.recentlyPlayedAfter
      ? state.recentlyPlayedAfter.getTime()
      : null;

    summary.cursorUsed = state.recentlyPlayedAfter
      ? state.recentlyPlayedAfter.toISOString()
      : null;

    // 2) Call Spotify, using the cursor if we have it
    const path =
      afterMs !== null
        ? `/me/player/recently-played?limit=50&after=${afterMs}`
        : `/me/player/recently-played?limit=50`;

    const data = await spotifyGet<RecentlyPlayedResponse>(path, accessToken);

    summary.spotifyFetched = data.items.length;

    if (data.items.length > 0) {
      const playedDates = data.items.map((i) => new Date(i.played_at));
      const min = new Date(Math.min(...playedDates.map((d) => d.getTime())));
      const max = new Date(Math.max(...playedDates.map((d) => d.getTime())));
      summary.minPlayedAt = min.toISOString();
      summary.maxPlayedAt = max.toISOString();
    }

    // Track “touched” counts using sets (cheap + honest).
    const trackSpotifyIds = new Set<string>();
    const artistSpotifyIds = new Set<string>();

    let newestPlayedAt: Date | null = state.recentlyPlayedAfter ?? null;

    for (const item of data.items) {
      const playedAt = new Date(item.played_at);
      const t = item.track;

      // Skip local tracks / missing Spotify track id to keep V0 sane
      if (!t.id) {
        summary.skippedLocalOrMissingTrackId++;
        continue;
      }

      trackSpotifyIds.add(t.id);
      for (const a of t.artists) {
        if (a.id) artistSpotifyIds.add(a.id);
      }

      // 3) Upsert Track + Artists + join table (you already had this working)
      const trackRow = await prisma.track.upsert({
        where: { spotifyId: t.id },
        create: {
          spotifyId: t.id,
          name: t.name,
          uri: t.uri,
          isLocal: t.is_local,
          durationMs: t.duration_ms,
          explicit: t.explicit,
          popularity: t.popularity ?? null,
          previewUrl: t.preview_url,
          isrc: t.external_ids?.isrc ?? null,
          spotifyUrl: t.external_urls?.spotify ?? null,
        },
        update: {
          name: t.name,
          uri: t.uri,
          isLocal: t.is_local,
          durationMs: t.duration_ms,
          explicit: t.explicit,
          popularity: t.popularity ?? null,
          previewUrl: t.preview_url,
          isrc: t.external_ids?.isrc ?? null,
          spotifyUrl: t.external_urls?.spotify ?? null,
        },
      });

      for (let i = 0; i < t.artists.length; i++) {
        const a = t.artists[i];
        if (!a.id) continue;

        const artistRow = await prisma.artist.upsert({
          where: { spotifyId: a.id },
          create: {
            spotifyId: a.id,
            name: a.name,
            uri: a.uri,
            spotifyUrl: a.external_urls?.spotify ?? null,
          },
          update: {
            name: a.name,
            uri: a.uri,
            spotifyUrl: a.external_urls?.spotify ?? null,
          },
        });

        await prisma.trackArtist.upsert({
          where: {
            trackId_artistId: {
              trackId: trackRow.id,
              artistId: artistRow.id,
            },
          },
          create: {
            trackId: trackRow.id,
            artistId: artistRow.id,
            position: i,
          },
          update: { position: i },
        });
      }

      // 4) Insert Play with dedupe, but keep it simple and *accurate*
      // We do a findUnique first so we can report inserted vs already present.
      const existing = await prisma.play.findUnique({
        where: {
          userId_trackId_playedAt: {
            userId,
            trackId: trackRow.id,
            playedAt,
          },
        },
        select: { id: true },
      });

      if (existing) {
        summary.playsAlreadyPresent++;
      } else {
        await prisma.play.create({
          data: {
            userId,
            trackId: trackRow.id,
            playedAt,
            contextType: item.context?.type ?? null,
            contextUri: item.context?.uri ?? null,
          },
        });
        summary.playsInserted++;
      }

      summary.processed++;

      if (!newestPlayedAt || playedAt > newestPlayedAt) {
        newestPlayedAt = playedAt;
      }
    }

    summary.tracksTouched = trackSpotifyIds.size;
    summary.artistsTouched = artistSpotifyIds.size;

    // 5) Advance cursor only if we actually saw newer data
    if (newestPlayedAt && (!state.recentlyPlayedAfter || newestPlayedAt > state.recentlyPlayedAfter)) {
      await prisma.syncState.update({
        where: { id: 1 },
        data: {
          recentlyPlayedAfter: newestPlayedAt,
          lastRunAt: new Date(),
          lastStatus: "ok",
          lastError: null,
        },
      });
      summary.newCursor = newestPlayedAt.toISOString();
    } else {
      await prisma.syncState.update({
        where: { id: 1 },
        data: {
          lastRunAt: new Date(),
          lastStatus: "ok",
          lastError: null,
        },
      });
      summary.newCursor = state.recentlyPlayedAfter
        ? state.recentlyPlayedAfter.toISOString()
        : null;
    }

    summary.ok = true;
    summary.finishedAt = new Date().toISOString();
    return NextResponse.json(summary);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    // Record failure so you can see it later without reading terminal logs
    await prisma.syncState.upsert({
      where: { id: 1 },
      create: { id: 1, lastRunAt: new Date(), lastStatus: "error", lastError: msg },
      update: { lastRunAt: new Date(), lastStatus: "error", lastError: msg },
    });

    summary.finishedAt = new Date().toISOString();
    return NextResponse.json({ ...summary, ok: false, error: msg }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}