import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import type { AppState } from './types.js';

export interface StateStore {
  kind: 'memory' | 'postgres';
  read(id: string): Promise<AppState>;
  update<T>(id: string, fn: (state: AppState) => Promise<T> | T): Promise<T>;
  reset(id: string): Promise<AppState>;
  close(): Promise<void>;
}
export class MemoryStore implements StateStore {
  readonly kind = 'memory' as const;
  private states = new Map<string, AppState>();
  private locks = new Map<string, Promise<void>>();
  constructor(private factory: () => AppState) {}
  async read(id: string) {
    await this.locks.get(id);
    if (!this.states.has(id)) {
      if (this.states.size >= 1000) this.states.delete(this.states.keys().next().value!);
      this.states.set(id, this.factory());
    }
    return structuredClone(this.states.get(id)!);
  }
  async update<T>(id: string, fn: (state: AppState) => Promise<T> | T): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const lock = new Promise<void>(resolve => { release = resolve; });
    this.locks.set(id, lock);
    await previous;
    try {
      const state = structuredClone(this.states.get(id) ?? this.factory());
      const result = await fn(state);
      this.states.set(id, structuredClone(state));
      return structuredClone(result);
    } finally {
      release();
      if (this.locks.get(id) === lock) this.locks.delete(id);
    }
  }
  async reset(id: string) {
    return this.update(id, state => {
      const fresh = this.factory();
      Object.assign(state, fresh);
      return state;
    });
  }
  /** Drop a session's workspace (used by bounded MCP session expiry). */
  discard(id: string) { this.states.delete(id); this.locks.delete(id); }
  async close() {}
}
export class PostgresStore implements StateStore {
  readonly kind = 'postgres' as const;
  private pool: Pool;
  constructor(url: string, private factory: () => AppState) { this.pool = new Pool({ connectionString: url, max: 8 }); }
  async migrate() {
    const sql = await readFile(new URL('../db/migrations/001_initial.sql', import.meta.url), 'utf8');
    await this.pool.query(sql);
  }
  async read(id: string) { return this.update(id, state => structuredClone(state)); }
  async update<T>(id: string, fn: (state: AppState) => Promise<T> | T): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // INSERT serializes first-use races; SELECT FOR UPDATE serializes all subsequent writes.
      await client.query('INSERT INTO rr_sessions(id,state_json) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, this.factory()]);
      const { rows } = await client.query<{ state_json: AppState }>('SELECT state_json FROM rr_sessions WHERE id=$1 FOR UPDATE', [id]);
      const state = rows[0]!.state_json;
      const result = await fn(state);
      await client.query('UPDATE rr_sessions SET state_json=$2,revision=$3,updated_at=now() WHERE id=$1', [id, state, state.revision]);
      await this.project(client, id, state);
      await client.query('COMMIT');
      return structuredClone(result);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private async project(c: PoolClient, id: string, s: AppState) {
    for (const film of s.films) await c.query('INSERT INTO rr_films VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(session_id,id) DO UPDATE SET title=$3,film_year=$4,runtime_minutes=$5,metadata=$6,rights=$7', [id,film.id,film.title,film.year,film.runtimeMinutes,film,film.rights]);
    for (const cohort of s.cohorts) await c.query('INSERT INTO rr_cohorts VALUES($1,$2,$3,$4,$5) ON CONFLICT(session_id,id) DO UPDATE SET name=$3,seeds=$4,metadata=$5', [id,cohort.id,cohort.name,JSON.stringify(cohort.seeds),cohort]);
    for (const slot of s.slots) await c.query('INSERT INTO rr_slots VALUES($1,$2,$3,$4,$5) ON CONFLICT(session_id,id) DO UPDATE SET start_at=$3,end_at=$4,format=$5', [id,slot.id,slot.startAt,slot.endAt,slot.format]);
    for (const version of s.versions) {
      // Only lifecycle columns can change. Original programme and rights snapshots are append-only.
      await c.query('INSERT INTO rr_programme_versions VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(session_id,id) DO UPDATE SET status=$5,approved_at=$7,invalidated_at=$8,invalidation_reason=$9', [id,version.id,version.programmeId,version.parentVersionId ?? null,version.status,version.createdAt,version.approvedAt ?? null,version.invalidatedAt ?? null,version.invalidationReason ?? null,version]);
      for (const item of version.items) await c.query('INSERT INTO rr_programme_items VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[id,version.id,item.slotId,item.filmId,item]);
    }
    for (const event of s.events) await c.query('INSERT INTO rr_events VALUES($1,$2,$3,$4,$5) ON CONFLICT(session_id,id) DO UPDATE SET payload=$5',[id,event.id,event.createdAt,event.type,event]);
    for (const run of s.runs) await c.query('INSERT INTO rr_runs VALUES($1,$2,$3,$4,$5) ON CONFLICT(session_id,id) DO UPDATE SET status=$4,trace=$5',[id,run.id,run.startedAt,run.status,run]);
    for (const ev of s.evidence) await c.query('INSERT INTO rr_evidence VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[id,ev.id,ev.createdAt,ev.mode,ev]);
  }
  async reset(id: string) {
    return this.update(id, async state => {
      // A demo reset is session-local; audit rows remain associated with their immutable IDs.
      Object.assign(state, this.factory());
      return state;
    });
  }
  async close() { await this.pool.end(); }
}
