import { parseSheet } from "../utils/sheetParser";
import { isChordPro, parseChordProLine } from "../utils/chordpro";

interface ChordSheetProps {
  text: string;
  wrapText: boolean;
}

export default function ChordSheet({ text, wrapText }: ChordSheetProps) {
  if (isChordPro(text)) {
    return <ChordProSheet text={text} wrapText={wrapText} />;
  }

  if (!wrapText) {
    return (
      <pre className="whitespace-pre overflow-x-auto font-mono leading-relaxed text-gray-200">
        {text}
      </pre>
    );
  }

  return <LegacySheet text={text} />;
}

function ChordProSheet({ text, wrapText }: { text: string; wrapText: boolean }) {
  const lines = text.split("\n");

  return (
    <div className={`font-mono leading-relaxed text-gray-200 ${!wrapText ? "overflow-x-auto" : ""}`}>
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
            return (
              <div key={i} className={!wrapText ? "whitespace-nowrap" : ""}>
                {parsed.segments.map((seg, j) => (
                  <span key={j} className="inline-block min-w-[3ch] whitespace-pre align-top">
                    <span className="block font-bold text-accent-400">
                      {seg.chord || "\u00A0"}
                    </span>
                    <span className="block">{seg.text || "\u00A0"}</span>
                  </span>
                ))}
              </div>
            );
        }
      })}
    </div>
  );
}

function LegacySheet({ text }: { text: string }) {
  const lines = parseSheet(text);

  return (
    <div className="font-mono leading-relaxed text-gray-200">
      {lines.map((line, i) => {
        switch (line.type) {
          case "empty":
            return <div key={i} className="h-[1.5em]" />;
          case "header":
            return (
              <div key={i} className="mt-2 font-bold text-accent-400 whitespace-pre">
                {line.text}
              </div>
            );
          case "chords-only":
            return (
              <div key={i} className="whitespace-pre font-bold text-accent-400">
                {line.text}
              </div>
            );
          case "text":
            return (
              <div key={i} className="whitespace-pre-wrap">
                {line.text}
              </div>
            );
          case "paired":
            return (
              <div key={i}>
                {line.segments.map((seg, j) => (
                  <span key={j} className="inline-block whitespace-pre align-top">
                    <span className="block font-bold text-accent-400">
                      {seg.chord || "\u00A0"}
                    </span>
                    <span className="block">{seg.lyric || "\u00A0"}</span>
                  </span>
                ))}
              </div>
            );
        }
      })}
    </div>
  );
}
