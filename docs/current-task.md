# Current Task — YouTube Lark Full-Sync UAT Operator

## Authoritative status

```text
TASK_STATUS                         = APPROVED_FOR_IMPLEMENTATION
CURRENT_PROGRAM                     = YOUTUBE_LARK_FULL_SYNC_UAT_OPERATOR
BASE_BRANCH                         = docs/youtube-read-only-preflight-closeout
BRANCH                              = implementation/youtube-lark-full-sync-uat
IMPLEMENTATION_OWNER                = CHATGPT_WORK_GITHUB_TOOLS
READ_ONLY_PREFLIGHT                 = PASS_READ_ONLY_PREFLIGHT
USER_LARK_CLEANUP                   = COMPLETED_MANUALLY
REMOTE_ACTION_DURING_IMPLEMENTATION = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
D1_WRITE                            = NONE
LARK_WRITE                          = NONE
SCHEDULE_MUTATION                   = NONE
PRODUCTION                          = BLOCKED
```

## Objective

สร้าง Operator แบบ Plan-only by default สำหรับเติมข้อมูล YouTube กลับเข้า Integration Workspace Lark หลังผู้ใช้ลบข้อมูลทดสอบเก่า โดยใช้ Runtime path ที่มีอยู่แล้ว:

```text
YouTube Provider
→ Existing YouTube normalizer
→ Shared Reliability / Lock / Resumable work
→ D1-first Organic history storage
→ Existing TableSyncEngine
→ Lark RAW / Canonical tables
```

ห้ามสร้าง Connector, Queue framework, D1 writer, Lark sync engine หรือ Reliability engine ใหม่

## Verified prerequisites

```text
Historical Lark schema apply            PASS
Historical full sync                    PASS
Historical idempotent rerun             PASS
Historical incremental sync             PASS
Historical lock/retry/DLQ/alert          PASS
Current Remote read-only fingerprint    MATCH
Current active Worker version stable    PASS
Pending migrations                      0
Required YouTube/Lark Secrets            PRESENT
Required Lark table mappings             PRESENT
```

Read-only evidence was captured on clean `main@ee342e7f27c7a03c9527d166078374a16ab9f4ef` with:

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

The user manually removed the old YouTube DEV/test records they intended to clear from Lark. The Operator must not delete records, tables, fields, views, formulas, relations, D1 rows or audit history. It only performs a controlled fresh full-sync/upsert.

## In scope

- Add a dedicated YouTube Lark full-sync UAT operator and pure contract helper.
- Reuse `.dev.vars` safe parser; never source it as shell.
- Read-only Lark metadata/record-count preflight before any deployment.
- Verify current Remote all-false baseline and exact active version.
- Create a D1 backup before enabling writes.
- Generate Safe and Active Wrangler configs from one reviewed source.
- Active true flags must be exactly:
  - `MKT_CONNECTOR_YOUTUBE_ENABLED`
  - `MKT_YOUTUBE_END_TO_END_ENABLED`
  - `MKT_TIME_SERIES_D1_WRITE_ENABLED`
  - `MKT_YOUTUBE_LARK_WRITE_ENABLED`
- Keep `MKT_YOUTUBE_ANALYTICS_ENABLED=false` for the first repopulation run.
- Keep `MKT_SCHEDULE_YOUTUBE_ENABLED=false` and every other Schedule/Report/Retention/DLQ-redrive flag false.
- Send exactly one stable Queue operation with:
  - `type=youtube.channel.organic.sync`
  - `trigger=youtube_lark_full_sync_uat`
  - `syncMode=full`
  - `dryRun=false`
  - `analyticsEnabled=false`
  - Bangkok metric date equal to generation date.
- Verify terminal success, no active lock, no DLQ admission, D1/Lark write completion and positive Lark row counts.
- Resend the same operation exactly once for idempotency verification; no duplicate stable keys.
- Restore all execution flags to false and verify the restored version.
- Produce sanitized chained evidence and summary.

## Lark targets

```text
RAW_YouTube_Channels
RAW_YouTube_Videos
RAW_YouTube_Analytics_Daily  (schema verified; no new Analytics rows required while Analytics=false)
MKT_Accounts
MKT_Content
MKT_Content_Daily
MKT_Sync_Log
MKT_System_Alerts
```

The first public-data repopulation acceptance requires positive counts in Channels, Videos, Accounts, Content and Content Daily. Analytics Daily may remain zero because Owner Analytics is explicitly disabled in this run.

## Out of scope

- Lark schema/table/field/view/formula/relation mutation.
- Record deletion or retention cleanup.
- Owner Analytics/OAuth activation.
- Schedule activation.
- Production/customer-owned deployment.
- Queue DLQ redrive.
- Remote migration apply.
- Any Connector other than YouTube.

## Safety and phase contract

```text
plan
→ lark-preflight              READ ONLY
→ remote-preflight            READ ONLY
→ backup                      D1 BACKUP ONLY
→ deploy-active               WORKER DEPLOYMENT
→ verify-active               READ ONLY
→ snapshot-before             READ ONLY
→ send-full-sync              EXACTLY ONE QUEUE MESSAGE
→ verify-full-sync            READ ONLY
→ resend-same-operation       EXACTLY ONE SAME-IDENTITY QUEUE MESSAGE
→ verify-idempotent-rerun     READ ONLY
→ restore-all-false           WORKER DEPLOYMENT
→ verify-restore              READ ONLY
→ summary                     LOCAL EVIDENCE ONLY
```

Every executable phase requires its own exact confirmation token and exact reviewed repository HEAD. Queue send attempt evidence must be written before the POST so automatic retries cannot duplicate sends.

## Acceptance criteria

```text
Plan-only default                          PASS REQUIRED
Exact repository HEAD / clean tree         PASS REQUIRED
Current safe baseline                      PASS REQUIRED
Lark metadata and mappings                 PASS REQUIRED
D1 backup evidence                         PASS REQUIRED
Active true flags exact set                PASS REQUIRED
Schedule flags all false                   PASS REQUIRED
One full-sync Queue send                    PASS REQUIRED
Sync run terminal success                  PASS REQUIRED
Active lock count zero                     PASS REQUIRED
DLQ admission zero                         PASS REQUIRED
D1-first completion                        PASS REQUIRED
Positive required Lark record counts       PASS REQUIRED
Same-operation rerun idempotent             PASS REQUIRED
Safe restore and verification              PASS REQUIRED
Secret/token values persisted              FORBIDDEN
Production                                 BLOCKED
```

## Required tests

- Config window permits only the four approved live-UAT flags.
- Analytics/Schedule/other connector flags remain false.
- Job identity, metric date and `syncMode=full` are deterministic.
- Lark target-count classification handles required-positive and Analytics-optional semantics.
- Full-sync completion classification rejects partial/failed/active-lock/DLQ states.
- Rerun classification rejects duplicate-key growth and a second provider generation.
- Restore guard rejects changed active version or target fingerprint.
- Queue send-once attempt guard.
- Existing YouTube dry-run, TikTok/Core, Unit/Workers, Report and Wrangler dry-run regressions pass.

## Required repository gates

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

## Merge and Remote execution boundary

Implementation and CI do not authorize Merge or Remote execution. Squash Merge requires separate explicit authorization. After merge, phases that deploy, create a backup, send Queue messages or write D1/Lark require explicit execution authorization and must run from the user's authenticated local Terminal.
