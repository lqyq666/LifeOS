# Host API contract (LifeOS local product, HTTP + JSON)

The skill's state operations bind to the real backend so persistence,
isolation and receipts are enforced by the product, not by the agent.

## Base

- Use the configured product origin (`LIFEOS_ORIGIN`) and its authenticated
  session. `LIFEOS_PORT` is the backend listener, not necessarily the browser
  origin. Verify `/api/run/version` there before accessing state.
- Every request carries the session cookie from sign-in and header
  `Origin: <origin>`. Content type `application/json` for bodies.
- Idempotency: every mutating call takes a fresh caller-generated `requestId`
  (UUID). Replaying the same `requestId` with a different body is rejected
  (`REQUEST_ID_REUSED`); replaying the identical body returns the original
  result. Never reuse a requestId across different intents.

## Identity

- `POST /api/auth/sign-up/email {email,password,name}` → session cookies
  (better-auth; ~3 signups per 10s per IP locally — back off on 429).
- `GET /api/session` → `{id,…}` current user id; 401 when anonymous.
- Accounts are strictly isolated. There is no cross-account read path.

## Conversations and turns

- `POST /api/conversations {id:<uuid>,title}` → creates a conversation
  (caller supplies the uuid).
- `POST /api/conversations/{id}/messages {requestId:<uuid>,text}` → SSE stream.
  Events include `delta` (partial/final reply text; `saved:true` marks the
  committed final), `draft` (early safe question preview), and a final `done`
  carrying `{requestId, modelUsage, stateChange:{growth,controls,material,plan},…}`.
  The reply, material, personal-understanding updates and receipts commit in
  one server transaction; `stateChange.growth.status` ∈
  `applied|partial|needs_confirmation|not_requested`.
- Failed turns end the stream with an error code (e.g. `GROWTH_SOURCE_INVALID`,
  `GROWTH_SNAPSHOT_INVALIDATED`). Do not auto-retry the same input; surface the
  failure and continue conversationally.

## Personal understanding (growth)

- `GET /api/growth?conversation={id}` → `{items:[…],settings:{…}}`. Each item:
  `{id,conversationId,kind,assertion,status,text,sources,validUntil,progressState,revision,…}`.
  - `assertion`: `user_reported` (verbatim user words) | `user_edit` (manual UI
    edit) | `ai_observation` (proposed, carries `limitation`, needs `accept`) | `unknown`.
  - `status`: `active|proposed|paused|completed|rejected|forgotten|stale`.
  - Items from other conversations appear only when cross-session memory is on.
- `POST /api/growth {requestId,conversationId,kind,text,validUntil?,dependencies?}` —
  manual create (`user_edit`). Constraint kinds need `validUntil` (`GROWTH_TIME_REQUIRED`).
- `POST /api/growth/{id}/actions {requestId,expectedRevision,action,…}` —
  `correct` (takes `text`, optional `validUntil`), `accept` (adopt a proposed
  observation; stays marked as AI judgment), `pause`, `complete`, `reject`
  (refuse a proposed observation), `forget` (precise forgetting: the item's
  spans are suppressed; dependent items go stale; other independent facts stay).
  Wrong `expectedRevision` → `GROWTH_REVISION_CONFLICT` (re-read, don't guess).

## Memory gate

- `GET /api/memory` → items + `{settings:{enabled,revision}}`.
- `POST /api/memory/settings {requestId,enabled,expectedRevision}` — the user's
  cross-session memory switch. Default off. Never flip it without an explicit
  user instruction.

## Matter process (coach events)

- `GET /api/conversations/{id}/event` → the matter workspace when one exists:
  `{id,revision,title,nodes,actions,processTurns,…}` with unknowns
  (`kind:'unknown'`, `status:'active'|…`) and action drafts (materials).
- There is no direct write endpoint for events — event/process changes go
  through conversation turns so source verification stays server-side.

## Evergreen guide use (local WIP contract extension)

- `GET /api/knowledge/{guideId}?revision={revision}` returns
  `{title,revision,scope,limitations,url,guide}` for an authenticated user.
  The `guide` contains approved claims, selected-task branches and steps,
  editorial-adaptation labels, small actions, stop conditions and feedback
  branches. A withdrawn source or changed revision returns 409; unavailable
  methods return 404. Re-read instead of substituting another revision.
- `GET /api/conversations/{id}/guide-usage?event={eventId}` returns `{items}`
  ordered newest first. Each row includes `guide_id`, `revision`, `branch`,
  `step_id`, `status`, `event_id`, `source_message_id`, `source_quote` and
  `request_id`. Read only through the student's own authenticated session.
  Cross-session access requires the memory switch to be on; unavailable
  sources and forgotten feedback are filtered. 401 means signed out;
  404 means an unavailable owned conversation/event; 403 `MEMORY_DISABLED`
  means this event cannot be used from the requested conversation.
- Feedback writes use the existing conversation message endpoint. There is
  no direct guide-use write endpoint. The engine checks a current user report
  about the same event and saves it in the turn's transaction. `done` includes
  `stateChange.guideUsage:{status:'applied'|'not_requested',items:[{guideId,
  revision,branch,stepId,status,eventId}]}`. Only `applied` permits a claim
  that this guide-use change committed; read back the newest log afterward.
- Guide-use states: `suggested` recommended; `accepted` explicitly willing;
  `attempted` actually started; `waiting_result` action done/result pending;
  `completed` reported result; `declined` stopped; `blocked` reported obstacle
  or negative outcome. Copying text, asking a hypothetical question, someone
  else's actions and an AI suggestion do not advance personal progress.
- Public methods and private guide-use logs are separate. Only approved
  public cards can be proposed for a Coze mirror, with canonical ID, revision
  and content hash preserved. CLI OAuth, public workflow access and a student
  session grant different permissions. A public workflow never reads these
  personal logs. An older runtime missing this extension degrades this branch
  honestly; it does not prove saving succeeded.

## Star map readback and corrections

- `GET /api/cognition` reads the current user's themes and experience links.
  A displayed link is a proposed interpretation until the user confirms it;
  do not turn an observed relation into a personal fact.
- `POST /api/themes/{id}/actions {requestId,expectedRevision,action,title?}`:
  `rename` uses the user's exact title; other actions are
  `pin|unpin|pause|resume|revoke`. Read back `/api/cognition` after success.
- `POST /api/theme-links/{experienceId}/{themeId}/actions {requestId,action}`:
  `confirm|revoke` follows the user's explicit decision. Corrections to the
  underlying personal understanding use the growth action endpoint above;
  correcting a star-map label is not a substitute for correcting its source.

## Honesty mapping

| Claim you might make | Only valid when |
| --- | --- |
| "已记录/已更新" | the turn's `done.stateChange` shows the committed change |
| "我记得你之前…" | memory setting on AND the item appears in the current context |
| "已暂停/已恢复方向" | a `direction_controls` change in `stateChange` |
| "这是待核对观察" | item `assertion==='ai_observation'` with its limitation shown |
