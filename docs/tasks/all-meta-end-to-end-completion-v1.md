# All Meta End-to-End Completion v1

## Authority

งานนี้เริ่มจาก `origin/main@0d33be48f9b8ccaf6d8cea9a4c4ee31b1175b650` หลัง PR `#420`
Squash Merged. คำสั่งผู้ใช้อนุญาต Integration Workspace Live execution และ Squash Merge แต่ทุก
mutation ยังต้องผ่าน existing Repository guards และ exact retained evidence.

## Read-only baseline facts

```text
repository                         kasinpod-40/social-marketing-integration
branch                             integration/all-meta-end-to-end-completion-v1
base                               0d33be48f9b8ccaf6d8cea9a4c4ee31b1175b650
PR #420                            merged
PR #415                            open Draft / WooCommerce Report / excluded from this branch
retained Facebook operation        meta-facebook-history-20260701-20260731-1d12a5ec4fef
retained Facebook repository Head  5ff8e2cfb1f890ac2a8f2867a904b477c6456d91
retained Facebook D1/Lark          complete / pending
retained evidence checkout         local detached checkout; immutable audit required
remote mutation count              0
```

## Execution phases

1. Aggregated read-only audit: Git/GitHub, local process/evidence, Worker, Queue/Work/Lock, D1,
   Coverage, Lark schema/mappings, Report settings/materializations และ Dashboard bindings.
2. Chatwoot prerequisite: verify safe state; ถ้ายังไม่ผ่านให้ใช้ current reviewed exact retained recovery
   จน parity/incident closure/all-false ผ่าน โดยห้าม second Initial admission.
3. Meta History: use `scripts/meta-history-2026-reviewed-release-terminal.mjs` and its reviewed child only
   after retained evidence is bound without editing it; complete all six planned operations.
4. Meta Reports: reuse generic adapters/materializer/Lark writer for supported windows `1/3/7/30`.
5. Lark/Dashboard: verify exact stable rows, values, filters and supported Native Dashboard bindings via
   sanitized readback; unsupported Dashboard endpoints remain frozen.
6. Repository closeout: focused/full gates, exact-head workflows, docs, review, ready transition, Squash
   Merge and post-merge read-only safety verification.

## Fail-closed rules

- Any uncertain Queue acceptance, active conflicting Work/Lock, Worker flag drift, retained evidence drift,
  provider identity mismatch, D1/Lark parity failure or unsupported Dashboard mutation stops the phase.
- Existing Business rows are never deleted or rewritten outside Shared operators.
- A process exit is not completion evidence; Remote readback and accepted contract markers are required.
- Every failure window must restore Worker execution flags all false before another connector phase.

## Acceptance criteria

- Chatwoot prerequisite safe with Worker all-false, no active lock and no uncertain execution.
- Facebook completed lane verified without replay; retained July Lark continuation completes exact Work.
- Instagram July and Meta Ads required May-July operations complete; conditional January-April operations
  complete or are bounded-deferred by the reviewed limit contract.
- History Coverage, D1/Lark parity, replay/idempotency and `META_HISTORY_2026_COMPLETED_SAFE` pass.
- Meta Report materializations for `1/3/7/30` pass D1/Lark key/value parity with correct null/zero semantics.
- Organic, Paid Ads, Executive and Data Quality Dashboard readback truthfully exposes the Meta results.
- Worker all-false, Schedule/Webhook false, active Work/Lock/uncertain Queue zero and Production blocked.
- Required local gates and GitHub workflows pass on exact final Head; review threads are resolved.
- Draft PR becomes Ready and Squash Merges to `main`; post-merge read-only verification passes.

## Evidence policy

Private evidence remains under ignored `outputs/` roots with restrictive permissions. Git records only
sanitized counts, fingerprints, decisions and completion markers. Token, Secret, raw provider/Lark IDs,
Queue IDs and customer payloads must not be printed or committed.

## Current result

Repository/GitHub/local-evidence discovery is in progress. No Live or Remote mutation has occurred.
