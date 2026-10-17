-- Additive audit metadata for LifeOS Grilling unknowns. The question remains
-- the coach_nodes content; this stores only dependencies and a short reason,
-- never model chain-of-thought.
ALTER TABLE coach_nodes
  ADD COLUMN inquiry_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT coach_nodes_inquiry_context_object CHECK (jsonb_typeof(inquiry_context)='object');

