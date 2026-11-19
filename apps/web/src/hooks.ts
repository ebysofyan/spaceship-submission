import { useEffect, useState } from "react";
import type { ForecastSpec } from "@app/core";

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

export interface Route {
  tab: TabId;
  params: URLSearchParams;
}

// Plain hash routing: #ask?q=<question>, #forecast?kind=…&value=…&h=…. Unknown tabs fall back to the dashboard.
export function parseRoute(hash: string): Route {
  const body = hash.replace(/^#/, "");
  const at = body.indexOf("?");
  const name = at === -1 ? body : body.slice(0, at);
  const search = at === -1 ? "" : body.slice(at + 1);
  return { tab: TAB_IDS.find((t) => t === name) ?? "dashboard", params: new URLSearchParams(search) };
}

// Same limit as the API (500 characters); anything else is ignored rather than sent to be refused.
export function askQuestion(params: URLSearchParams): string | undefined {
  const q = params.get("q")?.trim();
  return q && q.length <= 500 ? q : undefined;
}

export const askHref = (question: string) => `#ask?${new URLSearchParams({ q: question })}`;

// Once a `#ask?q=` link is asked, the query is dropped so a reload does not ask it again.
export const tabOnlyHash = (hash: string) => `#${parseRoute(hash).tab}`;

export function forecastHref(spec: ForecastSpec): string {
  const { target } = spec;
  const params = new URLSearchParams({ kind: target.kind, h: String(spec.horizonMonths) });
  if (target.kind !== "all") params.set("value", target.value);
  return `#forecast?${params}`;
}

const readRoute = (): Route => parseRoute(window.location.hash);

/** Route state from location.hash; the setter changes only the tab, so a tab click drops any query. */
export function useHashTab(): [Route, (tab: TabId) => void] {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return [route, (next) => (window.location.hash = next)];
}
