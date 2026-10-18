import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { getQlooReadiness } from './api';

/** Local setup is deliberately separate from recorded programme evidence and the live gate. */
export function QlooReadinessPanel() {
  const query = useQuery({
    queryKey: ['qloo-readiness'],
    queryFn: ({ signal }) => getQlooReadiness(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const readiness = query.data;
  return <section className="qloo-readiness" aria-label="Qloo local setup">
    <div className="qloo-readiness-heading"><strong>Qloo setup</strong><span className="badge orange">Live gate: UNVERIFIED</span></div>
    {query.isError && <p role="alert">Couldn’t read local Qloo setup: {query.error.message}. Live access remains unverified.</p>}
    {!readiness && !query.isError && <p role="status">Checking installed tools and configuration. No provider request is made.</p>}
    {readiness && <>
      <dl>
        <dt>Transport</dt><dd>{readiness.transport === 'harness' ? 'Official Qloo harness (default)' : 'Direct HTTP compatibility (explicit opt-in)'}</dd>
        <dt>API endpoint</dt><dd>{readiness.baseUrl}</dd>
        <dt>Server key</dt><dd>{readiness.configured ? 'Configured; account access is unverified' : 'Not configured; UNVERIFIED'}</dd>
        <dt>Local readiness</dt><dd>{readiness.ready ? 'READY for an explicit live check' : 'BLOCKED'}{query.isError ? ' · last retrieved result' : ''}</dd>
        <dt>Harness</dt><dd>{readiness.harness.package} · {readiness.harness.installedVersion ?? (readiness.harness.status === 'NOT_USED' ? 'not inspected' : 'not detected')} · {readiness.harness.status}</dd>
        <dt>Capabilities</dt><dd>{readiness.harness.capabilities.length ? readiness.harness.capabilities.join(', ') : 'None detected for the selected transport'}</dd>
      </dl>
      <p>{readiness.harness.message}</p>
    </>}
    <p>This is a local setup check only. Run <code>pnpm probe</code> explicitly to check provider access, mappings and complete cohort coverage. A configured key or installed harness does not verify live feasibility. Restart the API after configuration changes.</p>
    <button className="button small" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw/>{query.isFetching ? 'Checking locally…' : 'Reload setup status'}</button>
  </section>;
}
