/**
 * Schema. Append a new array for each change; never edit an earlier one. Statements are idempotent so two cold
 * starts migrating at once are harmless.
 *
 *  content  one row per (network, content_id). content_id is a hash of the normalised text, so it is stable across
 *           users and across LinkedIn's different views. Holds the latest Jev verdict, engagement counts and how often
 *           the post has been checked. `text` stays NULL unless STORE_CONTENT_TEXT is enabled.
 *  votes    one row per (post, install): "no" | "maybe" | "probably" (probably = flagged as slop/spam). Counts are
 *           always derived from here, so they can't drift.
 *  usage    checks per install per UTC day, for the daily cap. Only a salted hash of the install id is stored.
 *  events   (v2) one row per /judge outcome (scored, cached, limited, error) with token counts and latency. Feeds the
 *           admin dashboard's calls/cost/latency charts. Pruned after EVENT_RETENTION_DAYS; holds no post text.
 *  installs (v2) one row per install (salted hash): first/last seen and lifetime checks, so install counts survive pruning.
 *           (v3) adds the admin's per-install kill switch: `disabled`, when, and an optional reason.
 *  settings (v4) small key/value store; holds the live-edited tell weights (`tell_weights`).
 *  weight_history (v4) every change to the live weights, so a change can be reviewed and restored.
 *  counted_votes (v5) a view: votes from installs the admin hasn't disabled. The one definition of "votes that count".
 */
export const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS content (
      network TEXT NOT NULL,
      content_id TEXT NOT NULL,
      native_id TEXT,
      text_len INTEGER NOT NULL,
      text TEXT,
      model TEXT,
      criteria_version TEXT,
      ai_likelihood REAL,
      dimensions TEXT,
      surface TEXT,
      engagement TEXT,
      scored_at INTEGER,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      checks INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (network, content_id)
    )`,
    `CREATE INDEX IF NOT EXISTS content_last_seen ON content (network, last_seen)`,
    `CREATE TABLE IF NOT EXISTS votes (
      network TEXT NOT NULL,
      content_id TEXT NOT NULL,
      install_hash TEXT NOT NULL,
      vote TEXT NOT NULL CHECK (vote IN ('no','maybe','probably')),
      at INTEGER NOT NULL,
      PRIMARY KEY (network, content_id, install_hash)
    )`,
    `CREATE TABLE IF NOT EXISTS usage (
      install_hash TEXT NOT NULL,
      day TEXT NOT NULL,
      checks INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (install_hash, day)
    )`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      network TEXT NOT NULL,
      install_hash TEXT NOT NULL,
      content_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('scored','cached','limited','error')),
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER,
      ai_likelihood REAL,
      detail TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS events_at ON events (at)`,
    `CREATE INDEX IF NOT EXISTS events_install ON events (install_hash, at)`,
    `CREATE TABLE IF NOT EXISTS installs (
      install_hash TEXT PRIMARY KEY,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      checks INTEGER NOT NULL DEFAULT 0,
      limit_hits INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS installs_last_seen ON installs (last_seen)`,
  ],
  [
    `ALTER TABLE installs ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE installs ADD COLUMN disabled_at INTEGER`,
    `ALTER TABLE installs ADD COLUMN disabled_reason TEXT`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS weight_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      weights TEXT NOT NULL,
      note TEXT,
      source TEXT NOT NULL CHECK (source IN ('admin','reset'))
    )`,
  ],
  [
    `CREATE VIEW IF NOT EXISTS counted_votes AS
       SELECT v.network, v.content_id, v.install_hash, v.vote, v.at
       FROM votes v LEFT JOIN installs i ON i.install_hash = v.install_hash
       WHERE COALESCE(i.disabled, 0) = 0`,
  ],
  [
    // When a stored score is due to be redone (see recheck.ts): the engagement it was made with, how long it is kept, and until when.
    `ALTER TABLE content ADD COLUMN engagement_at_score INTEGER`,
    `ALTER TABLE content ADD COLUMN recheck_interval_ms INTEGER`,
    `ALTER TABLE content ADD COLUMN next_recheck_at INTEGER`,
  ],
  [
    // The admin's own hand-labelled posts: the ground truth the threshold tuner uses. Kept apart from community votes, which
    // never feed any setting on their own. Only Jev's answers and engagement are kept, never the post text.
    `CREATE TABLE IF NOT EXISTS curated_labels (
      key TEXT PRIMARY KEY,
      network TEXT NOT NULL,
      label TEXT NOT NULL CHECK (label IN ('no','maybe','probably')),
      ai_likelihood REAL NOT NULL,
      dimensions TEXT NOT NULL,
      engagement TEXT,
      note TEXT,
      created_at INTEGER NOT NULL
    )`,
  ],
  [
    // Every saved change to the scoring settings and the client manifest, so it can be reviewed or restored (like weight_history).
    `CREATE TABLE IF NOT EXISTS setting_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      at INTEGER NOT NULL,
      value TEXT NOT NULL,
      note TEXT,
      source TEXT NOT NULL CHECK (source IN ('admin','reset'))
    )`,
    `CREATE INDEX IF NOT EXISTS setting_history_key ON setting_history (key, id)`,
  ],
  [
    // A second, independent ceiling on /judge, per source IP per UTC hour (see IpCapRepo). ip_hash is a salted hash, like install_hash.
    `CREATE TABLE IF NOT EXISTS ip_usage (ip_hash TEXT NOT NULL, hour TEXT NOT NULL, checks INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ip_hash, hour))`,
  ],
  [
    // Per-install limit overrides. NULL = follow the default limits (the `limits` setting), so a new install gets the defaults
    // and the admin can give one install its own daily and/or hourly ceiling.
    `ALTER TABLE installs ADD COLUMN daily_limit INTEGER`,
    `ALTER TABLE installs ADD COLUMN hourly_limit INTEGER`,
  ],
];
