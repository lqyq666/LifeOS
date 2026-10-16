CREATE TABLE kb_maintenance_drafts (
 guide_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 content_hash text NOT NULL, producer_id text NOT NULL, queued_by text NOT NULL,
 status text NOT NULL CHECK(status IN ('needs_review','waiting_approval','rejected','cancelled','published')),
 bundle jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(guide_id,revision)
);
CREATE TABLE kb_maintenance_receipts (
 id uuid PRIMARY KEY, guide_id uuid NOT NULL, revision integer NOT NULL,
 actor_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('independent_review','human_release','question','return','reject','cancel')),
 content_hash text NOT NULL, source_hashes jsonb NOT NULL,
 decision text NOT NULL CHECK(decision IN ('approve','needs_review','reject','cancel')),
 notes text NOT NULL, claim_checks jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(guide_id,revision) REFERENCES kb_maintenance_drafts(guide_id,revision)
);
CREATE INDEX kb_maintenance_receipts_revision ON kb_maintenance_receipts(guide_id,revision,created_at);
