import type { AuthGroup } from "../api";

interface GroupSelectorProps {
  groups: AuthGroup[];
  value: number | null;
  onChange: (groupId: number | null) => void;
  allLabel?: string;
  /** "subtle" renders as inline text (for list toolbars) instead of a boxed field. */
  variant?: "default" | "subtle";
}

export default function GroupSelector({ groups, value, onChange, allLabel, variant = "default" }: GroupSelectorProps) {
  if (groups.length <= 1) return null;

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      aria-label="Band"
      className={
        variant === "subtle"
          ? "min-w-0 truncate rounded bg-transparent py-1 text-sm text-gray-400 focus:outline-none"
          : "min-w-0 truncate rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
      }
    >
      {allLabel !== undefined ? (
        <option value="">{allLabel}</option>
      ) : (
        <option value="" disabled>
          Select group...
        </option>
      )}
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );
}
