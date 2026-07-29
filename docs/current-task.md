# Current Task — Lark Dashboard Shared Dimensions Backfill Post-Apply Verification Hotfix

## Authoritative status

```text
TASK_STATUS                         = REPOSITORY_IMPLEMENTATION_VALIDATED
CURRENT_PROGRAM                     = LARK_DASHBOARD_BACKFILL_POST_VERIFY_V1
INCIDENT_MAIN_SHA                   = 6c249e794ce51d118c841ff17d12fd823647fd46
IMPLEMENTATION_BASE_MAIN_SHA        = ab56882
BRANCH                              = hotfix/lark-dashboard-backfill-post-verify-v1
OPERATOR                            = scripts/lark-dashboard-shared-dimensions-backfill.mjs
OPERATOR_VERSION                    = lark-dashboard-shared-dimensions-backfill-v1.2
IMPLEMENTATION_PR                   = #246 / DRAFT / DO_NOT_MERGE
BRANCH_VERIFICATION                 = #30468846202 / PASS
REMOTE_ACTION_DURING_IMPLEMENTATION = NONE
LARK_APPLY                          = NOT_RUN
D1_WRITE                            = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
SCHEDULE_MUTATION                   = NONE
PRODUCTION_UAT                      = BLOCKED
```

## Objective

แก้ Post-apply verification ของ Shared dimensions backfill ให้แยก Lark read-after-write
eventual consistency ออกจาก persistent mismatch โดยทำ bounded read-only replan หลาย attempt
หลัง `executeAll()` เพียงครั้งเดียว ห้าม retry write และต้อง Fail closed หากยังมี pending writes.

Incident ก่อนหน้า Apply แสดง `createRows=0`, `updateRows=32` และจบด้วย
`LARK_DASHBOARD_BACKFILL_POST_VERIFY_FAILED` หลัง write execution. Error นี้ยืนยันได้เพียงว่า
single immediate verification ยังเห็น pending 32 rows; ไม่ได้ยืนยันว่า Batch update ล้มเหลว.

## Root cause decision

- ยืนยัน Repository defect: เส้นทางเดิม
  `preview.planner.executeAll() → planBackfill() → assertBackfillVerificationComplete()`
  ทำ Post-apply read/replan เพียงครั้งเดียวทันที จึงแยก eventual consistency ออกจาก
  persistent mismatch ไม่ได้.
- Lark record search ในแต่ละ `planBackfill()` เป็น request ใหม่; ไม่มี record-response cache
  ใน path นี้. Schema metadata เท่านั้นที่ runtime cache ไว้.
- Existing Lark serializer มี semantic normalization สำหรับ Text, SingleSelect, Number และ
  omitted null อยู่แล้ว แต่ก่อน Hotfix ไม่มี focused backfill regression ที่พิสูจน์ contract นี้.
- Root cause ของ Remote state ยังไม่ยืนยันโดย Live reproduction. Eventual consistency,
  update persistence failure และ comparison mismatch จึงยังเป็นสมมติฐานที่ bounded fresh reads
  จะช่วยจำแนก โดยไม่เดาจาก Batch update response.

## Correction contract

```text
write execution                  exactly once before verification
verification attempt            fresh planBackfill + fresh Lark record reads
verification write retry        0
delays                           0ms, 1000ms, 2000ms, 4000ms, 8000ms
attempt bound                    5
maximum elapsed budget          30000ms
success                         createRows=0 AND updateRows=0
createRows>0                    fail closed immediately
persistent updateRows>0         LARK_DASHBOARD_BACKFILL_POST_VERIFY_FAILED
```

Persistent diagnostics เปิดเผยเฉพาะ attempt count, elapsed milliseconds, pending rows ต่อ
logical table key, pending field-name counts และ read strategy. ห้ามมี Business values,
Caption, Metrics, Token/Secret, Lark record payload, record ID หรือ physical Table ID.

Preview ปกติยังเป็น read-only recovery mode:

```bash
node scripts/lark-dashboard-shared-dimensions-backfill.mjs
```

- `updateRows=0` หมายถึง Remote state converge แล้ว ไม่ต้อง Apply ซ้ำ.
- `updateRows>0` หมายถึงยังมี pending จริง และต้องขออนุมัติ Apply ใหม่แยกต่างหาก.

## Required validation

```text
Focused backfill / normalization / sync-engine tests
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npx wrangler deploy --dry-run --config wrangler.sync.jsonc --env development
Branch Verification CI
```

## Safety boundary

Repository implementation นี้ไม่อนุญาต Backfill Apply, Remote Lark/D1 mutation, Worker deploy,
Queue/DLQ send, Schedule change, Secret change, Production/UAT หรือ PR merge.

รายละเอียด Implementation และ evidence:

```text
docs/tasks/lark-dashboard-backfill-post-verify-hotfix-v1.md
```

## Implementation result

### WooCommerce snapshot idempotent normalization — 2026-07-30

- ยืนยัน root cause ของ semantic-empty exact preflight: `readSnapshot()` normalize D1 row แล้ว
  downstream selector/classifier normalize ซ้ำด้วย snake_case-only contract ทำให้ identity/state/
  Queue/Coverage/Commerce counts กลายเป็น null/zero.
- Normalizer ใหม่รองรับ raw snake_case และ normalized camelCase แบบ idempotent; exact selector
  ให้ identity เดียวกันทั้งสองรูปแบบ.
- Verification ผ่าน focused `25/25`, Unit `1499/1499`, Workers runtime `16/16`,
  Report reliability `101/101`, architecture/hygiene `406` modules / `0` cycles,
  audit `0` vulnerabilities และ deploy dry-run.
- Repository implementation ไม่มี Remote mutation; failed attempts ก่อนหน้านี้หยุดก่อน
  Lark schema, backup, Deploy และ Queue.

### WooCommerce exact snapshot semantic retry — 2026-07-30

- หลัง lifecycle reactivation สำเร็จ Final remote preflight เห็น pinned active work ถูกต้อง
  แต่ exact snapshot query ถัดมาได้ successful semantic-empty row ชั่วคราว; attempt หยุดก่อน
  Lark schema, backup, Deploy และ Queue.
- เพิ่ม bounded read-only retry `1s/2s/5s/10s` เฉพาะ snapshot ที่ว่างทุก identity/state/count
  เท่านั้น; populated contract mismatch ยัง fail closed ทันที.
- Verification ผ่าน focused `13/13`, Unit `1490/1490`, Workers runtime `16/16`,
  Report reliability `101/101`, architecture/hygiene `404` modules / `0` cycles,
  audit `0` vulnerabilities และ deploy dry-run.
- Repository implementation ไม่มี Remote mutation; หลัง merge ต้อง retry exact operation
  `woo-final-full-e2372e56d52d` เดิมเท่านั้น.

### WooCommerce exact-resume lifecycle reactivation hotfix — 2026-07-30

- Exact continuation ของ `woo-final-full-e2372e56d52d` ถูก launcher รุ่นเดิม terminalize
  โดย generic failed-work recovery หลัง operation มี partial D1/Lark facts แล้ว; Final operator
  หยุดก่อน Deploy/Queue เพราะขาด `optionalText`.
- Launcher ใหม่ข้าม generic recovery เมื่อ pin exact operation และ generic recovery ถูกจำกัด
  แบบ read+mutation guard ให้รับเฉพาะ work ที่ Coverage/Commerce rows เป็นศูนย์.
- One-command/Final preflight ยอม active work ได้เฉพาะ pinned work หนึ่งรายการ ไม่มี work อื่น,
  ไม่มี lock และ Migration 0017 ไม่ pending.
- เพิ่ม exact reactivation operator ที่ตรวจ failed code, phase page 2, Work/Queue/Fence identity,
  Coverage และ exact 14-table counts ก่อน update lifecycle แถวเดียว พร้อม immutable post-check.
- Live read-only inspection ยืนยัน terminal incident, Queue attempts `7`, Coverage `2`,
  invalid Coverage `1`, Business rows `897`, active locks `0`.
- Verification ผ่าน focused `33/33`, Unit `1488/1488`, Workers runtime `16/16`,
  Report reliability `101/101`, architecture/hygiene `404` source modules / `0` cycles,
  audit `0` vulnerabilities และ deploy dry-run.
- Repository implementation ยังไม่มี Remote mutation; exact reactivation ทำได้หลัง
  exact-head CI/Squash Merge เท่านั้น แล้วต้อง resume operation เดิม ห้ามสร้าง full operation ใหม่.

### Platform-neutral WooCommerce Commerce report runtime — 2026-07-30

- Added WooCommerce to the shared Report registry/settings as active capability `commerce`.
- The existing D1 WooCommerce report source now feeds shared Dashboard materialization metrics
  plus bounded `top_products`, `payment_methods`, `shipping_methods` and currency context.
- Shared D1 materialization persistence now retains extensible collections for every capability.
- Shared Lark materialization writes Commerce Snapshot and Metric rows without requiring Organic
  or Paid Ads ranking tables.
- Worker execution requires an isolated WooCommerce report-only window and rejects concurrent
  connector, D1/Lark ingestion, full reconciliation or Schedule flags.
- AI summary remains default-off and no report schedule is enabled.
- Verification passed: focused Node `32/32`, focused Worker `3/3`, full unit `1476/1476`,
  Workers runtime `16/16`, report reliability `101/101`, architecture/hygiene with `0` cycles,
  audit `0` and deploy dry-run.
- Repository implementation has no Remote action.

### WooCommerce exact durable continuation operator — 2026-07-30

- Final rollout can pin the already-admitted partial operation through
  `MKT_WOOCOMMERCE_FINAL_RESUME_OPERATION_ID`.
- The read-only preflight runs before Lark schema or Worker mutation and requires the exact
  D1-read failure, active incomplete work, zero live locks, existing Queue attempts, partial
  Business facts and matching work/Queue generation plus original requested-at.
- The continuation sends the original stable job identity once, completes the existing full
  operation, then preserves the existing parity, same-operation replay, incremental UAT and
  all-false Safe closeout stages.
- Queue attempt verification now uses durable `main_queue_attempts` rather than row count.
- Verification passed: focused `17/17`, unit `1467/1467`, Workers runtime `15/15`, report
  reliability `101/101`, architecture/hygiene with `0` cycles, audit `0` and deploy dry-run.
- Repository implementation has no Remote action.

### WooCommerce D1 100-bound-parameter continuation hotfix — 2026-07-30

- Final operation `woo-final-full-e2372e56d52d` was admitted once and wrote partial Store/Orders
  D1 + Lark facts before exact durable retries failed at the `commerce_customer_aggregates` read.
- Live evidence isolated the boundary: the first page passed with 99 value keys + one account bind;
  the full page failed with 100 value keys + one account bind. D1 allows at most 100 bound
  parameters per query.
- The shared WooCommerce D1 derived-row reader now reserves the account bind and chunks value
  lists to 99 while preserving sorted deterministic output.
- The exact partial operation must be resumed through its existing durable contract after
  PR/CI/Merge; it must not be abandoned or replaced.
- Verification passed: focused WooCommerce `12/12`, unit `1466/1466`, Workers runtime `15/15`,
  report reliability `101/101`, architecture/hygiene `399` source modules with `0` cycles,
  `npm audit` with `0` vulnerabilities and deploy dry-run.
- Repository implementation has no Remote action.

### WooCommerce Final Safe Closeout v1 — 2026-07-30

- Exact recovery PR `#253` Squash Merged ที่
  `67a82551749569d74b9e4b66a32c82e5715b1d40`; Live recovery เปลี่ยนเฉพาะ durable lifecycle
  row ของ `woo-final-full-6f43ac8ee857` เป็น terminal และ post-inspection ยืนยัน stale-active
  false, locks `0`, Queue attempts `1`, Coverage/Business rows `0`.
- Final operator เดิมยัง deploy scheduled-active window เมื่อ success ซึ่งขัด scoped
  authorization ล่าสุดที่กำหนด Schedule/Cron disabled และ all-false Safe restore.
- Hotfix นี้ reuse existing rollout path แต่แทน final scheduled deployment ด้วย verified
  `safe-closeout`; summary ต้องเป็น `executionFlagsAllFalse=true`, `scheduleEnabled=false`.
- Focused rollout/runtime tests ผ่าน `56/56`; full Unit `1462/1462`, Workers runtime
  `15/15`, Report reliability `100/100`, repository check, dependency audit `0 vulnerabilities`
  และ deploy dry-runs ผ่าน.
- Repository implementation ไม่มี Remote action; Live rollout จะทำหลัง exact-head CI,
  self-review และ Squash Merge.

### WooCommerce exact stale-operation recovery 6f43 — 2026-07-30

- Provider diagnostics rerun ผ่านบน merged `main@527cdceda2d4661c82dc000380705d1078343bdf`:
  WooCommerce `10.6.2`, WordPress `6.9.4`, currency `THB`, Provider GET `1`, mutations/Queue/
  D1/Lark/Schedule `0`, Preview URLs restored disabled และ Production baseline ไม่เปลี่ยน.
- Read-only inspector ยืนยัน `woo-final-full-6f43ac8ee857` เป็น failed + stale active,
  active locks `0`, Queue attempts `1`, Coverage `0` และ Commerce Business rows ทั้ง 14 ตาราง `0`.
- Recovery-only operator ถูก repin ไป exact operation และ confirmation
  `RECOVER_WOO_FINAL_FULL_6F43AC8EE857_ONLY`; mutation ยังคงจำกัดที่ guarded lifecycle row
  เดียว และมี read-only pre/post verification.
- Focused recovery/inspector tests ผ่าน `20/20`; full Unit `1461/1461`, Workers runtime
  `15/15`, Report reliability `100/100`, repository check, dependency audit `0 vulnerabilities`
  และ deploy dry-runs ผ่าน.
- Repository implementation นี้ยังไม่มี Remote mutation; exact recovery execution จะทำหลัง
  exact-head CI, self-review และ Squash Merge.

### WooCommerce Provider redirect diagnostics follow-up — 2026-07-30

- PR `#251` Squash Merged ที่ `a4bfd16daac6bc47a5296687fb4f843e7f132847`.
- Live Preview diagnostics ผ่าน Active/Safe pair classification และ restore ครบ; Provider GET
  หนึ่งครั้งได้ HTTP `200`/`application/json` แต่ body shape เป็น `html_or_xml` จึงยัง fail closed
  ด้วย `WOOCOMMERCE_INVALID_JSON`.
- Preview URLs/workers.dev ถูก restore disabled, Production baseline
  `8284c076-49ed-4ffc-bba9-f2e0839aa1c5` ไม่เปลี่ยน และ Queue/D1/Lark/Schedule/Business
  mutations เป็นศูนย์.
- Public unauthenticated exact-route GET ด้วย Worker headers ได้ JSON `401`, ยืนยัน source
  hostname/path/Accept/User-Agent route. Follow-up เพิ่มเฉพาะ bounded redirect/final-target
  booleans เพื่อแยก followed redirect จาก direct HTML contamination โดยไม่เก็บ URL/body/Secret.
- Provider diagnostics rerun, failed-operation recovery และ Final D1/Lark rollout รอ hotfix
  exact-head CI/Squash Merge.

### WooCommerce End-to-End D1 + Lark Closeout v1 — Preview pair classifier — 2026-07-30

- Branch `codex/woocommerce-end-to-end-lark-closeout-v1` เริ่มจาก
  `main@2f8d62928dc2329b06d275a3bef927fe506dba30` และมี required ancestor
  `1002cc9cfad0f07fdd1103f2601d642339e08686`.
- Preview upload parser จำแนก `aliased_preview`, `versioned_preview` และ
  `invalid_or_foreign`; alias+versioned หนึ่งคู่ไม่ถูกถือเป็น ambiguity อีกต่อไป.
- Candidate extraction จำกัดเฉพาะ six declared Preview fields/containers. Deterministic alias
  ยังคงเป็น probe/Provider target เสมอ; Versioned URL ใช้เป็น bounded cross-check เท่านั้น.
- Focused classifier/runtime tests ผ่าน `36/36`; full Unit `1460/1460`, Workers runtime
  `15/15`, Report reliability `100/100`, repository check, dependency audit 0 vulnerabilities
  และ repository deploy dry-runs ผ่าน.
- Repository implementation Remote action count = `0`. Live diagnostics, recovery, D1/Lark UAT
  และ Safe restore จะดำเนินต่อหลัง exact-head CI/Squash Merge ภายใต้ scoped authorization ล่าสุด.
- รายละเอียด: `docs/tasks/woocommerce-end-to-end-lark-closeout-v1.md`.

### WooCommerce Diagnostics Deterministic Preview Origin Hotfix v1 — 2026-07-30

- Branch `codex/woocommerce-diagnostics-preview-origin-v1` starts from latest
  `main@78aaf1416f5f7fc528c0c4bbfc2da409bb169a34` and contains required ancestor
  `1002cc9cfad0f07fdd1103f2601d642339e08686`.
- Confirmed repository defect: structured upload parsing required a Preview URL array even after
  exactly one valid `version-upload`; latest retained Live evidence had two successful Preview
  uploads but zero Provider requests and a safely restored Preview setting/unchanged Production
  deployment.
- Existing Preview URL wrapper now performs the read-only Cloudflare account subdomain GET after
  existing account/auth resolution, validates the exact DNS label and forwards only
  `MKT_WOOCOMMERCE_WORKERS_DEV_SUBDOMAIN`.
- Operator constructs the exact deterministic origin from alias, Worker name and account
  subdomain. Wrangler structured upload/version ID remains authoritative; URL evidence is optional
  but matching is mandatory if present. Raw origin/account subdomain/account ID/auth is not
  printed or persisted.
- Command-failed evidence now keeps `capturedOutputFileCount` independent and includes only files
  with a real `command-failed` record; successful uploads and application-level child exits do not
  fabricate Wrangler failures.
- Preview Queue sentinel, production deployment checks, at-most-one Provider GET, all-zero
  Queue/D1/Lark/Schedule/mutation counters and Active/Safe config isolation are unchanged.
- Focused Node behavior tests passed `33/33`; focused Workers-runtime Queue sentinel regression
  passed `12/12`.
- Full verification passed: `npm ci`, `npm run check`, Unit `1456/1456`, Workers runtime
  `15/15`, Report reliability `100/100`, dependency audit `0 vulnerabilities`, generated
  Active/Safe Preview config dry-runs and both repository deployment dry-runs.
- Implementation/CI Remote actions are `0`; Live rerun, Preview setting mutation, Worker Version
  upload/deploy, Provider request, Remote D1/Lark, Queue, Schedule, Secret, Production and Merge
  remain unauthorized.
- Implementation head `80e9dacc902d9e47b9086db09d1ebaa4a62f8fbd` ถูก Push และเปิด
  Draft PR `#250`; Branch Verification `#1082 / 30482310910` ผ่านทุก step.
- Docs-only closeout head ต้องผ่าน Branch Verification รอบสุดท้ายก่อน Mark Ready for Review.
- Detailed handoff:
  `docs/tasks/woocommerce-diagnostics-preview-origin-v1.md`.

- Focused backfill, serializer และ sync-engine regressions ผ่าน `30/30`.
- Full existing backfill/table-discovery tests ผ่าน `16/16`.
- `npm ci`, Architecture/Repository hygiene, Unit `1436/1436`, Workers runtime `14/14`,
  Report reliability `100/100`, dependency audit `0 vulnerabilities`, exact
  `wrangler.sync.jsonc --env development` dry-run และ repository example dry-runs ผ่าน.
- `npm test` ใน restricted sandbox ผ่าน Unit ทั้งหมดก่อน Workers runtime ถูก OS ปฏิเสธ
  Wrangler log/localhost ด้วย `EPERM`; Workers suite เดิมผ่านเมื่อ rerun นอก restricted sandbox.
- Implementation commit `1fd375b5e6c6cc70562212677902f1b32b7cf8e5` ถูก Push และเปิด
  Draft PR `#246` เข้า `main`.
- Branch Verification run `30468846202` ผ่านทุก step; docs-only closeout Head ต้องผ่าน
  verification รอบสุดท้ายก่อนส่งมอบ.
- Remote action count ระหว่าง Implementation = `0`.

### WooCommerce diagnostics Queue sentinel hotfix handoff

- Branch `codex/woocommerce-diagnostics-queue-sentinel-v1` เริ่มจาก latest
  `main@142d742fd27df9fdd1728a371836dd395dcc88ea` ซึ่งมี required ancestor
  `ab56882e691f93678ee56fbac2cb12f5c8ee95fc`.
- Preview-only diagnostics entrypoint เพิ่ม fail-closed `queue(batch)` ที่เรียก
  `batch.retryAll()` exactly once โดยไม่ ack, อ่าน message, เรียก Business router,
  Provider, D1, Lark, Queue producer หรือ Schedule.
- Active/Safe generated configs ไม่มี Queue/routes/triggers/D1/production bindings และลด vars
  เหลือเฉพาะ target, non-secret WooCommerce source และ diagnostics values ที่จำเป็น.
- Focused Node tests ผ่าน `26/26`; Workers-runtime focused file ผ่าน `12/12`;
  generated Active/Safe configs ผ่าน Wrangler version-upload dry-run.
- `npm ci`, `npm run check`, Unit `1438/1438`, Workers runtime `15/15`,
  Report reliability `100/100`, dependency audit `0 vulnerabilities` และ repository
  deploy dry-runs ผ่าน. `npm test` ใน restricted sandbox ผ่าน Unit ก่อน Workers suite ถูก
  OS ปฏิเสธ Wrangler log/localhost ด้วย `EPERM`; Workers suite ผ่านเมื่อ rerun นอก sandbox.
- Implementation head `08fe830c4e38664d2210bcb97d52ee1739bb9ba9` ถูก Push และเปิด
  Draft PR `#247`; Branch Verification `#1070 / 30471168454` ผ่านทุก step.
- Docs-only closeout head ผ่าน Branch Verification `#1072 / 30471397433`; PR `#247`
  ถูก Mark Ready for Review และยังไม่ Merge. Status-only handoff commit สุดท้ายต้องผ่าน
  exact-head Branch Verification ก่อน Merge.
- Remote action count ระหว่าง Implementation = `0`; Live rerun = `NOT_AUTHORIZED`;
  Production Worker entrypoint, Queue runtime, deployment และ traffic ไม่เปลี่ยน.
- รายละเอียด: `docs/tasks/woocommerce-diagnostics-queue-sentinel-v1.md`.

---

# Historical Task Context — YouTube Lark Full-Sync UAT Operator

## Authoritative status

```text
TASK_STATUS                         = CUSTOMER_SCOPE_HOTFIX_READY_FOR_CI
CURRENT_PROGRAM                     = YOUTUBE_LARK_FULL_SYNC_UAT_OPERATOR
CLOSEOUT_PR                         = #184 / SQUASH_MERGED / 9f690b2bce4c440be162649c8a2da134245fcc75
IMPLEMENTATION_PR                   = #186 / SQUASH_MERGED / bead0d5c4f9e78793ea00ba16fdf58bbcc80f19e
BRANCH                              = codex/fix-youtube-uat-persist-end-to-end-completion
BASE_MAIN_SHA                       = 369aff9aa805a277340ac1d32aed227d16db507d
IMPLEMENTATION_OWNER                = CHATGPT_WORK_GITHUB_TOOLS
READ_ONLY_PREFLIGHT                 = PASS_READ_ONLY_PREFLIGHT
USER_LARK_CLEANUP                   = COMPLETED_MANUALLY
FINAL_DOCS_CI                       = #848 / 30335038060 / PASS
EXACT_ALIGNED_CI                    = #849 / 30336265851 / PASS
LIVE_UAT_OPERATION                  = NEW CUSTOMER-SCOPED SESSION REQUIRED AFTER MERGE
LARK_PREFLIGHT                      = PENDING CUSTOMER-SCOPED RERUN
REMOTE_PREFLIGHT                    = PENDING CUSTOMER-SCOPED RERUN
REMOTE_ACTION_DURING_IMPLEMENTATION = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
D1_WRITE                            = NONE
LARK_WRITE                          = NONE
SCHEDULE_MUTATION                   = NONE
PRODUCTION                          = BLOCKED
```

## Objective

เติมข้อมูล YouTube ของลูกค้า Chemistry K เข้า Integration Workspace Lark หลัง rollback ชุดข้อมูล
YouTube DEV ที่ operation ก่อนหน้าเขียนผิด scope โดยใช้ Runtime path เดิมเท่านั้น:

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
account              chemistry_k
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
- reads the exact `chemistry_k` / `youtube` connection from Remote D1 and requires
  connected + validated state with a credential reference before pinning its Channel ID;
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
- PR #186 passed exact-head Branch Verification `#849` and Squash Merged at `bead0d5c4f9e78793ea00ba16fdf58bbcc80f19e`.
- Live UAT authorization was received and a session was pinned to clean `main@369aff9aa805a277340ac1d32aed227d16db507d`.
- Lark metadata/count preflight passed for all eight destinations with zero YouTube-scoped rows and no mutation.
- Remote preflight stopped before any Remote read or mutation because the generated Wrangler config directory was removed before the asynchronous dry-run completed.
- The hotfix keeps both normal and emergency-restore generated configs alive until their awaited operation settles, then removes the private temporary directory.
- Hotfix verification passed: syntax checks, focused operator/emergency tests `13/13`, repository check, unit tests `1273/1273`, Workers-runtime tests `12/12`, report reliability `88/88`, dependency audit with zero vulnerabilities, and Wrangler dry-run with no deployment.
- The initial combined `npm test` Workers-runtime failure was environment-only (`EPERM` for the sandboxed Wrangler log and localhost listener); the same Workers-runtime suite passed outside the restricted sandbox.
- A first live attempt reached the existing D1-first/Lark write path but used the obsolete
  developer YouTube profile. It was restored to all-false immediately and was not rerun.
- The customer-scope hotfix changes the Integration Workspace YouTube account identity to
  `chemistry_k`, requires the exact connected/validated D1 customer connection in the session
  wrapper, and pins that connection and Channel ID without reading or printing credential values.
- The completion hotfix persists `endToEnd.storage` in `sync_work_runs.completion_json` before
  marking durable work complete, so live verification can resolve the exact D1 history and
  coverage IDs while replay still skips the Provider.
- Meta Facebook D1-only live execution later exposed a separate credential-wiring defect:
  `facebook.content.inventory` returned sanitized Graph `190/2069032` before any Business,
  Coverage or Lark write, and the Worker was restored and verified all-false.
- The Meta runtime hotfix loads `META_FACEBOOK_PAGE_ACCESS_TOKEN` separately, uses it only for
  Facebook Page business reads, keeps discovery/Meta Ads on `META_ACCESS_TOKEN`, fails closed
  without the Page secret and makes Facebook D1/Lark preflight require that secret name.
- Focused Meta config/runtime/D1/Lark operator tests pass `38/38`; Remote Page-token activation
  and a fresh guarded Facebook D1/Lark operation remain separate authorized execution steps.
- The authorized Page-token activation later passed with code/settings/bindings/flags and Queue
  topology unchanged, then the fresh Facebook D1 operation proved a second Repository defect:
  `facebook.content.inventory` ignored the reviewed period and staged 2,501 historical rows across
  26 bounded units before `facebook.account.insights` failed with `META_CURSOR_MISSING`.
- GET-only memory probes confirmed the exact period contains only 25 Facebook posts on one page,
  while non-cursor account Insights returned an empty requested-period dataset with
  `paging.next/previous` time windows and no `after` cursor.
- The follow-up hotfix forwards the reviewed period to Facebook content inventory and treats
  metric datasets declared `paginated=false` as one requested-period response, preserving cursor
  enforcement for genuinely cursor-paginated datasets.
- Follow-up verification passed: focused Meta tests `120/120`, repository check, unit tests
  `1280/1280`, Workers-runtime tests `12/12`, report reliability `88/88`, dependency audit with
  zero vulnerabilities and Wrangler dry-run with no deployment.
- A second fresh operation then passed period scoping and account Insights but Graph v25 rejected
  `reactions_count`, `comments_count` and `shares_count` at the first content Insights request with
  code `100`; the combined `post_media_view,post_total_media_view_unique` request passed HTTP 200.
- The metric-capability hotfix removes only the three Live-rejected candidates. Their Canonical
  values remain `null` under the missing-metric contract rather than being fabricated as zero.
- Metric-capability verification passed: focused Meta tests `121/121`, repository check, unit
  tests `1281/1281`, Workers-runtime tests `12/12`, report reliability `88/88`, dependency audit
  with zero vulnerabilities and Wrangler dry-run with no deployment.
- Focused customer-profile, UAT operator/session, YouTube sync and storage tests pass `39/39`;
  full repository gates and CI are pending.
- The Worker is currently restored and verified all-false after the first customer-scoped run.
- Customer-scoped operation `youtube-lark-uat-20260728t080617338z-eb4dd5d5` completed successfully
  from merged `main@eb4dd5d581686b7d94f7be030f257b966c1b0a0f`: Provider requests `35`,
  D1 content state/observations/coverage entities `837/837/837`, account facts `1`,
  coverage runs `2`, cursor `1`, source record states `837`.
- Customer Lark counts are RAW channel/video `1/837`, MKT account/content/content-daily
  `1/837/837`; Owner Analytics remains intentionally `0`.
- The obsolete DEV Lark rows written by the earlier wrong-scope operation were deleted by exact
  record IDs after validating the prior baseline was zero and the scoped fingerprint matched;
  post-rollback DEV Lark counts are all zero and no schema mutation occurred.
- The shared D1 exact-row rollback was not performed because the remote deletion approval gate
  rejected it; the DEV audit and business history therefore remain available for forensic review.
- The first customer verifier exposed that live Wrangler D1 timestamps are numeric epoch values.
  The parser hotfix accepts numeric timestamps, and emergency restore now accepts the pinned v2
  customer session. The Worker was restored and verified all-false before this hotfix.
- The exact same operation payload was admitted a second time with the original job fingerprint.
  `main_queue_attempts` reached `2`, the rerun recorded Provider requests `0`, DLQ remained `0`,
  and no active lock remained.
- Idempotency verification preserved D1 counts at content state/observations/account facts/
  coverage runs/coverage entities/cursor/source states `837/837/1/2/837/1/837`, and preserved
  Lark counts at RAW channel/videos/Analytics, MKT account/content/content-daily
  `1/837/0/1/837/837`.
- The immutable reviewed all-false Worker version
  `a7b4bc48-4374-43de-b55c-c16dc7fe43c9` was restored at `100%` traffic after the rerun.
- Facebook operation `meta-facebook-d1-20260728t163156z` reached the accepted D1 boundary on
  merged `main@f748008707eda4eaf93eb47b266821613a03bd80`; Coverage was valid, the same-operation
  replay incremented `main_queue_attempts` from `28` to `29`, and the Worker was restored and
  verified all-false after the rerun verifier timed out.
- The timeout proved an operator contract defect: `queue_operation_attempts.operation_id` is the
  primary key, so the row count cannot increase for a same-operation replay. D1 and Lark rerun
  verification now use the durable `main_queue_attempts` counter and continue to require immutable
  Business, Coverage and Lark reconciliation facts.
- A guarded compatibility path permits only the remaining D1 evidence-closeout phases to run from
  the merged operator hotfix while retaining the original operation/evidence repository head. It
  requires exact old/new heads, ancestor lineage, a clean tree and an operator/test/docs-only diff.
- That compatibility closeout reuses the prior hash-valid restore only after a fresh remote
  all-false/version/topology verification and performs no additional Worker deployment.
- The first same-operation Facebook Lark continuation then failed closed before any Lark
  Business write because the Meta Canonical account row included `username` and other
  Provider-specific fields that are not present in the approved Live `MKT_Accounts` schema.
- The Canonical write-set now emits only the existing `MKT_Accounts` fields. Provider identity,
  profile and follower facts remain preserved in `RAW_Meta_Organic_Accounts` and D1 account-daily
  facts, so the correction removes no source data and performs no schema mutation.
- Verification passed: focused Meta `48/48`, full unit `1334/1334`, Workers runtime `14/14`,
  report reliability `100/100`, repository check, dependency audit with zero vulnerabilities and
  Wrangler dry-run with no deployment.

### Parallel stacked workstream — Lark Dashboard Shared Dimensions

- The separately authorized stacked workstream
  `codex/lark-dashboard-shared-dimensions-v1` starts from PR #236 head
  `52f3a516ade71c81f6d22a4ae4acad0da0a5d954`; it does not change the YouTube UAT objective or
  Business facts above.
- Repository implementation adds 18 additive Shared Report fields across Snapshot, Metric,
  Top Content and Top Ads and maps one validated materialization dimension set through the
  existing Lark `TableSyncEngine`.
- Stable keys, Daily/Weekly compatibility, `window_days=null`, Coverage null and observed zero
  semantics are preserved; historical rows are not backfilled.
- Focused Phase A tests pass `7/7`; expanded Report/Dashboard `34/34`, full Node `1406/1406`,
  Workers runtime `14/14`, Report reliability `100/100`, dependency audit and Wrangler dry-runs
  pass. Draft PR `#237` remains open and unmerged.
- Review correction preserves the legacy all-capability Snapshot write for
  `baseline_coverage_rate`, so a Paid Ads rerun cannot clear an existing value; the new
  `coverage_rate` field remains the Universal shared Coverage dimension.
- Remote actions are `0`: no Lark Apply/write, Remote D1, Worker, Queue/DLQ, Schedule, Secret,
  LIVE UAT or Production mutation.
- Detailed handoff: `docs/tasks/lark-dashboard-shared-dimensions-v1.md`.
