# Demonstration data

`demo-fixture.json` is an inspectable export of the default data. The authoritative, fresh-copy fixture factory is `createDemoData()` in `@rr/domain`. It contains exactly 30 films, 3 fictional cross-domain cohorts and 4 dated screening slots at the fictional Lantern Cinema in Bristol.

**Every rights availability, licence fee and affinity number is synthetic.** They are not Qloo responses, real distributor terms, bookings, market evidence or attendance predictions. Curated film metadata is illustrative and should be checked against the licensor before use. Cohorts are Film Society, Alternative Music, and Gaming & Speculative Fiction, with artist/book/movie/video-game seed examples. All Qloo mappings start UNMAPPED, with null entity IDs; live mode must verify mappings independently.

The fixture deliberately includes an unavailable licence (Drive), an incompatible territory (Blade Runner 2049) and a format mismatch (Blade Runner). Solver evidence is kept on the same fixed 30-film universe even when eligibility changes. Initial budget: GBP 1,850 (185000 integer pence). Dates: 16–17 October 2026. UTC storage; Europe/London presentation.

Synthetic affinity assumptions are intentionally illustrative: Film Society leans toward intimate/literary cinema; Alternative Music toward music-led and sonically distinctive films; Gaming & Speculative Fiction toward imagined worlds. Bridges such as Her can serve more than one cohort. These values are not evidence about real fans. Distributor labels are fictional placeholders and must never be used as real recipients.
