# Current Task — Meta Organic + Meta Ads Blueprint & DEV Access Preflight v0.12.0

## Task metadata

- **Status:** `approved_for_planning`
- **Source baseline:** commit `d7b28c99f3ee435f45cc2d637bbe8fddfaf1179d`
- **Working release:** `v0.12.0-meta-blueprint-access-preflight`
- **Environment:** developer-owned DEV profile `dev_ft_pumkin`
- **Production ownership:** customer-owned resources only
- **Implementation gate:** `blocked_until_blueprint_and_source_contract_approved`
- **Last updated:** `2026-07-20`
- **Owners:** ChatGPT Work (scope/data model/review) + Codex/developer (repository implementation after approval)

## Previous task closeout

- TikTok Organic large-account durable resume ผ่าน deterministic fixture, guarded DEV deployment, scheduled smoke, completion cleanup และ final D1 health แล้วบน commit `d7b28c9`.
- TikTok DEV health หลังปิด incident: active work/phase/unit/lock/open DLQ/open alert = `0/0/0/0/0/0`.
- YouTube Organic ยังคง `dev_ready`; Customer-owned 837-video Live UAT เป็น Production blocker.
- Production ของทุก Connector ยังคงปิด.
- เอกสารสถานะรุ่นก่อนหน้าใน README/PROJECT_BRAIN/CHANGELOG อาจยังอ้าง Worker หรือ candidate เก่า; ต้องปรับใน release-hygiene step ของรอบนี้จากหลักฐานที่ตรวจแล้วเท่านั้น.

## Security prerequisite

Credential ที่เคยปรากฏในภาพหน้าจอต้องถือว่าเปิดเผยและต้อง Rotate ก่อน External UAT/Deploy ครั้งถัดไป:

- YouTube API key
- OAuth client secret
- OAuth refresh token

หลัง Rotate ต้องอัปเดตเฉพาะ `.dev.vars` และ Cloudflare Secret store, ตรวจว่าไฟล์ยัง ignored/untracked และทำ YouTube read-only preflight/smoke หนึ่งรอบ. ห้ามบันทึกค่า Secret ลง Source, เอกสาร, Log หรือแชท.

งาน Data Model/Architecture แบบ Offline ดำเนินต่อได้ แต่ห้ามเรียก External API ด้วย Credential เก่าหรือ Deploy จน Security prerequisite ผ่าน.

## Objective

ออกแบบ Meta workstream ให้ Facebook Organic, Instagram Organic และ Meta Ads ใช้ Foundation/Customer onboarding ชุดเดียวกัน โดยเป้าหมายคือ:

1. ลูกค้าใหม่เปลี่ยนเฉพาะ Profile, non-secret IDs/mappings, Secrets, Lark table IDs, Permission และ Schedule โดยไม่แก้ Source codeเฉพาะราย.
2. DEV setup เลียนแบบ Production ownership/roles/OAuth/App Review path ให้มากที่สุด.
3. Data Model, Source Contract, Metric/null/timezone/currency/attribution semantics และ Lark schema ผ่านการอนุมัติก่อน Connector coding.
4. Initial backfill, incremental sync, periodic full reconciliation, durable resume, completeness accounting และ idempotency ถูกออกแบบสำหรับบัญชีขนาดจริงตั้งแต่ต้น.
5. Runtime เป็น read-only; ไม่มีการสร้าง/แก้ Campaign, Budget, Post หรือ Media ใน Scope นี้.

## In scope — planning and design

### 1. Full repository review ก่อน Implementation

ตรวจ Source/Tests/Docs ทั้ง Codebase โดยเน้น:

- Connector Catalog, Customer profiles, Queue job catalog และ runtime gates
- Shared `MetaGraphClient`
- Canonical Organic model และ TikTok/YouTube reuse contracts
- Canonical Ads model, stable keys, Ad/Creative separation และ integer money micros
- D1 resumable work/generation fence/checkpoint/reconciliation
- Lark schema installer/view/permission patterns
- Reliability runner, lock, retry, DLQ, Alert, warning outbox และ redaction
- Release examples, secret/hygiene gates และ production fail-closed behavior
- Duplicate logic, stale foundation code, unbounded memory/pagination และ hidden customer-specific assumptions

### 2. Official Meta source-contract research

ต้องตรวจจากเอกสารทางการและ Live App UI ก่อนล็อก Contract:

- Supported Graph/Marketing API version และ deprecation window
- Facebook Page account/posts/media/insights endpoints
- Instagram Professional account/media/media insights endpoints
- Meta Ad Account/Campaign/Ad Set/Ad/Creative/Insights endpoints
- Cursor pagination, field expansion, breakdowns และ async Insights requirements
- Token types, expiry/renewal, Page access, Business asset assignment และ System User applicability
- Permission/App Review/Advanced Access requirements
- Rate-limit headers/error codes/subcodes และ retry policy
- Metric availability/version differences, privacy/missing/deleted content semantics
- Ads timezone, currency, action/conversion attribution windows และ breakdown cardinality

Permission namesต่อไปนี้เป็นเพียง Candidate จนกว่าจะยืนยันจาก Official docs/Live preflight: `pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic`, `instagram_manage_insights`, `ads_read`, และ `business_management` เฉพาะเมื่อ Asset discovery ต้องใช้จริง. ห้ามขอ write permission โดยไม่จำเป็น.

### 3. Meta Organic + Ads Excel/Lark Blueprint

สร้าง canonical artifact:

`docs/Social_MKT_Data_Hub_Meta_Blueprint_v0.12.0.xlsx`

Workbook ต้องมีอย่างน้อย:

- Table inventory/status
- Facebook RAW fields
- Instagram RAW fields
- Meta Ads RAW fields
- Canonical destination mapping
- Select options
- Stable-key/idempotency contracts
- Metric definitions/null semantics
- Money/currency/timezone/attribution contracts
- Relation/lookup/formula/view/permission requirements
- Source/API traceability
- DEV access and blocking UAT checklist
- Customer onboarding/profile mapping
- Large-account fixture and completeness gates

### 4. DEV Access Preflight runbook

ออกแบบ Production-like DEV ownership:

- Developer-owned Meta Developer App
- Developer-owned Business Portfolio เมื่อ Platform flow ต้องใช้
- Developer-owned Facebook Page สำหรับทดสอบ
- Instagram Professional account ที่เชื่อมกับ Page ถูกต้อง
- DEV Ad account ที่มีสิทธิ์อ่าน ถ้ามีข้อมูลจริงสำหรับ UAT
- App roles/asset assignments/token generation ตามเส้นทางเดียวกับลูกค้า
- Secret handling, token debug, identity allowlist และ fail-closed preflight

Production ภายหลังต้องใช้ App, Business, Page, Instagram account, Ad account, Cloudflare, Lark และ Credentials ที่ลูกค้าเป็นเจ้าของ แล้วเชิญผู้พัฒนาเป็น role ที่จำเป็นเท่านั้น.

### 5. Customer onboarding/config-only contract

กำหนด Profile กลางโดยแยก:

**Source-controlled non-secret configuration**

- customer/profile key
- stable account keys
- Meta Page ID
- Instagram account ID
- Meta Ad account ID
- Lark table mappings
- timezone/currency
- attribution/report settings
- feature flags/schedules

**Secret store only**

- Meta app secret
- user/system-user/Page access token
- token exchange/renewal credential
- Lark app secret
- Cloudflare deployment credentials

ห้ามใช้ `if customer === ...` หรือ hardcode DEV/Production identity ใน Business logic.

## Proposed table inventory — pending blueprint review

### Facebook Organic RAW

- `RAW_Meta_Pages`
- `RAW_Facebook_Posts`
- `RAW_Facebook_Post_Insights_Daily`

Canonical destinations:

- `MKT_Accounts`
- `MKT_Content`
- `MKT_Content_Daily`

### Instagram Organic RAW

- `RAW_Instagram_Accounts`
- `RAW_Instagram_Media`
- `RAW_Instagram_Media_Insights_Daily`

Canonical destinations:

- `MKT_Accounts`
- `MKT_Content`
- `MKT_Content_Daily`

### Meta Ads RAW

- `RAW_Meta_Ad_Accounts`
- `RAW_Meta_Campaigns`
- `RAW_Meta_Ad_Sets`
- `RAW_Meta_Ads`
- `RAW_Meta_Ad_Creatives`
- `RAW_Meta_Ads_Insights_Daily`

Canonical destinations:

- `MKT_Ads_Accounts`
- `MKT_Ads_Campaigns`
- `MKT_Ads_AdGroups`
- `MKT_Ads_Ads`
- `MKT_Ads_Creatives`
- `MKT_Ads_Daily`

Table names/field sets are proposals until Workbook visual/contract review passes. No Lark mutation is authorized in this task stage.

## Existing foundation findings to preserve

1. Facebook/Instagram connectors remain `planned` and must fail closed if enabled before implementation.
2. Current shared `MetaGraphClient` handles GET/Auth/basic error classification/cursor pagination, but `listEdge()` aggregates every page in memory. Large-account implementation must add single-page/bounded streaming or durable staging rather than reuse this unbounded accumulator for full backfill.
3. Facebook and Instagram Business mapping must remain separate adapters even when sharing Meta transport/Auth.
4. Canonical Ads hierarchy is `Account → Campaign → Ad group/Ad set → Ad`, with Creative as a separate reusable asset.
5. Ad and Creative IDs/stable keys must never be interchanged.
6. Ads money source of truth uses non-negative integer micros; decimal Source values must not pass through JavaScript floating-point conversion.
7. Missing metrics are `null`/N/A unless the Source contract proves zero is a real observed value.
8. Existing D1 `sync_work_*`, generation fence, checkpoint, lock, retry, DLQ, Alert and warning-outbox contracts must be reused; no Connector-specific retry/pagination state machine duplication.
9. Production remains blocked until large-account technical gates, fixture and customer-owned Live UAT all pass.

## Large-account targets

- Facebook Organic: minimum fixture `5,000` posts
- Instagram Organic: minimum fixture `2,000` media/posts; customer inventory reference is approximately `1,941`
- Meta Ads: fixture targets must be approved from real account inventory and expected daily fact cardinality before Implementation; no arbitrary silent row cap

Every Source flow must support:

- initial full backfill
- incremental sync
- periodic full reconciliation
- bounded cursor pagination
- durable resume after Queue/API failure
- bounded chunks/memory
- stable-key idempotency
- expected/fetched/processed/written/failed completeness accounting
- typed rate-limit retry/backoff
- fail-closed max-page/max-row guards
- live account UAT

## Out of scope until Blueprint approval

- Facebook/Instagram/Ads Connector implementation
- New Worker routes or Queue producers
- Lark schema Apply or record writes
- Meta OAuth/token mutation
- Meta App Review submission
- Cloudflare deploy/schedule enablement
- Production resource mutation
- Ads campaign/budget/content write operations
- Customer-specific code branches

## Deliverables

1. Updated `docs/current-task.md` with approved planning scope — completed.
2. Full-codebase review findings relevant to Meta/Ads.
3. Official-source Meta access/endpoint/permission matrix.
4. `docs/Social_MKT_Data_Hub_Meta_Blueprint_v0.12.0.xlsx`.
5. Meta source-contract/design document.
6. Production-like DEV access preflight runbook.
7. Customer onboarding/config-only profile contract.
8. Implementation release split and acceptance tests for:
   - Meta shared client + preflight
   - Facebook/Instagram Organic
   - Meta Ads
9. Review package with visual Workbook QA and no Secret/live customer identity.

## Acceptance criteria for planning approval

- Every proposed table/field has type, required flag, stable key, metric definition, null semantics, source path, example, import note and canonical mapping.
- RAW/Master/Daily/Sync/Alert boundaries are explicit.
- Organic and Ads timezone/date semantics are explicit.
- Ads money/currency/attribution/action metrics cannot be confused or silently fabricated.
- Deleted/private/archived/missing data semantics are non-destructive and testable.
- Pagination/checkpoint/reconciliation/durable-resume contracts handle target inventory without unbounded memory.
- DEV and Production ownership/IAM/OAuth/App status paths are documented separately but structurally equivalent.
- Required permissions are least-privilege and verified against current Official docs/Live preflight.
- Customer onboarding requires configuration and secrets only, not Source edits.
- All Connector and Schedule flags remain false until Manual DEV UAT passes.
- User reviews and explicitly approves Blueprint/Source Contract before status changes to `approved_for_implementation`.

## Planned implementation releases after approval

- `v0.12.1` — Meta shared transport hardening, single-page pagination, identity/access preflight and config contract
- `v0.12.2` — Facebook + Instagram Organic schema/runtime/reconciliation/large-account DEV UAT
- `v0.12.3` — Meta Ads schema/runtime/attribution/reconciliation/large-account DEV UAT

Release boundaries may change after Blueprint review, but no single release may combine unreviewed schema, OAuth, connector runtime and schedule activation into one uncontrolled rollout.

## Implementation result

`not_started — planning/data-model stage only`

No Source implementation, Lark mutation, External Meta API call, Queue enqueue, D1 migration, Cloudflare deploy, schedule change, Secret mutation or Production mutation has been performed by this task update.
