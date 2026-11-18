import { useEffect, useState } from "react";

export type TabId = "dashboard" | "ask" | "forecast";
const TAB_IDS: TabId[] = ["dashboard", "ask", "forecast"];

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

export interface AsyncState<T> {
  data?: T;
  error?: string;
  loading: boolean;
  retry: () => void;
}

/** Loads on mount and whenever `deps` change; keeps the previous data while reloading. `null` = idle. */
export function useAsync<T>(load: (() => Promise<T>) | null, deps: unknown[]): AsyncState<T> {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Pick<AsyncState<T>, "data" | "error" | "loading">>({
    loading: load !== null,
  });

  useEffect(() => {
    if (!load) {
      setState({ loading: false });
      return;
    }
    let live = true; // a superseded request must not overwrite newer state
    setState((s) => ({ data: s.data, loading: true }));
    load().then(
      (data) => {
        if (live) setState({ data, loading: false });
      },
      (e: unknown) => {
        if (live) setState((s) => ({ data: s.data, error: errorMessage(e), loading: false }));
      },
    );
    return () => {
      live = false;
    };
    // `load` is rebuilt on every render; callers list the values it reads in `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, ...deps]);

  return { ...state, retry: () => setAttempt((a) => a + 1) };
}

const readTab = (): TabId => {
  const hash = window.location.hash.slice(1);
  return TAB_IDS.find((t) => t === hash) ?? "dashboard";
};

/** Tab state stored in location.hash (#dashboard, #ask, #forecast). */
export function useHashTab(): [TabId, (tab: TabId) => void] {
  const [tab, setTab] = useState<TabId>(readTab);

  useEffect(() => {
    const onChange = () => setTab(readTab());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return [tab, (next) => (window.location.hash = next)];
}
