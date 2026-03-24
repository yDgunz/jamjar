import type { ReactNode } from "react";
import { Link } from "react-router";

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export default function Breadcrumb({ items, right }: { items: BreadcrumbItem[]; right?: ReactNode }) {
  return (
    <nav className="mb-3 flex items-center gap-1.5 text-sm text-gray-500">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && (
            <svg className="h-3.5 w-3.5 shrink-0 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          )}
          {item.to ? (
            <Link to={item.to} className="hover:text-gray-300 transition-colors">
              {item.label}
            </Link>
          ) : (
            <span className="text-gray-400 truncate max-w-[200px]">{item.label}</span>
          )}
        </span>
      ))}
      {right && <div className="ml-auto shrink-0">{right}</div>}
    </nav>
  );
}
