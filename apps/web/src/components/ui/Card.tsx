import type { ReactNode } from "react";

// Flat: 1px border, no shadow.
export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={`rounded-card border border-line bg-surface ${className}`}>{children}</section>;
}

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {action}
    </header>
  );
}
