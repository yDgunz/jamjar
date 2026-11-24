import { parseUtc } from "../api";

/** Expiry choices offered when sharing; null = never expires. */
export const EXPIRY_CHOICES: { days: number | null; label: string }[] = [
  { days: 1, label: "1 day" },
  { days: 7, label: "1 week" },
  { days: 30, label: "1 month" },
  { days: 90, label: "3 months" },
  { days: 365, label: "1 year" },
  { days: null, label: "Never" },
];

/** The choices, plus the server default when it isn't one of them. */
export function expiryChoices(defaultDays: number | null) {
  if (EXPIRY_CHOICES.some((c) => c.days === defaultDays)) return EXPIRY_CHOICES;
  const extra = { days: defaultDays, label: `${defaultDays} days` };
  return [...EXPIRY_CHOICES, extra].sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
}

/** "Expires Dec 24" / "Expired Nov 2" / "Never expires" */
export function describeExpiry(expiresAt: string | null, expired: boolean): string {
  if (!expiresAt) return "Never expires";
  const d = parseUtc(expiresAt);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${expired ? "Expired" : "Expires"} ${date}`;
}
