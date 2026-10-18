// Taste DNA (v0.3). Contract: docs/taste-contract.md
import { z } from 'zod';
import { createDemoData, type DemoData } from './index';

export const TasteSourceSchema = z.enum(['QLOO_LIVE', 'SYNTHETIC_DEMO']);
export type TasteSource = z.infer<typeof TasteSourceSchema>;
export const TasteTagSchema = z.object({ id: z.string().min(1), name: z.string().min(1), weight: z.number().min(0).max(1) });
export type TasteTag = z.infer<typeof TasteTagSchema>;
export const TasteProfileSchema = z.object({
  source: TasteSourceSchema,
  generatedAt: z.string().datetime(),
  workflow: z.array(z.string()),
  cohorts: z.array(z.object({ cohortId: z.string(), tags: z.array(TasteTagSchema) })),
  films: z.array(z.object({
    filmId: z.string(), tags: z.array(TasteTagSchema),
    sharedTags: z.array(z.object({ cohortId: z.string(), tagIds: z.array(z.string()) })),
    why: z.string(),
  })),
  status: z.enum(['ok', 'partial', 'unavailable']),
  message: z.string().optional(),
});
export type TasteProfile = z.infer<typeof TasteProfileSchema>;

/** Fixed so the synthetic profile is byte-for-byte reproducible. */
export const SYNTHETIC_TASTE_GENERATED_AT = '2026-10-01T00:00:00.000Z';
export const SYNTHETIC_TASTE_MESSAGE = 'SYNTHETIC DEMO: tags are derived from the local demo fixture (film genres/themes weighted by fictional cohort affinities). No Qloo response is involved.';
const tagId = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const round = (n: number) => Math.round(n * 1000) / 1000;
const joinNames = (names: string[]) => names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/**
 * Deterministic, clearly synthetic Taste DNA built only from the demo fixture.
 * Weights are relative group tendencies, not attendance predictions.
 */
export function createSyntheticTasteProfile(demo: Pick<DemoData, 'films' | 'cohorts' | 'affinities'> = createDemoData()): TasteProfile {
  const filmTags = new Map<string, TasteTag[]>();
  for (const film of demo.films) {
    const raw = new Map<string, TasteTag>();
    film.themes.forEach((name, i) => raw.set(tagId(name), { id: tagId(name), name, weight: round(0.95 - i * 0.12) }));
    film.genres.forEach((name, i) => { if (!raw.has(tagId(name))) raw.set(tagId(name), { id: tagId(name), name: name.toLowerCase(), weight: round(0.6 - i * 0.08) }); });
    filmTags.set(film.id, [...raw.values()].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id)).slice(0, 6));
  }
  // Sum of affinity-squared-weighted tag mass per cohort; then emphasise what is distinctive to a cohort
  // (lift over the all-cohort mean) so ubiquitous genres such as "drama" do not swamp every cohort.
  const sums = demo.cohorts.map(cohort => {
    const acc = new Map<string, { name: string; sum: number }>();
    for (const film of demo.films) {
      const a = demo.affinities[cohort.id]?.[film.id];
      if (typeof a !== 'number') continue;
      for (const tag of filmTags.get(film.id)!) {
        const cur = acc.get(tag.id) ?? { name: tag.name, sum: 0 };
        cur.sum += a * a * tag.weight; acc.set(tag.id, cur);
      }
    }
    return acc;
  });
  const mean = (id: string) => sums.reduce((t, m) => t + (m.get(id)?.sum ?? 0), 0) / Math.max(sums.length, 1);
  const cohorts = demo.cohorts.map((cohort, i) => {
    const scored = [...sums[i]!.entries()].map(([id, v]) => ({ id, name: v.name, score: v.sum * (v.sum / (mean(id) || 1)) }));
    const max = Math.max(...scored.map(v => v.score), 1e-9);
    const tags = scored.map(v => ({ id: v.id, name: v.name, weight: round(v.score / max) }))
      .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id)).slice(0, 8);
    return { cohortId: cohort.id, tags };
  });
  const films = demo.films.map(film => {
    const tags = filmTags.get(film.id)!;
    const shared = cohorts.map(c => {
      const own = new Map(c.tags.map(t => [t.id, t.weight]));
      const tagIds = tags.filter(t => own.has(t.id)).map(t => t.id);
      return { cohortId: c.cohortId, tagIds, score: tagIds.reduce((s, id) => s + own.get(id)! * tags.find(t => t.id === id)!.weight, 0) };
    }).filter(s => s.tagIds.length > 0).sort((a, b) => b.score - a.score || a.cohortId.localeCompare(b.cohortId));
    const best = shared[0];
    const bestCohort = best && demo.cohorts.find(c => c.id === best.cohortId);
    const names = best ? best.tagIds.slice(0, 3).map(id => `'${tags.find(t => t.id === id)!.name}'`) : [];
    const why = best && bestCohort
      ? `Shares ${joinNames(names)} with ${bestCohort.name}${shared.length > 1 ? `, and overlaps with ${shared.length - 1} other cohort${shared.length > 2 ? 's' : ''}` : ''}.`
      : 'No strong tag overlap with any cohort; selected on other constraints.';
    return { filmId: film.id, tags, sharedTags: shared.map(({ cohortId, tagIds }) => ({ cohortId, tagIds })), why };
  });
  return {
    source: 'SYNTHETIC_DEMO', generatedAt: SYNTHETIC_TASTE_GENERATED_AT,
    workflow: ['synthetic: film genres + themes (demo fixture)', 'synthetic: cohort affinity-weighted tag aggregation', 'synthetic: film ∩ cohort tag overlap'],
    cohorts, films, status: 'ok', message: SYNTHETIC_TASTE_MESSAGE,
  };
}
