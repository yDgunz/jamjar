import type { ReactNode } from "react";
import { Link } from "react-router";

interface ListItemCardProps {
  to: string;
  title: ReactNode;
  children?: ReactNode;
  right?: ReactNode;
  rightClassName?: string;
  /** Leading visual, e.g. <Artwork size="sm" /> */
  leading?: ReactNode;
}

/**
 * A flat, tappable list row. Render inside a `<ListRows>` container, which
 * draws hairline dividers between rows.
 */
export default function ListItemCard({
  to,
  title,
  children,
  right,
  rightClassName,
  leading,
}: ListItemCardProps) {
  return (
    <Link
      to={to}
      className="-mx-4 flex items-center gap-3.5 px-4 py-2.5 transition active:bg-white/[0.04] sm:mx-0 sm:rounded-xl sm:px-3 sm:hover:bg-white/[0.04]"
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-semibold leading-snug text-white">
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
  return <div className="divide-y divide-white/[0.05]">{children}</div>;
}
