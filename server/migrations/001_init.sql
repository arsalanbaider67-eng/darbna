-- Darbna initial schema. Requires PostgreSQL 14+ with contrib extensions
-- (cube, earthdistance, pg_trgm, pgcrypto). PostGIS is NOT required.

CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- gazetteer
-- Curated Iraqi places with multilingual names and spelling aliases.
CREATE TABLE places (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('governorate','city','district','neighborhood','landmark','street')),
  parent_id   BIGINT REFERENCES places(id) ON DELETE SET NULL,  -- e.g. neighborhood → city
  lat         DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN 28.5 AND 38),
  lng         DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN 38 AND 49.5),
  importance  REAL NOT NULL DEFAULT 0.5,
  -- 'seed_unverified' = shipped with the repo, coordinates approximate, needs local validation
  -- 'verified'        = checked on the ground / by an editor
  -- 'osm_import'      = imported from OpenStreetMap
  quality     TEXT NOT NULL DEFAULT 'seed_unverified' CHECK (quality IN ('seed_unverified','verified','osm_import')),
  external_ref TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX places_external_ref ON places(external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE place_names (
  id        BIGSERIAL PRIMARY KEY,
  place_id  BIGINT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  lang      TEXT NOT NULL CHECK (lang IN ('ar','ckb','en','alias')),
  name      TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  ar_key    TEXT,   -- normalizeArabic/arabicKey output (packages/core)
  lat_key   TEXT    -- latinKey output (packages/core)
);
CREATE INDEX place_names_place ON place_names(place_id);
CREATE INDEX place_names_ar_trgm  ON place_names USING gin (ar_key gin_trgm_ops);
CREATE INDEX place_names_lat_trgm ON place_names USING gin (lat_key gin_trgm_ops);
CREATE INDEX place_names_name_trgm ON place_names USING gin (lower(name) gin_trgm_ops);
CREATE UNIQUE INDEX place_names_unique ON place_names(place_id, lang, name);

-- ---------------------------------------------------------------- reports
CREATE TABLE reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category     TEXT NOT NULL CHECK (category IN ('congestion','crash','closure','roadworks','pothole','flooding')),
  source       TEXT NOT NULL DEFAULT 'community' CHECK (source IN ('community','official')),
  lat          DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN 28.5 AND 38),
  lng          DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN 38 AND 49.5),
  heading      SMALLINT CHECK (heading BETWEEN 0 AND 359),  -- direction of travel when reported, optional
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden','removed','expired')),
  hidden_reason TEXT,                                       -- 'gone_votes' | 'flags' | 'moderator'
  confirms     INTEGER NOT NULL DEFAULT 0,
  gone         INTEGER NOT NULL DEFAULT 0,
  flags        INTEGER NOT NULL DEFAULT 0,
  -- HMAC of the anonymous install ID; nulled when the report expires or the user deletes their data.
  reporter_hash TEXT,
  -- Official reports must cite where they came from (ministry notice, traffic police post, etc.).
  official_ref TEXT,
  -- Demonstration data, never shown when SAMPLE_DATA=off.
  is_sample    BOOLEAN NOT NULL DEFAULT false,
  CHECK (source <> 'official' OR official_ref IS NOT NULL)
);
CREATE INDEX reports_active_geo ON reports USING gist (ll_to_earth(lat, lng)) WHERE status = 'active';
CREATE INDEX reports_status_expiry ON reports(status, expires_at);
CREATE INDEX reports_reporter_time ON reports(reporter_hash, created_at) WHERE reporter_hash IS NOT NULL;

CREATE TABLE report_votes (
  report_id  UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  voter_hash TEXT NOT NULL,
  vote       TEXT NOT NULL CHECK (vote IN ('confirm','gone','flag')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, voter_hash, vote)
);
CREATE INDEX report_votes_voter_time ON report_votes(voter_hash, created_at);

CREATE TABLE moderation_log (
  id         BIGSERIAL PRIMARY KEY,
  report_id  UUID REFERENCES reports(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,          -- auto_hide_gone | auto_hide_flags | restore | remove | create_official
  actor      TEXT NOT NULL,          -- 'system' or moderator label (never a user hash)
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
