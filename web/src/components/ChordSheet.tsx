import { isChordToken, parseSheet } from "../utils/sheetParser";
import { isChordPro, parseChordProLine } from "../utils/chordpro";

interface ChordSheetProps {
  text: string;
  wrapText: boolean;
  lyricsOnly?: boolean;
}

export default function ChordSheet({ text, wrapText, lyricsOnly }: ChordSheetProps) {
  if (isChordPro(text)) {
    return <ChordProSheet text={text} wrapText={wrapText} lyricsOnly={lyricsOnly} />;
  }

  if (!wrapText) {
    return (
      <pre className="whitespace-pre overflow-x-auto font-mono leading-relaxed text-gray-200">
        {text}
      </pre>
    );
  }

  return <LegacySheet text={text} lyricsOnly={lyricsOnly} />;
}

function ChordProSheet({ text, wrapText, lyricsOnly }: { text: string; wrapText: boolean; lyricsOnly?: boolean }) {
  const lines = text.split("\n");

  return (
    <div className={`leading-relaxed text-gray-100 ${!wrapText ? "overflow-x-auto font-mono" : ""}`}>
      {lines.map((line, i) => {
        const parsed = parseChordProLine(line);
        switch (parsed.type) {
          case "empty":
            return <div key={i} className="h-[1.5em]" />;
          case "text":
            return (
              <div key={i} className={wrapText ? "whitespace-pre-wrap" : "whitespace-pre"}>
                {parsed.text}
              </div>
            );
          case "paired":
            if (lyricsOnly) {
              const lyricText = parsed.segments.map((seg) => seg.text || "").join("");
              if (!lyricText.trim()) return <div key={i} className="h-[1.5em]" />;
              return (
                <div key={i} className={wrapText ? "whitespace-pre-wrap" : "whitespace-pre"}>
                  {lyricText}
                </div>
              );
            }
            return (
              <div key={i} className={!wrapText ? "whitespace-nowrap" : ""}>
                <PairedLine segments={parsed.segments.map((seg) => ({ chord: seg.chord, text: seg.text }))} />
              </div>
            );
        }
      })}
    </div>
  );
}

function LegacySheet({ text, lyricsOnly }: { text: string; lyricsOnly?: boolean }) {
  const lines = parseSheet(text);

  return (
    <div className="leading-relaxed text-gray-100">
      {lines.map((line, i) => {
        switch (line.type) {
          case "empty":
            return <div key={i} className="h-[1.5em]" />;
          case "header":
            return (
              <div key={i} className="mt-3 text-[0.8em] font-semibold uppercase tracking-wide text-gray-500 whitespace-pre">
                {line.text}
              </div>
            );
          case "tab":
            if (lyricsOnly) return null;
            return (
              <pre key={i} className="my-1 overflow-x-auto whitespace-pre font-mono text-[0.8em] leading-snug text-gray-300">
                {line.text}
              </pre>
            );
          case "chords-only":
            if (lyricsOnly) return null;
            return (
              <div key={i} className="whitespace-pre font-mono font-semibold text-accent-400">
                {line.text}
              </div>
            );
          case "text":
            return (
              <div key={i} className="whitespace-pre-wrap">
                {lyricsOnly ? line.text : <InlineChords text={line.text} />}
              </div>
            );
          case "paired":
            if (lyricsOnly) {
              const lyricText = line.segments.map((seg) => seg.lyric || "").join("");
              if (!lyricText.trim()) return <div key={i} className="h-[1.5em]" />;
              return (
                <div key={i} className="whitespace-pre-wrap">
                  {lyricText}
                </div>
              );
            }
            return (
              <div key={i}>
                <PairedLine segments={line.segments.map((seg) => ({ chord: seg.chord, text: seg.lyric }))} />
              </div>
            );
        }
      })}
    </div>
  );
}

/**
 * Colour chord names inside shorthand lines like "Verse: D | F#m | Bm | G".
 * Only applies when most of the line's words are chords, so lyrics that
 * happen to contain "A" or "Am" aren't highlighted.
 */
function InlineChords({ text }: { text: string }) {
  const parts = text.split(/(\s+|\|)/);
  const words = parts.filter((p) => p.trim() && p !== "|" && !p.endsWith(":"));
  const chordCount = words.filter(isChordToken).length;
  if (words.length === 0 || chordCount / words.length < 0.6) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        isChordToken(p) ? (
          <span key={i} className="font-semibold text-accent-400">{p}</span>
        ) : p === "|" ? (
          <span key={i} className="text-gray-600">{p}</span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/**
 * Render a chord-over-lyric line so it can wrap at any word boundary.
 *
 * Each segment (chord + the lyric under it) is split into words; the chord
 * sits above the first word, later words get an empty chord row. Words that a
 * chord splits in two ("pra|y") are kept together in one unbreakable group.
 */
function PairedLine({ segments }: { segments: { chord?: string; text?: string }[] }) {
  type Unit = { chord: string; text: string };
  const units: Unit[] = [];
  for (const seg of segments) {
    const words = (seg.text ?? "").split(/(?<=\s)(?=\S)/);
    words.forEach((w, k) => units.push({ chord: k === 0 ? seg.chord ?? "" : "", text: w }));
  }
  const groups: Unit[][] = [];
  units.forEach((u, i) => {
    const prev = i > 0 ? units[i - 1].text : "";
    const glued = i > 0 && /\S$/.test(prev) && /^\S/.test(u.text);
    if (glued && groups.length) groups[groups.length - 1].push(u);
    else groups.push([u]);
  });
  return (
    <>
      {groups.map((group, g) => (
        <span key={g} className="inline-block whitespace-nowrap align-top">
          {group.map((u, j) => (
            <span key={j} className="inline-block whitespace-pre align-top">
              {/* A chordless piece adds no width (a zero-width space keeps the row's height),
                  so a word split by a chord ("t|hrones") doesn't open a gap */}
              <span className={`block text-[0.85em] font-semibold text-accent-400 ${u.chord ? "pr-1" : ""}`}>
                {u.chord || "\u200B"}
              </span>
              <span className="block">{u.text || "\u00A0"}</span>
            </span>
          ))}
        </span>
      ))}
    </>
  );
}
