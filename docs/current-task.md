# Current Task — YouTube Lark Full-Sync UAT Operator

## Authoritative status

```text
TASK_STATUS                         = ALIGNMENT_READY_FOR_EXACT_HEAD_CI
CURRENT_PROGRAM                     = YOUTUBE_LARK_FULL_SYNC_UAT_OPERATOR
CLOSEOUT_PR                         = #184 / SQUASH_MERGED / 9f690b2bce4c440be162649c8a2da134245fcc75
IMPLEMENTATION_PR                   = #186 / READY / UNMERGED
BRANCH                              = implementation/youtube-lark-full-sync-uat
BASE_MAIN_SHA                       = 9f690b2bce4c440be162649c8a2da134245fcc75
IMPLEMENTATION_OWNER                = CHATGPT_WORK_GITHUB_TOOLS
READ_ONLY_PREFLIGHT                 = PASS_READ_ONLY_PREFLIGHT
USER_LARK_CLEANUP                   = COMPLETED_MANUALLY
FINAL_DOCS_CI                       = #848 / 30335038060 / PASS
EXACT_ALIGNED_CI                    = PENDING
REMOTE_ACTION_DURING_IMPLEMENTATION = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
D1_WRITE                            = NONE
LARK_WRITE                          = NONE
SCHEDULE_MUTATION                   = NONE
PRODUCTION                          = BLOCKED
```

## Objective

เติมข้อมูล YouTube DEV กลับเข้า Integration Workspace Lark หลังผู้ใช้ลบข้อมูลทดสอบเก่าที่ต้องการลบ โดยใช้ Runtime path เดิมเท่านั้น:

```text
YouTube Data API
→ Existing YouTube adapter / normalizer
→ Shared Reliability / lock / durable work
→ D1-first organic history
→ Existing TableSyncEngine
→ Lark RAW / Canonical tables
```

ไม่มีการสร้าง Connector, Queue framework, D1 writer, Lark sync engine หรือ Reliability engine ใหม่

## Verified prerequisites

```text
Historical schema apply                 PASS
Historical full sync                    PASS
Historical idempotent rerun             PASS
Historical incremental sync             PASS
Historical lock / retry / DLQ / alert   PASS
Current Remote fingerprint              MATCH
Current active Worker version stable    PASS
Pending migrations                      0
Required Secret names                   PRESENT
Required Lark mappings                  PRESENT
```

Final read-only evidence was captured on clean `main@ee342e7f27c7a03c9527d166078374a16ab9f4ef`:

```text
decision          PASS_READ_ONLY_PREFLIGHT
remoteMutation    NONE
providerCall      NOT_RUN
queueMessage      NOT_SENT
d1Write           NONE
larkRequest       NOT_RUN
workerDeployment  NOT_RUN
scheduleMutation  NONE
```

## User data-reset fact

The user manually removed the old YouTube DEV/test Lark records they intended to clear. The operator never deletes records, tables, fields, views, formulas, relations, D1 rows or audit history. It performs only a controlled full-sync/upsert.

## Repository implementation

### Stable operation identity

New trigger:

```text
youtube_lark_full_sync_uat
```

Approved job contract:

```text
type                youtube.channel.organic.sync
trigger             youtube_lark_full_sync_uat
syncMode            full
dryRun               false
analyticsEnabled     false
workKey              youtube:<operationId>
syncRunId            youtube-lark-uat:<operationId>
generation           originalRequestedAt
```

The durable identity is independent from the Cloudflare delivery message ID. Initial send and rerun use the exact same operation identity.

### Runtime guard

The dedicated YouTube router requires:

```text
environment          development
profile              integration_workspace
customer             chemistry_k
account              dev_ft_pumkin
D1 write             true
Lark write           true
Owner Analytics      false
YouTube Schedule     false
```

### Approved active window

Exactly four flags may be true:

```text
MKT_CONNECTOR_YOUTUBE_ENABLED
MKT_YOUTUBE_END_TO_END_ENABLED
MKT_TIME_SERIES_D1_WRITE_ENABLED
MKT_YOUTUBE_LARK_WRITE_ENABLED
```

Every other `MKT_*_ENABLED` flag remains false.

### Guarded phases

```text
plan
→ lark-preflight              READ ONLY
→ remote-preflight            READ ONLY
→ backup                      D1 EXPORT ONLY
→ deploy-active               WORKER DEPLOYMENT
→ verify-active               READ ONLY
→ snapshot-before             READ ONLY
→ send-full-sync              ONE QUEUE MESSAGE
→ verify-full-sync            READ ONLY
→ resend-same-operation       ONE SAME-IDENTITY MESSAGE
→ verify-idempotent-rerun     READ ONLY
→ restore-all-false           WORKER DEPLOYMENT
→ verify-restore              READ ONLY
→ summary                     LOCAL EVIDENCE ONLY
```

Every executable phase requires a distinct exact confirmation. Deploy and Queue attempt evidence is written before the remote command so ambiguous interruptions cannot be automatically repeated.

### Local session wrapper

`scripts/youtube-lark-full-sync-uat-session.mjs`:

- reads `.dev.vars` through the repository parser;
- resolves Cloudflare Account ID and bearer auth from the Wrangler session;
- reads Queue inventory and pins the exact `social-mkt-sync-jobs` Queue ID;
- creates a private `0600` non-secret session file;
- never prints or persists the bearer token;
- pins repository HEAD, operation ID, generation, account and Queue target;
- forwards the exact phase to the low-level operator.

### Emergency all-false restore

`scripts/youtube-lark-full-sync-uat-emergency-restore.mjs` is separately confirmation-gated. It can operate even when `main` moves after activation, but only when:

- the Working Tree is clean;
- the session and evidence chain are valid;
- the authenticated Cloudflare account matches the pinned session;
- the current Safe config SHA equals Remote-preflight evidence;
- the active Worker version equals either the reviewed baseline or reviewed UAT activation.

It performs no Queue send, D1 write or Lark request. It deploys the reviewed all-false config only, verifies zero true execution flags and writes private evidence. A prior attempt blocks automatic repetition.

## Verification contracts

### D1-first verification

The verifier reads durable storage IDs from `sync_work_runs.completion_json`:

```text
$.endToEnd.storage.historySyncRunId
$.endToEnd.storage.contentCoverageRunId
$.endToEnd.storage.accountCoverageRunId
```

D1 business counts are checked against the exact IDs used by the existing storage writer, not the outer Reliability sync-run ID.

### Lark acceptance

Positive YouTube-scoped counts are required in:

```text
RAW_YouTube_Channels
RAW_YouTube_Videos
MKT_Accounts
MKT_Content
MKT_Content_Daily
```

`RAW_YouTube_Analytics_Daily` may remain zero because Owner Analytics is intentionally disabled. No schema mutation occurs.

### Idempotency acceptance

The same stable operation is admitted twice. Verification requires:

- first run Provider request count greater than zero;
- rerun Provider request count exactly zero;
- unchanged operation-scoped D1 business counts;
- unchanged YouTube-scoped Lark counts;
- no active lock;
- no DLQ admission;
- completed durable work and terminal success.

## Repository verification history

```text
#829 / 30331782685   EXPECTED FAIL / one source-wiring test
#832 / 30332322254   PASS
#834 / 30332773124   PASS / phase commands
#840 / 30333794942   PASS / durable IDs and Provider replay
#841 / 30334016384   PASS / aligned combined tree
#842 / 30334270419   PASS / local session wrapper
#846 / 30334705825   PASS / emergency restore and final Runtime tree
#848 / 30335038060   PASS / final documentation head before PR #184 squash alignment
```

Latest verified Runtime head:

```text
HEAD                    = faf8e69c5aea470321a7ccb8ac0ef481786e32ee
BRANCH_VERIFICATION     = #846 / 30334705825 / PASS
SYNTAX_ARCHITECTURE     = PASS
FOCUSED_TIKTOK          = PASS
UNIT_WORKERS_RUNTIME    = PASS
REPORT_RELIABILITY      = PASS
DEPENDENCY_AUDIT        = PASS
WRANGLER_DRY_RUN        = PASS / NO DEPLOYMENT
ARTIFACT                = 8678696845
ARTIFACT_DIGEST         = sha256:262ddee515b1e4e01a4b3e49d17bf47735b9ba3a9ba958b2f3b1b7b8bc0bd01b
BEHIND_MAIN             = 0
REVIEW_THREADS          = 0
COMMENTS_ACTION         = 0
REMOTE_ACTION_COUNT     = 0
```

## Merge and execution boundary

Required order:

```text
1. Squash Merge PR #184 — read-only closeout documentation
2. Align PR #186 with resulting main
3. Exact combined-head Branch Verification
4. Squash Merge PR #186 — UAT operator implementation
5. Separate explicit authorization for Live UAT phases
```

Repository implementation and CI do not authorize D1 backup, Worker deployment, Queue send, Provider call, D1/Lark write, restore deployment or Production. Live execution must run from the user's authenticated local Terminal after a separate authorization.

## Implementation result

- Squash Merge PR #184 completed at `9f690b2bce4c440be162649c8a2da134245fcc75`.
- The resulting `main` was merged into PR #186; the only conflict was this Current Task document.
- The YouTube Lark Full-Sync UAT task remains authoritative over the completed read-only closeout task.
- Exact aligned-head Branch Verification is required before Squash Merge PR #186.
- No Worker deployment, Queue/DLQ action, Remote D1/Lark mutation, Provider call, Schedule mutation, Secret mutation or Production action occurred during alignment.
