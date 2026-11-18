import { useEffect, useState } from "react";

type Health = "checking" | "ok" | "down";

export function App() {
  const [health, setHealth] = useState<Health>("checking");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => setHealth(res.ok ? "ok" : "down"))
      .catch(() => setHealth("down"));
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-900">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Logistics Analytics</h1>
        <p className="mt-2 text-sm text-slate-600">
          API status: <span className="font-medium">{health}</span>
        </p>
      </div>
    </main>
  );
}
