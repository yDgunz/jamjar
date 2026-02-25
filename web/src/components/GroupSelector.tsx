import type { AuthGroup } from "../api";

interface GroupSelectorProps {
  groups: AuthGroup[];
  value: number | null;
  onChange: (groupId: number) => void;
}

export default function GroupSelector({ groups, value, onChange }: GroupSelectorProps) {
  if (groups.length <= 1) return null;

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded border border-gray-700 bg-gray-800 px-3 py-2 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
    >
      <option value="" disabled>
        Select group...
      </option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );
}
