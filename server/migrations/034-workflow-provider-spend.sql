-- Dialogue keeps its existing two-call limit. Only a durably registered workflow
-- may reserve up to five nodes; all rows still share the original production cap.
ALTER TABLE lifeos_provider_spend ADD COLUMN workflow_request_id uuid;
ALTER TABLE lifeos_provider_spend DROP CONSTRAINT lifeos_provider_spend_call_index_check;
ALTER TABLE lifeos_provider_spend ADD CONSTRAINT lifeos_provider_spend_call_index_check
 CHECK ((workflow_request_id IS NULL AND call_index IN (1,2)) OR
        (workflow_request_id IS NOT NULL AND workflow_request_id = request_id AND call_index BETWEEN 1 AND 5));
ALTER TABLE lifeos_provider_spend ADD CONSTRAINT lifeos_provider_spend_workflow_fk
 FOREIGN KEY(user_id,workflow_request_id) REFERENCES lifeos_workflow_tasks(user_id,request_id);
