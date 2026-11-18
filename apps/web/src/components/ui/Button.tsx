import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "outline" | "ghost";
type Size = "md" | "sm" | "icon";

// Black label on brand green: white on #17F082 fails contrast (1.5:1).
const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control font-bold transition-colors disabled:pointer-events-none disabled:opacity-50";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-500 text-ink hover:bg-brand-600",
  outline: "border border-line bg-transparent text-ink hover:bg-subtle",
  ghost: "bg-transparent text-body hover:bg-subtle hover:text-ink",
};

const SIZES: Record<Size, string> = {
  md: "h-10 px-4 text-sm",
  sm: "h-9 px-3 text-sm",
  icon: "size-9",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type="button" {...props} className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`} />;
}

// Suggestion chips: example questions and clickable refusals.
export function Chip(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="rounded-full border border-line bg-surface px-3 py-1.5 text-left text-sm text-body transition-colors hover:bg-subtle hover:text-ink disabled:opacity-50"
    />
  );
}
