-- Preserve existing records; the same explicit pause control now supports
-- the already available freelance direction independently of entrepreneurship.
ALTER TABLE growth_direction_controls
  DROP CONSTRAINT growth_direction_controls_scope_check;
ALTER TABLE growth_direction_controls
  ADD CONSTRAINT growth_direction_controls_scope_check CHECK (scope IN (
    'employment','postgraduate_recommendation','postgraduate_exam','public_service',
    'entrepreneurship','overseas_study','undergraduate_upgrade','freelance'
  ));
