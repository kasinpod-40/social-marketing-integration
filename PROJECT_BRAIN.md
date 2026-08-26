# Project Brain — Social Marketing Data Integration

## Customer Workers Free bounded post-source continuation — 2026-08-26

Source completion and destination completion are separate durable boundaries. A large YouTube or Meta snapshot
must never rebuild and write every Lark row in one Workers Free delivery. YouTube therefore records D1 storage
once, then checkpoints Content, Daily and Account destination row offsets; Account remains last so freshness is
published only after dependent rows finish. Meta preflight and Lark delivery checkpoint both table and row offsets,
while stable-key duplicate validation remains full-scope. Existing complete Meta preflight state stays compatible.

These row budgets are execution controls, not operation-fingerprint inputs. Customer may safely tune the bounded
delivery envelope without replacing a retained generation, while work key, generation, source snapshot and stable
keys remain unchanged. The Customer recovery vector is 100 rows per YouTube destination and 100 rows per Meta
preflight/D1/Lark delivery; Queue batch/concurrency stays one and generic redrive stays disabled.

Live recovery proved that the preceding YouTube D1 storage write was itself an uncheckpointed 838-row sequential
unit and could exceed Free CPU before destination batching began. D1 organic content now advances by the same
100-row durable phase budget. Coverage remains partial until all content batches, availability, Analytics and
Account storage complete; then the compact storage result is retained and Lark delivery begins.

## Chatwoot deploy-only execution caps — 2026-08-26

Customer Workers Free may need a smaller per-delivery Chatwoot unit than the reviewed durable
operation fingerprint. Execution caps are therefore applied only after `beginWork`: they may shrink
conversation rows/reporting pages but never expand the reviewed limits. Changing the fingerprint
configuration for an active same-generation Work remains a permanent fail-closed mismatch.

## Customer Meta daily Select projection repair — 2026-08-26

The first post-quota-reset Customer Meta K2 schedule proved one permanent destination contract issue rather than
a credential or provider failure. Complete-payload preflight checked six Lark tables, 19,222 rows and 116,090
fields and found nine `MKT_Ads_Daily.ad_channel` rows whose auxiliary Meta publisher-placement values are not
configured Customer Base Select options. No Lark write occurred for that failed generation.

Detailed placement identity remains stored in D1 for reporting and forensic use. The canonical Customer Lark
projection admits only `facebook_ads` and `instagram_ads`; auxiliary placement values are omitted from the Lark
cell rather than remapped or invented. The scheduled builder, exact K2 snapshot importer and provider-direct
materializer now share one projection contract. Stable keys, source rows and D1 facts are unchanged.

The 2026-08-26 reset also proved current-day Customer D1 success for Facebook, Instagram, Google Ads,
WooCommerce and TikTok. Meta K2/K3 and YouTube continue from durable checkpoints. Chatwoot retains one exact
retry-exhausted Work for bounded recovery. These are runtime continuation states, not missing credentials.

The next K2 generation reached Creative source page 188/500 and then returned HTTP 400 / Graph code `80004` /
subcode `2446079`. This exact pair is an Ads Business Use Case rate limit and is already treated as resumable by
the reviewed local checkpoint recovery, but the shared Production Graph client previously relied only on HTTP
429/5xx or `is_transient=true`. The client must classify only this exact pair as transient so Queue retries resume
the persisted cursor; all neighboring codes and permanent permission/identity failures remain fail-closed.

## Customer Production bounded Queue auto-recovery — 2026-08-25

Customer Workers Free can legitimately exhaust one Queue delivery while a durably checkpointed connector still
has recoverable work. Future self-healing is therefore implemented as an exact same-generation continuation, not
as generic DLQ redrive: an eligible retry-exhausted DLQ atomically claims its existing Work in D1, reactivates only
that Work, and sends the unchanged stable payload after a bounded lock-aware cooldown. The per-Work budget is five
recovery incidents and the admitted set is limited to the eight active Customer connectors.

The controller is disabled by default and requires the exact `production/chemistry_k/customer/chemistry_k`
runtime. Permanent/completed/superseded Work, unstable identities, unsupported jobs and the retained TikTok
forensic terminal `terminal:eafd8e43f1ae5113d12905301496fd4e` are non-recoverable. Generic
`MKT_DLQ_REDRIVE_ENABLED` remains false. A recovered DLQ and its paired Alert remain open evidence until the exact
Work completes; only then may the controller mark that incident redriven/resolved. A crash after Queue send but
before its durable marker may resend the same stable payload, whose existing idempotency contract prevents a new
Work identity or duplicate business rows.

PR #745 merged as `main@ae37b064` and was deployed at 100% Customer traffic. The first non-synthetic exhaustion
proved exact automatic claims for Chatwoot, Meta K2, Meta K3 and TikTok; Meta K3, TikTok and YouTube subsequently
advanced their original checkpoints. Customer Meta D1 batching was reduced from 10 to 5 after Free-CPU evidence,
and version `56b969fa-3860-4aaa-8a00-ec9899a7a815` is the current active deployment. This proves bounded self-heal,
not final source parity: the long-running Works must still complete before TikTok incremental is restored and
final Report/Lark reconciliation is declared complete.

The extended soak stopped on the Customer Workers Free external daily Queue-write ceiling after operation 10,253,
not on lost checkpoints. Retained progress is Chatwoot 4/5, Meta K3 2,425/3,874, TikTok 390/2,048 and YouTube
Owner Analytics 837/837. Meta K2 is a separate permanent Lark preflight failure and must not be auto-retried.
Do not burn further Queue writes before the provider reset; afterward resume only these exact Works and preserve
the same operation/generation. No credential or customer login is missing.

## Customer Organic Dashboard copied-Base compatibility — 2026-08-24

Exact Dev/Customer Base export comparison proved Customer already held all 272 canonical Organic Dashboard rows
(four platforms x 17 metrics x four windows), while the copied Dashboard blocks still depended on two preserved
compatibility fields that were blank on those canonical Customer rows: Display V2 and the legacy Period selector.
Customer D1 materializations and business values were correct; this was a Lark projection compatibility gap, not
a source-data or aggregation defect.

The shared materialization writer now projects both compatibility fields for the reviewed `chemistry_k` Customer
profile while retaining canonical `window_days`, stable `lark_slot_key` identities and the existing Integration
behavior. PRs #738 and #739 deployed Worker version `46acfee0-49f2-4169-9dad-837f4798df08` at 100% traffic. A
controlled D1-backed replay completed all 16 Facebook/Instagram/TikTok/YouTube x 1D/3D/7D/30D operations. Fifteen
completed on the first Queue attempt and one completed on retry; the post-run baseline remained open DLQ 137,
open Alerts 146 and locks 2, with zero newly created DLQ or Alerts. The user visually confirmed Facebook values;
TikTok then completed its remaining Period operations without any manual Dashboard mutation.

Post-replay Dev/Customer D1 comparison also explains why some Customer values are higher: Customer Facebook uses
source watermark `2026-08-23T12:16:25+0000`, while Dev remains at `2026-08-22T12:20:57+0000`; Customer YouTube
also uses a newer source snapshot. TikTok shares the exact source watermark and metric values across both runtimes,
and Instagram values match across all four windows. Customer values must therefore not be overwritten from the
older Dev materializations.

The fresh post-replay Customer export exposed a separate presentation collision: the Report Metric table retains
336 Integration Organic rows at the older period end and 336 Customer Organic rows at the current period end;
272 rows in each profile satisfy the copied Dashboard's legacy Display/Period selectors. Stable keys remain unique,
so this is not storage duplication, but the Dashboard can aggregate both profiles until it is isolated with exact
`customer_profile=chemistry_k`. Do not replay or delete source/report rows to address this UI filter defect.

After profile isolation exposed blank Instagram cards, D1 proved the Customer source was present: 50 content
states/observations through 2026-08-22 and account daily facts through 2026-08-23. The latest bounded daily source
run had zero new content but was incorrectly labelled `full_inventory`; the generic reader therefore treated the
empty coverage entity set as the complete account inventory and excluded all prior observations. Bounded Meta
Organic writes now persist `report_range`, while unbounded snapshots retain `full_inventory`. Existing affected
coverage requires exact correction and 1D/3D/7D/30D rematerialization before Instagram visual closeout.

PR #740 merged as `main@cda7f09f` and Customer Worker version
`cf59d7bf-260a-4527-9c15-7244808a8f48` serves the existing schedules/Queue configuration. The exact affected
`instagram-scheduled-20260823:instagram:content` row was corrected only when its reviewed 0/0 complete invariant
matched, then four fresh Report operations completed on their first attempts. Readback is 1D complete with zero
daily gain and Total Views 4,059,734; 3D complete with Views 263,287 / Likes 5,023; 7D complete with Views 527,576
/ Likes 8,285; and 30D partial at 56% coverage. Open DLQ/Alerts remained 137/146 and locks returned to baseline 2.

The fresh Customer Base export audit covered all 33 in-scope Data Hub tables and excluded the three
customer-created Content Creator/Sale-Support tables. All 33 schemas match Dev, no primary-key duplicates exist,
and Customer holds 55,926 rows versus Dev 43,060 due to additional Customer history. One completely blank record
remains in `MKT_Sync_Log` (`recvt6mZnhkueH`); it is recorded for separate hygiene review and was not deleted.

## Customer Chatwoot/WooCommerce exact D1-to-Lark closeout — 2026-08-24

Customer Chatwoot business state is already complete in Customer D1 at 3,707 canonical Lark-bound rows. Dev and
Customer WooCommerce comparison proved Dev was newer only for the latest completed day, while Customer retained
more historical rows. The safe merge therefore added/replaced only 37 exact stable-key rows and preserved all
Customer-only history; Customer Commerce Daily and Product Daily now reach 2026-08-23.

A disabled-by-default Customer-Production-only Queue path reads the ten reviewed D1 tables in 50-row batches and
writes only their existing Customer Lark mappings. Jobs carry no Business rows, accept only the fixed snapshot
manifest/table/batch identity, and fail closed on manifest drift, duplicate input or incomplete reconciliation.
The active Customer schedules and Workers Free queue topology are unchanged until reviewed merge/deploy. Full
Lark execution, idempotent replay and Report/AI/Notification activation remain live gates.

## Customer Workers Free runtime restoration — 2026-08-24

The user canceled the adjacent visible-field ordering work and prioritized Production source/report completion.
Queue tails on its release showed unrelated batch-size-one source continuations ending at the Workers Free CPU
ceiling. Exact reviewed pre-field-order source `e0430022` was redeployed with all current Customer bindings,
schedules and flags preserved as Worker version `30223f20-a91d-42b4-8d49-65c6cc95c80f`; the next error-only tail
showed no new `exceededCpu`. The canceled field-order runtime is removed from the next `main` release. Completed
empty-field hygiene remains intact, and no Base area outside `Setup Phase | Social MKT Data Hub` was touched.

K3 Meta source staging is already complete 20/20. Its sole Lark blocker is a canonical Select mismatch: Customer
`creative_type` accepts `image`, `video`, `carousel`, `other`, while the provider emits uppercase object types.
The permanent adapter maps video/image/photo/carousel variants to those exact values and all other/missing types
to `other`, allowing exact same-generation recovery without rereading provider inventory.

TikTok scheduled admission must not run on every five-minute primary Cron tick. The watermark probe reads the
protected RAW source twice to establish a stable snapshot and is therefore due only once daily at 06:55
`Asia/Bangkok`. The normal source sync remains durable/idempotent; the retained UAT forensic DLQ is never redriven.

## Customer Lark Base empty-field View hygiene — 2026-08-24

The customer authorized a one-time cleanup of empty columns in Views, limited to `Setup Phase | Social MKT Data
Hub`. The supplied Base export proves 33 in-scope `MKT_*`/`RAW_TikTok_*` tables and explicitly excludes three
customer-created Content Creator/Sale-Support tables. A disabled-by-default manual Queue path now binds every
table operation to a reviewed SHA-256 scope, validates exact Customer Production ownership, re-proves each
candidate field is still empty against Live Lark, preserves current hidden fields and the primary field, PATCHes
only `hidden_fields`, and reads back the result. It cannot write records/schema/filters/names. Snapshot candidates
are 100 empty fields across 81 Grid views. The first reviewed run failed closed during read-before-write and proved
that Record Search `isNotEmpty` requires `value: []`; no Base mutation occurred in that run. PR #721 added the exact
serializer contract and passed both CI gates. The corrected Customer run accepted all 19 table jobs, retained exact
post-PATCH readback, and created zero new hygiene DLQ/alerts. The 19 pre-hotfix DLQs and their paired alerts are now
resolved, open hygiene DLQ is zero, and the one-time flag is false in final Customer Worker version
`b19c5a97-b7a5-4965-9d17-85ace9219654` at 100% traffic. The unrelated TikTok forensic DLQ was not redriven or
changed.

## Customer Weekly Notification Settings controlled activation — 2026-08-24

Customer Production has 74 canonical `chemistry_k` Report Settings, but the eight active-channel 7D Settings
remain AI/Notification-disabled while source closeout is in progress. A reviewed Queue activation mode now updates
only those eight stable keys after the exact customer Production runtime, Weekly Report gates, Notification
runtime/send/mirror gates and destination name/SHA-256 authority all pass. It carries no raw group ID and leaves
all non-7D, TikTok Ads, Integration Workspace and customer-created Base areas untouched. The exact Customer
`MKT_Notification_Log` table is present inside `Setup Phase | Social MKT Data Hub`; its mapping remains local and
uncommitted. Live activation still waits for WooCommerce and Chatwoot completion plus reviewed merge/deploy.

## Customer Production Free-plan continuation cutover — 2026-08-23

Reviewed main `400a17795f3a2fee0175504c20f3758f377675f8` is deployed in the exact customer account as Worker
version `d93072cb-a179-4158-944c-0eb08cf0e759`, authored by `dev.datahub.2026@gmail.com` and receiving
100% traffic. The shared primary Cron is active at `*/5 * * * *`; Workers.dev remains disabled and the main
Queue remains Free-plan safe at batch size/timeout/concurrency `1/1/1`.

The first normal Production activation enables only Instagram, Meta Ads and Chatwoot sources, D1/Lark writes
and their schedules. Their Monday times are 07:35, 07:40 and 07:45 `Asia/Bangkok`. TikTok remains disabled
until 06:55 Monday avoids a previous-day cursor rollback; Facebook, Google Ads, YouTube and WooCommerce remain
disabled behind exact missing-secret gates. Reports, AI, notifications, retention, webhook and DLQ redrive
also remain disabled. Pre-run D1 baseline is retained for first-run reconciliation and the existing TikTok
forensic alerts/DLQ were not changed. Heartbeat `customer-production-cutover-monitor` continues the reviewed
Monday enable/observe sequence from 06:50; no first-schedule or AI exactly-once success is claimed yet.

คำสั่งผู้ใช้ยืนยันว่า Source accounts, data และ connector credentials/state ใน Integration Workspace
เป็นทรัพย์สินลูกค้าอยู่แล้ว. Customer Production จึงเป็นการย้าย runtime ไป Customer Cloudflare/D1,
เปลี่ยน mapping เป็น Customer Lark Base แล้วเปิด schedule แบบควบคุม ไม่ใช่ onboarding เจ้าของบัญชีใหม่.
ภาพหลักฐานยืนยันว่า `dev.datahub.2026@gmail.com` เปิด Customer Base ได้แล้ว; Live preflight ที่เหลือเป็น
Worker App/OAuth API binding กับ exact Table IDs เท่านั้น.

Customer Workers ยังเป็น Free และอัปเกรดไม่ได้ในขณะนี้. TikTok จึงถูก refactor ให้ Source staging,
Business plan scan/finalization, preflight, write และ completion ทำงานเป็น durable Queue continuations
แบบ bounded. ทุก continuation รักษา stable operation/work/generation, checkpoint ก่อน Queue send,
รองรับ ambiguous duplicate แบบ idempotent และ fail closed เมื่อ sequence นำ durable state.
Fresh stable TikTok Production UAT `tiktok-prod-cutover-20260823-r1` ผ่านแล้วด้วย 2,046 records และ
82 bounded units: Lark Content 5 create/2,041 update, Daily 2,046 create, Account 1 update, checkpoint
เลื่อนถึง `2026-08-23`, exact alert/DLQ/lock เป็นศูนย์ และ same-identity replay ไม่เปลี่ยน completion,
cursor, checkpoint count หรือ Lark totals. Main Queue ใช้ `max_batch_size=1` ตาม live Free-plan CPU
evidence. Retained TikTok DLQ เดิมยังเป็น forensic evidenceและไม่ถูก redrive. UAT flags/schedules/
reports/AI/notifications กลับสู่ dark ที่ Worker version `1dc1ae9c-7c98-4e23-974b-3e43050c9aa1`.
TikTok จึงมีหลักฐานครบสำหรับ reviewed `verified` promotion. คำสั่งต่อมาของผู้ใช้ขยาย Cutover ให้ครบ
ทุกช่องทางและยืนยันว่า Integration source/runtime เดิมใช้ทรัพย์สินลูกค้าอยู่แล้ว. Retained customer-source
Live UAT จึงรองรับ `verified` สำหรับ Facebook, Instagram, Meta Ads, Google Ads และ Chatwoot พร้อม exact
Production ownership tuple; YouTube/WooCommerce ยังคง `dev_ready` จนตั้ง Secret ที่อ่านคืนไม่ได้และผ่าน
Customer Production UAT.
ก่อนเปิด Cron ตรวจพบ post-Lark router ยังล็อกเฉพาะ Integration Workspace; reviewed follow-up จึงต้อง
allow exact customer Production tuple (`production` / `chemistry_k` / customer-owned) และปฏิเสธ target
อื่นทั้งหมด. Shared reviewed ownership predicate ใช้กับ Meta, Google Ads, WooCommerce, Chatwoot และ TikTok
โดยทุก router ยังผ่าน Central Connector readiness; ไม่มี generic Production bypass. ห้ามเปิด schedule ใด
ก่อน follow-up นี้ merge/deploy แบบมืดและ exact connector preflight ผ่าน.

หลัง controlled connector proofs ต้องเปิด schedule ทีละ connector และพิสูจน์ continuation จาก migrated
checkpoint, expected time coverage, zero duplicate/zero gap และ D1/Lark parity. วันจันทร์ 2026-08-24
ต้องตรวจ Automatic AI/Notification ว่าส่ง exact customer profile/period ไป exact Lark group เพียงครั้งเดียว
พร้อม AI run, delivery claim, Notification Log/message hash และ zero exact-scope alert/DLQ/lock.

## Automatic Weekly negative-channel repair — 2026-08-17

รอบ Scheduled จริงช่วง `2026-08-10..2026-08-16` fail closed ก่อนส่งด้วย
`weaknesses_missing_negative_channel`: Native AI generated ครบ แต่ per-row compact Weaknesses contract
ไม่บังคับชื่อช่องทางให้ตรงกับ Quality Gate. ไม่มี D1 delivery row และไม่มี Lark message ถูกส่ง.

Permanent contract ต้องระบุ exact negative channel + metric จาก `ch/m`; missing data ไม่ใช่ Weakness และ
เมื่อไม่มี negative comparison ต้องใช้ fallback เดิม. Fresh Decision identity bump จาก v4 เป็น v5;
identity ที่ fail เดิมเป็น immutable forensic evidence ห้าม reset/replay/redrive. GET-only preflight ยืนยัน
ช่วงข้อมูลถูกต้อง 8 Report channels, input 2,212/593 chars อยู่ใน budget และ v5 identity ยังไม่มี Live row.

หลัง reviewed v5 deploy, controlled recovery ใหม่ (ไม่ใช่ replay) ทำให้ Weaknesses ผ่าน แต่ fail closed ที่
`insight_missing_business_metric_value`; compact `m` มี Business values แต่ Overview contract ไม่สั่งให้ยก
exact channel + metric + value. ไม่มี Notification delivery. v5 terminal/Alert/DLQ ต้องคงเป็น forensic
evidence. Permanent follow-up เพิ่ม Overview rule ภายในงบเดิมและ bump immutable identity เป็น v6.

v6 ปิด Business recovery แล้ว: PR #656 merge ที่ `d0615193`, Worker `da0777dc-447b-452b-b86c-3e96637375c8`
รับ traffic 100%. Exact new operation `weekly-executive-recovery-20260816-v6` completed; AI/Admission อย่างละ
หนึ่งแถว, Quality Gate ผ่าน, D1 delivery `sent/mirrored` claim 1 และ Lark Notification Log `sent` หนึ่งแถว.
ไม่มี exact alert/DLQ/active lock ใหม่. Controlled recovery ไม่ใช่ scheduled evidence; retained scheduled/v5
failures ห้าม replay/redrive และ scheduled exactly-once proof ต้องมาจากรอบอัตโนมัติถัดไปเท่านั้น.

## TikTok MKT_Accounts master completion — 2026-08-16

Root cause ของ TikTok ที่หายจาก `MKT_Accounts` คือ Native sync contract ไม่เคยส่ง mapping หรือเขียน
Account master แม้ Content และ Daily ทำงานแล้ว. Live exact backfill เพิ่ม `tiktok:chemistry_k` หนึ่งแถว
ทำให้ master ครบ YouTube/Facebook/Instagram/TikTok 4 ช่องทาง โดย 3 identities เดิมไม่เปลี่ยนและมี
private backup/checksum ก่อน mutation.

Repository implementation เพิ่ม Account plan ใน validation, legacy, staged/D1-first และ history paths;
ใช้ stable key `tiktok:${accountId}`, source-handle guard, deterministic `last_sync_at` และเขียนหลัง
Content/Daily สำเร็จเท่านั้น. Focused 25/25, D1-first ordering 2/2, full unit 3048/3048, Workers runtime
18/18, report reliability 105/105, architecture/hygiene, audit 0 vulnerabilities และ deploy dry-run ผ่าน.
PR #653 merge หลัง PR #652 ที่แก้ Facebook omitted Shares; exact main `dff7c1e6` deploy เป็น Worker
`377bb562-46f0-44af-8aea-13b3e928bcaf` ที่ traffic 100%. Post-deploy alert/DLQ/lock ใหม่เป็นศูนย์และ
GET-only Account master readback ผ่าน 4/4. Scheduled evidence รอบถัดไปยังต้องเป็น automatic เท่านั้น.
รายละเอียดอยู่ที่
`docs/project-brain/tiktok-mkt-accounts-master-2026-08-16.md`.

## Non-TikTok Lark RAW live retirement closeout — 2026-08-16

Fresh scheduled Connector gates หลัง reviewed Worker `808fe569-8319-469b-b069-2b586642e630` ผ่านครบ.
Facebook scheduled operation จบ complete/full-inventory 89/89, failed 0 และ D1↔Lark current MKT parity
89/89. `MKT_Content_Daily` อยู่ที่ 9,139/10,000 rows, unmanaged 0 และไม่มี delete candidate.
Backup/checksum 27 tables, D1 backup, YouTube 2,532/2,532 stable-key parity, zero consumer reference,
zero active lock และ zero current alert/DLQ ถูก revalidate ก่อน mutation.

Exact operator ลบ non-TikTok Lark RAW 27 tables ทีละ exact Table ID สำเร็จเมื่อ 2026-08-16;
หลังทุก delete target หายเพียงรายการเดียว, non-target identities ไม่เปลี่ยน และ protected
`RAW_TikTok_Creator_Videos` ยังอยู่. ไม่มี bulk/prefix delete, replay, redrive, manual Queue run หรือ
Worker deploy. Remaining time-based Integration gate เหลือ Automatic Weekly วันจันทร์ 2026-08-17
08:30 Asia/Bangkok; Production provisioning/UAT เป็นงาน customer-owned แยกต่างหาก.

## Integration non-wait closeout — 2026-08-15

ปิดงานที่ไม่ต้องรอใน worktree แยกจาก Facebook: exact TikTok `SYNC_PARTIAL_WRITE` alerts สองรายการ
ถูกจัดเป็น `resolved_by_new_generation` หลัง run/work เดิมและอย่างน้อยสอง generation ใหม่สำเร็จ โดยไม่มี
replay/redrive/Queue/Business mutation. Alert/DLQ เก่าอื่นคง forensic evidence; recent open alert/DLQ
ตั้งแต่ 2026-08-15 เป็นศูนย์ และ active lock เป็นศูนย์. Meta Ads A22 active Work เป็น exact retained
forensic identity ที่ Current Task ห้าม terminalize/cleanup จึงไม่ถือเป็น current-actionable incident.

D1 capacity audit พบ 151.74 MiB, 70 tables, 175,855 rows และ 104 reviewed indexes. Linear projection
จาก 14-day creation rate อยู่ประมาณ 609.35 MiB ที่ 1 ปีและ 1.49 GiB ที่ 3 ปี. Local Storage Foundation
load test ผ่าน 10x/100x พร้อม indexed query plans และ integrity check. Private pre-0020 D1 backup checksum
และ 27-table Lark backup revalidate ผ่าน; local restore 70 tables และ re-apply Migration 0020 ผ่าน.

`MKT_Content_Daily` capacity incident ปิดโดย defer Facebook แบบ exact: backup/checksum 19,940 rows,
ลบเฉพาะ TikTok/YouTube 10,649 rows และ readback เหลือ 9,291. Facebook 425/425, Instagram 37/37 และ
protected TikTok Native RAW คงเดิม. PR #647 เพิ่ม permanent daily retention 08:05 ซึ่ง fail closed เมื่อมี
active sync lock และตรวจ exact retained identity หลังลบ; Worker version
`3d9c363d-d1fc-4cfe-b275-9fa75b0a6ca1` รับ traffic 100% ในระยะปิด incident capacity. Downstream
Facebook parity ผ่านแล้วและ Worker `808fe569-8319-469b-b069-2b586642e630` เปิด Facebook
source/schedule พร้อมนำ Facebook ออกจาก retention defer; หลักฐาน scheduled 07:30/08:05 ยังต้องรอ
วันที่ 2026-08-16. Customer-owned Production runbook พร้อมแล้ว แต่การ provision ยังรอ asset ของลูกค้า.
รายละเอียดอยู่ที่ `docs/project-brain/mkt-content-daily-retention-live-closeout-2026-08-15.md`.

## Chatwoot Daily updated-within incremental — 2026-08-15

Daily ไม่ใช้ full-account stable-ID two-pass discovery อีกต่อไป. Fresh Daily state เรียก Chatwoot
`updated_within` ครั้งเดียวด้วย immutable rolling 3-day window + 5-minute clock-skew overlap, deduplicate
stable IDs และอ่าน exact detail เฉพาะ Conversation ที่เปลี่ยน. Initial/Reconciliation และ legacy state ที่
เริ่ม scan ไปแล้วคง two-pass path เดิม. Daily operation เดิมจบ completed โดย failed/alert/DLQ/lock เป็น
ศูนย์ และ GET-only tenant preflight ผ่าน 51/51 unique rows ใน one unpaginated request. PR #643 merge
เข้า `main` ที่ `77f9c92efe36a6b36d6eed66bffc04e90326fe10`; Integration Worker version
`9d768d22-4f96-48aa-87d7-f1dd86c991a6` รับ traffic 100% และ post-deploy readback พบ alert/DLQ/lock/
manual Chatwoot Work ใหม่เป็นศูนย์. Rollout gate ที่เหลือคือ fresh scheduled Daily evidence เท่านั้น.
รายละเอียดอยู่ที่
`docs/project-brain/chatwoot-daily-updated-within-incremental-2026-08-15.md`.

## Non-TikTok Lark RAW retirement — 2026-08-14

Customer-facing Lark Base จะไม่เก็บ API-source RAW mirrors อีกต่อไป. Meta Organic, Paid Ads,
YouTube, WooCommerce และ Chatwoot เก็บ source facts/history/coverage ใน D1 แล้วเขียน Lark เฉพาะ
`MKT_*` และ Report tables. ไม่มี feature switch สำหรับเปิด RAW mirror กลับมา. ข้อยกเว้นเดียวคือ
`RAW_TikTok_Creator_Videos` ซึ่งเป็น protected Lark Native source และ Worker อ่านได้อย่างเดียว.

Repository change เพิ่ม D1 `youtube_analytics_daily_facts` และตัด active writers/preflight/schema ของ
27 legacy RAW tables. หลัง backup/checksum, D1 catch-up, stable-key parity, reviewed deploy, scheduled
soak และ zero-consumer proof ผ่านครบ ได้ลบ Live tables 27/27 แบบ exact ID แล้วเมื่อ 2026-08-16;
TikTok Native RAW คง protected/read-only ตามเดิม. รายละเอียดอยู่ที่
`docs/project-brain/non-tiktok-lark-raw-retirement-2026-08-14.md`.

## Multichannel Report & Schedule Final Closure — 2026-08-09

Meta Ads, Google Ads และ Chatwoot ได้รับการ promote เป็น active จาก retained UAT evidence
โดย execution flags ยัง default false. Daily/Weekly schedule ใช้ Shared
`report.materialization.generate` ครบ 8 reviewed platforms ที่ `1D/3D/7D/30D`, มี Stable
Queue identity และ batched fan-out. Meta Ads/Chatwoot ใช้ primary cron; Google Ads คง external
Manager Script boundary เพื่อไม่สร้าง duplicate producer. TikTok Ads ยัง planned, Facebook R2
ห้าม replay, Production blocked. รายละเอียดและ activation gate อยู่ที่
`docs/project-brain/multichannel-report-schedule-final-closure-v1.md`.

Integration Workspace activation เมื่อ 2026-08-10 เปิด Source และ Daily/Weekly Report schedules
พร้อม D1/Lark readback 32 snapshots สำหรับ period end `2026-08-09`. Notification runtime,
automatic weekly notification, DLQ redrive และ Production ยังปิด. Google Ads fresh LIVE ผ่าน
6 datasets, 7 chunks, 1,335 rows, D1/Lark parity และ Provider schedule readback `Daily between
6:00 AM and 7:00 AM`; PREVIEW ไม่มี schedule. Blocker ที่ยังห้ามประกาศ full LIVE pass คือ
YouTube Analytics ต้องออก Refresh Token ใหม่ด้วย one-time consent จาก customer Channel owner จริง;
Chatwoot stable-ID pagination fix merge/deploy แล้ว; Live `r6` พบ post-boundary convergence liveness defect
และ cutoff correction ผ่าน gates แล้ว อยู่ระหว่าง reviewed release/catch-up/reconciliation.

## YouTube Customer OAuth runtime credential-path correction — 2026-08-10

Read-only evidence ยืนยันว่า Customer Connection เดิมยัง `connected/validated` และ active encrypted
Refresh Token reference ตรงกัน แต่สถานะ D1 นี้ไม่ใช่หลักฐานว่า Google refresh grant ยังใช้ได้.
Repository cause ชั้นแรกคือ ingestion สร้าง Owner client จาก legacy `YOUTUBE_OAUTH_*` path แทน
Customer Connection ที่ callback บันทึกไว้.

Repository แก้แล้วโดยให้ Analytics-enabled routes อ่าน exact D1 Customer Connection, ตรวจ customer,
state, scopes, active credential reference และ configured Channel แบบ fail-closed แล้ว reuse shared
Google refresh provider; ไม่มี legacy Owner fallback. Full unit, Workers runtime `18/18`, report
reliability `105/105`, architecture/hygiene, audit, deploy dry-run และ diff check ผ่าน. Reviewed Worker
deploy แล้ว แต่ Live refresh ของ retained credential คืน `invalid_grant`. OAuth app publish ไม่สามารถ
ชุบ grant เดิม; บัญชีนักพัฒนาสองบัญชี consent สำเร็จแต่ไม่มี Channel และ callback ปิด fail-closed เป็น
`identity_mismatch` โดยไม่มี Queue/Lark write. `REPOSITORY_FIXED=YES`, `LIVE_VALIDATED=NO` และลูกค้า
ต้อง consent ครั้งเดียวด้วย Google/Brand Account owner ของ Channel จริงเพื่อออก Refresh Token ใหม่.
หลังจากนั้นระบบ refresh ต่อได้จนกว่าจะถูก revoke/หมดอายุตาม Google policy. รายละเอียดอยู่ที่
`docs/project-brain/youtube-customer-oauth-runtime-credential-path-incident-2026-08-10.md`.

Customer Channel owner consent สำเร็จเมื่อ 2026-08-12: D1 ยืนยัน `connected/validated`, exact Channel,
scopes 2/2 และ Refresh Token ใหม่ active โดย token เดิมเป็น replaced. Fresh Analytics catch-up ผ่าน
Owner authorization แต่หยุดก่อน Business write (`records_written=0`) เพราะ adapter บังคับ
`averageViewPercentage` ไม่เกิน 100 ทั้งที่ Source อาจเกิน 100 เมื่อมีการรับชมซ้ำ. Work ที่ล้มถูกเก็บ
เป็นหลักฐานและห้าม replay; Repository hotfix เปลี่ยน contract เป็น finite non-negative โดยไม่ clamp และ
ต้องผ่าน reviewed deploy + fresh operation + D1/Lark reconciliation ก่อนปิด Live Analytics.

## Chatwoot stable-identity pagination correction — 2026-08-10

Provider Conversations API ใช้ mutable offset page และไม่มี snapshot cursor. Fingerprint ของ page เดิม
จึง fail เมื่อลำดับรายการเปลี่ยนระหว่าง durable continuation. PR #597 เปลี่ยน durable state ให้เก็บเฉพาะ
stable numeric Conversation IDs, ใช้ page list เพื่อ discovery, fetch exact detail ต่อ ID และวนจาก page 1
จน pass เต็มไม่พบ ID ใหม่ โดยไม่ persist Provider payload/PII.

Focused tests `23/23`, full unit `2919/2919`, Workers runtime `18/18`, report reliability, architecture,
audit และ deploy dry-run ผ่าน. Live catch-up พบ Provider total 7,720 สูงกว่า active bound 5,000 จึงขยาย
เฉพาะ ignored runtime limits `CHATWOOT_API_MAX_ROWS`/`CHATWOOT_MAX_CONVERSATIONS` เป็น 10,000,
deploy config-only และ read back 100% traffic โดยคง schedule/webhook/Notification/DLQ/Production gates
เดิม. Controlled operation `r6` ต้อง complete + D1/Lark reconciliation ก่อนเปลี่ยนสถานะเป็น PASS.
รายละเอียดอยู่ที่
`docs/project-brain/chatwoot-stable-identity-pagination-live-closeout-2026-08-10.md`.

## Chatwoot Initial terminal recovery — 2026-08-01

The current retained Initial operation was terminalized after Final UAT polling mistakenly treated a `running`
unit as failed and restored the Worker all-false before Queue completion. Recovery is exact-session/D1-proven,
reactivates only the guarded existing Work, sends no replacement Initial admission, preserves partial masters,
requires 15-target D1/Lark parity plus Initial/Daily replay stability, and closes incidents only after Safe
completion. See `docs/project-brain/chatwoot-initial-terminal-failure-recovery-2026-08-01.md`.

The live recovery later proved that durable Queue work can outlive the local controller. The exact Initial
operation advanced beyond the attempts-16 boundary while the controller's cached Cloudflare OAuth bearer expired;
the Worker and Queue remained healthy, but controller polling and automatic Safe restore stopped. The recovery
operator now selects exactly one incomplete prior evidence directory, resumes by polling without another Initial
send, refreshes Queue REST bearer authorization just in time, keeps Wrangler on its refreshable OAuth session and
checks active deployment at a bounded cadence. The original 30-day/3-day/parity contract remains unchanged.

## WooCommerce 2026-only history decision — 2026-07-30

คำสั่งล่าสุดแทนที่ Full-history WooCommerce ด้วย Order history ตั้งแต่
`2026-01-01T00:00:00.000Z` ถึง operation boundary. Orders/Customers/Coupons ใช้
`report_range`; Store/Products/Categories เป็น current master snapshot. Pre-2026 Business rows
ต้อง backup, exact-key reconcile และลบจาก D1/Lark ก่อน bounded rerun. Worker ต้องคืน all-false
และ Schedule/Production ปิดตลอด. Full-history durable operation เดิมห้าม resume เพราะไม่มี
2026 boundary; หลัง backup ให้ปิดเฉพาะ exact Work/Sync identity เป็น scope-replaced.

## Purpose

ระบบรวมข้อมูล Social Organic, Paid Ads, Commerce และ Conversation เข้าสู่ Lark Base เพื่อทำ Dashboard, Reporting, AI Summary, Insight, Alert และ Notification โดยใช้ Cloudflare Workers, D1, Queues และ JavaScript ES Modules

ไฟล์นี้เก็บ **Current verified repository/runtime state** เท่านั้น ให้ยึด `AGENTS.md` และ `docs/current-task.md` ก่อนเสมอ

Historical Root Project Brain ก่อน TikTok post-Lark implementation ถูกเก็บแบบ immutable ที่:

```text
docs/archive/PROJECT_BRAIN-before-tiktok-post-lark-parity-2026-07-26.md
```

## WooCommerce snapshot idempotent normalization — 2026-07-30

Root cause ของ Final exact preflight semantic-empty คือ double normalization ภายใน operator:
`readSnapshot()` คืน camelCase แล้ว selector/classifier เรียก snake_case-only normalizer ซ้ำ.
D1/OAuth/bearer/generated-config/subprocess read ทั้งหมดเห็น durable operation และ 897 rows
ถูกต้อง จึงตัด Cloudflare account, token, replica และ config drift ออกได้.

Current normalizer รองรับ raw และ normalized snapshot แบบ idempotent รวม Work/Queue/Fence,
Coverage, state/completion และ 14 Commerce counts. Semantic-empty retry ยังคงเป็น fallback
เฉพาะ raw empty read จริง. Failed attempts ทั้งหมดหยุดก่อน Lark/backup/Deploy/Queue.

รายละเอียด:

```text
docs/tasks/woocommerce-snapshot-idempotent-normalization-v1.md
```

## WooCommerce exact snapshot semantic retry — 2026-07-30

หลัง exact lifecycle reactivation ของ `woo-final-full-e2372e56d52d` สำเร็จ Final remote
preflight เห็น pinned active work, zero other work/locks แต่ snapshot read ถัดมาได้ successful
semantic-empty row ชั่วคราว. Read-only inspector หลัง failure ยืนยัน durable state และ partial
facts เดิมยังครบ; attempt ไม่มี Lark/backup/Deploy/Queue mutation.

Exact continuation จึง retry read-only snapshot แบบ bounded เฉพาะเมื่อทุก identity, state,
Coverage, Queue attempts และ Commerce counts ว่างทั้งหมด. Snapshot ที่มีข้อมูลแต่ผิด contract
ยัง fail closed ทันที และ retry เกิดก่อน Remote mutation ทุกชนิด.

รายละเอียด:

```text
docs/tasks/woocommerce-exact-snapshot-semantic-retry-v1.md
```

## WooCommerce exact-resume lifecycle reactivation — 2026-07-30

Exact continuation ของ `woo-final-full-e2372e56d52d` ถูก source-safe launcher รุ่นเดิมเรียก
generic failed-work recovery ก่อนอ่าน exact-resume env จึงเปลี่ยน lifecycle เป็น terminal
หลังมี partial D1/Lark writes แล้ว. Attempt นี้ไม่ Deploy Worker, ไม่ส่ง Queue และไม่เปลี่ยน
Business/Coverage/Lark facts; Final operator หยุดต่อด้วย defect `optionalText is not defined`.

Live read-only inspection บน
`main@b10458e3873a16481264fa4889a88620b9669c3d` ยืนยัน failed code
`WOOCOMMERCE_D1_READ_FAILED`, incomplete phase ที่ dataset 1/page 2, Queue attempts 7,
Coverage 2/invalid 1, Business rows 897 และ active lock 0.

Current correction ข้าม generic recovery เมื่อ exact operation ถูก pin, ปิด generic
recovery ทั้ง discovery และ mutation สำหรับ work ที่มี Coverage/Commerce rows, อนุญาต
preflight active work เฉพาะ pinned identity หนึ่งรายการ และเพิ่ม exact lifecycle reactivation
แถวเดียวพร้อม immutable pre/post verification. หลัง merge ต้อง re-activate และ resume
operation เดิมเท่านั้น; ห้าม abandon หรือ admit replacement full operation.

รายละเอียด:

```text
docs/tasks/woocommerce-exact-resume-reactivation-hotfix-v1.md
```

## WooCommerce Preview alias/version pair classifier — 2026-07-30

Wrangler `version-upload` สามารถคืนทั้ง Aliased และ Versioned Preview URL ใน upload เดียว.
Parser แยกทั้งสองชนิดด้วย exact Worker/account workers.dev identity แทนการถือ distinct origins
สองค่าเป็น ambiguity. Deterministic alias ยังคงเป็น request target เสมอ; Versioned URL เป็น
cross-check เท่านั้น. Extraction จำกัดที่ six declared Preview containers และ fail closed สำหรับ
malformed/foreign/unsafe URL โดย evidence ไม่มี raw origin.

Focused tests ผ่าน `36/36`; full Unit `1460/1460`, Workers runtime `15/15`, Report reliability
`100/100`, repository check, audit และ dry-runs ผ่าน. Repository implementation ไม่มี Remote
action. Live diagnostics และ D1/Lark rollout ดำเนินต่อหลัง merge ภายใต้ scoped authorization.

รายละเอียด:

```text
docs/tasks/woocommerce-end-to-end-lark-closeout-v1.md
```

Live diagnostics หลัง merge ผ่าน classifier และ Safe restore แต่ Provider HTTP `200` body ถูก
จำแนกเป็น HTML/XML ทั้งที่ Content-Type เป็น JSON. Public unauthenticated exact-route GET ด้วย
Worker headers ได้ JSON `401`, จึงไม่ใช่ hostname/path/Accept/User-Agent mismatch. Follow-up
เพิ่มเฉพาะ `responseRedirected`, response URL presence และ origin/path match booleans โดยไม่เก็บ
raw URL/body/prefix เพื่อแยก redirect จาก direct Provider contamination ก่อนตัดสิน external fix.
Rerun หลัง PR #252 ผ่าน Provider diagnostics แล้วบน
`main@527cdceda2d4661c82dc000380705d1078343bdf`; store รายงาน WooCommerce `10.6.2`,
WordPress `6.9.4`, currency `THB`, Preview URLs ถูก restore disabled และ Production baseline
ไม่เปลี่ยน. Exact inspector ของ `woo-final-full-6f43ac8ee857` ยืนยัน failed/stale-active,
no lock, one Queue attempt และ zero Coverage/Commerce rows จึงอนุญาตเฉพาะ guarded
lifecycle-only recovery ที่ pin operation นี้ก่อน Final rollout.
PR #253 ต่อมา Squash Merged ที่ `67a82551749569d74b9e4b66a32c82e5715b1d40`
และ exact recovery สำเร็จ: stale-active false, active lock 0, Queue attempt คง 1,
Coverage/Commerce rows คง 0. ก่อน admit operation ใหม่ต้องแก้ Final operator รุ่นเดิมที่จบด้วย
scheduled-active deployment ให้จบด้วย verified all-false `safe-closeout` แทน เพราะ
Integration Workspace authorization ล่าสุดห้ามเปิด Schedule/Cron ตลอด Workstream.
Final operation `woo-final-full-e2372e56d52d` ต่อมาถูก admit ครั้งเดียวและมี partial D1/Lark
writes ก่อน retry ที่ Orders page 2 ล้มด้วย `WOOCOMMERCE_D1_READ_FAILED` บน
`commerce_customer_aggregates`. Live boundary คือ 99 value binds + account bind ผ่าน แต่
100 value binds + account bind รวม 101 เกิน D1 maximum 100 bound parameters. Current correction
ต้อง chunk derived-row value reads เป็น 99 และ resume exact durable operation เดิมเท่านั้น.
Final operator รองรับการ pin `MKT_WOOCOMMERCE_FINAL_RESUME_OPERATION_ID` โดยตรวจ failed sync
code, active durable work, no active lock, partial Business rows และความตรงกันของ work/Queue
generation กับ original requested-at แบบ read-only ก่อน Remote mutation ทุกชนิด.
Queue-attempt evidence ใช้ `main_queue_attempts` เพราะหนึ่ง operation มี durable row เดียว.
WooCommerce Report ต่อผ่าน generic `report.materialization.generate` ด้วย capability `commerce`
และ D1 Commerce source เดิมแล้ว; D1 materialization กับ Lark Snapshot/Metric ใช้ shared runtime,
ส่วน Product/Payment/Shipping เป็น bounded extensible collections. Runtime ยอมให้ Commerce
Report เฉพาะ report-only window ที่ ingestion/full/schedule flags เป็น false.
Guarded Live path ใช้ `scripts/woocommerce-report-runtime-closeout.mjs` เพื่อ reuse Report
finalizer/closeout เดิมใน explicit WooCommerce mode, เปิดเพียง global D1 Report read,
preset materialization และ WooCommerce Report read, พิสูจน์ D1/Lark metric parity กับ
same-job replay แล้วคืน all-false Safe state ใน `finally`.
DLQ incident ของ exact Final operation ปิดได้เฉพาะหลัง Final summary ผ่านครบด้วย
`scripts/woocommerce-dlq-closure-operator.mjs`; operator pin 3 immutable rows, สำรอง D1,
ตรวจ completed full snapshot/zero lock และเปลี่ยนเฉพาะ retained DLQ/recovery metadata โดย
ห้าม Queue redrive/delete หรือ Work/Sync/Coverage/Business/Lark mutation.

## WooCommerce diagnostics deterministic Preview origin — 2026-07-30

Live diagnostics หลัง Queue sentinel fix ยืนยัน Active และ automatic Safe Preview upload สำเร็จ
รวม 2 Version แต่ parser เดิมหยุดด้วย
`WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_URL_INVALID` เพราะ Wrangler 4.110.0
structured output ไม่มี URL ใน array shape เดิม. Provider request เป็นศูนย์, Preview URLs และ
workers.dev ถูก restore เป็น disabled, Production deployment/version/traffic คงเดิม และ
Queue/D1/Lark/Schedule/Business mutations เป็นศูนย์.

Hotfix สร้าง origin แบบ deterministic จาก validated alias, Worker name และ account workers.dev
subdomain. Existing Preview URL wrapper อ่าน subdomain ผ่าน Cloudflare account API แบบ GET-only,
ไม่พิมพ์/persist raw identity หรือ auth และส่งต่อเฉพาะ validated label. Wrangler structured
`version-upload` exactly one กับ valid version ID ยังคงเป็น authority; URL เป็น optional
fail-closed cross-check. Command-failed evidence แยก captured file count ออกจาก failures เพื่อ
ไม่รายงาน successful upload หรือ application error เป็น Wrangler failure ปลอม.

Implementation/CI ไม่มี Remote action และไม่อนุญาต Live rerun.

รายละเอียด:

```text
docs/tasks/woocommerce-diagnostics-preview-origin-v1.md
```

## WooCommerce diagnostics Queue sentinel — 2026-07-29

Live diagnostics ยืนยันว่า Cloudflare ปฏิเสธทั้ง Active และ automatic Safe Preview Version
ด้วย `11001 Queue handler is missing` เพราะ Preview-only entrypoint มีเพียง `fetch` ขณะที่
Worker เดียวกันลงทะเบียนเป็น Queue consumer. Safe state ถูก restore แล้ว, Production deployment
คงเดิม และไม่มี Version upload, Provider, Queue, D1, Lark หรือ Schedule action สำเร็จ.

Repository Hotfix เพิ่ม fail-closed `queue(batch)` ที่เรียก `batch.retryAll()` exactly once
โดยไม่ ack, อ่าน message หรือ import Business Queue runtime. Active/Safe config ยังคงไม่มี
Queue/routes/triggers/D1/Production bindings และมีเฉพาะ diagnostics vars/Secret names ที่จำเป็น.
Production entrypoint และ Queue runtime จริงไม่เปลี่ยน. Implementation/CI ไม่มี Remote action
และไม่อนุญาต Live rerun.

รายละเอียด:

```text
docs/tasks/woocommerce-diagnostics-queue-sentinel-v1.md
```

## Lark Dashboard backfill post-apply verification — 2026-07-29

Shared dimensions backfill operator v1.2 แก้ Repository defect ที่เดิม replan เพียงครั้งเดียว
ทันทีหลัง `executeAll()`. Post-apply verification ใหม่สร้าง Planner ใหม่และอ่าน Lark records
ใหม่ทุก attempt ตาม delay `0/1000/2000/4000/8000ms`, จำกัด 5 attempts และ elapsed budget
30000ms โดยไม่มี write retry. ผ่านเมื่อ create/update เป็น zero เท่านั้น; create หรือ persistent
update ยังคง Fail closed.

Diagnostics เปิดเผยเฉพาะ logical table key, pending row count, pending field-name count,
attempt/elapsed และ read strategy. ไม่เปิดเผย physical Table ID, record payload/ID, Business
values หรือ Secret. `TableSyncEngine` expose เฉพาะชื่อ Field ที่ต่างหลัง normalized comparison;
Text, SingleSelect, Number, formatted decimal และ null shape ที่ semantic เท่ากันไม่สร้าง update
ปลอม ขณะที่ observed zero ยังคงต่างจาก null.

Remote cause ของ Incident ยังไม่ยืนยัน: Error เดิมเกิดหลัง write execution และพิสูจน์เพียงว่า
immediate replan ยังเห็น 32 pending. Preview ปกติเป็น read-only recovery mode เพื่อจำแนกว่า
Apply ก่อนหน้า converge แล้ว (`updateRows=0`) หรือยังต้องขอ Apply ใหม่ (`updateRows>0`).
Implementation นี้ไม่มี Remote Lark/D1, Worker, Queue, Schedule, Secret หรือ Production action.

รายละเอียด:

```text
docs/tasks/lark-dashboard-backfill-post-verify-hotfix-v1.md
```

## Lark Dashboard Shared Report dimensions — 2026-07-29

Phase A เพิ่ม Shared dimensions แบบ Additive only ให้ `MKT_Report_Snapshots`,
`MKT_Report_Metric_Values`, `MKT_Report_Top_Content` และ `MKT_Report_Top_Ads`.
Snapshot เพิ่ม `customer_key`, `capability`, `coverage_rate`; อีกสามตารางเพิ่มสอง Field
ดังกล่าวร่วมกับ `period_kind` และ `window_days`. `capability` เป็น Text extensible lowercase
key, `window_days` ใช้ integer formatter และ `coverage_rate` ใช้ `0.0000`.
`baseline_coverage_rate` ยังคงเป็น Organic baseline coverage เดิมและไม่ถูกแทนที่.
Phase A คง legacy Snapshot writer ที่เขียน `payload.coverageRate` ลง Field นี้ทุก Capability
เพื่อไม่ให้ Paid Ads rerun ล้างค่าเดิม; `coverage_rate` ใหม่เป็น Universal shared dimension.
การ reinterpret หรือ cleanup ค่าเก่าต้องเป็น workstream แยก.

Materialization-to-Lark path อ่าน validated `report_materializations` เท่านั้น, ตรวจ Storage
contract/checksum/metadata parity แล้วสร้าง Shared dimension object หนึ่งครั้งสำหรับทุก output
row ผ่าน `TableSyncEngine` เดิม. Stable keys ไม่เปลี่ยน, Custom range คง
`window_days=null`, missing Coverage คง `null` และ observed zero คง `0`. Dashboard Views
เดิมยังกรอง `report_type=dashboard_performance_report` โดยไม่มี Platform/Account/Customer
hardcode.

Focused Phase A tests ผ่าน `7/7`, expanded Dashboard/Report `34/34`, full Node `1406/1406`,
Workers runtime `14/14`, Report reliability `100/100`, dependency audit 0 vulnerabilities และ
Wrangler dry-runs ผ่าน. Schema preview simulation ได้ additive `create_field=18`,
`create_table=0`, `update_field=0`, `conflicts=0`. Draft stacked PR `#237` ยังเปิดและไม่ Merge.
ไม่มี Remote Lark/D1, Worker, Queue, Schedule, Secret หรือ Production action.

รายละเอียด:

```text
docs/tasks/lark-dashboard-shared-dimensions-v1.md
```

## Dashboard rolling-period repository contract — 2026-07-28

Dashboard period identity ใช้ `period_kind=rolling_days|custom_range` ร่วมกับ
`window_days`/inclusive dates; presets คือ 3D, 7D, 9D, 15D, 30D และ 90D โดย 30D
ไม่ใช่ Calendar month. Default end คือ last completed day ตาม Reporting timezone และ
default comparison คือ previous period ที่มีวันเท่ากัน.

Custom ranges claim `report_requests` ด้วย request ID ที่รวม Source watermark ก่อนส่ง
existing Queue/Reliability path และผลลัพธ์เขียน `report_materializations` ด้วย Storage
Foundation Stable key เดิม. Dashboard/Lark ใช้ Materialized results เท่านั้น ไม่ Query
Detailed D1 facts. TikTok Organic ยังคง end-minus-baseline semantics; Ads SUM daily facts
ก่อนคำนวณ ratio. Missing metric เป็น `null`, observed zero เป็น `0`, และ Coverage/data
status ต้องติดผลลัพธ์เสมอ. Repository binding ครอบคลุม Snapshots, Metric Values,
Top Content และ Top Ads; ยังไม่มี Remote Apply หรือ runtime activation.

Lark Settings correction เพิ่ม Canonical `integration_workspace` rows สำหรับ compatibility
1D/7D, rolling 3/7/9/15/30/90D และ Custom โดย `dashboard_performance_report` เป็น Report type
กลางของ Preset ใหม่. `period_kind`/`window_days` ถูกเพิ่มใน Settings และ Snapshot contract.
Guarded reconciliation อนุญาตเฉพาะ exact schema additions/options, Canonical upsert และการ
Disable exact historical developer setting keys หลัง Canonical rows พร้อมแล้ว; ห้าม Delete
เพราะมี Historical Report outputs อ้าง key เดิม. Live Preview พบ active legacy settings 2 แถว,
historical references 27 แถว, expected schema actions 9 และ Remote mutation 0.

Guarded Live reconciliation ผ่านหลัง Branch Verification `#870`: additive/option schema actions
9, Canonical settings created 9, exact legacy settings disabled 2, active legacy settings 0,
historical references retained 27 และ deletes 0. Read-only post-check พบ schema actions 0 และ
Canonical record creates/updates 0/0 (skipped 9). ไม่มี D1, Worker, Queue, Schedule, Secret หรือ
Production action.

## Current verified repository state — 2026-07-27

```text
Integration Workspace                         active
Technical environment                         development
Runtime profile                               integration_workspace
TikTok post-Lark pipeline                     merged via PR #65
TikTok pipeline merge commit                  acb0b76bb3be936319e0e8bed4849592c96761b5
TikTok guarded rollout operator               merged via PR #71
TikTok operator merge commit                  e6b8bd0b9098b9a79bae49ff24455187e43a331e
TikTok operator reviewed head                 df229ccade82ce7869c01bbf75c1cb3fc0f16cd1
TikTok operator final verification            #558 PASS
TikTok route stability Hotfix                 Repository-only implementation in progress
Meta end-to-end implementation                merged via PR #69
Meta implementation merge commit              11e861cfbc79ea067a90496b205f692ca8bb4d3d
Meta protected runtime                        merged via PR #73
Meta runtime merge commit                     13ebba1476d7983428c5b5ce51ce754adf493ad5
Meta runtime reviewed head                    a700f5f31ebd24a32cc64cc6ca5ffe123a632ff4
Meta runtime verification                     #26 / #593 PASS
Meta read-only validation operator            merged via PR #82
Meta operator merge commit                    0f38aeb8a1c69e8655145f97808f3d3d1b31615a
Meta operator reviewed head                   9b6f8d48891daa9ad7620f731dcdf2483da871e3
Meta operator verification                    #29 / #605 PASS
YouTube end-to-end integration                merged via PR #85
YouTube integration merge commit              dce3bd954ee75ee55a29efac303e9973ca060fca
YouTube reviewed head                         c5ffc4327ffec405f82472c7b7098b45bac82722
YouTube final verification                    #581 PASS
Chatwoot analytics foundation                 merged via PR #68
Chatwoot foundation merge commit              80601de973740e8654b2cea2c4ecf419f4378c0a
Chatwoot foundation verification              #619 PASS
WooCommerce end-to-end integration            merged via PR #94
WooCommerce integration merge commit          060977cd9ed2933700fbd121c9236e6578ad571e
WooCommerce reviewed Integration head         d0ce3399177b5d6c8fcdb6c56eadd77851ae29e9
WooCommerce final verification                #622 PASS
Migration 0016                                applied remotely / additive verification passed
Migration 0017                                applied remotely / additive verification passed
Worker deployment                             TikTok restored safe-closed / Meta, YouTube, Chatwoot and WooCommerce not run
Provider execution                            not run for Meta, YouTube, Chatwoot or WooCommerce rollout
Queue send / DLQ redrive                      none for TikTok, Meta, YouTube, Chatwoot or WooCommerce rollout
Remote D1 / Lark mutation                     TikTok Migration 0016 only / no Business fact or Lark mutation
Schedules                                     disabled
Retention/delete                              blocked
Production                                    blocked
Google Ads                                    LIVE UAT complete / safely closed
```

## YouTube Worker dry-run rollout operator — repository implementation

Branch `integration/youtube-worker-dry-run-rollout-operator` เพิ่ม Stable Queue identity
`youtube:{operationId}` และ deterministic `youtube-dry-run:{operationId}` เฉพาะ trigger
`youtube_worker_dry_run`. Delivery `message.id` ไม่ใช่ durable identity; completed operation
replay โดยไม่เรียก Provider ซ้ำ ขณะที่ scheduled/legacy YouTube path คง behavior เดิม.

Operator `youtube-dry-run-rollout-v1` เป็น plan-only โดย default, ใช้ confirmation แยกทุก phase,
exact Git provenance, canonical SHA-256 evidence chain, one-message/no-auto-resend และ guarded
all-flags-false restore ที่ no-op บน safe baseline และ block concurrent version. Remote verifier
ตรวจ version/bindings/flags/Secret names/traffic/Queue consumers/Cron/routes/workers.dev จาก
read-only Remote responses โดยไม่ใช้ local config แทนหลักฐาน. Dry-run อนุญาตเฉพาะ Public
YouTube GET, Lark planning GET และ Shared
operational mutations; ห้าม Business/Coverage/checkpoint/Lark write, Analytics และ OAuth refresh.
Warning drain กับ expired-work cleanup ถูกข้ามเฉพาะ Operator path.

PR #101 blocker remediation เพิ่ม terminal completion proof, pre-send empty-operation mode,
dry-run completion replay semantics และ Workers-runtime D1 integrated replay test; ยังไม่มี
Remote action ใดเกิดขึ้น.

งานนี้เป็น Repository-only: ไม่มี Worker/D1/Lark/Provider/Queue/DLQ/Schedule/Production action.
รายละเอียด:

```text
docs/project-brain/youtube-worker-dry-run-rollout-operator-2026-07-27.md
```

## TikTok Organic identity and protected source

```text
customerKey=chemistry_k
accountKey=chemistry_k
sourceHandle=chemistry_k
source=lark_native_tiktok_for_creator
```

`RAW_TikTok_Creator_Videos` is a protected Lark Native source. Runtime may read it but must not mutate its Table, Fields, Views, Formula, Filter or Records.

Retained last verified Live facts:

```text
RAW_TikTok_Creator_Videos             approximately 2021
organic_content_state                 2021
organic_content_observations          2021
data_coverage_entities                3396
D1 duplicate State/Observation groups 0 / 0
MKT_Content                           22 at last verified audit
MKT_Content_Daily                     208 at last verified audit
```

These counts are historical evidence, not a new freshness claim. New Live facts require the guarded read-only audit.

## Merged TikTok post-Lark architecture

```text
Lark Native TikTok sync approximately 07:00 Asia/Bangkok
→ bounded read-only RAW probe
→ two identical probes / deterministic watermark
→ durable same-watermark admission
→ existing Durable source staging
→ staged-watermark fence
→ full-unit preflight
→ existing D1 Observation / State / Coverage
→ existing Canonical Lark writer
→ completed Coverage re-read
→ idempotent Daily Report request
→ Lark-primary + D1-shadow or D1-primary Report calculation
→ bounded Lark metadata hydration
→ existing Report output writer
→ optional deterministic D1 materialization
```

Scheduled `metricDate` is the previous completed local day. The scheduler no longer emits a blind TikTok Business sync and rejects conflicting independent/post-processing Daily Report producers.

No second TikTok connector, Reliability stack, Queue/DLQ framework, D1 history writer, Canonical writer, Lark sync engine or Report formula engine was created.

## Merged guarded TikTok rollout operator

PR `#71` added an operator for these separately confirmed phases:

```text
plan
preflight
backup
migrate
deploy-safe
enable-audit
audit
disable-audit
```

The operator:

- defaults to plan-only;
- locks the exact Integration Workspace, Chemistry K source, D1 and Worker identity;
- requires a checksum-verified backup before Migration `0016`;
- validates exactly pending Migration `0016` and additive post-migration count parity;
- permits only Audit HTTP during the audit-only deployment;
- validates route state `404 → 401 → 200 → 404`;
- retains `readyForManualProcessing=false` as diagnostic evidence;
- preserves emergency safe-close when the authenticated Audit fails;
- contains no Queue send, DLQ action, Business write, schedule, retention/delete or Production path.

Final aligned Branch Verification `#558` passed after the merged Meta implementation was included.

Detailed operator closeout:

```text
docs/project-brain/tiktok-post-lark-rollout-operator-merge-closeout-2026-07-27.md
```

## TikTok Remote rollout and Audit diagnostic incident

The separately authorized rollout completed the read-only preflight, checksum-verified Remote D1
backup, additive Migration `0016`, and an all-flags-false Worker deployment. Migration verification
retained zero Admission rows, zero active Work/Locks, zero duplicate groups and unchanged TikTok
Business counts.

A controlled authenticated GET-only Audit window reached the handler but returned:

```text
HTTP status                         400
error                               TikTok audit failed
code                                null / missing
Queue or Business write             none
```

The route was restored to safe-closed HTTP `404` through the approved emergency safe deployment.
TikTok Audit, Business-write and Schedule flags are all `false`. Manual processing, Queue,
Canonical/D1 Business writes, Lark mutation, Report cutover and schedules remain blocked.

The Repository-only branch `hotfix/tiktok-post-lark-audit-error-code` adds a stable sanitized
fallback code at the HTTP boundary and propagates only `httpStatus` plus `remoteCode` through the
rollout operator. The Hotfix performs no Remote action and authorizes no new Audit window.

A later controlled enable attempt exposed a route-stability mismatch: the operator observed
unauthenticated `401`, while the next same-target probe observed `404` before safe-close. Target
fingerprints, pathname, Safe/Audit configuration and deployment ordering matched. The incident is
classified as `ROUTE_PROPAGATION_OR_RUNTIME_INCONSISTENCY`; no authenticated Audit request ran and
the Worker was restored to safe-closed `404`.

The Repository-only branch `hotfix/tiktok-post-lark-audit-route-stability` replaces single route
checks with three consecutive cache-busted/no-cache probes, captures the exact deployed Worker
version from typed Wrangler output, records only sanitized target fingerprints/status/timestamps
and blocks authenticated Audit when enable evidence is stale, incomplete or superseded. It does
not change Audit Business logic and authorizes no Remote action.

## Merged YouTube Organic integration

PR `#85` merged the reviewed YouTube End-to-End implementation and the Integration-owned Shared Worker wiring. Shared routing now selects the D1-first End-to-End route only when the dedicated gate is explicitly true:

```text
YouTube job + MKT_YOUTUBE_END_TO_END_ENABLED=true
  → dedicated D1-first route

YouTube job + flag false/unset
  → existing active router and legacy YouTube route

Non-YouTube job
  → existing Google Ads/TikTok/History/Active chain unchanged
```

The merge reuses the existing YouTube API client, Shared Google OAuth Core, normalizers, Reliability runner, distributed lock, resumable work, Organic history writer, D1 stores, Coverage and `TableSyncEngine`. No duplicate Connector, Queue, Reliability, D1, Lark or Report engine was created.

The merged implementation includes bounded large-inventory storage, retry-safe Coverage, fail-closed report reads, non-destructive missing/private/deleted handling, hidden-subscriber `null` semantics, and D1-before-Lark ordering. YouTube Analytics period facts remain in `RAW_YouTube_Analytics_Daily`; no new migration was added.

Live owner validation on 2026-08-12 established two additional RAW Analytics value contracts. First,
`averageViewPercentage` is finite non-negative but may exceed 100 and must not be clamped. Second, daily
`views`/`likes`/`comments`/`shares` preserve signed safe-integer Provider adjustments, while cumulative
Data API statistics remain non-negative. Both failed operations stopped before Business writes and are
retained without replay. PR #638 then merged/deployed and one fresh post-correction catch-up completed:
837/837 Videos queried, 1,919 Analytics rows, zero failed/missing rows, D1 checkpoint committed, zero new
alerts and Lark GET-only reconciliation at 1,919 unique stable keys with 13 signed adjustment cells retained.
Integration Workspace Owner Analytics is Live PASS; Production remains blocked.

Detailed records:

```text
docs/tasks/youtube-organic-end-to-end.md
docs/tasks/youtube-organic-end-to-end-integration-review.md
docs/tasks/youtube-organic-integration-wiring-safe-rollout.md
```

Remote schema inspection, Worker deployment, Provider calls, Queue messages, D1/Lark Business writes, schedules and LIVE UAT remain blocked pending separate authorization.

## Merged Chemistry K Meta runtime

### Facebook Page-token runtime incident and hotfix

A guarded Facebook D1-only operation reached the Page posts inventory endpoint but was rejected
with sanitized Graph code/subcode `190/2069032`. The operation produced zero Business, Coverage
and Lark rows and the Worker was restored to a verified all-false version at 100% traffic.

The Repository contract already required a distinct Facebook Page credential, while the runtime
source adapter incorrectly reused the discovery/User credential. The hotfix wires
`META_FACEBOOK_PAGE_ACCESS_TOKEN` only to Facebook Page business reads and requires that Secret
name in Facebook D1/Lark rollout preflight. Discovery and Meta Ads remain on `META_ACCESS_TOKEN`.
Detailed evidence:

```text
docs/project-brain/meta-facebook-page-token-runtime-hotfix-2026-07-28.md
```

PR `#73` merged the protected Meta routing and exact Chemistry K multi-account contract:

```text
Facebook Page       982406442148381 / เคมี K
Instagram           17841413521012797 / chemistry_key
Meta Ads alias      chemistry_k2 → 505898710119851
Meta Ads alias      chemistry_k3 → 851206695716861
```

Canonical mapping:

```text
META_AD_ACCOUNT_MAPPINGS=chemistry_k2=505898710119851,chemistry_k3=851206695716861
```

The Shared route preserves:

```text
YouTube guarded route
→ Google Ads protected route
→ Meta protected route
→ TikTok/report/active fallback
```

Meta runtime contracts:

- Facebook, Instagram and Meta Ads remain `uat_pending` and manual-only;
- protected activation requires `development`, `integration_workspace`, Chemistry K and an explicit source-read gate;
- all Connector/source/D1/Lark/report controls default to `false`;
- mappings reject malformed, duplicate or mixed legacy/canonical configuration;
- every Meta Ads job chooses exactly one configured `sourceAccountKey`;
- Queue work key, sync-run identity, Reliability scope and continuation preserve the selected alias;
- Coverage IDs include the exact Ad Account identity;
- unknown aliases fail before Provider access;
- preflight output is sanitized;
- the existing Reliability, Queue/DLQ, D1 history/Coverage and Lark `TableSyncEngine` are reused.

Meta Ads active ingestion contract updated on 2026-08-02:

- one operation accepts at most 31 inclusive days and reads Account plus ad-level Daily Insights;
- Campaign, Ad Set and Ad state is derived only from identities active in that exact range;
- the active path does not enumerate full-history Campaign, Ad Set, Ad or Creative inventories;
- D1 retains validated activity entities and detailed daily facts as the historical authority;
- Lark receives Account and activity entities only, without RAW Ads Daily or MKT Ads Daily detail mirrors;
- Shared checksummed Report materializations provide 1D/3D/7D/30D and Top Ads display data;
- prior full-inventory operation identities are fingerprint-incompatible and remain forensic truth.

## Merged Meta read-only validation operator

PR `#82` added the separately confirmed operator:

```text
plan
→ configuration preflight / zero Provider requests
→ Facebook GET-only validation
→ Instagram GET-only validation
→ chemistry_k2 GET-only validation
→ chemistry_k3 GET-only validation
→ sanitized summary
```

The operator:

- defaults to plan-only;
- requires an exact confirmation for every executable phase;
- requires every Connector, Meta, D1/report, DLQ-redrive and Schedule flag to be explicitly `false`;
- validates one Connector/account per phase;
- uses the existing GET-only Graph client and never places the Token in the URL;
- rejects unknown Meta Ads aliases before Provider access;
- binds evidence to the same contract version, API version and sanitized target fingerprint;
- excludes Tokens and raw customer IDs from output/evidence;
- contains no Queue send, D1/Lark mutation, Worker deployment, schedule or Production path.

Repository verification passed on the final reviewed operator head:

```text
Meta End-to-End Verification  #29 PASS
Branch Verification           #605 PASS
```

Detailed records:

```text
docs/tasks/meta-runtime-wiring.md
docs/tasks/meta-read-only-validation-operator.md
docs/runbooks/meta-read-only-validation.md
```

Provider execution has not run and remains a separate explicit gate.

## Merged Chatwoot analytics foundation

PR `#68` merged the reviewed bounded Chatwoot polling and analytics foundation at
`80601de973740e8654b2cea2c4ecf419f4378c0a`. It adds PII-minimized source collection,
stable identity/revision handling, bounded D1/Coverage preparation and optional existing
`TableSyncEngine` delivery. Runtime routing and a numbered Chatwoot migration remain separate work.

WooCommerce Integration owns Migration `0017`; Chatwoot Runtime Wiring must refresh the migration
directory and currently treats its later migration as provisional `0018`.

Detailed closeout:

```text
docs/project-brain/chatwoot-foundation-merge-closeout-2026-07-27.md
```

## Merged WooCommerce integration

PR `#94` merged the reviewed WooCommerce End-to-End implementation and Shared protected wiring at
`060977cd9ed2933700fbd121c9236e6578ad571e` after Branch Verification `#622` passed.

Merged contracts include:

- read-only WooCommerce REST transport with HTTPS and header-only Basic authentication;
- PII-minimized Commerce models and exact currency micros;
- immutable continuation scope, source-revision gating and atomic Order-line replacement;
- additive D1 RAW/Canonical/Daily facts and Coverage-backed reports;
- stable Queue work identity `woocommerce:<operationId>`;
- protected `uat_pending` / `manualOnly` routing;
- existing Reliability, lock, Queue retry/DLQ, Coverage and `TableSyncEngine` reuse;
- additive source Migration `0017_woocommerce_commerce.sql`;
- all Connector, D1, Lark, Report, full-reconciliation and Schedule controls default `false`.

The merge performed no Provider request, credential use, Remote D1/Lark mutation, Queue action,
Worker deployment, Schedule, LIVE UAT or Production change.

Detailed closeout:

```text
docs/project-brain/woocommerce-integration-merge-closeout-2026-07-27.md
```

## Default-false controls

```text
MKT_TIKTOK_AUDIT_HTTP_ENABLED=false
MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED=false
MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED=false
MKT_CONNECTOR_FACEBOOK_ENABLED=false
MKT_CONNECTOR_INSTAGRAM_ENABLED=false
MKT_CONNECTOR_META_ADS_ENABLED=false
MKT_META_SOURCE_READ_ENABLED=false
MKT_META_D1_WRITE_ENABLED=false
MKT_META_LARK_WRITE_ENABLED=false
MKT_META_REPORT_READ_ENABLED=false
MKT_YOUTUBE_END_TO_END_ENABLED=false
MKT_YOUTUBE_LARK_WRITE_ENABLED=false
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_WOOCOMMERCE_D1_WRITE_ENABLED=false
MKT_WOOCOMMERCE_LARK_WRITE_ENABLED=false
MKT_WOOCOMMERCE_REPORT_READ_ENABLED=false
MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED=false
MKT_SCHEDULE_WOOCOMMERCE_ENABLED=false
MKT_REPORT_D1_SHADOW_READ_ENABLED=false
MKT_REPORT_D1_READ_ENABLED=false
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED=false
MKT_SCHEDULE_TIKTOK_ENABLED=false
MKT_SCHEDULE_YOUTUBE_ENABLED=false
MKT_SCHEDULE_DAILY_REPORT_ENABLED=false
MKT_LARK_DAILY_RETENTION_ENABLED=false
```

Storage, Source-read and Report flags never implicitly enable schedules.

## Shared Core authority

All channel Workstreams must reuse:

- central Connector and Job catalogs;
- deterministic Stable keys and exact identity validation;
- existing Queue/DLQ and operation identity helpers;
- existing Reliability runner, lock renewal and typed retry classification;
- D1 history/Coverage contracts and Storage Foundation;
- existing Canonical Lark writer and `TableSyncEngine`;
- existing Report calculations, materialization and output writers;
- sanitized observability with no Secret or raw customer payload exposure.

Do not create a parallel Reliability, Queue, D1 writer, Lark sync or Report engine.

## Parallel Workstreams

```text
TikTok Organic       Migration 0016 applied / Audit failed without code / safe-closed / Hotfix review pending
All Meta             runtime PR #73 merged / read-only operator PR #82 merged / Provider validation pending
YouTube Organic      integration PR #85 merged / Remote read-only preflight pending
Chatwoot             foundation PR #68 merged / Runtime Wiring waits after Migration 0017 owner
WooCommerce          integration PR #94 merged / Migration 0017 and Remote rollout pending
Google Ads           complete / safely closed
```

Each remaining Workstream owns a unique Branch and Draft PR. Migration, deployment, Queue sends, Remote Lark/D1 mutation, schedules and LIVE UAT remain Integration-stream responsibilities only.

## Next separately approved TikTok rollout

Migration `0016` is already applied and must not be rerun. The next order is:

1. review and separately approve merge of the route-stability Hotfix;
2. separately authorize an all-flags-false Worker deployment containing both reviewed Hotfixes;
3. confirm the route remains safe-closed HTTP `404`;
4. separately authorize one new controlled Audit-only window and one authenticated GET;
5. capture the stable sanitized Remote error code or a successful read-only Audit result;
6. restore all-flags-false Worker state immediately;
7. only after a clean Audit, consider one manual new-watermark Admission;
8. reconcile D1/Canonical/Coverage and validate exact rerun stability;
9. propose Schedule activation only after all prior gates pass.

This Hotfix PR authorizes none of these Remote phases.

## Next separately approved YouTube rollout

The Repository implementation is merged, but no Remote phase is authorized automatically. The next order is:

1. authenticated read-only verification that Storage Foundation `0009` tables exist;
2. inspect deployed configuration and confirm every YouTube/Storage/Report/Schedule flag is false;
3. retain and review sanitized evidence;
4. separately authorize an all-flags-false Worker deployment;
5. separately authorize a dry-run/read-only YouTube operation;
6. verify non-dry execution is blocked while D1 or Lark gate is false;
7. separately authorize controlled Integration Workspace D1-first/Lark UAT;
8. verify Coverage, idempotent rerun and D1 Report shadow parity;
9. keep Schedule and Production blocked until a new explicit approval.

## Next separately approved Meta validation

The live Facebook D1 follow-up on 2026-07-28 proved that Page-token wiring alone was insufficient:
content inventory ignored the reviewed period and account Insights time-window pagination was
mistaken for cursor pagination. The reviewed follow-up is documented in
`docs/project-brain/meta-facebook-page-token-runtime-hotfix-2026-07-28.md`; Remote rerun must use a
new operation only after the hotfix is merged, deployed all-false and preflighted against the exact
active version.

The subsequent content Insights capability probe also removed three Graph-v25-rejected metric
candidates. Only `post_media_view` and `post_total_media_view_unique` are currently accepted for
Facebook content Insights; unsupported engagement metrics remain `null`.

The following Facebook D1 run proved the rerun verifier must use the durable
`main_queue_attempts` counter, not the count of `queue_operation_attempts` rows: `operation_id` is
the primary key, so one same-operation replay updates the existing row. The D1 and Lark operators
retain immutable Business/Coverage/reconciliation checks and permit cross-head closeout only for
an exact-confirmed, clean, ancestor-bound operator-only hotfix. The closeout reuses a prior
hash-valid restore only after remote all-false/version/topology re-verification, without another
Worker deployment.

The first Facebook Lark continuation failed closed at destination preflight because its Canonical
`MKT_Accounts` row contained Provider-specific fields such as `username` that belong to the Shared
RAW contract and are absent from the approved Live Canonical schema. The corrected write-set keeps
those source facts in `RAW_Meta_Organic_Accounts` and D1 account-daily facts while limiting the
Canonical row to existing `MKT_Accounts` fields. No additive Lark schema mutation is required.

The runtime and operator are merged, but Provider execution is not authorized automatically. The next order is:

1. run `rollout:meta-read-only` in plan-only mode from an authorized local Integration Workspace;
2. separately authorize configuration preflight and confirm Provider requests remain zero;
3. retain and review sanitized preflight evidence;
4. separately authorize one Facebook GET-only identity/permission validation;
5. separately authorize one Instagram GET-only identity/permission validation;
6. separately authorize one `chemistry_k2` GET-only validation;
7. separately authorize one `chemistry_k3` GET-only validation;
8. create and review the sanitized summary;
9. only after a clean summary, consider a separate D1-only processing gate.

D1 writes, Coverage reconciliation, Lark parity, LIVE UAT, schedules and Production remain later approval gates.

## Repository hygiene audit note

A temporary `tmp/noop` file containing only `x` was accidentally created on `main` at
`62857a7e6c298b4be02dc105aeecbff4080d5313` during PR `#82` branch reconstruction and immediately
removed at `6158a8b1381d62539274a7fa77d7860bdbee624a`.

The final tree contains no temporary file and no Business fact, Secret, Runtime configuration,
migration, Queue state, D1/Lark data or deployed infrastructure was changed by the incident. The
commits are retained as transparent audit history.

## Facebook ContentDaily source-permission correction — 2026-08-11

Post-merge read-only recovery of `facebook-dashboard-repair-20260809-v1` proved the recovery
control-plane fix was correct but the completed source carried 89 content identities and zero
ContentDaily metrics. A bounded GET-only probe confirmed the active credential has Page inventory
permissions but not `read_insights`; Insights-only metrics are therefore unavailable on this
credential, while explicit Post fields remain usable.

`read_insights` remains an optional enhancement rather than a hard admission gate. Graph v25 does
return the Post `shares.count` field with the currently granted
`pages_read_engagement` scope. The shared Facebook inventory now requests that field and projects
only explicit counts through the existing Raw/Canonical/D1 cumulative snapshot path. Missing fields
remain null. The requested operation date is the fallback metric date while the real fetch timestamp
remains audit evidence. Live preview for `2026-08-10` produced 64 ContentDaily candidates and 2,351
shares from 89 bounded Posts without writes. The old recovery identity stays immutable; deployment,
fresh admission, Lark parity and Dashboard materialization must use a new operation identity.

Live r1 then proved that Canonical/Lark date binding alone was insufficient: Organic History still
derived its D1 observation and Coverage day from execution time. The shared Writer now supports an
explicit historical metric date and uses a checkpoint when unchanged cumulative values are observed
for that historical day. Existing callers retain the old observed-date default. r1 is immutable;
only fresh r2 evidence may close D1/Lark date parity before Dashboard materialization.

Live closeout is now complete in the Integration Workspace. PR #629/#632 merged, Worker version
`5ede6471-b890-4459-a090-e9f8c3d2ca5d` serves 100%, and fresh operation
`facebook-contentdaily-20260810-r2` completed in 98 bounded attempts. D1 and GET-only Lark readback
agree on 64 distinct ContentDaily keys dated `2026-08-10`, 2,352 shares, complete 64/64 Coverage,
zero failed rows, zero DLQ and zero open alerts. Fresh 1D/3D/7D/30D materializations expose total
shares 2,352 as `available`, and the user visually confirmed Facebook on the Dashboard. The active
runtime token still lacks the actual `read_insights` grant, so Views/Likes/Comments remain N/A.
No retained operation was replayed or redriven.

## Facebook Reactions/Comments summary continuation — 2026-08-12

The earlier Shares-only closeout remains valid historical evidence, but it is no longer the complete
Facebook admission contract. A fresh GET-only probe against the newly generated token confirms
`read_insights` is now granted while `pages_read_user_content` is still absent. Graph rejects both
`comments.limit(0).summary(true)` and `reactions.limit(0).summary(true)` with permission code 10 and
continues to return `shares.count`; therefore the remaining gap is credential scope, not Lark schema,
Dashboard configuration or metric mapping.

The repository implementation requests only summary counts with `limit(0)`, so user identities and
Comment text do not enter the payload. Observed `reactions.summary.total_count` maps to the existing
`reactions_count` Raw provenance and Canonical/D1/Lark Likes field; observed
`comments.summary.total_count` maps to Comments. Explicit zero is real, an absent field stays null/N/A
and malformed summaries fail closed. The Facebook permission gate now requires
`pages_show_list`, `pages_read_engagement`, `pages_read_user_content` and `read_insights`.

No new table or migration is required. Deployment is prohibited until both active Facebook secrets are
rotated from a grant containing all four permissions. After reviewed merge/deploy, closure requires one
fresh operation identity, terminal success, complete Coverage, zero new exact alerts/DLQ, D1/Lark parity
for Likes/Comments and fresh 1D/3D/7D/30D materialization. Retained `r1`/`r2` identities must not be
replayed or redriven. Detailed contract:
`docs/project-brain/facebook-reactions-comments-live-2026-08-12.md`.

### Downstream Facebook live evidence — 2026-08-15

The prior token blocker is superseded by fresh Page-token Business evidence. Scheduled operation
`facebook-scheduled-20260814` completed 91/91 full-inventory Coverage with zero failed rows/new alerts/DLQ.
D1 and GET-only Lark stable-key parity is exact: Views 1,584,330, Likes 16,069, Comments 70 and Shares
2,439. No further customer token rotation is required for the current Integration Workspace.

Fresh post-source Dashboard jobs exposed a separate D1 reader regression: three stale Content identities
outside the authoritative 91-item inventory contributed old Views and null Likes/Comments. The generic
reader now scopes current/comparison/baseline observations only when exact same-period complete
`full_inventory` Coverage and its observed entity set agree; otherwise it preserves strict null/N/A
semantics. PR #649 passed two CI checks and merged at `7f4c301413acec53e9003feb08f936e38f5c14a4`.
Worker `808fe569-8319-469b-b069-2b586642e630` serves 100%; four unique post-deploy Dashboard jobs each
ran once with zero alert/DLQ/lock. D1 and Lark match at Views 1,584,330, Likes 16,069 and Comments 70.
Shares stays null/not-observed because 28/91 Provider rows omit it. Facebook connector/schedule is enabled
for 07:30 and retention defer is removed for the 08:05 scheduled evidence on 2026-08-16. RAW 27-table
deletion remains outside this workstream and waits for its scheduled-soak authority.

## Permanent safety rules

- Data model before Connector;
- one Integration Workspace before customer-owned Production;
- no fake history or dummy Production data;
- missing metric is `null`, not zero, unless Source proves zero;
- no Retention/delete before parity, backup, reconciliation and rollback;
- no protected RAW mutation;
- no rerun of completed TikTok recovery operators;
- no duplicate Reliability/Queue/D1/Lark/Report engine;
- Connector flags and schedules disabled by default;
- Secrets stay in Environment/Secret Manager;
- Production resources must be customer-owned.

## Customer Production cutover completion — 2026-08-24

Customer Social MKT Data Hub Production is complete for the reviewed scope. Chatwoot and WooCommerce canonical
Lark projections are complete and idempotent; D1 retains the authoritative larger Customer commerce history.
All eight active Report platforms have 1D/3D/7D/30D materializations for `2026-08-23`. Customer workflow IDs are
bound by SHA-256 runtime authority because cloned Base workflows do not retain Integration workflow identities.
The exact Customer Weekly AI run completed and one group notification was sent/mirrored with D1 claim count one,
a stable message hash, zero duplicate send and zero remaining exact Alert/DLQ/lock. Final Worker version is
`8f151a18-f07a-4cab-ad08-4cd4ba84433e` at reviewed `main@3fd9b482`; normal source, Report and notification schedules
remain active. The protected TikTok forensic terminal is unchanged.

## Customer daily schedule correction — 2026-08-25

YouTube's dedicated trigger is intentionally reduced to one daily run at `07:50` Asia/Bangkok
(`50 0 * * *` UTC); the retired six-hour trigger is rejected by the runtime contract. Google Ads remains on its
external customer-owned Manager Script trigger and signed ingress, so the Cloudflare Google Ads producer stays
disabled to avoid duplicate source scheduling.

The first Customer TikTok 06:55 automatic probe for metric date `2026-08-24` failed before admission because a
25-row page required more external Lark fetches than Workers Free permits during the two-pass 2,048-record scan.
Live recovery then proved that reusing a 500-row page as the durable business unit can exceed the independent CPU
ceiling, and 100 rows was not stable across all units. The final contract therefore uses a 500-row probe page and
25-row durable source/business units with one unit per Queue invocation. Closure still requires exact cursor,
D1/Lark and incident-delta proof; the protected forensic terminal remains immutable.

## Customer Workers Free runtime recovery — 2026-08-25

Fresh Customer schedule evidence supersedes the earlier assumption that successful Paid Dev execution proves the
same invocation sizing on Workers Free. Customer Business data remains authoritative; recovery resumes existing D1
phase checkpoints rather than copying older Dev results or restarting source ingestion.

The reviewed runtime direction is: Queue batch/concurrency one, one Provider/source unit per YouTube delivery,
page-bounded stable two-pass Chatwoot discovery, Meta whole-operation inventory ceilings separated from its one-page
invocation budget, and smaller Google/Meta D1 batches. TikTok uses migrated incremental state for new operations and
10-row future source units. The exact retained TikTok forensic terminal
`terminal:eafd8e43f1ae5113d12905301496fd4e` remains immutable. Production completion must be re-proven by exact
checkpoint, D1/Lark stable-key parity and zero-new-incident evidence after reviewed merge/deploy.
