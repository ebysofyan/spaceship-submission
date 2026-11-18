import type { ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "./Button";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-control bg-line/60 ${className}`} />;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-4 rounded-card border border-danger bg-danger-50 p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 shrink-0 text-danger" size={18} aria-hidden="true" />
        <div>
          <p className="text-sm font-bold text-ink">Something went wrong</p>
          <p className="text-sm text-body">{message}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry} className="self-start sm:self-auto">
        <RotateCw size={14} aria-hidden="true" />
        Retry
      </Button>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line bg-surface p-8 text-center text-sm text-muted">{children}</div>
  );
}

// Caveats from core (small base, sparse SKU, ...). Renders nothing when empty.
export function Notes({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-4 space-y-2 rounded-control bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={14} aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
