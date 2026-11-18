import { Info } from "lucide-react";

// Definition shown as a native title tooltip: no popover to clip at narrow widths.
export function InfoHint({ label, text }: { label: string; text: string }) {
  return (
    <button
      type="button"
      title={text}
      aria-label={`${label}: ${text}`}
      className="shrink-0 rounded-full text-zinc-400 transition-colors hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <Info size={14} aria-hidden="true" />
    </button>
  );
}
