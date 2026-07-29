# Current Task — Lark Number Formatter Precision Canonicalization Hotfix

## Authoritative status

```text
TASK_STATUS                         = REPOSITORY_IMPLEMENTATION_VALIDATED
CURRENT_PROGRAM                     = LARK_NUMBER_FORMATTER_PRECISION_V1
INCIDENT_MAIN_SHA                   = 142d742fd27df9fdd1728a371836dd395dcc88ea
MERGED_SOURCE_FIX                   = PR #248 / 78aaf1416f5f7fc528c0c4bbfc2da409bb169a34
IMPLEMENTATION_BASE_MAIN_SHA        = 78aaf1416f5f7fc528c0c4bbfc2da409bb169a34
BRANCH                              = hotfix/lark-number-formatter-precision-v1-followup
OPERATOR                            = scripts/lark-dashboard-shared-dimensions-backfill.mjs
OPERATOR_VERSION                    = lark-dashboard-shared-dimensions-backfill-v1.3
IMPLEMENTATION_PR                   = #249 / DRAFT / DO_NOT_MERGE
IMPLEMENTATION_COMMIT               = 16bdf664d1b95d77a053e69324bca7d8fcdda1b5
BRANCH_VERIFICATION                 = #30480675876 / PASS
REMOTE_ACTION_DURING_IMPLEMENTATION = NONE
LARK_APPLY                          = NOT_RUN
D1_WRITE                            = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
PROVIDER_CALL                       = NONE
SCHEDULE_MUTATION                   = NONE
PRODUCTION_UAT                      = BLOCKED
```

ชื่อ branch เดิม `hotfix/lark-number-formatter-precision-v1` ถูกใช้และ Merge ผ่าน PR `#248`
ระหว่างเริ่มงานแล้ว จึงใช้ follow-up branch จาก Current Remote Main เพื่อไม่แก้ประวัติ branch
ที่ Merge ไปแล้ว. PR `#248` วาง serializer correction หลัก; workstream นี้ปิด requirements
ที่ยังขาด ได้แก่ official grouped formatter contract, operator v1.3 และ authoritative docs.

## Objective

หยุด false update ของ Lark Number fields เมื่อ Lark เก็บ/คืนค่าตาม precision ของ formatter
เช่น `coverage_rate` formatter `0.0000` แต่ D1 materialization เก็บ Business value แบบ
full precision. Canonicalization ต้องอยู่เฉพาะ Lark serializer/storage-comparison boundary
และห้ามเพิ่ม global epsilon/tolerance ใน `TableSyncEngine`.

## Confirmed root cause

Live read-only evidence:

```text
materializations                         2
matching Lark records                   32
coverage_rate present                   32/32
source nonzero                           2/2
Lark nonzero                            32/32
exact_equal                              0
equal_after_formatter_precision         32
0-1 vs 0-100 unit mismatch               0
formatter                           0.0000
Remote writes during diagnostics         0
```

`serializeNumber()` และ existing Number normalization เดิมคืน raw finite numbers ขณะที่
`TableSyncEngine` ใช้ exact `Object.is`/deep equality. ตัวอย่าง incoming
`0.833333333333` จึงต่างจาก Lark `0.8333` ทั้งที่เท่ากันตาม storage formatter.

Source fix ที่ Merge แล้วผ่าน PR `#248` ใช้
`canonicalizeNumberForLarkFormatter(value, field)` ทั้ง incoming serialization และ existing
normalization. Follow-up audit พบว่า helper เดิม recognize spreadsheet alias `#,##0.00`
แต่ไม่ recognize official formatter `1,000.00` ที่ Shared Field contract แปลง alias ไปใช้จริง.

## Canonicalization contract

```text
0             precision 0
0.0           precision 1
0.00          precision 2
0.000         precision 3
0.0000        precision 4
1,000         precision 0
1,000.00      precision 2
```

Spreadsheet aliases ที่ Shared Lark Field contract รู้จักถูก normalize ก่อนอ่าน precision.
Formatter อื่น เช่น percent/currency/custom หรือจำนวน decimal ที่ไม่ใช่ enum ที่อนุมัติ
คง exact behavior เดิมและไม่ถูกปัดโดยเดา.

Canonicalization ใช้เฉพาะ Lark payload/comparison:

- D1 materialization, payload และ checksum ไม่เปลี่ยน;
- Stable keys, Allowed fields และ Apply confirmation ไม่เปลี่ยน;
- null/missing ยังคงต่างจาก observed zero;
- NaN/Infinity fail closed;
- URL/Text/Select/Date behavior ไม่เปลี่ยน;
- persistent difference หลัง canonicalization ยังสร้าง Update plan.

## Recovery

หลัง Merge ให้รัน read-only Preview จาก clean Current `main`:

```bash
node scripts/lark-dashboard-shared-dimensions-backfill.mjs
```

Expected:

```text
ok               true
mode             preview
operatorVersion  lark-dashboard-shared-dimensions-backfill-v1.3
createRows       0
updateRows       0
recoveryDecision previous_apply_converged_no_apply_needed
```

หาก `updateRows=0` ห้ามเสนอหรือรัน Apply ซ้ำ.

## Required validation

```text
Focused Lark formatter / serializer / repository / sync / backfill tests
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
npx wrangler deploy --dry-run --config wrangler.sync.jsonc --env development
Branch Verification CI
```

## Safety boundary

ห้าม Backfill Apply, Remote Lark/D1 mutation, Worker deploy, Queue/DLQ send, Provider call,
Schedule/Secret change, Production/UAT หรือ PR merge. Remote action count ระหว่าง
Implementation ต้องเป็น `0`.

รายละเอียด:

```text
docs/tasks/lark-number-formatter-precision-v1.md
```

## Implementation result

- Source fix จาก PR `#248` ถูกตรวจบน Current Main และคงไว้โดยไม่สร้าง duplicate helper.
- Follow-up รองรับ official grouped formatters `1,000`/`1,000.00` ผ่าน Shared formatter
  normalizer เดิม และไม่ recognize unsupported `0.00000`/`1,000.000`.
- Backfill operator bump เป็น v1.3 โดยไม่เปลี่ยน confirmation หรือ Allowed fields.
- Focused formatter/serializer/repository/sync/backfill regressions ผ่าน `39/39`.
- `npm ci` ผ่าน (`80` packages).
- `npm run check` ผ่าน: Architecture audit `399` source files, `1027` local dependencies,
  `0` cycles และ Repository hygiene ผ่าน.
- `npm test` ผ่าน: Unit `1444/1444`, Workers runtime `15/15`.
- `npm run test:report-reliability` ผ่าน `100/100`.
- `npm audit` ผ่าน: `0 vulnerabilities`.
- `npm run deploy:dry-run` ผ่านทั้ง example Worker configs.
- `npx wrangler deploy --dry-run --config wrangler.sync.jsonc --env development` ผ่านและ
  จบด้วย `--dry-run: exiting now`; Wrangler แจ้ง warning เดิมว่า config ไม่มี
  `[env.development]` แต่ไม่เกิด deployment.
- Implementation Commit `16bdf664d1b95d77a053e69324bca7d8fcdda1b5` ถูก Push ไปที่
  Draft PR `#249`; Branch Verification run `30480675876` ผ่านทุกขั้น.
- Final-head CI หลัง documentation closeout ยัง pending.
- Remote action count = `0`.

---

# Previous Task Context — Lark Dashboard Shared Dimensions Backfill Post-Apply Verification Hotfix

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
