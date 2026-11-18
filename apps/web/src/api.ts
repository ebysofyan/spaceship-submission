import type { AskResponse, DashboardResponse, ForecastResult, ForecastSpec, MetaResponse } from "@app/core";

// Not part of the shared contract: only the web app reads this.
export interface Health {
  ok: boolean;
  aiMode: "llm" | "rules";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error("Can't reach the server. Check that it is running.");
  }
  const body = (await res.json().catch(() => null)) as { error?: string } | T | null;
  if (!res.ok) {
    const message = body && typeof body === "object" && "error" in body ? body.error : undefined;
    throw new Error(message ?? `Request failed (${res.status}).`);
  }
  return body as T;
}

function post<T>(path: string, data: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}

export const getHealth = () => request<Health>("/api/health");
export const getMeta = () => request<MetaResponse>("/api/meta");
export const getDashboard = () => request<DashboardResponse>("/api/dashboard");
export const ask = (question: string) => post<AskResponse>("/api/ask", { question });
export const forecast = (spec: ForecastSpec) => post<ForecastResult>("/api/forecast", spec);
