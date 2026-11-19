import { useRef, useState, type FormEvent } from "react";
import { ChevronDown, Loader2, Search, Send } from "lucide-react";
import type { AskResponse, MetaResponse } from "@app/core";
import { ask } from "../api";
import { errorMessage } from "../hooks";
import { AnswerCard } from "./AskAnswer";
import { Button, Chip } from "../components/ui/Button";
import { Card, CardHeader } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { sourceLabel, toolLabel } from "../format";

interface Entry {
  id: number;
  response: AskResponse;
}

export function Ask({ meta, onAnswered }: { meta: MetaResponse; onAnswered: () => void }) {
  const [draft, setDraft] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]); // newest first
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<{ question: string; message: string } | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  async function submit(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setDraft(q);
    setPending(true);
    setFailed(null);
    try {
      const response = await ask(q);
      const id = nextId.current++;
      setEntries((prev) => [{ id, response }, ...prev]);
      setSelectedId(id);
      inputRef.current?.focus();
    } catch (e) {
      setFailed({ question: q, message: errorMessage(e) });
    } finally {
      setPending(false);
      onAnswered();
    }
  }

  const selected = entries.find((e) => e.id === selectedId);
  const hasAnswer = entries.length > 0;
  const showChips = !hasAnswer || showExamples;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(draft);
  };

  const chips = showChips && (
    <div className="flex flex-wrap gap-2">
      {meta.examples.map((ex) => (
        <Chip key={ex} onClick={() => void submit(ex)} disabled={pending}>
          {ex}
        </Chip>
      ))}
    </div>
  );

  const list =
    entries.length === 0 ? (
      <p className="p-5 text-sm text-muted">Questions you ask this session will be listed here.</p>
    ) : (
      <ul className="max-h-[70vh] space-y-1 overflow-y-auto p-2">
        {entries.map(({ id, response }) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => setSelectedId(id)}
              aria-current={id === selectedId ? "true" : undefined}
              className={`w-full rounded-control px-3 py-2.5 text-left transition-colors ${
                id === selectedId ? "bg-brand-50" : "hover:bg-subtle"
              }`}
            >
              <span className="line-clamp-2 block text-sm text-ink">{response.question}</span>
              <span className="mt-1 block text-xs text-muted">
                {toolLabel(response.interpretation.tool)} · {sourceLabel(response.interpretation.source)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  const history = (
    <Card>
      <CardHeader title="History" />
      {list}
    </Card>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
      <div className="min-w-0 space-y-6">
        <section className="space-y-3">
          <form onSubmit={onSubmit} className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} aria-hidden="true" />
              <Input
                ref={inputRef}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setFailed(null);
                }}
                placeholder="Ask about orders, carriers, delays or demand"
                aria-label="Ask a question"
                className="pl-9"
              />
            </div>
            <Button type="submit" disabled={pending || !draft.trim()}>
              {pending ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
              Ask
            </Button>
          </form>
          {hasAnswer && (
            <button
              type="button"
              onClick={() => setShowExamples((v) => !v)}
              aria-expanded={showExamples}
              className="inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-ink"
            >
              Examples
              <ChevronDown className={`transition-transform ${showExamples ? "rotate-180" : ""}`} size={14} aria-hidden="true" />
            </button>
          )}
          {chips}
        </section>

        {pending ? (
          <Working />
        ) : failed ? (
          <ErrorState message={failed.message} onRetry={() => void submit(failed.question)} />
        ) : selected ? (
          <AnswerCard key={selected.id} response={selected.response} examples={meta.examples} onAsk={(q) => void submit(q)} />
        ) : (
          <EmptyState>Ask a question to get started. Answers and the reasoning behind them appear here.</EmptyState>
        )}
      </div>

      {/* Below the answer on small screens (collapsed when long); a sidebar on lg. */}
      <aside className="min-w-0">
        <div className="lg:hidden">
          {entries.length > 3 ? (
            <details className="group rounded-card border border-line bg-surface">
              <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-bold text-ink [&::-webkit-details-marker]:hidden">
                History ({entries.length})
                <ChevronDown className="text-muted transition-transform group-open:rotate-180" size={16} aria-hidden="true" />
              </summary>
              <div className="border-t border-line p-2">{list}</div>
            </details>
          ) : (
            history
          )}
        </div>
        <div className="hidden lg:block">{history}</div>
      </aside>
    </div>
  );
}

function Working() {
  return (
    <Card className="p-5 sm:p-6">
      <div role="status" className="flex items-center gap-3 text-sm text-body">
        <Loader2 className="animate-spin text-brand-700" size={18} aria-hidden="true" />
        Working out the answer…
      </div>
      <div className="mt-5 space-y-3" aria-hidden="true">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-48 w-full" />
      </div>
    </Card>
  );
}
