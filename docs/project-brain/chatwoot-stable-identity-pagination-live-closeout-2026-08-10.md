# Chatwoot Stable-identity Pagination Live Closeout — 2026-08-10

## Incident

Chatwoot Conversations list exposes mutable offset pages, not a snapshot cursor. The prior durable runtime
persisted page number, row offset and an identity-order fingerprint. When new/updated conversations changed
the page membership between Queue continuations, the same page returned a different order and the runtime
failed permanently with `CHATWOOT_CONVERSATION_PAGE_DRIFT`.

The retained failed daily operation is forensic evidence and was not replayed or bulk-redriven.

## Repository correction

- Persist only stable numeric Conversation IDs, discovery counters and bounded control state; never persist
  Provider payload, message content or PII.
- Treat mutable page lists as discovery only, deduplicate IDs across pages/passes and fetch each selected
  conversation from the exact detail endpoint before writing.
- Restart discovery at page 1 after an exhausted pass and complete only when a full pass finds zero new IDs.
- Preserve stable Queue generation, exact work identity, idempotent D1/Lark keys, retry classification and
  partial-write semantics.
- Migrate legacy fingerprint/offset state by restarting identity discovery; already committed writes remain
  safe through their stable keys.

PR #597 merged this change. Focused Chatwoot tests passed `23/23`; full unit passed `2919/2919`; Workers
runtime passed `18/18`; report reliability, architecture/hygiene, dependency audit and deploy dry-run passed.

The cutoff liveness correction subsequently passed focused Chatwoot `25/25`, full unit `2933/2933`, Workers
runtime `18/18`, report reliability `105/105`, architecture/hygiene, zero-vulnerability audit and deploy
dry-run. Live deployment and convergence remain required before closure.

## Live closeout sequence

1. Worker version containing PR #597 was deployed at 100% traffic.
2. The first controlled payload used a manual daily trigger while the steady-state schedule flag was enabled;
   it stopped before Work/Provider/D1/Lark business mutation with `CHATWOOT_PROCESSING_GATES_DISABLED`.
3. A fresh operation used the scheduled-daily trigger matching active config. It began durable work and proved
   page transitions with stable-ID growth and zero drift alerts.
4. Provider page-1 metadata reported 7,720 conversations, above the active bound 5,000. Before the work hit
   that bound, only `CHATWOOT_API_MAX_ROWS` and `CHATWOOT_MAX_CONVERSATIONS` were raised to 10,000.
   Dry-run passed and the new Worker version was read back at 100% traffic; webhook, Notification, DLQ redrive
   and Production gates were unchanged.
5. The first discovery pass completed with 7,720 stable IDs. Pass 2 immediately discovered one Conversation
   created after the operation's immutable cutoff. The original stable-ID fix retained that ID for dedupe but
   also counted it as convergence progress, so an active account could require unbounded verification passes.
6. The cutoff correction keeps post-boundary IDs in the PII-free seen set but excludes them from pending
   detail reads and `conversationNewIdsInPass`. Those Conversations belong to the next daily operation.

## Operational cost and follow-up

The controlled `r6` operation is a daily incremental run with an immutable three-day overlap window; it is
not a 7,720-row historical backfill. The Provider list endpoint must nevertheless be scanned across the full
account inventory because an old-created Conversation can be updated, reopened, assigned or receive new
activity inside the current window. Only list rows whose `updated_at`, `last_activity_at` or `created_at`
intersects that window are selected for exact detail reads and Business writes.

This full stable-ID discovery plus a zero-new-ID verification pass is required for correctness under the
current polling contract, but its API and elapsed-time cost grows with the whole account inventory. Record
that cost as a follow-up reliability/capacity item: evaluate a reviewed webhook-first changed-ID journal for
daily processing with a less-frequent bounded full reconciliation. Webhook execution remains disabled in
this closeout, and no polling/webhook architecture change may be introduced into the active `r6` operation.

The live `r6` discovery is retained as the evidence that exposed the cutoff liveness defect. It is not closure
authority until the reviewed cutoff correction is deployed and the same durable operation either converges
under that code or a fresh exact operation completes without conflicting work.

## Closure authority

```text
REPOSITORY_FIX                 = MERGED_PR_597
LIVE_WORKER                    = DEPLOYED
CONTROLLED_OPERATION           = chatwoot-daily-20260809-r6
PROVIDER_TOTAL_AT_PREFLIGHT    = 7720
BOUNDED_MAX_CONVERSATIONS      = 10000
DLQ_BULK_REDRIVE               = NOT_RUN
PRODUCTION                     = BLOCKED
LIVE_COMPLETION                = R6_RETAINED_LIVENESS_EVIDENCE
D1_LARK_RECONCILIATION         = PENDING_COMPLETION
```

Do not mark Chatwoot PASS until the controlled operation is `completed`, the checkpoint belongs to the same
generation, exact operation alerts are zero and the 15 D1/Lark table identities reconcile. Historical failed
operations and alerts remain retained evidence unless a separate exact incident-closure action is reviewed.
