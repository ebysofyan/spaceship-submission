import type { ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "./Button";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-zinc-200/70 ${className}`} />;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-4 rounded-xl border border-rose-200 bg-rose-50 p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 shrink-0 text-rose-600" size={18} aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-rose-900">Something went wrong</p>
          <p className="text-sm text-rose-800">{message}</p>
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
    <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">
      {children}
    </div>
  );
}

// Caveats from core (small base, sparse SKU, ...). Renders nothing when empty.
export function Notes({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-4 space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={14} aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
