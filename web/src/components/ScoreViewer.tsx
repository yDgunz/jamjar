import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { renderScore } from "../score/renderer";

const ZOOM_KEY = "jamjar.scoreZoom";
const clampZoom = (v: number) => Math.min(80, Math.max(20, v));

// The zoom the reader chose, if they ever changed it (remembered per device).
function savedZoom(): number | null {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY));
    return Number.isFinite(v) && v > 0 ? clampZoom(v) : null;
  } catch {
    return null;
  }
}

// Until they choose: full size on a wide screen, smaller on a phone so a line
// still holds a few bars.
const autoZoom = (width: number) => clampZoom(Math.round((width * 100) / 1600 / 5) * 5 || 40);
const fitZoom = (width: number) => Math.min(40, autoZoom(width));

interface Props {
  songId: number;
  format: "musicxml" | "mxl";
  /** Changes whenever the stored score changes, so a replaced score is re-fetched. */
  version: string | null;
}

/** Notated sheet music for a song: a MusicXML file drawn in the browser, on a white page. */
export default function ScoreViewer({ songId, format, version }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [pages, setPages] = useState<string[]>([]); // blob: URLs, one per drawn page
  const [width, setWidth] = useState(0);
  const [chosenZoom, setChosenZoom] = useState(savedZoom);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setBusy(true);
    fetch(api.songScoreUrl(songId), { credentials: "include" })
      .then((resp) => {
        if (!resp.ok) throw new Error(`the score could not be loaded (${resp.status})`);
        return resp.arrayBuffer();
      })
      .then(
        (buf) => { if (!cancelled) setData(buf); },
        (e: Error) => { if (!cancelled) { setError(e.message); setBusy(false); } },
      );
    return () => { cancelled = true; };
  }, [songId, version]);

  // Redraw when the available width changes (window resize, rotation, full screen).
  useEffect(() => {
    const el = scrollRef.current!;
    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(() => setWidth(Math.floor(el.clientWidth)), 200);
    });
    observer.observe(el);
    setWidth(Math.floor(el.clientWidth));
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, []);

  const zoom = chosenZoom ?? fitZoom(width);

  useEffect(() => {
    if (!data || width === 0) return;
    let cancelled = false;
    setBusy(true);
    renderScore(data, format, width, zoom)
      .then(
        (svgs) => {
          if (cancelled) return;
          // Scores are uploaded files, so the drawn SVG is never put in the page's
          // DOM: it is shown through <img>, where scripts and links cannot run.
          setPages(svgs.map((svg) => URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }))));
          setError(null);
        },
        (e: Error) => {
          if (cancelled) return;
          setPages([]);
          setError(e.message);
        },
      )
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [data, format, width, zoom]);

  // Free each set of page images once it is replaced or the viewer goes away.
  useEffect(() => () => pages.forEach((url) => URL.revokeObjectURL(url)), [pages]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [full]);

  const changeZoom = (next: number) => {
    const v = clampZoom(next);
    setChosenZoom(v);
    try { localStorage.setItem(ZOOM_KEY, String(v)); } catch { /* private mode */ }
  };

  const button =
    "flex h-8 w-8 items-center justify-center rounded-md bg-white/90 text-gray-700 shadow ring-1 ring-gray-300 hover:bg-white hover:text-gray-950 disabled:opacity-40";

  return (
    <div
      className={
        full
          ? "fixed inset-0 z-50 bg-white"
          : "relative overflow-hidden rounded-lg bg-white"
      }
    >
      <div className="absolute right-3 top-2 z-10 flex gap-1.5">
        <button className={button} onClick={() => changeZoom(zoom - 5)} disabled={zoom <= 20} aria-label="Smaller notes" title="Smaller">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M5 12h14" /></svg>
        </button>
        <button className={button} onClick={() => changeZoom(zoom + 5)} disabled={zoom >= 80} aria-label="Larger notes" title="Larger">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
        </button>
        <button className={button} onClick={() => setFull((f) => !f)} aria-label={full ? "Exit full screen" : "Full screen"} title={full ? "Exit full screen (Esc)" : "Full screen"}>
          {full ? (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
          )}
        </button>
      </div>
      <div
        ref={scrollRef}
        className={`overflow-y-auto overscroll-contain ${full ? "h-full" : "max-h-[75vh] min-h-32"}`}
      >
        {error && (
          <p className="m-4 mr-32 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Couldn’t show this score: {error}
          </p>
        )}
        {busy && !error && (
          <p className="absolute left-4 top-3 text-xs text-gray-500">Drawing…</p>
        )}
        <div className="pb-6 pt-10">
          {pages.map((url) => (
            <img key={url} src={url} alt="Sheet music" className="mx-auto block h-auto max-w-full" draggable={false} />
          ))}
        </div>
      </div>
    </div>
  );
}
