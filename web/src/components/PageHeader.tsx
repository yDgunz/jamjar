import type { ReactNode } from "react";

/** Large page title with optional trailing actions (iOS-style). */
export default function PageHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-3 pt-1">
      <h1 className="min-w-0 flex-1 truncate text-[28px] font-bold leading-tight tracking-tight text-white">
        {title}
      </h1>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Round icon button used in page headers (e.g. "+", upload). */
export function HeaderIconButton({
  onClick,
  label,
  children,
  disabled,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-600 text-white transition hover:bg-accent-500 active:bg-accent-700 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export const PlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
    <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
  </svg>
);
