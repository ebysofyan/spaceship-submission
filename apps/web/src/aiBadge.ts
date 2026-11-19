import type { Health } from "./api";
import type { AsyncState } from "./hooks";
import type { Tone } from "./components/ui/Badge";

export interface AiBadge {
  label: string;
  tone: Tone;
  title?: string;
}

// The header badge: what is interpreting questions right now, and whether the LLM is failing over to rules.
export function aiBadge({ data, error }: AsyncState<Health>): AiBadge {
  if (error) return { label: "API offline", tone: "warn" };
  if (!data) return { label: "Checking…", tone: "neutral" };
  if (data.aiMode === "llm") {
    if (data.aiStatus === "limited") {
      return { label: "AI limit reached", tone: "warn", title: "Daily AI budget used up; using keyword matching until tomorrow (UTC)" };
    }
    if (data.aiStatus === "failing") {
      return { label: "AI fallback", tone: "warn", title: "The AI model is unavailable; using keyword matching" };
    }
    return { label: "AI", tone: "accent", title: `Questions are interpreted by ${data.model ?? "an LLM"}` };
  }
  if (data.aiMode === "rules") {
    return { label: "Keyword mode", tone: "accent", title: "Questions are interpreted by deterministic rules" };
  }
  return { label: "Unknown", tone: "neutral" };
}
