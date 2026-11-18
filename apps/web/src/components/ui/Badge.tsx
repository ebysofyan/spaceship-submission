import type { HTMLAttributes } from "react";

type Tone = "neutral" | "accent" | "warn";

// accent = brand badge (#E8FAF0 on #07713B text); used for the LLM/Rules mode.
const TONES: Record<Tone, string> = {
  neutral: "bg-subtle text-body",
  accent: "bg-brand-50 text-brand-700",
  warn: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
};

export function Badge({ tone = "neutral", className = "", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      {...props}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${TONES[tone]} ${className}`}
    />
  );
}
