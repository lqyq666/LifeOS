ALTER TABLE coach_nodes DROP CONSTRAINT IF EXISTS coach_nodes_status_check;
ALTER TABLE coach_nodes ADD CONSTRAINT coach_nodes_status_check CHECK (status IN ('active','resolved','declined','withdrawn'));
