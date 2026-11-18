import { Info } from "lucide-react";

// Definition shown as a native title tooltip: no popover to clip at narrow widths.
export function InfoHint({ label, text }: { label: string; text: string }) {
  return (
    <button
      type="button"
      title={text}
      aria-label={`${label}: ${text}`}
      className="shrink-0 rounded-full text-muted transition-colors hover:text-ink"
    >
      <Info size={14} aria-hidden="true" />
    </button>
  );
}
