import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/** Load async data; re-runs when `deps` change. Ignores stale responses. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => id === seq.current && setState({ data, error: null, loading: false }),
      (error: Error) => id === seq.current && setState((s) => ({ data: s.data, error, loading: false })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { ...state, reload: run };
}

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Tiny store shared across components. With a `key` it is persisted to
 * localStorage and synced across tabs; with `null` it is in-memory only.
 */
export function createStore<T>(key: string | null, initial: T) {
  let value: T = initial;
  try {
    const raw = key && localStorage.getItem(key);
    if (raw) value = JSON.parse(raw) as T;
  } catch {
    /* ignore corrupt data */
  }
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  if (key) window.addEventListener("storage", (e) => {
    if (e.key !== key || !e.newValue) return;
    try {
      value = JSON.parse(e.newValue) as T;
      emit();
    } catch {
      /* ignore */
    }
  });
  return {
    get: () => value,
    set(next: T | ((prev: T) => T)) {
      value = typeof next === "function" ? (next as (p: T) => T)(value) : next;
      if (key) {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch {
          /* quota / private mode */
        }
      }
      emit();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    use(): T {
      return useSyncExternalStore(this.subscribe, this.get);
    },
  };
}

export function useOnline() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
  );
}

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
  );
}
