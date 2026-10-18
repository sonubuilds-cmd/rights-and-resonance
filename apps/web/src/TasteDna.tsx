import { useQuery } from '@tanstack/react-query';
import { Dna, RefreshCw, Sparkles } from 'lucide-react';
import type { Cohort, Film } from '@rr/domain';
import { getTaste, type TasteProfile, type TasteTag } from './api';
import './taste.css';

export function useTaste() {
  return useQuery({ queryKey: ['taste'], queryFn: ({ signal }) => getTaste(signal), staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: false });
}

const cohortHue = (cohorts: Cohort[], id: string) => `hue-${Math.max(0, cohorts.findIndex(c => c.id === id)) % 3}`;

/** The provenance badge is the first thing a reader sees: where did these tags come from? */
export function SourceBadge({ taste }: { taste?: TasteProfile }) {
  if (!taste) return <span className="badge neutral">Source loading</span>;
  const live = taste.source === 'QLOO_LIVE';
  return <span className={`badge source-badge ${live ? 'green' : 'orange'}`} title={live ? 'Tags returned by the Qloo API' : 'Tags derived from a local, fictional fixture'}>
    {live ? 'Qloo live' : 'Synthetic demo'}{taste.status !== 'ok' ? ` · ${taste.status}` : ''}
  </span>;
}

function Chip({ tag, hue, shared }: { tag: TasteTag; hue?: string; shared?: boolean }) {
  return <li className={`taste-chip ${hue ?? ''} ${shared ? 'is-shared' : ''}`} style={{ ['--w' as string]: tag.weight }} title={`Relative weight ${Math.round(tag.weight * 100)}%`}>
    <span className="taste-chip-bar" aria-hidden="true" /><span className="taste-chip-name">{tag.name}</span><span className="taste-chip-w">{Math.round(tag.weight * 100)}</span>
  </li>;
}

/** Inline "Why this film" block shown on each selected film in the programme. */
export function WhyThisFilm({ taste, film, cohorts }: { taste?: TasteProfile; film: Film; cohorts: Cohort[] }) {
  const entry = taste?.films.find(f => f.filmId === film.id);
  if (!taste || taste.status === 'unavailable' || !entry) return null;
  const synthetic = taste.source === 'SYNTHETIC_DEMO';
  return <div className="why-film" aria-label={`Why ${film.title}`}>
    <div className="why-film-head"><Sparkles aria-hidden="true" /><span className="why-label">Why this film</span><SourceBadge taste={taste} /></div>
    <p className="why-text">{entry.why}</p>
    {entry.sharedTags.length > 0 && <ul className="why-links">{entry.sharedTags.map(s => {
      const cohort = cohorts.find(c => c.id === s.cohortId);
      return <li key={s.cohortId} className={`why-link ${cohortHue(cohorts, s.cohortId)}`}>
        <span className="why-cohort">{cohort?.name ?? s.cohortId}</span>
        <ul className="why-tags">{s.tagIds.map(id => <li key={id}>{entry.tags.find(t => t.id === id)?.name ?? id}</li>)}</ul>
      </li>;
    })}</ul>}
    {synthetic && <p className="why-note">Illustrative tags from the demo fixture, not Qloo output.</p>}
  </div>;
}

/** Full Taste DNA surface: provenance, workflow, and per-cohort weighted tag chips. */
export function TasteDnaPanel({ cohorts, films }: { cohorts: Cohort[]; films: Film[] }) {
  const query = useTaste();
  const taste = query.data;
  return <div className="taste-dna">
    <section className={`taste-banner ${taste?.source === 'QLOO_LIVE' ? 'live' : 'synthetic'}`} aria-label="Taste DNA provenance">
      <div className="taste-banner-main">
        <Dna aria-hidden="true" />
        <div>
          <div className="eyebrow">Provenance</div>
          <h2>Taste DNA <SourceBadge taste={taste} /></h2>
          <p>{query.isError ? `Couldn’t load Taste DNA: ${query.error.message}` : taste ? taste.message ?? 'Tags and weights describe relative group tendencies, not attendance predictions.' : 'Loading taste tags…'}</p>
        </div>
        <button className="button small" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw />{query.isFetching ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {taste && taste.workflow.length > 0 && <div className="taste-workflow"><span className="eyebrow">Workflow</span>
        <ol>{taste.workflow.map((step, i) => <li key={step}><span className="step-n">{i + 1}</span><code>{step}</code></li>)}</ol></div>}
    </section>
    {taste?.status === 'unavailable' && <div className="alert warning" role="alert"><div>{taste.message}</div></div>}
    {taste && taste.cohorts.length > 0 && <div className="taste-cohorts">
      {taste.cohorts.map(c => {
        const cohort = cohorts.find(x => x.id === c.cohortId);
        const served = taste.films.filter(f => f.sharedTags.some(s => s.cohortId === c.cohortId)).length;
        return <article key={c.cohortId} className={`taste-cohort ${cohortHue(cohorts, c.cohortId)}`}>
          <header><h3>{cohort?.name ?? c.cohortId}</h3><span className="taste-count">{served}/{films.length} films share tags</span></header>
          {cohort && <p>{cohort.description}</p>}
          <ul className="taste-chips" aria-label={`${cohort?.name ?? c.cohortId} taste tags`}>{c.tags.map(t => <Chip key={t.id} tag={t} hue={cohortHue(cohorts, c.cohortId)} />)}</ul>
        </article>;
      })}
    </div>}
    {taste && <p className="section-note">Chip numbers are relative weights (strongest tag = 100) within a cohort. They describe group tendencies, not predictions of who will attend. Generate a programme to see “Why this film” on each selected title.</p>}
  </div>;
}
