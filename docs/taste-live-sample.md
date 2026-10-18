# Live Taste DNA sample (QLOO_LIVE)

Captured 2026-10-18 from `GET /api/taste` on a local API with a real hackathon Qloo key (7 Qloo requests on a cold load, then served from the in-process cache).
Tag names/ids and film ranks only; no key, no raw payloads. Weights are relative within each cohort's top-50 Qloo theme pool, not attendance predictions.

`source=QLOO_LIVE  status=ok`

Workflow:
- qloo api /entities (30 mapped films)
- qloo api /v2/insights (urn:tag, urn:tag:theme:qloo, 3 cohorts)
- qloo api /v2/insights (urn:entity:movie fixed universe, 3 cohort ranks)
- local: tag-id intersection of film and cohort tags; deterministic template sentence (no LLM)

## Cohort taste DNA (top 8 Qloo theme tags)

**Film Society**: Emotional Growth (1), Self-Sufficiency (0.998), Dreams Vs Reality (0.982), Unrequited Love (0.964), Alternate Realities (0.955), Social Alienation (0.849), Critical Thinking (0.823), The Meaning Of Life (0.821)

**Alternative Music**: Emotion (1), Technology (0.775), Analysis (0.748), Alienation (0.741), Environmental Conservation (0.518), Isolation (0.512), Human Relationships (0.495), Introspection (0.483)

**Gaming & Speculative Fiction**: Cultural Fusion (1), Prejudice (0.77), Media Influence (0.73), Digital Culture (0.643), Anti-Capitalism (0.597), Artificial Intelligence (0.52), Environmental Issues (0.507), Human Emotion (0.493)

## Per-film `why` (deterministic template; real shared tags + Qloo rank)

- `aftersun` tags: Loss, Memory, Nostalgia, Grief, Perception vs reality, Mental health
  - Shares the Qloo themes 'memory' with Film Society, where Qloo ranks it #17 of 29 candidate films; also overlaps with 1 other cohort.
- `whiplash` tags: Ambition, Power dynamics, Artistic excellence, Sacrifice, Perfectionism, Obsession
  - Shares the Qloo themes 'power dynamics' and 'obsession' with Alternative Music, where Qloo ranks it #12 of 30 candidate films; also overlaps with 1 other cohort.
- `arrival` tags: Language, Time, Memory, Communication, Grief, Cooperation
  - Shares the Qloo themes 'language', 'time' and 'memory' with Film Society, where Qloo ranks it #13 of 29 candidate films; also overlaps with 1 other cohort.
- `akira` tags: Identity, Evolution, Friendship, Abuse of power, Rebellion, Post apocalyptic recovery
  - Shares the Qloo themes 'identity' with Gaming & Speculative Fiction, where Qloo ranks it #2 of 29 candidate films; also overlaps with 1 other cohort.

28 of 30 films share at least one theme with a cohort.
