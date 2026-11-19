import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

// Collapsed by default. Used for the Ask "Details" and the dashboard "View data".
export function Disclosure({ label, bodyClassName = "", children }: { label: string; bodyClassName?: string; children: ReactNode }) {
  return (
    <details className="group rounded-control border border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-control px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-subtle [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown className="shrink-0 text-muted transition-transform group-open:rotate-180" size={16} aria-hidden="true" />
      </summary>
      <div className={`border-t border-line p-4 ${bodyClassName}`}>{children}</div>
    </details>
  );
}
