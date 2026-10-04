// Storage types for authenticated historical V1.2 reads only. No generation
// schema, business gate, hypothesis template or model-output parser remains.
export type CampusSource={type:'message';id:string;quote:string}|{type:'experience'|'memory'|'knowledge';id:string;revision:number;quote:string}
export type EvidenceLink={source:CampusSource;role:'support'|'counterexample'|'background'|'unknown';match:string;limitation:string}
type HistoricalFact={key:string;value:string;status:string;source:CampusSource;scope:string;observedAt?:string}
type HistoricalOpportunity={evidence:EvidenceLink[];[key:string]:unknown}
type HistoricalHypothesis={id:string;status:'pending'|'accepted'|'rejected'|'revised'|'stale';evidence:EvidenceLink[];[key:string]:unknown}
type HistoricalExperiment={id:string;status:'proposed'|'accepted'|'running'|'deferred'|'reported';action:string;needsReview?:boolean;result?:{text:string;source:CampusSource;candidateId:string|null;reportedAt:string;invalidated?:boolean;invalidationReason?:'forgotten'|'corrected'|'removed'};[key:string]:unknown}
export type InquiryPayload={domain:'university_exit'|'life_goal';question:string;questionSource:CampusSource;criteria:string[];readiness:'clarify'|'act'|'bounded'|'listen';questions:unknown[];studentContext:HistoricalFact[];pathways:unknown[];opportunities:HistoricalOpportunity[];evidence:EvidenceLink[];hypotheses:HistoricalHypothesis[];experiments:HistoricalExperiment[];changes:{text:string;at:string;sourceMessageId?:string}[];continuedFrom?:{inquiryId:string;experimentId:string}}
export type Inquiry={id:string;user_id:string;conversation_id:string;revision:number;payload:InquiryPayload;stale:boolean;stale_reason:string|null;created_at:string;updated_at:string}
