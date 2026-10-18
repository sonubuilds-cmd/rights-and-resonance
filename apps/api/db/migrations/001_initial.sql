-- Canonical JSON is the versioned aggregate; relational projections support audit/query.
CREATE TABLE IF NOT EXISTS rr_sessions (
 id text PRIMARY KEY, state_json jsonb NOT NULL, revision integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rr_films (
 session_id text NOT NULL REFERENCES rr_sessions(id) ON DELETE CASCADE,
 id text NOT NULL, title text NOT NULL, film_year integer NOT NULL, runtime_minutes integer NOT NULL,
 metadata jsonb NOT NULL, rights jsonb NOT NULL, PRIMARY KEY(session_id,id)
);
CREATE TABLE IF NOT EXISTS rr_cohorts (
 session_id text NOT NULL REFERENCES rr_sessions(id) ON DELETE CASCADE,
 id text NOT NULL, name text NOT NULL, seeds jsonb NOT NULL, metadata jsonb NOT NULL,
 PRIMARY KEY(session_id,id)
);
CREATE TABLE IF NOT EXISTS rr_slots (
 session_id text NOT NULL REFERENCES rr_sessions(id) ON DELETE CASCADE,
 id text NOT NULL, start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, format text NOT NULL,
 PRIMARY KEY(session_id,id)
);
CREATE TABLE IF NOT EXISTS rr_programme_versions (
 session_id text NOT NULL REFERENCES rr_sessions(id) ON DELETE CASCADE,
 id text NOT NULL, programme_id text NOT NULL, parent_version_id text, status text NOT NULL,
 created_at timestamptz NOT NULL, approved_at timestamptz, invalidated_at timestamptz,
 invalidation_reason text, snapshot jsonb NOT NULL, PRIMARY KEY(session_id,id)
);
CREATE TABLE IF NOT EXISTS rr_programme_items (
 session_id text NOT NULL, version_id text NOT NULL, slot_id text NOT NULL, film_id text NOT NULL,
 snapshot jsonb NOT NULL, PRIMARY KEY(session_id,version_id,slot_id),
 FOREIGN KEY(session_id,version_id) REFERENCES rr_programme_versions(session_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS rr_events (
 session_id text NOT NULL REFERENCES rr_sessions(id) ON DELETE CASCADE,
 id text NOT NULL, created_at timestamptz NOT NULL, type text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(session_id,id)
);
CREATE TABLE IF NOT EXISTS rr_runs (
 session_id text NOT NULL REFERENCES rr_sessions(id) ON DELETE CASCADE,
 id text NOT NULL, started_at timestamptz NOT NULL, status text NOT NULL, trace jsonb NOT NULL,
 PRIMARY KEY(session_id,id)
);
CREATE TABLE IF NOT EXISTS rr_evidence (
 session_id text NOT NULL REFERENCES rr_sessions(id) ON DELETE CASCADE,
 id text NOT NULL, created_at timestamptz NOT NULL, mode text NOT NULL,
 snapshot jsonb NOT NULL, PRIMARY KEY(session_id,id)
);
CREATE INDEX IF NOT EXISTS rr_versions_programme ON rr_programme_versions(session_id,programme_id);
CREATE INDEX IF NOT EXISTS rr_events_created ON rr_events(session_id,created_at);
