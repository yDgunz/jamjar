import type { ReactNode } from "react";
import { Link } from "react-router";

interface ListItemCardProps {
  to: string;
  title: ReactNode;
  children?: ReactNode;
  right?: ReactNode;
  rightClassName?: string;
}

export default function ListItemCard({
  to,
  title,
  children,
  right,
  rightClassName,
}: ListItemCardProps) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-5 py-4 transition hover:border-accent-500 hover:bg-gray-800"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-white">
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
