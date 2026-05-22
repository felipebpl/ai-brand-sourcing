import { useQuery } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

type Health = {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  checks: { database: 'ok' | 'fail' };
};

async function fetchHealth(): Promise<Health> {
  const res = await fetch(`${API_BASE_URL}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json() as Promise<Health>;
}

export function App() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 5_000,
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-12">
        <h1 className="text-3xl font-semibold tracking-tight">ai-brand-sourcing</h1>
        <p className="mt-2 text-neutral-400">
          Multi-agent supplier negotiation, from XLSX to Purchase Order.
        </p>
      </header>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
          API connectivity
        </h2>
        <div className="mt-3 font-mono text-sm">
          {isLoading && <span className="text-neutral-500">checking…</span>}
          {error && (
            <span className="text-red-400">
              error: {error instanceof Error ? error.message : 'unknown'}
            </span>
          )}
          {data && (
            <div className="space-y-1">
              <div>
                status:{' '}
                <span
                  className={
                    data.status === 'ok' ? 'text-emerald-400' : 'text-amber-400'
                  }
                >
                  {data.status}
                </span>
              </div>
              <div>uptime: {data.uptimeSeconds}s</div>
              <div>
                db:{' '}
                <span
                  className={
                    data.checks.database === 'ok'
                      ? 'text-emerald-400'
                      : 'text-red-400'
                  }
                >
                  {data.checks.database}
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="mt-12 text-sm text-neutral-500">
        <p>
          Backend at <code className="text-neutral-300">{API_BASE_URL}</code>.
          OpenAPI docs at{' '}
          <a
            href={`${API_BASE_URL}/docs`}
            target="_blank"
            rel="noreferrer"
            className="text-neutral-300 underline hover:text-white"
          >
            /docs
          </a>
          .
        </p>
      </section>
    </main>
  );
}
