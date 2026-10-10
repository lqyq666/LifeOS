-- Additive only. Rollback: disable the workflow flag; retain these audit tables.
CREATE TABLE lifeos_workflow_tasks (
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 request_id uuid NOT NULL, conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 trace_id uuid NOT NULL, input_digest text NOT NULL, source_snapshot jsonb NOT NULL, request_payload jsonb NOT NULL,
 host_commit jsonb,
 status text NOT NULL CHECK(status IN ('queued','running','finished')),
 deadline_at timestamptz NOT NULL, cancel_requested boolean NOT NULL DEFAULT false,
 receipt jsonb, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 PRIMARY KEY(user_id,request_id)
);
CREATE TABLE lifeos_workflow_nodes (
 user_id text NOT NULL, request_id uuid NOT NULL, node_id text NOT NULL,
 execution_kind text NOT NULL, role text NOT NULL, max_cost_cny numeric NOT NULL CHECK(max_cost_cny>=0),
 status text NOT NULL CHECK(status IN ('dispatched','succeeded','failed','unknown')),
 call_id uuid NOT NULL UNIQUE, provider_calls integer NOT NULL DEFAULT 0,
 input_ref_digest text NOT NULL, output_ref_digest text,
 cost_cny numeric, result jsonb, provider_usage jsonb, error text, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 PRIMARY KEY(user_id,request_id,node_id),
 FOREIGN KEY(user_id,request_id) REFERENCES lifeos_workflow_tasks(user_id,request_id) ON DELETE CASCADE
);
