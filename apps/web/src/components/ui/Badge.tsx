import type { HTMLAttributes } from "react";

type Tone = "neutral" | "accent" | "warn";

const TONES: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700",
  accent: "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200",
  warn: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
};

export function Badge({ tone = "neutral", className = "", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      {...props}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}
    />
  );
}
