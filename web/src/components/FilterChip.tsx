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
    <span className={chipClass(active)}>
      {icon}
      <span className="max-w-[12rem] truncate">{label}</span>
      <ChipChevron />
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

/** The pill look shared by every chip in a filter bar; highlighted when its filter is set. */
function chipClass(active: boolean): string {
  return `relative inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors ${
    active
      ? "border-accent-500/50 bg-accent-500/15 text-accent-300"
      : "border-white/10 bg-white/[0.04] text-gray-300 hover:bg-white/[0.08]"
  }`;
}

/**
 * A chip that opens something of its own (a picker panel) instead of the
 * native dropdown. Looks the same as a FilterChip.
 */
export function ChipButton({
  label,
  active,
  onClick,
  ariaLabel,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} aria-haspopup="dialog" className={chipClass(active)}>
      <span className="max-w-[12rem] truncate">{label}</span>
      <ChipChevron />
    </button>
  );
}

/** The small down arrow at the end of a chip. */
function ChipChevron() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0 opacity-70" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
    </svg>
  );
}

const SortIcon = (
  <svg className="h-3.5 w-3.5 shrink-0 opacity-70" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
    <path fillRule="evenodd" d="M2.24 6.8a.75.75 0 0 0 1.06-.04l1.95-2.1v8.59a.75.75 0 0 0 1.5 0V4.66l1.95 2.1a.75.75 0 1 0 1.1-1.02l-3.25-3.5a.75.75 0 0 0-1.1 0L2.2 5.74a.75.75 0 0 0 .04 1.06Zm8 6.4a.75.75 0 0 0-.04 1.06l3.25 3.5a.75.75 0 0 0 1.1 0l3.25-3.5a.75.75 0 1 0-1.1-1.02l-1.95 2.1V6.75a.75.75 0 0 0-1.5 0v8.59l-1.95-2.1a.75.75 0 0 0-1.06-.04Z" clipRule="evenodd" />
  </svg>
);

/**
 * The sort chip that opens a list's filter bar: always neutral, marked with
 * the sort arrows. `short` is the text on the chip when the option's full
 * label is too long for it.
 */
export function SortChip<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string; short?: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <FilterChip
      value={value}
      options={options}
      onChange={onChange}
      ariaLabel={ariaLabel}
      display={(v) => { const o = options.find((x) => x.value === v); return o?.short ?? o?.label ?? ""; }}
      icon={SortIcon}
    />
  );
}

/** Band filter chip; renders nothing for people in a single band. */
export function BandChip({
  groups,
  value,
  onChange,
}: {
  groups: { id: number; name: string }[];
  value: number | null;
  onChange: (groupId: number | null) => void;
}) {
  if (groups.length <= 1) return null;
  return (
    <FilterChip
      value={value === null ? "" : String(value)}
      options={[{ value: "", label: "All bands" }, ...groups.map((g) => ({ value: String(g.id), label: g.name }))]}
      onChange={(v) => onChange(v ? Number(v) : null)}
      ariaLabel="Filter by band"
      defaultValue=""
      placeholder="Band"
    />
  );
}

/**
 * The row of chips under a list page's title/search: sort first, then filters
 * (highlighted when set). Scrolls sideways on narrow screens. Pass `onClear`
 * while any filter is set to show a Clear button at the end.
 */
export function FilterBar({ children, onClear }: { children: ReactNode; onClear?: () => void }) {
  return (
    <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      {children}
      {onClear && (
        <button onClick={onClear} className="shrink-0 px-1 text-sm text-gray-400 hover:text-gray-200">
          Clear
        </button>
      )}
    </div>
  );
}
