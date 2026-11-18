import { Truck } from "lucide-react";
import type { MetaResponse } from "@app/core";
import { getHealth, getMeta, type Health } from "./api";
import { formatInt, formatMonthSpan } from "./format";
import { useAsync, useHashTab, type AsyncState, type TabId } from "./hooks";
import { Badge } from "./components/ui/Badge";
import { Tabs } from "./components/ui/Tabs";
import { ErrorState, Skeleton } from "./components/ui/States";
import { Ask } from "./views/Ask";
import { Dashboard } from "./views/Dashboard";
import { Forecast } from "./views/Forecast";

const TABS: Array<{ value: TabId; label: string }> = [
  { value: "dashboard", label: "Dashboard" },
  { value: "ask", label: "Ask" },
  { value: "forecast", label: "Forecast" },
];

export function App() {
  const [tab, setTab] = useHashTab();
  const meta = useAsync(getMeta, []);
  const health = useAsync(getHealth, []);

  return (
    <div className="min-h-screen bg-surface text-body antialiased">
      {/* One 64px row on sm+; below sm the tabs wrap onto a second row. */}
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3 sm:h-16 sm:flex-nowrap sm:px-8 sm:py-0 lg:px-16">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-control bg-ink text-white">
              <Truck size={16} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base leading-tight">Logistics Analytics</h1>
              <p className="truncate text-xs text-muted tabular-nums">{datasetLabel(meta.data)}</p>
            </div>
          </div>
          <nav className="order-last w-full sm:order-none sm:w-auto">
            <Tabs label="Sections" value={tab} options={TABS} onChange={setTab} />
          </nav>
          <AiModeBadge health={health} />
        </div>
      </header>

      <main className="mx-auto max-w-[1160px] px-4 py-8 sm:px-8 lg:px-16">
        {meta.error ? (
          <ErrorState message={meta.error} onRetry={meta.retry} />
        ) : !meta.data ? (
          <Skeleton className="h-96 w-full rounded-card" />
        ) : (
          // Kept mounted when hidden so the question history and forecast controls survive tab switches.
          <>
            <div hidden={tab !== "dashboard"}>
              <Dashboard meta={meta.data} />
            </div>
            <div hidden={tab !== "ask"}>
              <Ask meta={meta.data} />
            </div>
            <div hidden={tab !== "forecast"}>
              <Forecast meta={meta.data} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function datasetLabel(meta?: MetaResponse): string {
  if (!meta) return "Loading dataset…";
  // Each order has exactly one SKU, so summing SKU order counts gives the order total.
  const orders = meta.skus.reduce((sum, s) => sum + s.orders, 0);
  return `${formatMonthSpan(meta.dateRange.from, meta.dateRange.to)} · ${formatInt(orders)} orders`;
}

function AiModeBadge({ health }: { health: AsyncState<Health> }) {
  if (health.error) return <Badge tone="warn">API offline</Badge>;
  if (!health.data) return <Badge>Checking…</Badge>;
  if (health.data.aiMode === "llm") {
    return (
      <Badge tone="accent" title="Questions are interpreted by an LLM">
        LLM
      </Badge>
    );
  }
  if (health.data.aiMode === "rules") {
    return (
      <Badge tone="accent" title="Questions are interpreted by deterministic rules">
        Rules
      </Badge>
    );
  }
  return <Badge>Unknown</Badge>;
}
