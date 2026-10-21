# Existing-budget Flash feasibility — not a routing promotion

Status: RESEARCHED, NOT_DISPATCHED. Date: 2026-10-19. No extra allowance, no released unknowns, no production change.

## Decision and scope

Investigate the already integrated Beijing `qwen3.8-flash` for a fresh candidate using the same semantic, speed, full-36 and human gates. Do not replace the production model or treat cheaper transport as product acceptance. Saved C6 total-once wording is now locally bounded to the current report; opening-question necessity and absence of an early retained draft remain unresolved. No new latency is claimed.

Official Beijing input/output prices are 0.8/2.7 CNY per million tokens, including non-thinking mode. Current configured context/output ceilings remain 128000/8192. This implies a no-discount reservation of 0.1245184 per call. The published cache page defers this model's exact cache rate to the console; do NOT rely on the old configured 0.1 rate. A candidate must conservatively account cached input at full 0.8 unless an exact account price is independently established. Do not assume free quota, discounts, Batch pricing, or account/model access from documentation.

Alternative rejected: another Max full batch. Remaining sole-ledger funds are 2.10074620, but one Max reservation needs 1.830912; only 0.26983420 of settled spend can precede that last reservation. Historical DE partial cost 1.42422 makes another full Max run not a defensible plan. Do not shrink actual transport ceilings, reset the ledger, refund unknowns, or buy funds.

## Existing seams / files

- `server/model.ts`, `server/model-payload.ts`: existing model routing, strict runtime schema and capability signatures.
- `server/provider-spend.ts`: sole PostgreSQL authority and conservative reservation; keep unchanged.
- `.local/capability-probe-session.ts`: existing real capability probe, fresh source freeze, zero automatic retry, synthetic identity, reserve before dispatch, first failure stops. Do NOT use `scripts/probe-model.ts` against its legacy file ledger.
- Existing frozen source and six-chain runner: no new competing transport or parser.

Official schema support does not prove current account or contract compatibility. Preserve unsupported `uniqueItems` exclusion and server-side uniqueness validation. Generate a genuine new capability report for current interface; never rewrite an old signature into a pass.

## Checklist before any paid dispatch

- [x] Read official pricing, schema and cache pages; record limits in sources.md.
- [x] Check source changes have deterministic red/green evidence, not fake timing.
- [x] Saved C6 total-once source boundary repaired locally; question/early-draft limitation explicitly retained, not passed or timed.
- [ ] Complete pinned-candidate independent review and current root/type/backend checks.
- [x] Replayed six old CI Flash defects, corrected their six targeted patterns locally; broader turn quality is still not accepted. Current evidence `evidence/grilling/ci-flash-saved-defect-stage16-read-proof-replay-20261019.json`.
- [x] Prepared process-only Flash environment `.local/use-flash-candidate-20261019.ps1`, full-rate cached input and fresh evidence directory, unchanged output/context ceilings and sole PG budget ID. Merely sourcing it sends no request and changes no production routing.
- [x] Read-only feasibility `evidence/grilling/flash-source-scope-feasibility-20261019.json`: old 35 real calls at no cache discount cost0.2113848; four-times that workload plus four capability ceilings and one last-call margin totals1.4681312, below remaining2.10074620. This is an empirical estimate, not a bound or guarantee; all36 absolute ceilings sum4.4826624. Refresh source/ledger before any dispatch, retain actual per-call ceiling0.1245184 and first-failure stop. Quote binds its earlier Flash-config source digest02cb09c1, not the later Max-config freeze. No cached discount, refund, extra funds or purchase assumed.
- [ ] Fresh capability probe; stop on first failure, no automatic paid retry.
- [ ] Only if prior checks pass: freeze current source/runtime and run a new complete six-chain cohort, never stitch partial runs.
- [ ] Blind review only after complete36, then production and human gates separately.

## Acceptance

Research alone does not close any launch gate. Old model results, Max timing, source tests and static reviews cannot substitute for current real36, retained first P50/P95, whole latency P95, deployment health, recovery proof or student acceptance. Promotion remains forbidden unless those gates actually pass.
