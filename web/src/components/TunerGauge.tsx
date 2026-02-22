interface TunerGaugeProps {
  cents: number | null;
  active: boolean;
}

// 21 bars: index 0–20, center is 10. Each bar spans ~5 cents.
const BAR_COUNT = 21;
const CENTER = 10;

function litColor(i: number): string {
  const dist = Math.abs(i - CENTER);
  if (dist <= 1) return "#4ade80"; // green-400
  if (dist <= 4) return "#facc15"; // yellow-400
  return "#fb923c"; // orange-400
}

function dimColor(i: number): string {
  const dist = Math.abs(i - CENTER);
  if (dist <= 1) return "rgba(74,222,128,0.15)";
  if (dist <= 4) return "rgba(250,204,21,0.10)";
  return "rgba(251,146,60,0.08)";
}

export default function TunerGauge({ cents, active }: TunerGaugeProps) {
  const clamped = cents !== null ? Math.max(-50, Math.min(50, cents)) : 0;
  // Map cents to bar index: -50 → 0, 0 → 10, +50 → 20
  const position = Math.round((clamped + 50) / 100 * (BAR_COUNT - 1));

  return (
    <div className="flex w-full max-w-xs items-end justify-center gap-[3px]">
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const isCenter = i === CENTER;
        const dist = Math.abs(i - CENTER);
        // Taller at center, shorter at edges
        const height = isCenter ? 44 : 20 + Math.round((1 - dist / CENTER) * 20);

        // Light up bars between center and current position
        const lit =
          active &&
          cents !== null &&
          (clamped >= 0
            ? i >= CENTER && i <= position
            : i <= CENTER && i >= position);

        return (
          <div
            key={i}
            className="flex-1 rounded-sm transition-colors duration-75"
            style={{
              height,
              backgroundColor: lit ? litColor(i) : dimColor(i),
              minWidth: 6,
            }}
          />
        );
      })}
    </div>
  );
}
