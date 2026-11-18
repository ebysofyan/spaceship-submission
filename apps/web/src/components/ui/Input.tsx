import type { ComponentProps } from "react";

// Placeholder uses text-muted: #999 on white is too faint to read.
export const fieldClass =
  "h-10 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted aria-invalid:border-danger disabled:opacity-50";

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input {...props} className={`${fieldClass} ${className}`} />;
}
