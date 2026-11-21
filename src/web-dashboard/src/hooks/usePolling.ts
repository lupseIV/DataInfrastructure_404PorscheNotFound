import { useCallback, useEffect, useRef, useState } from "react";

export interface PollingState<T> {
  data: T | null;
  /** Message of the last failed request; cleared by the next successful one. */
  error: string | null;
  /** Time of the last successful response (ms). */
  updatedAt: number | null;
  /** True until the first response (or error) for the current key. */
  loading: boolean;
}

/**
 * Calls `fetcher` now and then every `intervalMs`, waiting for each request to
 * finish before scheduling the next. When a request fails, the last good data
 * stays on screen and `error` is set. Changing `key` starts over with empty
 * data; `key = null` pauses polling.
 */
export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  key: string | null,
): PollingState<T> & { refresh: () => void } {
  const [state, setState] = useState<PollingState<T>>({
    data: null,
    error: null,
    updatedAt: null,
    loading: key !== null,
  });

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (key === null) {
      setState({ data: null, error: null, updatedAt: null, loading: false });
      refreshRef.current = () => {};
      return;
    }

    let active = true;
    let timer: number | undefined;
    let controller: AbortController | undefined;

    setState({ data: null, error: null, updatedAt: null, loading: true });

    const run = async () => {
      window.clearTimeout(timer);
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const data = await fetcherRef.current(current.signal);
        if (!active || current.signal.aborted) return;
        setState({ data, error: null, updatedAt: Date.now(), loading: false });
      } catch (err) {
        if (!active || current.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, error: message, loading: false }));
      }
      if (active && controller === current) {
        timer = window.setTimeout(run, intervalMs);
      }
    };

    refreshRef.current = () => void run();
    void run();

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [key, intervalMs]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { ...state, refresh };
}
