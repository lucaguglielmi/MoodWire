"use client";

import { useEffect, useMemo, useState } from "react";

type Board = { id: string; name: string; description?: string; pin_count?: number };
type Media = { url: string; kind: "image" | "video" | "gif" | "stream" };
type Pin = { id: string; title?: string; description?: string; source_url?: string; _media?: Media[]; [key: string]: unknown };
type Issue = { code?: string; user_message?: string; detail?: string; action?: string; retryable?: boolean; request_id?: string };

type ResolvePin = {
  id: string;
  title?: string | null;
  description?: string | null;
  source_url?: string;
  media?: Array<{ url: string; type: Media["kind"] }>;
};

const DEFAULT_SUGGESTIONS = [
  "Use the selected references to create an original image without copying any one source.",
  "Analyse the selected references for composition, material, lighting, typography, shape and motion cues.",
  "Turn the selected references into an original 3D asset brief for a game.",
  "Use the selected references to propose an original animated logo direction.",
];

function fromResolvedPin(pin: ResolvePin): Pin {
  return { ...pin, title: pin.title ?? undefined, description: pin.description ?? undefined, _media: (pin.media ?? []).map((m) => ({ url: m.url, kind: m.type })) };
}

function issueFromResponse(data: { issue?: Issue; error?: string }, fallback: string): Issue {
  if (data.issue) return data.issue;
  return { code: "REQUEST_FAILED", user_message: data.error || fallback, retryable: true, action: "Retry once. If it fails again, reconnect Pinterest." };
}

export default function Home() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [boardId, setBoardId] = useState("");
  const [pins, setPins] = useState<Pin[]>([]);
  const [referenceUrl, setReferenceUrl] = useState("");
  const [resolvedLabel, setResolvedLabel] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [issue, setIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [copied, setCopied] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS);
  const [copiedSuggestion, setCopiedSuggestion] = useState<number | null>(null);

  const selectedBoard = boards.find((b) => b.id === boardId);

  async function loadBoards(silent = false) {
    if (!silent) setLoading(true);
    setIssue(null);
    try {
      const started = performance.now();
      const r = await fetch("/api/pinterest/boards");
      const data = await r.json();
      if (!r.ok) {
        if (r.status === 401 && silent) {
          setStatus("Pinterest is not connected yet.");
          return;
        }
        throw issueFromResponse(data, "Could not load Pinterest boards");
      }
      setBoards(data.items ?? []);
      const target = (data.items ?? []).find((b: Board) => b.name.toLowerCase() === "css animation reference");
      if (target) setBoardId(target.id);
      setStatus(`Loaded ${(data.items ?? []).length} boards in ${Math.round(performance.now() - started)} ms.`);
    } catch (e) {
      setIssue(typeof e === "object" && e && "user_message" in e ? e as Issue : { user_message: e instanceof Error ? e.message : String(e), retryable: true });
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadPins() {
    if (!boardId) return;
    setLoading(true); setIssue(null); setAnalysis(""); setSelected(new Set()); setStatus("Fetching board preview…");
    try {
      const started = performance.now();
      const r = await fetch(`/api/pinterest/pins?boardId=${encodeURIComponent(boardId)}`);
      const data = await r.json();
      if (!r.ok) throw issueFromResponse(data, "Could not load this board");
      setPins(data.items ?? []);
      setResolvedLabel(selectedBoard?.name ?? "Pinterest board");
      setSuggestions(DEFAULT_SUGGESTIONS);
      setStatus(`Loaded ${(data.items ?? []).length} references in ${Math.round(performance.now() - started)} ms.`);
    } catch (e) {
      setIssue(typeof e === "object" && e && "user_message" in e ? e as Issue : { user_message: e instanceof Error ? e.message : String(e), retryable: true });
      setStatus("");
    } finally { setLoading(false); }
  }

  async function resolveUrl() {
    if (!referenceUrl.trim()) return;
    setLoading(true); setIssue(null); setAnalysis(""); setSelected(new Set()); setStatus("Resolving Pinterest reference…");
    try {
      const started = performance.now();
      const r = await fetch("/api/pinterest/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: referenceUrl.trim(), limit: 48 }),
      });
      const data = await r.json();
      if (!r.ok) throw issueFromResponse(data, "Could not resolve Pinterest reference");

      if (data.kind === "board") {
        const nextPins = (data.pins ?? []).map(fromResolvedPin);
        setPins(nextPins);
        setResolvedLabel(data.board?.name ?? "Pinterest board");
        setSuggestions(data.suggestions ?? DEFAULT_SUGGESTIONS);
        setStatus(`Loaded ${nextPins.length} reference${nextPins.length === 1 ? "" : "s"} in ${data.duration_ms ?? Math.round(performance.now() - started)} ms.`);
      } else if (data.kind === "pin") {
        const pin = fromResolvedPin(data.pin);
        setPins([pin]);
        setSelected(new Set([pin.id]));
        setResolvedLabel(data.pin?.title || `Pin ${data.pin?.id}`);
        setSuggestions(data.suggestions ?? DEFAULT_SUGGESTIONS);
        setStatus(`Reference ready in ${data.duration_ms ?? Math.round(performance.now() - started)} ms.`);
      } else if (data.kind === "media") {
        const id = `media:${data.resolved_url}`;
        setPins([{ id, title: "Direct Pinterest media", source_url: data.resolved_url, _media: (data.media ?? []).map((m: { url: string; type: Media["kind"] }) => ({ url: m.url, kind: m.type })) }]);
        setSelected(new Set([id]));
        setResolvedLabel("Direct Pinterest media");
        setSuggestions(data.suggestions ?? DEFAULT_SUGGESTIONS);
        setStatus(`Reference ready in ${data.duration_ms ?? Math.round(performance.now() - started)} ms.`);
      }
    } catch (e) {
      setIssue(typeof e === "object" && e && "user_message" in e ? e as Issue : { user_message: e instanceof Error ? e.message : String(e), retryable: true });
      setStatus("");
    } finally { setLoading(false); }
  }

  const stats = useMemo(() => {
    const media = pins.flatMap((p) => p._media ?? []);
    return { pins: pins.length, images: media.filter((m) => m.kind === "image").length, gifs: media.filter((m) => m.kind === "gif").length, videos: media.filter((m) => m.kind === "video" || m.kind === "stream").length };
  }, [pins]);

  const selectedPins = pins.filter((pin) => selected.has(pin.id));

  function togglePin(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function copyManifest() {
    const manifest = selectedPins.map((pin) => ({
      reference_id: pin.id.startsWith("media:") ? pin.id : `mw:pin:${pin.id}`,
      pin_id: /^\d+$/.test(pin.id) ? pin.id : undefined,
      title: pin.title,
      source_url: pin.source_url ?? (/^\d+$/.test(pin.id) ? `https://www.pinterest.com/pin/${pin.id}/` : undefined),
      media: pin._media,
    }));
    await navigator.clipboard.writeText(JSON.stringify({ references: manifest }, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function copySuggestion(text: string, index: number) {
    const context = selected.size > 0 ? `Use references ${[...selected].map((id) => /^\d+$/.test(id) ? `mw:pin:${id}` : id).join(", ")}. ` : "";
    await navigator.clipboard.writeText(`${context}${text}`);
    setCopiedSuggestion(index);
    window.setTimeout(() => setCopiedSuggestion(null), 1500);
  }

  async function analyse() {
    setLoading(true); setIssue(null); setStatus("Analysing selected references…");
    try {
      const source = selectedPins.length ? selectedPins : pins;
      const urls = source.flatMap((p) => p._media ?? []).filter((m) => m.kind === "image" || m.kind === "gif").map((m) => m.url);
      const unique = [...new Set(urls)].slice(0, 20);
      if (!unique.length) throw { user_message: "No static image or poster is available for the selected references.", retryable: false, action: "Choose another reference or wait for video frame extraction support." } satisfies Issue;
      const r = await fetch("/api/analyse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageUrls: unique, boardName: resolvedLabel || selectedBoard?.name }) });
      const data = await r.json();
      if (!r.ok) throw issueFromResponse(data, "Reference analysis failed");
      setAnalysis(data.analysis ?? "");
      setStatus(`Analysed ${unique.length} visual reference${unique.length === 1 ? "" : "s"}.`);
    } catch (e) {
      setIssue(typeof e === "object" && e && "user_message" in e ? e as Issue : { user_message: e instanceof Error ? e.message : String(e), retryable: true });
      setStatus("");
    } finally { setLoading(false); }
  }

  useEffect(() => { void loadBoards(true); }, []);

  return (
    <main>
      <h1>MoodWire</h1>
      <p className="muted">Turn Pinterest boards, Pins and animation references into visual context an AI can actually use.</p>

      <section className="panel">
        <h2>Paste any Pinterest reference</h2>
        <div className="url-row">
          <input value={referenceUrl} onChange={(e) => setReferenceUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void resolveUrl(); }} placeholder="https://www.pinterest.com/... or https://pin.it/..." aria-label="Pinterest reference URL" />
          <button onClick={resolveUrl} disabled={loading || !referenceUrl.trim()}>{loading ? "Working…" : "Fetch reference"}</button>
        </div>
        <p className="muted small">Supports board URLs, individual Pin URLs, pin.it short links and direct pinimg media URLs. Board links load a 48-item preview first for speed.</p>
        {status && <p className="status" aria-live="polite">{status}</p>}
        {issue && <div className="issue" role="alert"><strong>{issue.user_message || "Something went wrong."}</strong>{issue.action && <span>{issue.action}</span>}{issue.request_id && <code>Request {issue.request_id}</code>}{issue.detail && <details><summary>Technical detail</summary><pre>{issue.detail}</pre></details>}{issue.retryable && referenceUrl.trim() && <button className="secondary" onClick={resolveUrl}>Retry</button>}</div>}
      </section>

      <section className="panel compact">
        <div className="toolbar">
          <a className="button secondary-link" href="/api/pinterest/oauth">Connect Pinterest</a>
          <button className="secondary" onClick={() => void loadBoards()} disabled={loading}>Refresh boards</button>
          <select value={boardId} onChange={(e) => setBoardId(e.target.value)}>
            <option value="">Or choose one of your boards…</option>
            {boards.map((b) => <option key={b.id} value={b.id}>{b.name}{typeof b.pin_count === "number" ? ` (${b.pin_count})` : ""}</option>)}
          </select>
          <button onClick={loadPins} disabled={!boardId || loading}>Fetch board</button>
        </div>
      </section>

      {pins.length > 0 && <>
        <section className="panel">
          <div className="results-head">
            <div><h2>{resolvedLabel || "References"}</h2><p className="muted">Select the references you want to carry into the next creative task.</p></div>
            <div className="toolbar"><span className="badge">{stats.pins} pins</span><span className="badge">{stats.images} images</span><span className="badge">{stats.gifs} GIFs</span><span className="badge">{stats.videos} video/streams</span></div>
          </div>
          {selected.size > 0 && <div className="selection-bar"><strong>{selected.size} selected</strong><button className="secondary" onClick={copyManifest}>{copied ? "Copied" : "Copy reference manifest"}</button><button onClick={analyse} disabled={loading}>Analyse selected</button><button className="secondary" onClick={() => setSelected(new Set())}>Clear</button></div>}
        </section>

        {selected.size > 0 && <section className="panel suggestions"><h2>Suggested next actions</h2><p className="muted small">MoodWire keeps these as prompts rather than deciding what the references mean for you.</p><ol>{suggestions.map((text, index) => <li key={`${text}-${index}`}><span>{text}</span><button className="secondary mini" onClick={() => void copySuggestion(text, index)}>{copiedSuggestion === index ? "Copied" : "Copy prompt"}</button></li>)}</ol></section>}

        {analysis && <section className="panel"><h2>Reference analysis</h2><div className="analysis">{analysis}</div></section>}

        <div className="grid">
          {pins.map((pin, index) => {
            const media = pin._media ?? [];
            const preferred = media.find((m) => m.kind === "video") ?? media.find((m) => m.kind === "gif") ?? media.find((m) => m.kind === "image") ?? media[0];
            const isSelected = selected.has(pin.id);
            return <article className={`card selectable ${isSelected ? "selected" : ""}`} key={pin.id} onClick={() => togglePin(pin.id)} aria-pressed={isSelected}>
              <div className="index">{index + 1}</div><div className="check" aria-hidden="true">{isSelected ? "✓" : ""}</div>
              <div className="media">{preferred?.kind === "video" ? <video src={preferred.url} controls muted loop playsInline preload="metadata" onClick={(e) => e.stopPropagation()} /> : preferred ? <img src={preferred.url} alt={pin.title ?? "Pinterest reference"} loading="lazy" decoding="async" /> : <span>No media URL</span>}</div>
              <div className="card-body"><h3>{pin.title || `Pin ${pin.id}`}</h3>{media.slice(0, 4).map((m, i) => <span className="badge" key={`${m.url}-${i}`}>{m.kind}</span>)}<div className="reference-id">{pin.id.startsWith("media:") ? "direct media" : `mw:pin:${pin.id}`}</div></div>
            </article>;
          })}
        </div>
      </>}
    </main>
  );
}
