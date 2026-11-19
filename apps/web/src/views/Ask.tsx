import { useEffect, useRef, useState, type FormEvent } from "react";
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
  question: string;
  response?: AskResponse; // undefined while the answer is computed
}

export function Ask({ meta, question: deepLink, onAnswered }: { meta: MetaResponse; question?: string; onAnswered: () => void }) {
  const [draft, setDraft] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]); // newest first
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pending, setPending] = useState<string | null>(null); // question in flight; guards double-submit
  const [failed, setFailed] = useState<{ question: string; message: string } | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  const [arrived, setArrived] = useState<number | null>(null); // id of the answer that just came in
  const inputRef = useRef<HTMLInputElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const handledLink = useRef<string | undefined>(undefined); // StrictMode runs mount effects twice

  // `#ask?q=` submits once per link; leaving the link (or the Ask tab) clears it so the same link works again.
  useEffect(() => {
    if (!deepLink) handledLink.current = undefined;
    else if (handledLink.current !== deepLink) {
      handledLink.current = deepLink;
      void submit(deepLink);
    }
  }, [deepLink]);

  // Below lg the answer sits under the form and history, so bring it into view when it arrives.
  useEffect(() => {
    if (arrived === null || arrived !== selectedId || !answerRef.current) return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    answerRef.current.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [arrived]);

  async function submit(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    const id = nextId.current++;
    setDraft(q);
    setPending(q);
    setFailed(null);
    setEntries((prev) => [{ id, question: q }, ...prev]); // optimistic history entry
    setSelectedId(id);
    try {
      const response = await ask(q);
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, response } : e)));
      setArrived(id);
      inputRef.current?.focus();
    } catch (e) {
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setFailed({ question: q, message: errorMessage(e) });
    } finally {
      setPending(null);
      onAnswered();
    }
  }

  const selected = entries.find((e) => e.id === selectedId);
  const hasAnswer = entries.some((e) => e.response);
  const showChips = !hasAnswer || showExamples;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(draft);
  };

  const chips = showChips && (
    <div className="flex flex-wrap gap-2">
      {meta.examples.map((ex) => (
        <Chip key={ex} onClick={() => void submit(ex)} disabled={!!pending}>
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
        {entries.map(({ id, question, response }) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => setSelectedId(id)}
              aria-current={id === selectedId ? "true" : undefined}
              className={`w-full rounded-control px-3 py-2.5 text-left transition-colors ${
                id === selectedId ? "bg-brand-50" : "hover:bg-subtle"
              }`}
            >
              <span className="line-clamp-2 block text-sm text-ink">{question}</span>
              <span className="mt-1 block text-xs text-muted">
                {response
                  ? `${toolLabel(response.interpretation.tool)} · ${sourceLabel(response.interpretation.source)}`
                  : "Working…"}
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
            <Button type="submit" disabled={!!pending || !draft.trim()}>
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
          <Pending key={pending} question={pending} />
        ) : failed ? (
          <ErrorState message={failed.message} onRetry={() => void submit(failed.question)} />
        ) : selected?.response ? (
          <div ref={answerRef} className="scroll-mt-40">
            <AnswerCard key={selected.id} response={selected.response} examples={meta.examples} onAsk={(q) => void submit(q)} />
          </div>
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

// Shown from submit until the answer arrives, in the AnswerCard layout. The steps are static: the API
// returns one response and reports no progress, so only the first step is marked active.
export function Pending({ question }: { question: string }) {
  // The server gives no progress, so after 4 s say only that it is still working.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Card className="space-y-6 p-5 sm:p-6">
      <div>
        <p className="text-sm text-muted">{question}</p>
        <ul role="status" aria-live="polite" className="mt-3 space-y-2 text-sm">
          <Step active label="Understanding the question" />
          <Step label="Running the query" />
          <Step label="Building the chart" />
        </ul>
        {slow && <p className="mt-3 text-sm text-muted">Still working. If the AI takes more than 10 s, the answer comes from keyword matching instead.</p>}
      </div>
      <Skeleton className="h-48 w-full" />
    </Card>
  );
}

function Step({ active = false, label }: { active?: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-2 ${active ? "text-ink" : "text-muted"}`}>
      {active ? (
        <Loader2 className="animate-spin text-brand-700" size={14} aria-hidden="true" />
      ) : (
        <span className="mx-1 size-1.5 rounded-full bg-faint" aria-hidden="true" />
      )}
      {label}
    </li>
  );
}
