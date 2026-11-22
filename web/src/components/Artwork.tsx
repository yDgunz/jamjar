import type { CSSProperties, ReactNode } from "react";

/**
 * Curated gradient "sleeves". Each entry: three stops + a glow colour used for
 * hero backdrops. Picked to look good on the warm near-black background.
 */
const PALETTES: { stops: [string, string, string]; glow: string }[] = [
  { stops: ["#ff9a5a", "#e8456b", "#5b2a86"], glow: "#e8456b" }, // sunset
  { stops: ["#ffd36e", "#f27419", "#8a2c0d"], glow: "#f27419" }, // ember
  { stops: ["#7ee0c3", "#2a9d8f", "#1d3557"], glow: "#2a9d8f" }, // lagoon
  { stops: ["#a3c4ff", "#5b6cff", "#2a1b6b"], glow: "#5b6cff" }, // indigo
  { stops: ["#f7b2d9", "#b5179e", "#3a0ca3"], glow: "#b5179e" }, // orchid
  { stops: ["#d4f088", "#55a630", "#1b4332"], glow: "#55a630" }, // moss
  { stops: ["#ffe1a8", "#e09f3e", "#540b0e"], glow: "#e09f3e" }, // whiskey
  { stops: ["#9be7ff", "#0096c7", "#03045e"], glow: "#0096c7" }, // deep sea
  { stops: ["#ffb4a2", "#e5989b", "#6d6875"], glow: "#e5989b" }, // dusk
  { stops: ["#f9c74f", "#f3722c", "#277da1"], glow: "#f3722c" }, // festival
];

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function artPalette(seed: string) {
  const h = hash(seed);
  return { ...PALETTES[h % PALETTES.length], angle: 110 + (h >> 8) % 140, spot: 20 + (h >> 16) % 60 };
}

/** Background style for a seed — reusable for hero backdrops. */
export function artBackground(seed: string): CSSProperties {
  const p = artPalette(seed);
  return {
    backgroundImage: [
      `radial-gradient(circle at ${p.spot}% 18%, ${p.stops[0]}cc, transparent 55%)`,
      `linear-gradient(${p.angle}deg, ${p.stops[0]}, ${p.stops[1]} 45%, ${p.stops[2]})`,
    ].join(", "),
  };
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s&]/gu, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "♪";
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[1][0]).toUpperCase();
}

const SIZES = {
  xs: "h-10 w-10 rounded-lg text-base",
  sm: "h-12 w-12 rounded-xl text-lg",
  md: "h-36 w-36 rounded-2xl text-5xl",
  lg: "h-44 w-44 rounded-3xl text-6xl sm:h-52 sm:w-52",
};

/**
 * Generated cover art. `seed` picks the gradient; `label` is drawn in the
 * display serif (defaults to the name's initials).
 */
export default function Artwork({
  seed,
  name,
  label,
  size = "sm",
  className = "",
  children,
}: {
  seed: string;
  name?: string;
  label?: ReactNode;
  size?: keyof typeof SIZES;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`relative isolate flex shrink-0 items-center justify-center overflow-hidden ${SIZES[size]} ${className}`}
      style={artBackground(seed)}
      aria-hidden
    >
      {/* vinyl-groove sheen */}
      <div
        className="absolute inset-0 -z-10 opacity-25 mix-blend-overlay"
        style={{
          backgroundImage:
            "repeating-radial-gradient(circle at 120% 120%, rgba(255,255,255,.35) 0 1px, transparent 1px 6px)",
        }}
      />
      <div className="absolute inset-0 -z-10 bg-linear-to-t from-black/35 via-transparent to-white/10" />
      {children ?? (
        <span className="font-display leading-none text-white/90 drop-shadow-[0_1px_8px_rgba(0,0,0,0.35)]">
          {label ?? initials(name ?? seed)}
        </span>
      )}
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/15" />
    </div>
  );
}

/** Blurred, colour-matched backdrop for detail-page heroes. */
export function HeroBackdrop({ seed }: { seed: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] overflow-hidden" aria-hidden>
      <div className="absolute -inset-20 opacity-55 blur-3xl" style={artBackground(seed)} />
      <div className="absolute inset-0 bg-linear-to-b from-gray-950/10 via-gray-950/60 to-gray-950" />
    </div>
  );
}
