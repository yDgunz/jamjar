import type { ReactNode } from "react";

/**
 * Pill-shaped dropdown for a horizontal filter bar. Shows `placeholder` (the
 * filter's name) while the value is the default, and the chosen option,
 * highlighted, once it's set. A native <select> sits invisibly on top so the
 * platform picker opens on tap.
 */
export default function FilterChip<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  defaultValue,
  placeholder,
  icon,
  display,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  /** The "no filter" value; the chip is highlighted when value differs. Omit for always-neutral chips (sort). */
  defaultValue?: T;
  /** Label to show while the value is the default (e.g. "Artist"). */
  placeholder?: string;
  icon?: ReactNode;
  /** Shorter text for the chip itself (the dropdown keeps the full option labels). */
  display?: (value: T) => string;
}) {
  const active = defaultValue !== undefined && value !== defaultValue;
  const current = options.find((o) => o.value === value)?.label ?? "";
  const label = !active && placeholder ? placeholder : display ? display(value) : current;
  return (
    <span
      className={`relative inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors ${
        active
          ? "border-accent-500/50 bg-accent-500/15 text-accent-300"
          : "border-white/10 bg-white/[0.04] text-gray-300 hover:bg-white/[0.08]"
      }`}
    >
      {icon}
      <span className="max-w-[12rem] truncate">{label}</span>
      <svg className="h-3.5 w-3.5 shrink-0 opacity-70" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
      </svg>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        aria-label={ariaLabel}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </span>
  );
}
