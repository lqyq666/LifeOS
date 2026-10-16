-- Only new workflow reservations record a durable pre-dispatch boundary.
-- Legacy NULL remains unknown; rollback preserves every hold and audit row.
ALTER TABLE lifeos_provider_spend ADD COLUMN workflow_dispatch_state text
 CHECK (workflow_dispatch_state IN ('prepared','started'));
ALTER TABLE lifeos_provider_spend ADD CONSTRAINT lifeos_provider_spend_dispatch_scope_check
 CHECK (workflow_dispatch_state IS NULL OR workflow_request_id IS NOT NULL);
