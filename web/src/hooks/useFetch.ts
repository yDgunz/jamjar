import { useCallback, useEffect, useRef, useState } from "react";

interface UseFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Generic data-fetching hook with error handling and retry support.
 *
 * - Manages loading/error/data states
 * - Catches fetch errors so the UI never gets stuck on a skeleton
 * - Provides a `refresh()` to manually re-fetch
 *
 * @param fetcher  Async function that returns data
 * @param deps     Dependency array (re-fetches when these change)
 * @param options  Optional: `onSuccess` callback runs after a successful fetch
 */
export function useFetch<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  options?: { onSuccess?: (data: T) => void },
): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  const onSuccessRef = useRef(options?.onSuccess);
  fetcherRef.current = fetcher;
  onSuccessRef.current = options?.onSuccess;

  // Number of the latest request. A response is applied only while its request
  // is still the latest, so one for a previous key (or an older refresh) can't
  // overwrite newer state.
  const requestRef = useRef(0);

  const run = useCallback(() => {
    const request = ++requestRef.current;
    const stale = () => request !== requestRef.current;
    setLoading(true);
    setError(null);
    fetcherRef
      .current()
      .then((result) => {
        if (stale()) return;
        setData(result);
        onSuccessRef.current?.(result);
      })
      .catch((err) => {
        if (stale()) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!stale()) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
    // Dependencies changed or unmounted: cancel whatever is still in flight
    return () => {
      requestRef.current++;
    };
  }, [run]);

  return { data, loading, error, refresh: run };
}
