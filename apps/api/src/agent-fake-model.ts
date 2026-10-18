/**
 * Scripted stand-in for Gemini, used ONLY when AGENT_FAKE_MODEL=scripted and NODE_ENV !== 'production'
 * (see loadAgentConfig). It drives the real tool loop with deterministic, keyword-selected tool plans and writes its
 * final answer purely from the real tool outputs it receives. The UI labels it "scripted demo model" so nobody
 * mistakes it for Gemini. It exists for screenshots, offline demos and e2e checks.
 */
import type { GeminiContent, GeminiPart, GenerateFn, GenerateRequest, GenerateResponse } from './agent-chat.js';

type Call = { name: string; args: Record<string, unknown> };
type Out = Record<string, any>;

const outputs = (contents: GeminiContent[], from: number) => {
  const map = new Map<string, Out>();
  for (const c of contents.slice(from)) for (const p of c.parts) if (p.functionResponse) map.set(p.functionResponse.name, p.functionResponse.response as Out);
  return map;
};
const turnStart = (contents: GeminiContent[]) => {
  for (let i = contents.length - 1; i >= 0; i--) if (contents[i]!.role === 'user' && contents[i]!.parts.some(p => typeof p.text === 'string')) return i;
  return 0;
};
const callsMade = (contents: GeminiContent[], from: number): string[] =>
  contents.slice(from).flatMap(c => c.role === 'model' ? c.parts.filter(p => p.functionCall).map(p => p.functionCall!.name) : []);

const callPart = (n: number, call: Call): GeminiPart => ({ functionCall: { id: `scripted-${n}`, name: call.name, args: call.args } });
const reply = (text: string): GenerateResponse => ({ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' });

function programmeText(o: Out, lead: string) {
  const films: any[] = o.data?.programme?.films ?? o.data?.repairDraft?.films ?? [];
  if (!films.length) return `${lead}\n\n${o.summary ?? ''}`;
  const lines = films.map(f => `- **${f.title}** (${f.slot}, ${f.fee}). ${f.why}`);
  const d = o.data.programme ?? o.data.repairDraft;
  return `${lead}\n\n${lines.join('\n')}\n\nTotal licence cost ${d.totalCost} of ${d.budget}; the least-served audience scores ${d.leastCoveredCohortScore}. Evidence: ${d.evidenceSource}. These are rank-based cultural fits, not attendance forecasts, and rights and fees are synthetic. The draft is not approved: tell me if you want to approve version ${d.version}.`;
}

export const scriptedGenerate: GenerateFn = async (request: GenerateRequest): Promise<GenerateResponse> => {
  const { contents } = request;
  const from = turnStart(contents);
  const text = (contents[from]?.parts.find(p => typeof p.text === 'string')?.text ?? '').toLowerCase();
  const out = outputs(contents, from);
  const done = callsMade(contents, from);
  const next = (call: Call) => ({ content: { role: 'model' as const, parts: [callPart(done.length + 1, call)] }, finishReason: 'STOP' });
  const ws = out.get('get_workspace')?.data;
  const hasProgramme = (ws?.programmes?.length ?? 0) > 0;

  // Interface events (e.g. the approval button) are handled without the model, but keep a polite fallback.
  if (/\bapprove\b/.test(text) && !/rights|fell through/.test(text)) {
    if (!out.has('get_workspace')) return next({ name: 'get_workspace', args: {} });
    const draft = [...(ws?.programmes ?? [])].reverse().find((p: any) => p.status === 'DRAFT');
    if (!draft) return reply('There is no draft programme to approve yet. Ask me to plan the season first.');
    if (!out.has('approve_programme')) return next({ name: 'approve_programme', args: { versionId: draft.versionId } });
    return reply(`Version ${draft.version} (${draft.films.join(', ')}) is ready for your decision. I cannot approve it myself: press **Confirm approval** below if you are happy with it.`);
  }

  if (/rights|fell through|fall through|withdraw/.test(text)) {
    if (!out.has('get_workspace')) return next({ name: 'get_workspace', args: {} });
    if (!hasProgramme && !out.has('generate_programme')) return next({ name: 'generate_programme', args: {} });
    if (!out.has('search_films')) return next({ name: 'search_films', args: { query: /her\b/.test(text) ? 'Her' : 'Aftersun', limit: 12 } });
    const films: any[] = out.get('search_films')?.data?.films ?? [];
    const target = films.find(f => f.title === 'Her') ?? films[0];
    if (!target) return reply('I could not find that film in the catalogue, so I changed nothing.');
    if (!out.has('withdraw_rights')) return next({ name: 'withdraw_rights', args: { filmId: target.id, reason: 'Rights holder withdrew the licence (simulated).' } });
    const w = out.get('withdraw_rights');
    if (w?.ok === false) return reply(`The change did not go through: ${w.error?.message}`);
    const diff = w?.data?.diff;
    const swaps = (diff?.slots ?? []).filter((s: any) => s.changed).map((s: any) => `${s.slot}: ${s.before?.title} becomes **${s.after?.title}**`);
    return reply(programmeText(w ?? {}, `I marked the synthetic rights to **${target.title}** as withdrawn. ${swaps.length ? `The solver's minimal-change repair swaps ${swaps.join('; ')}.` : (w?.summary ?? '')} Here is the repair draft.`));
  }

  if (/gaming|speculative|sci-?fi|science fiction/.test(text)) {
    if (!out.has('get_taste_dna')) return next({ name: 'get_taste_dna', args: { cohortId: 'gaming-speculative' } });
    if (!out.has('search_films')) return next({ name: 'search_films', args: { query: 'science fiction', eligibleOnly: true, limit: 6 } });
    const taste = out.get('get_taste_dna')?.data;
    const films: any[] = out.get('search_films')?.data?.films ?? [];
    const ranked = new Map<string, any>();
    for (const f of taste?.films ?? []) ranked.set(f.filmId, f);
    const pick = films.map(f => ({ f, t: ranked.get(f.id), n: ranked.get(f.id)?.sharedWithCohorts?.find((x: any) => x.cohortId === 'gaming-speculative')?.sharedThemes?.length ?? 0 })).sort((a, b) => b.n - a.n)[0]?.f ?? films[0];
    if (!pick) return reply('No eligible science-fiction film turned up in the catalogue.');
    if (!out.has('explain_film')) return next({ name: 'explain_film', args: { filmId: pick.id } });
    const e = out.get('explain_film')?.data;
    const fit = (e?.cohortFit ?? []).find((c: any) => c.cohortId === 'gaming-speculative');
    const themes = e?.qlooThemes?.sharedWithCohorts?.find((c: any) => c.cohortId === 'gaming-speculative')?.sharedThemes ?? [];
    return reply(`For **${taste?.cohorts?.[0]?.cohort ?? 'Gaming & Speculative Fiction'}**, the strongest eligible fit I can show is **${e?.film?.title}**. ${fit?.rank ? `It ranks #${fit.rank} of ${fit.of} candidates for that cohort` : 'Its rank for that cohort is unknown'} (${e?.evidenceSource}). ${themes.length ? `It shares the themes ${themes.map((t: string) => `"${t}"`).join(', ')} with the cohort's seeds.` : ''} ${e?.qlooThemes?.why ?? ''}\n\nRank is cultural relevance within this catalogue, not a forecast of attendance.`);
  }

  if (/plan|season|programme|program|night|slate|pick/.test(text)) {
    if (!out.has('get_workspace')) return next({ name: 'get_workspace', args: {} });
    if (!out.has('get_taste_dna')) return next({ name: 'get_taste_dna', args: {} });
    if (!out.has('generate_programme')) return next({ name: 'generate_programme', args: {} });
    const g = out.get('generate_programme');
    if (g?.ok === false) return reply(`The solver could not produce a programme: ${g.error?.message}`);
    const films: any[] = g?.data?.programme?.films ?? [];
    const explained = done.filter(n => n === 'explain_film').length;
    if (explained < Math.min(2, films.length)) return next({ name: 'explain_film', args: { filmId: films[explained]?.filmId } });
    return reply(programmeText(g ?? {}, `I drafted the two-night season with the constrained solver, using the cohorts' Taste DNA. Each pick and why it earns its slot:`));
  }

  if (!out.has('get_workspace')) return next({ name: 'get_workspace', args: {} });
  return reply(`${out.get('get_workspace')?.summary ?? ''}\n\nThis is the scripted demo model, so I only follow a few built-in plans: try planning the season, asking which film serves the Gaming & Speculative Fiction crowd, or a rights change to Her.`);
};
