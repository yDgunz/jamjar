import type { ReactNode } from "react";
import { Link } from "react-router";

interface ListItemCardProps {
  to: string;
  /** Router state for the link (e.g. where "back" should return to). */
  state?: unknown;
  title: ReactNode;
  children?: ReactNode;
  right?: ReactNode;
  rightClassName?: string;
}

/**
 * A flat, tappable list row. Render inside a `<ListRows>` container, which
 * draws hairline dividers between rows.
 */
export default function ListItemCard({
  to,
  state,
  title,
  children,
  right,
  rightClassName,
}: ListItemCardProps) {
  return (
    <Link
      to={to}
      state={state}
      className="-mx-4 flex items-center gap-3 px-4 py-3 transition active:bg-white/5 sm:mx-0 sm:rounded-lg sm:px-3 sm:hover:bg-white/5"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px] font-medium leading-snug text-white sm:text-base">
          {title}
        </div>
        {children}
      </div>
      {right && (
        <div className={rightClassName ?? "shrink-0 text-right text-sm text-gray-400"}>
          {right}
        </div>
      )}
    </Link>
  );
}

export function ListRows({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-white/[0.07]">{children}</div>;
}
