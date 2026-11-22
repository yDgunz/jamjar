import InlineSelect from "./InlineSelect";
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

  if (variant === "subtle") {
    return (
      <InlineSelect
        value={value === null ? "" : String(value)}
        options={[
          ...(allLabel !== undefined ? [{ value: "", label: allLabel }] : []),
          ...groups.map((g) => ({ value: String(g.id), label: g.name })),
        ]}
        onChange={(v) => onChange(v ? Number(v) : null)}
        ariaLabel="Band"
      />
    );
  }

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      aria-label="Band"
      className="min-w-0 truncate rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
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
