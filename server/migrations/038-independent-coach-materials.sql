-- Different deliverables in one event remain independently usable. Rewrites
-- address the existing material by id and revision rather than replacing all.
DROP INDEX coach_one_proposed_action;
CREATE INDEX coach_proposed_actions ON coach_actions(user_id,event_id) WHERE status='proposed';
