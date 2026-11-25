import { useEffect, useState } from "react";
import { ChipButton } from "./FilterChip";

export type HasChoice = "any" | "yes" | "no";

export interface HasItem<K extends string> {
  key: K;
  /** Row label in the panel, e.g. "Guitar tab". */
  label: string;
  /** Chip text when set to yes / no, e.g. "Tab" / "No tab". */
  yes: string;
  no: string;
}

const CHOICES: { value: HasChoice; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/**
 * The "Has" chip of a filter bar: several yes/no properties behind one chip.
 * Opens a panel (a sheet at the bottom on phones, a centered box on larger
 * screens) with one row per property, each set to Any / Yes / No, so they can
 * be combined ("recorded, no chart"). Changes apply as they are made.
 */
export default function HasPicker<K extends string>({
  items,
  value,
  onChange,
}: {
  items: HasItem<K>[];
  value: Record<K, HasChoice>;
  onChange: (value: Record<K, HasChoice>) => void;
}) {
  const [open, setOpen] = useState(false);
  const set = items.filter((i) => value[i.key] !== "any");
  const text = (i: HasItem<K>) => (value[i.key] === "yes" ? i.yes : i.no);
  const label =
    set.length === 0 ? "Has" : set.length === 1 ? text(set[0]) : `${text(set[0])} +${set.length - 1}`;
  return (
    <>
      <ChipButton
        label={label}
        active={set.length > 0}
        onClick={() => setOpen(true)}
        ariaLabel={set.length > 0 ? `Filter by what a song has: ${set.map(text).join(", ")}` : "Filter by what a song has"}
      />
      {open && <Panel items={items} value={value} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

function Panel<K extends string>({
  items,
  value,
  onChange,
  onClose,
}: {
  items: HasItem<K>[];
  value: Record<K, HasChoice>;
  onChange: (value: Record<K, HasChoice>) => void;
  onClose: () => void;
}) {
  // The page behind must not scroll while the panel is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const anySet = items.some((i) => value[i.key] !== "any");
  const clear = () => onChange(Object.fromEntries(items.map((i) => [i.key, "any"])) as Record<K, HasChoice>);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Filter by what a song has"
        className="relative w-full rounded-t-2xl bg-gray-900 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-sm sm:rounded-2xl sm:pb-3"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-base font-semibold text-white">Has</h2>
          <button
            type="button"
            onClick={clear}
            disabled={!anySet}
            className="rounded-lg px-2 py-1 text-sm text-gray-300 hover:text-white disabled:opacity-40 disabled:hover:text-gray-300"
          >
            Clear
          </button>
        </div>
        <ul>
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-3 px-4 py-2">
              <span className={`min-w-0 flex-1 truncate text-base sm:text-sm ${value[item.key] !== "any" ? "text-accent-300" : "text-gray-100"}`}>
                {item.label}
              </span>
              <span role="group" aria-label={item.label} className="flex shrink-0 rounded-full bg-white/[0.06] p-0.5">
                {CHOICES.map((c) => {
                  const on = value[item.key] === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => onChange({ ...value, [item.key]: c.value })}
                      className={`min-w-[3rem] rounded-full px-3 py-1.5 text-sm transition sm:py-1 ${
                        on
                          ? c.value === "any" ? "bg-white/10 text-white" : "bg-accent-500/25 text-accent-200"
                          : "text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-full bg-accent-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
