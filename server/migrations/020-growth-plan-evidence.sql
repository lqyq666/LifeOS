ALTER TABLE growth_items
  ADD COLUMN direction_scopes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN structured_plan jsonb;
ALTER TABLE growth_items ADD CONSTRAINT growth_direction_scopes_valid
  CHECK (direction_scopes <@ ARRAY[
    'employment','postgraduate_recommendation','postgraduate_exam',
    'public_service','entrepreneurship','overseas_study','undergraduate_upgrade'
  ]::text[] AND cardinality(direction_scopes) <= 7);
ALTER TABLE growth_items ADD CONSTRAINT growth_structured_plan_object
  CHECK (structured_plan IS NULL OR jsonb_typeof(structured_plan)='object');
