import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { getQlooReadiness } from './api';

/** Local setup is deliberately separate from recorded programme evidence and the live gate. */
export function QlooReadinessPanel({ verifiedAt, verifiedVia, blocked = false }: { verifiedAt?: string; verifiedVia?: 'EVIDENCE' | 'TASTE'; blocked?: boolean }) {
  const query = useQuery({
    queryKey: ['qloo-readiness'],
    queryFn: ({ signal }) => getQlooReadiness(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const readiness = query.data;
  const healthy = Boolean(verifiedAt) && !blocked;
  const time = verifiedAt ? new Date(verifiedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  const badge = blocked ? <span className="badge orange">Live · last run blocked</span> : verifiedAt ? <span className="badge green">LIVE · verified {time}</span> : <span className="badge orange">Live · not yet verified</span>;
  const via = verifiedVia === 'TASTE' ? 'a complete live Taste DNA load' : 'a complete live evidence fetch';
  const body = <>
    {query.isError && <p role="alert">Couldn’t read local Qloo setup: {query.error.message}. Live status is taken from the last server response.</p>}
    {!readiness && !query.isError && <p role="status">Checking installed tools and configuration. No provider request is made.</p>}
    {readiness && <>
      <dl>
        <dt>Transport</dt><dd>{readiness.transport === 'harness' ? 'Official Qloo harness (default)' : 'Direct HTTP compatibility (explicit opt-in)'}</dd>
        <dt>API endpoint</dt><dd>{readiness.baseUrl}</dd>
        <dt>Server key</dt><dd>{readiness.configured ? (verifiedAt ? 'Configured; live access verified' : 'Configured; no complete live response yet') : 'Not configured; UNVERIFIED'}</dd>
        <dt>Local readiness</dt><dd>{readiness.ready ? 'READY for an explicit live check' : 'BLOCKED'}{query.isError ? ' · last retrieved result' : ''}</dd>
        <dt>Harness</dt><dd>{readiness.harness.package} · {readiness.harness.installedVersion ?? (readiness.harness.status === 'NOT_USED' ? 'not inspected' : 'not detected')} · {readiness.harness.status}</dd>
        <dt>Capabilities</dt><dd>{readiness.harness.capabilities.length ? readiness.harness.capabilities.join(', ') : 'None detected for the selected transport'}</dd>
      </dl>
      <p>{readiness.harness.message}</p>
    </>}
    <p>This is a local setup check only. Live verification comes from a complete, fresh Qloo response in this server process; a configured key or installed harness alone does not verify anything. Run <code>pnpm probe</code> for an explicit full check. Restart the API after configuration changes.</p>
    <button className="button small" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw/>{query.isFetching ? 'Checking locally…' : 'Reload setup status'}</button>
  </>;
  return <section className={`qloo-readiness${healthy ? ' compact' : ''}`} aria-label="Qloo local setup">
    {healthy ? <details><summary><strong>Qloo</strong>{badge}<span className="qloo-oneline">Live evidence verified via {via} in this server process.</span></summary>{body}</details> : <>
      <div className="qloo-readiness-heading"><strong>Qloo setup</strong>{badge}</div>{body}</>}
  </section>;
}
