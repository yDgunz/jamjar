import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * Go back to the previous page in the app, or to `fallback` when this page was
 * opened directly (a fresh tab, a shared link, a Home Screen launch).
 */
export function useBack(fallback: string) {
  const navigate = useNavigate();
  const location = useLocation();
  const hasHistory = location.key !== "default";
  return useCallback(() => {
    if (hasHistory) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [hasHistory, navigate, fallback]);
}

/** The list page a detail page belongs to, or null when the page isn't a detail page. */
export function parentPath(pathname: string): string | null {
  const m = pathname.match(/^\/(songs|sessions|setlists)\/[^/]+\/?$/);
  if (m) return `/${m[1]}`;
  if (pathname.startsWith("/import/")) return "/sessions";
  return null;
}
