/**
 * Text-style dropdown for list toolbars: shows the current label with a small
 * chevron right after it (a native <select> sits invisibly on top so the
 * platform picker still opens). Unlike a bare <select>, the chevron hugs the
 * text instead of sitting at the edge of the widest option.
 */
export default function InlineSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  const label = options.find((o) => o.value === value)?.label ?? "";
  return (
    <span className="relative inline-flex min-w-0 items-center gap-1 rounded py-1 text-sm text-gray-400 transition-colors focus-within:text-gray-100 hover:text-gray-200">
      <span className="truncate">{label}</span>
      <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
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
