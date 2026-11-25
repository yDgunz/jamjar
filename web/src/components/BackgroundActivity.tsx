import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import type {
  ActivityItem,
  BackgroundActivity as Activity,
  ProcessingActivity,
  TaggingActivity,
} from "../api";

type Entry = ProcessingActivity | TaggingActivity;
/** A stretch of tagging runs that found nothing to do, shown as one line. */
type Quiet = { kind: "quiet"; key: string; runs: TaggingActivity[] };

const JOB_LABELS: Record<string, string> = {
  upload: "Uploaded and split",
  reprocess: "Split again",
  merge: "Recordings merged",
};

function date(iso: string): Date {
  return new Date(iso.replace(" ", "T") + "Z");
}

function when(iso: string): string {
  return date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function day(iso: string): string {
  return date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function length(sec: number): string {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

function took(entry: Entry): string | null {
  if (!entry.finished_at) return null;
  const sec = (date(entry.finished_at).getTime() - date(entry.at).getTime()) / 1000;
  if (sec < 1) return null;
  return sec < 90 ? `took ${Math.round(sec)}s` : `took ${length(sec)}`;
}

function n(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function isQuiet(e: Entry): e is TaggingActivity {
  return (
    e.kind === "tagging" &&
    e.status === "completed" &&
    !e.skipped &&
    e.transcribed + e.failed + e.splits + e.merges + e.tagged === 0
  );
}

function fold(entries: Entry[]): (Entry | Quiet)[] {
  const out: (Entry | Quiet)[] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (!isQuiet(e)) out.push(e);
    else if (last?.kind === "quiet") last.runs.push(e);
    else out.push({ kind: "quiet", key: `quiet-${e.key}`, runs: [e] });
  }
  return out;
}

function taggingCounts(run: TaggingActivity): string {
  const parts: string[] = [];
  if (run.transcribed) parts.push(`listened to ${n(run.transcribed, "track", "tracks")}`);
  if (run.splits) parts.push(`${n(run.splits, "track", "tracks")} cut in two`);
  if (run.merges) parts.push(`${n(run.merges, "join", "joins")}`);
  if (run.tagged) parts.push(`${n(run.tagged, "track", "tracks")} tagged`);
  if (run.failed) parts.push(`${n(run.failed, "track", "tracks")} couldn't be read`);
  if (run.remaining) parts.push(`${run.remaining} still waiting`);
  return parts.join(" · ");
}

function Badge({ tone, children }: { tone: "blue" | "red" | "amber"; children: string }) {
  const tones = {
    blue: "bg-sky-500/15 text-sky-300",
    red: "bg-red-500/15 text-red-300",
    amber: "bg-amber-500/15 text-amber-300",
  };
  return <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`mt-1 h-4 w-4 shrink-0 text-gray-500 transition ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
    </svg>
  );
}

function ItemRow({ item }: { item: ActivityItem }) {
  const recording = (
    <Link to={`/sessions/${item.session_id}`} className="text-gray-400 hover:text-white">
      {item.session_name}
    </Link>
  );
  let label = "Tagged";
  let body;
  if (item.action === "tagged") {
    body = (
      <>
        <Link to={`/songs/${item.song_id}`} className={`hover:text-white ${item.kept === false ? "text-gray-500 line-through" : "text-gray-200"}`}>
          {item.song_name}
        </Link>
        <span className="text-gray-500"> · track {item.track_number} of </span>
        {recording}
        <span className="text-gray-600">
          {" · "}
          {item.source === "takes" ? "sounded like your other takes" : "matched the chart's lyrics"}
          {item.kept === false && " · tag changed since"}
        </span>
      </>
    );
  } else if (item.action === "split") {
    label = "Cut in two";
    body = (
      <>
        {recording}
        <span className="text-gray-500"> · a track held two songs, cut at {clock(item.at_sec ?? 0)}</span>
      </>
    );
  } else {
    label = "Joined";
    body = (
      <>
        {recording}
        <span className="text-gray-500">
          {" "}· {item.count ?? 2} tracks from {clock(item.at_sec ?? 0)} were one song
        </span>
      </>
    );
  }
  return (
    <li className="flex items-baseline gap-3 px-3 py-2 text-sm sm:py-1.5">
      <span className="w-20 shrink-0 text-xs text-gray-500">{label}</span>
      <span className="min-w-0 break-words">{body}</span>
    </li>
  );
}

function Row({ time, children, onClick, chevron }: { time: string; children: React.ReactNode; onClick?: () => void; chevron?: boolean }) {
  const inner = (
    <>
      <span className="hidden w-28 shrink-0 text-xs leading-5 text-gray-500 sm:block">{time}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-gray-500 sm:hidden">{time}</span>
        {children}
      </span>
      {chevron !== undefined && <Chevron open={chevron} />}
    </>
  );
  return onClick ? (
    <button onClick={onClick} className="flex w-full cursor-pointer items-start gap-3 px-3 py-2.5 text-left hover:bg-gray-900/50">
      {inner}
    </button>
  ) : (
    <div className="flex items-start gap-3 px-3 py-2.5">{inner}</div>
  );
}

function ProcessingRow({ job }: { job: ProcessingActivity }) {
  const details = [
    job.tracks != null && n(job.tracks, "track", "tracks"),
    job.duration_sec != null && `${length(job.duration_sec)} of audio`,
    job.group_name,
    took(job),
  ].filter(Boolean);
  return (
    <div className="rounded-lg border border-gray-800">
      <Row time={when(job.at)}>
        <span className="block text-sm text-gray-200">
          <span className="text-gray-400">{JOB_LABELS[job.job_type] ?? job.job_type}: </span>
          {job.session_id ? (
            <Link to={`/sessions/${job.session_id}`} className="hover:text-white">{job.session_name}</Link>
          ) : (
            <span className="text-gray-500">{job.status === "failed" ? "recording not saved" : "recording since deleted"}</span>
          )}
          {job.status === "failed" && <Badge tone="red">Failed</Badge>}
          {job.status === "processing" && <Badge tone="blue">Working</Badge>}
          {job.status === "pending" && <Badge tone="amber">Waiting for upload</Badge>}
        </span>
        {details.length > 0 && <span className="mt-0.5 block text-xs text-gray-500">{details.join(" · ")}</span>}
        {job.error && <span className="mt-0.5 block break-words text-xs text-red-400">{job.error}</span>}
      </Row>
    </div>
  );
}

function TaggingRow({ run, open, toggle }: { run: TaggingActivity; open: boolean; toggle: () => void }) {
  const counts = taggingCounts(run);
  const sub = [counts || (run.status === "completed" && !run.skipped ? "nothing new" : ""), took(run)].filter(Boolean);
  const hasItems = run.items.length > 0;
  return (
    <div className="rounded-lg border border-gray-800">
      <Row time={run.backfilled ? day(run.at) : when(run.at)} onClick={hasItems ? toggle : undefined} chevron={hasItems ? open : undefined}>
        <span className="block text-sm text-gray-200">
          <span className="text-gray-400">Song tagging: </span>
          {run.backfilled ? "tags from earlier runs" : run.session_name ?? (run.session_id ? "a recording since deleted" : "all recordings")}
          {run.status === "running" && <Badge tone="blue">Running</Badge>}
          {run.status === "failed" && <Badge tone="red">Failed</Badge>}
          {run.status === "interrupted" && <Badge tone="amber">Cut short</Badge>}
        </span>
        {sub.length > 0 && <span className="mt-0.5 block text-xs text-gray-500">{sub.join(" · ")}</span>}
        {run.skipped && <span className="mt-0.5 block text-xs text-amber-400/80">Didn't listen to new tracks: {run.skipped}</span>}
        {run.status === "interrupted" && (
          <span className="mt-0.5 block text-xs text-gray-500">Stopped by a server restart before it finished; the next run picks it up.</span>
        )}
        {run.error && <span className="mt-0.5 block break-words text-xs text-red-400">{run.error}</span>}
      </Row>
      {open && hasItems && (
        <ul className="divide-y divide-gray-800/50 border-t border-gray-800">
          {run.items.map((item, i) => (
            <ItemRow key={i} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Timeline of recordings processed and automatic song-tagging runs, newest first. */
export default function BackgroundActivity() {
  const [data, setData] = useState<Activity | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    api.adminGetBackgroundActivity().then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const busy =
    !!data &&
    (data.tagging.running ||
      data.tagging.queued > 0 ||
      data.entries.some((e) => e.status === "processing" || e.status === "running"));
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [busy, load]);

  if (error && !data) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) return <p className="text-sm text-gray-500">Loading...</p>;

  const t = data.tagging;
  const runNow = async () => {
    setStarting(true);
    setNotice("");
    try {
      await api.adminRunSongIdentification();
      load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not start a run");
    } finally {
      setStarting(false);
    }
  };

  let status: string;
  if (!t.available) status = "Automatic tagging isn't installed on this server.";
  else if (t.running) status = `Tagging run in progress${t.queued ? ` · ${t.queued} more queued` : ""}`;
  else if (t.nightly_hour_utc == null) status = "Automatic tagging is switched off.";
  else {
    const at = new Date(Date.UTC(2000, 0, 1, t.nightly_hour_utc)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    status = `Idle · runs nightly at ${at} and after each upload`;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-gray-800 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm text-gray-200">
            {t.running && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-400" />}
            {status}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {n(t.tracks, "track", "tracks")} · {t.untagged} untagged · {t.pending_transcripts} waiting to be listened to · {t.auto_tagged} tagged automatically
          </p>
          {notice && <p className="mt-0.5 text-xs text-red-400">{notice}</p>}
        </div>
        {t.available && !t.running && (
          <button
            onClick={runNow}
            disabled={starting}
            className="cursor-pointer rounded-md border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-800 disabled:opacity-50"
          >
            {starting ? "Starting..." : "Run tagging now"}
          </button>
        )}
      </div>

      {data.entries.length === 0 && <p className="text-sm text-gray-500">Nothing has run yet.</p>}

      <div className="space-y-2">
        {fold(data.entries).map((e) => {
          if (e.kind === "processing") return <ProcessingRow key={e.key} job={e} />;
          if (e.kind === "tagging") {
            return <TaggingRow key={e.key} run={e} open={open === e.key} toggle={() => setOpen(open === e.key ? null : e.key)} />;
          }
          const newest = e.runs[0].at;
          const oldest = e.runs[e.runs.length - 1].at;
          return (
            <p key={e.key} className="px-3 text-xs text-gray-600">
              {e.runs.length === 1
                ? `${when(newest)} · tagging run, nothing new`
                : `${day(oldest)} – ${day(newest)} · ${e.runs.length} tagging runs, nothing new`}
            </p>
          );
        })}
      </div>
    </div>
  );
}
