import { useEffect } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";

export interface SheetAction {
  label: ReactNode;
  onClick?: () => void;
  href?: string;
  /** Download link (rendered as <a download>) */
  download?: string;
  destructive?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
}

export interface SheetSection {
  title?: ReactNode;
  actions: SheetAction[];
  /** Muted note shown under the section title (e.g. why actions are unavailable) */
  note?: ReactNode;
}

/**
 * Bottom sheet on phones, centered menu on larger screens. Each action closes
 * the sheet before running.
 */
export default function ActionSheet({
  open,
  title,
  subtitle,
  sections,
  onClose,
}: {
  open: boolean;
  title?: ReactNode;
  subtitle?: ReactNode;
  sections: SheetSection[];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const rowClass = (a: SheetAction) =>
    `flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[17px] transition active:bg-white/5 sm:py-2.5 sm:text-sm sm:hover:bg-white/5 disabled:opacity-40 ${
      a.destructive ? "text-red-400" : "text-gray-100"
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-gray-900 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-w-sm sm:rounded-2xl sm:pb-2">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-gray-700 sm:hidden" />
        {(title || subtitle) && (
          <div className="border-b border-white/[0.07] px-4 pb-3 pt-3">
            {title && <div className="truncate text-base font-semibold text-white">{title}</div>}
            {subtitle && <div className="mt-0.5 truncate text-sm text-gray-400">{subtitle}</div>}
          </div>
        )}
        {sections.filter((s) => s.actions.length > 0 || s.note).map((section, i) => (
          <div key={i} className={i > 0 ? "border-t border-white/[0.07]" : ""}>
            {section.title && (
              <div className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{section.title}</div>
            )}
            {section.note && <div className="px-4 pb-1 pt-1 text-sm text-gray-500">{section.note}</div>}
            {section.actions.map((a, j) => {
              const content = (
                <>
                  <span>{a.label}</span>
                  {a.hint && <span className="text-sm text-gray-500">{a.hint}</span>}
                </>
              );
              if (a.href && !a.download) {
                return <Link key={j} to={a.href} onClick={onClose} className={rowClass(a)}>{content}</Link>;
              }
              if (a.href && a.download) {
                return <a key={j} href={a.href} download={a.download} onClick={onClose} className={rowClass(a)}>{content}</a>;
              }
              return (
                <button
                  key={j}
                  disabled={a.disabled}
                  onClick={() => { onClose(); a.onClick?.(); }}
                  className={rowClass(a)}
                >
                  {content}
                </button>
              );
            })}
          </div>
        ))}
        <div className="border-t border-white/[0.07] sm:hidden">
          <button onClick={onClose} className="w-full px-4 py-3 text-center text-[17px] font-medium text-gray-300 active:bg-white/5">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function MoreButton({ onClick, label = "More actions" }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition active:bg-white/10 sm:hover:bg-white/10"
    >
      <MoreIcon className="h-5 w-5" />
    </button>
  );
}

export function MoreIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM8.5 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM15.5 8.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" />
    </svg>
  );
}
