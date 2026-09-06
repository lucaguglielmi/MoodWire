"use client";

import { useEffect, useMemo, useState } from "react";

type Board = { id: string; name: string; description?: string; pin_count?: number };
type Media = { url: string; kind: "image" | "video" | "gif" | "stream" };
type Pin = { id: string; title?: string; description?: string; _media?: Media[]; [key: string]: unknown };

export default function Home() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [boardId, setBoardId] = useState("");
  const [pins, setPins] = useState<Pin[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState("");

  const selectedBoard = boards.find((b) => b.id === boardId);

  async function loadBoards() {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/pinterest/boards");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error === "not_connected" ? "Pinterest is not connected yet." : data.error);
      setBoards(data.items ?? []);
      const target = (data.items ?? []).find((b: Board) => b.name.toLowerCase() === "css animation reference");
      if (target) setBoardId(target.id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function loadPins() {
    if (!boardId) return;
    setLoading(true); setError(""); setAnalysis("");
    try {
      const r = await fetch(`/api/pinterest/pins?boardId=${encodeURIComponent(boardId)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setPins(data.items ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const stats = useMemo(() => {
    const media = pins.flatMap((p) => p._media ?? []);
    return {
      pins: pins.length,
      images: media.filter((m) => m.kind === "image").length,
      gifs: media.filter((m) => m.kind === "gif").length,
      videos: media.filter((m) => m.kind === "video" || m.kind === "stream").length,
    };
  }, [pins]);

  async function analyse() {
    setLoading(true); setError("");
    try {
      const urls = pins.flatMap((p) => p._media ?? []).filter((m) => m.kind === "image" || m.kind === "gif").map((m) => m.url);
      const unique = [...new Set(urls)].slice(0, 20);
      const r = await fetch("/api/analyse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageUrls: unique, boardName: selectedBoard?.name }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setAnalysis(data.analysis ?? "");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadBoards(); }, []);

  return (
    <main>
      <h1>MoodWire</h1>
      <p className="muted">Connect Pinterest, select a project board, and inspect the visual references available to AI. <strong>CSS animation reference</strong> is selected automatically when available.</p>

      <section className="panel">
        <div className="toolbar">
          <a className="button" href="/api/pinterest/oauth">Connect Pinterest</a>
          <button className="secondary" onClick={loadBoards} disabled={loading}>Refresh boards</button>
          <select value={boardId} onChange={(e) => setBoardId(e.target.value)}>
            <option value="">Choose a board…</option>
            {boards.map((b) => <option key={b.id} value={b.id}>{b.name}{typeof b.pin_count === "number" ? ` (${b.pin_count})` : ""}</option>)}
          </select>
          <button onClick={loadPins} disabled={!boardId || loading}>Fetch pins</button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      {pins.length > 0 && <>
        <section className="panel">
          <div className="toolbar">
            <span className="badge">{stats.pins} pins</span>
            <span className="badge">{stats.images} image URLs</span>
            <span className="badge">{stats.gifs} GIF URLs</span>
            <span className="badge">{stats.videos} video/stream URLs</span>
            <button onClick={analyse} disabled={loading}>Analyse visual DNA</button>
          </div>
          <p className="muted">The cards deliberately show the raw media type Pinterest actually returned. This answers the animation question before we build a more elaborate ingestion pipeline.</p>
        </section>

        {analysis && <section className="panel"><h2>Visual DNA</h2><div className="analysis">{analysis}</div></section>}

        <div className="grid">
          {pins.map((pin) => {
            const media = pin._media ?? [];
            const preferred = media.find((m) => m.kind === "video") ?? media.find((m) => m.kind === "gif") ?? media.find((m) => m.kind === "image") ?? media[0];
            return <article className="card" key={pin.id}>
              <div className="media">
                {preferred?.kind === "video" ? <video src={preferred.url} controls muted loop playsInline /> : preferred ? <img src={preferred.url} alt={pin.title ?? "Pinterest reference"} /> : <span>No media URL</span>}
              </div>
              <div className="card-body">
                <h3>{pin.title || `Pin ${pin.id}`}</h3>
                {media.slice(0, 6).map((m, i) => <span className="badge" key={`${m.url}-${i}`}>{m.kind}</span>)}
                <details><summary>Raw API object</summary><pre>{JSON.stringify(pin, null, 2)}</pre></details>
              </div>
            </article>;
          })}
        </div>
      </>}
    </main>
  );
}
