"use client";

import { useEffect, useMemo, useState } from "react";

type ApiState<T> =
  | { status: "idle" | "loading"; data?: undefined; error?: undefined }
  | { status: "success"; data: T; error?: undefined }
  | { status: "error"; data?: undefined; error: string };

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString();
}

export default function Page() {
  const [auth, setAuth] = useState<ApiState<any>>({ status: "idle" });
  const [sync, setSync] = useState<ApiState<any>>({ status: "idle" });

  const [topTracks, setTopTracks] = useState<ApiState<any>>({ status: "idle" });
  const [topArtists, setTopArtists] = useState<ApiState<any>>({
    status: "idle",
  });
  const [recent, setRecent] = useState<ApiState<any>>({ status: "idle" });

  const days = 7;
  const limit = 10;

  const loadAllExplore = async () => {
    setTopTracks({ status: "loading" });
    setTopArtists({ status: "loading" });
    setRecent({ status: "loading" });

    try {
      const [tt, ta, rp] = await Promise.all([
        fetch(`/api/analytics/top-tracks?days=${days}&limit=${limit}`).then(
          (r) => r.json()
        ),
        fetch(`/api/analytics/top-artists?days=${days}&limit=${limit}`).then(
          (r) => r.json()
        ),
        fetch(`/api/plays/recent?days=${days}&limit=25`).then((r) => r.json()),
      ]);

      setTopTracks(
        tt.ok
          ? { status: "success", data: tt }
          : { status: "error", error: tt.error ?? "Failed" }
      );
      setTopArtists(
        ta.ok
          ? { status: "success", data: ta }
          : { status: "error", error: ta.error ?? "Failed" }
      );
      setRecent(
        rp.ok
          ? { status: "success", data: rp }
          : { status: "error", error: rp.error ?? "Failed" }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTopTracks({ status: "error", error: msg });
      setTopArtists({ status: "error", error: msg });
      setRecent({ status: "error", error: msg });
    }
  };

  useEffect(() => {
    (async () => {
      setAuth({ status: "loading" });
      const res = await fetch("/api/auth/status").then((r) => r.json());
      if (!res.connected) {
        setAuth({ status: "error", error: res.error ?? "Auth status failed" });
        return;
      }
      setAuth({ status: "success", data: res });
      if (res.connected) {
        await loadAllExplore();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isConnected = useMemo(
    () => auth.status === "success" && auth.data?.connected,
    [auth]
  );

  const onSync = async () => {
    setSync({ status: "loading" });
    try {
      const r = await fetch("/api/sync/recently-played");
      const text = await r.text();

      let data: any;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }

      if (!r.ok || !data?.ok) {
        setSync({
          status: "error",
          error: data?.error ?? (text || `Sync failed (status ${r.status})`),
        });
        return;
      }

      setSync({ status: "success", data });
      await loadAllExplore();

    } catch (e) {
      setSync({
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <main
      style={{
        maxWidth: 980,
        margin: "40px auto",
        padding: "0 16px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Spotify Sandbox</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Lean DB-first stats dashboard. Explore mode reads from DB only.
      </p>

      <section
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          margin: "20px 0",
        }}
      >
        {auth.status === "loading" && <span>Checking auth…</span>}
        {auth.status === "error" && (
          <span style={{ color: "tomato" }}>{auth.error}</span>
        )}
        {auth.status === "success" && (
          <>
            <span>
              Status: <b>{isConnected ? "Connected" : "Not connected"}</b>
            </span>
            {!isConnected && (
              <a
                href="/api/auth/login"
                style={{
                  padding: "8px 12px",
                  border: "1px solid #444",
                  borderRadius: 8,
                }}
              >
                Connect Spotify
              </a>
            )}
          </>
        )}

        {isConnected && (
          <button
            onClick={onSync}
            disabled={sync.status === "loading"}
            style={{
              padding: "8px 12px",
              border: "1px solid #444",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            {sync.status === "loading" ? "Syncing…" : "Sync recently played"}
          </button>
        )}

        {sync.status === "error" && (
          <span style={{ color: "tomato" }}>{sync.error}</span>
        )}
        {sync.status === "success" && (
          <span style={{ opacity: 0.8 }}>
            Synced: {sync.data?.processed ?? "?"} processed (new:{" "}
            {sync.data?.playsInserted ?? "?"})
          </span>
        )}
      </section>

      {isConnected && (
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
        >
          <Card title={`Top Tracks (${days}d)`}>
            {topTracks.status === "loading" && <div>Loading…</div>}
            {topTracks.status === "error" && (
              <div style={{ color: "tomato" }}>{topTracks.error}</div>
            )}
            {topTracks.status === "success" && (
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                {topTracks.data.items.map((t: any) => (
                  <li key={t.trackId} style={{ marginBottom: 8 }}>
                    <b>{t.name}</b>
                    <div style={{ opacity: 0.8, fontSize: 13 }}>
                      plays: {t.playCount}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title={`Top Artists (${days}d)`}>
            {topArtists.status === "loading" && <div>Loading…</div>}
            {topArtists.status === "error" && (
              <div style={{ color: "tomato" }}>{topArtists.error}</div>
            )}
            {topArtists.status === "success" && (
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                {topArtists.data.items.map((a: any) => (
                  <li key={a.artist.id} style={{ marginBottom: 8 }}>
                    <b>{a.artist.name}</b>
                    <div style={{ opacity: 0.8, fontSize: 13 }}>
                      plays: {a.playCount}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <div style={{ gridColumn: "1 / -1" }}>
            <Card title={`Recent Plays (${days}d)`}>
              {recent.status === "loading" && <div>Loading…</div>}
              {recent.status === "error" && (
                <div style={{ color: "tomato" }}>{recent.error}</div>
              )}
              {recent.status === "success" && (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {recent.data.items.map((p: any) => (
                    <li
                      key={p.playId}
                      style={{ padding: "10px 0", borderTop: "1px solid #222" }}
                    >
                      <div>
                        <b>{p.track.name}</b> —{" "}
                        {p.track.artists.map((x: any) => x.name).join(", ")}
                      </div>
                      <div style={{ opacity: 0.75, fontSize: 13 }}>
                        {fmtTime(p.playedAt)}
                        {p.contextType ? ` · ${p.contextType}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </main>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{ border: "1px solid #222", borderRadius: 12, padding: 14 }}
    >
      <h2 style={{ fontSize: 16, margin: "0 0 10px 0", opacity: 0.9 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}
