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

  const run = useCallback(() => {
    setLoading(true);
    setError(null);
    fetcherRef
      .current()
      .then((result) => {
        setData(result);
        onSuccessRef.current?.(result);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { data, loading, error, refresh: run };
}
