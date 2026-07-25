# Current Task — Google Ads Local Reference-only Queue Admission

## Authoritative status

```text
TASK_STATUS                         = APPROVED_FOR_IMPLEMENTATION
CURRENT_PROGRAM                     = GOOGLE_ADS_MANAGER_SCRIPT_SIGNED_DELIVERY
SOURCE_BASELINE                     = PR_56_MERGED_3488C2A6
WORK_BRANCH                         = work/google-ads-reference-only-queue-admission
EXTERNAL_SIGNED_PREVIEW             = PASS_PREVIEW_VALIDATED
SIGNED_INGRESS_RUNTIME              = DISABLED_404
SECRET_PROVISIONING_RUNTIME         = DISABLED_404
BUSINESS_WRITES_RUNTIME             = DISABLED
QUEUE_ADMISSION_RUNTIME             = NOT_IMPLEMENTED_DISABLED
QUEUE_CONSUMER                      = NOT_IMPLEMENTED
GOOGLE_ADS_JOB_STATUS               = PLANNED
SCHEDULE_LIVE_PRODUCTION            = DISABLED
REMOTE_ACTION_AUTHORIZED            = NO
```

The completed External Signed PREVIEW Closeout is merged through PR `#56` at
`3488c2a69d25b58e52c6837c1e01a4df58dd22be`. Its prior task record is preserved
at:

```text
docs/archive/current-task-google-ads-external-signed-preview-closeout-merged-2026-07-26.md
```

## Objective

Implement the **local-only reference-only Queue admission boundary** for a fully
authenticated, completely assembled and cross-chunk-valid Google Ads Manager
Script `LIVE` transport Run.

The producer may enqueue only a stable non-sensitive Run reference. It must not
parse for Business destinations, write Ads facts, write Shared RAW/Lark, process
the Queue job, enable a schedule or perform any Remote action.

## Reviewed starting state

- The actual Manager Script Signed PREVIEW passed `6/6` datasets, `7/7` chunks
  and `1375/1375` rows with complete payload redaction and zero Business/Queue/
  Lark drift.
- `apps/api-worker/src/google-ads-manager-delivery-http.js` is PREVIEW-only and
  rejects `LIVE` before staging.
- `D1GoogleAdsManagerDeliveryStore` owns nonce, Run and Chunk transport state;
  it has no Queue-admission state or atomic admission method.
- Migration `0013` permits Run statuses only `assembling`, `preview_validated`,
  `invalid` and `expired`.
- Central Job type
  `google.ads.manager.signed-delivery.process` already exists but remains
  `planned`; Sync Worker correctly rejects it as not implemented.
- Shared Queue identity helpers currently lock stable operation serialization to
  TikTok history work and must be extended rather than duplicated.

## Contract locked for this task

### Queue payload

The Queue body must contain exactly these fields:

```json
{
  "schemaVersion": 1,
  "type": "google.ads.manager.signed-delivery.process",
  "operationId": "<runId>",
  "workKey": "google_ads:<runId>",
  "generation": 0,
  "originalRequestedAt": 0,
  "requestedAt": "<RFC3339>"
}
```

Rules:

- `operationId` equals the validated `runId`.
- `workKey` equals `google_ads:<runId>` exactly.
- `generation` and `originalRequestedAt` both equal
  `Date.parse(runStartedAt)`.
- `requestedAt` is the exact RFC3339 form of `originalRequestedAt`.
- No raw payload, Customer ID, Manager ID, Signature, Nonce, Secret, key ID,
  campaign/ad identity or source name may enter the Queue body.
- Unknown or additional Queue fields fail tests.

### Durable admission semantics

Use an additive Migration `0015` with a separate
`google_ads_delivery_queue_admissions` grain keyed by `run_id`. Do not rebuild or
weaken Migration `0013` constraints.

The admission record must persist only the stable reference payload and bounded
operational metadata, including:

- one durable admission identity per Run;
- exact reference payload digest;
- reservation/send lifecycle;
- bounded attempt count and sanitized error code;
- reserved/sent/expiry timestamps;
- no source rows or credentials.

Atomic reservation is allowed only when the stored Run:

- exists and is `mode=LIVE`;
- is still eligible for admission;
- has all expected chunks and rows;
- has passed the existing cross-chunk validator;
- has no conflicting admission identity or payload digest.

One durable admission identity does not imply physically exactly-once delivery
across D1 and Cloudflare Queue. A send may succeed while the D1 sent marker fails;
an exact retry may therefore deliver the same reference again. The stable
`operationId`/`workKey`/generation contract is the mandatory consumer dedupe
boundary. Remote Queue admission remains prohibited until that consumer-side
idempotency exists and passes tests.

### Feature gates

Add a separate fail-closed flag:

```text
MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED=false
```

Local synthetic tests may set it to `true`. Repository examples must keep it
`false`.

The local Queue-only path requires:

```text
MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED=true
MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED=true
MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED=false
```

This does not authorize a Remote `LIVE` run. Connector activation, Business
writes and the Queue consumer remain disabled.

## In scope

- Fresh review of the current codebase and reuse of the existing Transport,
  Job Catalog, Queue operation, D1, error/redaction and test patterns.
- Additive Migration `0015` and migration replay/constraint tests.
- Exact reference payload builder/validator using the central Job type.
- Extend shared Queue-operation identity support for Google Ads without breaking
  TikTok recovery semantics.
- D1 atomic admission reservation/read/send-result methods and race/conflict tests.
- Local API Worker `LIVE` Queue-admission path behind the new default-false flag.
- Fake/in-memory Queue tests only; no real Queue message.
- Exact retry, send failure, sent-marker failure and duplicate-safe identity tests.
- PREVIEW, provisioning, Customer OAuth, TikTok, YouTube, Meta and Core regressions.
- Update Contract, Current Task, Project Brain and CHANGELOG with the final local
  implementation result.

## Out of scope

- Remote D1 migration or backup/export.
- Cloudflare deployment, Secret/flag mutation or real HTTP request.
- Real Main Queue or DLQ message.
- Sync Worker route/consumer implementation for the Google Ads job.
- Job or Connector promotion from `planned`.
- Parsing/normalization or D1 Ads Business facts.
- Coverage processing, Shared RAW, Canonical Lark or reliability mirror writes.
- Script Property or Manager Script change.
- Another PREVIEW or any `LIVE` external execution.
- Schedule, Production or Google Ads mutation/Spend.
- Draft PR `#17` reuse, merge or cherry-pick.

## Acceptance criteria

- [x] PR `#56` is squash-merged at `3488c2a69d25b58e52c6837c1e01a4df58dd22be`.
- [x] New dedicated branch opened from that exact baseline.
- [x] Prior Closeout task archived before replacing Current Task.
- [ ] Full current-codebase review completed and duplicate/dead architecture risks recorded.
- [ ] Migration `0015` is additive and passes empty/existing-schema replay tests.
- [ ] Queue payload exact-schema tests pass and contain references only.
- [ ] Stable Google Ads operation identity is resolved through shared Queue helpers.
- [ ] Admission race produces one durable identity and no conflicting payload.
- [ ] Exact retry returns/reuses the same admission identity and reference body.
- [ ] Queue unavailable is Retryable and persists no false `sent` state.
- [ ] Ambiguous send/marker failure is duplicate-safe by stable operation identity.
- [ ] PREVIEW behavior and immediate PREVIEW payload redaction remain unchanged.
- [ ] Google Ads Job and Connector remain `planned`; all release flags remain false.
- [ ] No real Queue, Remote D1, Worker deployment, Secret, Lark or Production action occurs.
- [ ] Focused tests pass.
- [ ] `npm ci`, `npm run check`, `npm test`,
  `npm run test:report-reliability`, `npm audit --audit-level=high` and
  `npm run deploy:dry-run` pass.
- [ ] Final diff, repository hygiene and Secret/identity scan pass.
- [ ] `Implementation result` records files, commands, test counts and remaining blockers.

## Required implementation sequence

1. Review all current Google Ads transport, D1, Queue/reliability and shared
   operation code/tests before editing.
2. Update the approved Contract for the explicit Queue-only local gate.
3. Add Migration `0015` and storage tests first.
4. Add pure reference payload and shared operation-identity tests.
5. Add D1 admission store methods and concurrency/conflict coverage.
6. Wire the local API Worker path behind the default-false flag using only a fake
   Queue in tests.
7. Prove PREVIEW and all unrelated connector regressions.
8. Run full Definition of Done gates.
9. Update this file's `Implementation result`.
10. Stop for Work review before PR or any Remote action.

## Implementation result

Not started. Codex must update this section before handoff.

## Next approval gate

Review the completed local diff and full gate results. Commit/PR review and every
Remote boundary remain separate. No Remote Migration, deployment, Queue send,
external `LIVE`, Business writer, Lark write, schedule or Production action is
authorized by this task.
