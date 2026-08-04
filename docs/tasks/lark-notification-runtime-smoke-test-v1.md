# Lark Notification Runtime Smoke Test v1

Date: 2026-08-05

## Approval

The user explicitly approved one real Runtime Smoke Test after the Worker-side notification Runtime closed as
`PASS`.

This approval authorizes exactly one manual Queue admission for a new Runtime smoke identity. It does not
authorize automatic Notification admission, Lark Automation, Schedule/Cron, Webhook or Production.

## Verified prerequisite baseline

```text
main SHA                         e7963c6a1493354df5586f6a8d83a4062e6e2789
activation main SHA              5833c558d70efcfca08d476a30449b72d8555213
active Worker version            958e183e-fb0d-4795-a547-d805111ca6fc
Worker traffic                   100%
runtime / send / mirror          true / true / true
runtime mode                     runtime
active Executive Settings        4
D1 delivery rows                 1
retained real messages           1
Notification Log rows            1
additional delivery rows         0
additional message sends         0
Queue admission                  0
notification producer            false
Automation / Schedule            0 / 0
Production                       BLOCKED
```

The original Controlled UAT, Mirror Recovery and Runtime Activation commands are permanently closed and must
not be reused for this test.

## Business objective

Prove that the permanently active Runtime Worker can accept one reviewed Runtime Queue job and deliver one real
Executive message through the existing exact-once D1 and Lark mirror path.

The smoke test must leave the Runtime and the four exact Report Settings active after success.

## Exact test identity

The test derives one new immutable AI identity from:

```text
contract version
Runtime smoke template version
exact post-merge repository Head
latest reviewed Executive 1D Preview identity
source Preview dedupe key
exact source Report IDs
```

The resulting identity has the form:

```text
notification-runtime-smoke:<sha256>
```

It is a Runtime identity and must never use the closed `notification-uat:*` namespace.

The source Preview remains unchanged. The smoke test creates one separate AI Run row with:

```text
scope_type                 executive
notification_eligible      true
notification_reason        runtime_smoke_test
preview_mode               false
generation_status          generated
sent_to_group              false before delivery
```

## Exact execution sequence

1. Require clean exact current `main`.
2. Require the Integration Workspace environment and explicit smoke confirmation.
3. Run focused notification tests and repository checks.
4. Prove `scheduled-jobs.js` still contains no Notification producer.
5. Resolve the existing D1, Queue and Lark topology without changing it.
6. Require Worker version `958e183e-fb0d-4795-a547-d805111ca6fc` at 100% traffic.
7. Resolve latest Executive Preview authority for `1D/3D/7D/30D`.
8. Require all four exact source Report Settings active and bound to the reviewed destination hash.
9. Select the latest exact Executive `1D` Preview and derive the dedicated smoke identity.
10. Require applied D1 notification schema, zero active lock, zero unsafe delivery and the retained Controlled UAT
    exactly one `sent/mirrored` delivery.
11. Require no D1 delivery, Lark AI Run or Notification Log row for the exact smoke identity.
12. Create the dedicated smoke AI Run through the existing `TableSyncEngine`.
13. Validate the exact AI Run → source Reports → Settings → destination delivery chain.
14. Build one stable `lark.notification.send` job with trigger `lark_notification_runtime`.
15. Persist private Queue-attempt evidence before network mutation.
16. Send exactly one Queue REST admission.
17. Poll until D1 shows exactly one new `sent/mirrored` smoke delivery.
18. Require one new Lark Notification Log row and the smoke AI Run marked sent.
19. Observe a bounded no-admission window without sending a replay.
20. Require delivery, claim, sent time, message hash and Lark mirror evidence unchanged.
21. Reconfirm the reviewed Worker remains active at 100% and all four Settings remain active.

## Mutation budget

```text
Dedicated Lark AI Run create       maximum 1
Queue admission                    exactly 1 after attempt evidence
D1 delivery rows                   exactly +1 through existing consumer
Lark Notification Log rows         exactly +1 through existing mirror
Lark group messages                exactly +1
Worker deployment                  0
Report Settings writes             0
Automatic producer admission       0
Automation activation              0
Schedule/Cron activation           0
Webhook activation                 0
Production action                  0
```

## Why there is no replay Queue admission

The Controlled UAT already proved that an exact replay reaches D1 and cannot send a second message. This Runtime
Smoke Test tests the active Runtime boundary itself. Duplicate protection is checked by observing the completed
smoke identity without admitting another Queue message.

This keeps the smoke mutation budget at one real Queue admission and one real group message.

## Failure and uncertain transport outcome

The Terminal writes immutable private attempt evidence before the Queue POST.

After that point:

```text
blind rerun                         forbidden
second Queue admission              forbidden
replacement smoke identity          forbidden without a new reviewed workstream
automatic resend                    forbidden
```

If Cloudflare returns an error, times out, or the local controller stops after attempt evidence exists, the
operator must inspect the exact D1/Lark identity first. It must not assume the Queue admission failed.

The smoke test intentionally does not roll back the already active Runtime or Report Settings because it does not
change either of them.

## Plan command

```bash
node scripts/lark-notification-runtime-smoke-test-exact-terminal.mjs
```

## Post-merge live command

Run once only after exact-head CI, review and merge:

```bash
cd /Users/wasanjantawong/Git/social-marketing-integration-woo-diag && \
git fetch --quiet origin main && \
git switch main && \
git pull --ff-only origin main && \
CONFIRM_LARK_NOTIFICATION_RUNTIME_SMOKE_TEST=SEND_ONE_RUNTIME_EXECUTIVE_NOTIFICATION \
node scripts/lark-notification-runtime-smoke-test-exact-terminal.mjs --execute
```

## Acceptance

```text
active Worker version                 958e183e-fb0d-4795-a547-d805111ca6fc
Worker traffic                        100%
runtime / send / mirror               true / true / true
runtime mode                          runtime
active Executive Settings             4
Queue admission count                 1
delivery rows                         1 -> 2
additional delivery rows              1
additional message sends              1
exact smoke delivery rows             1
smoke delivery status                 sent
smoke mirror status                   mirrored
Notification Log rows                 1 -> 2
AI Run marked sent                    true
duplicate delivery rows               0
additional sends during observation   0
retained Controlled UAT               stable
Runtime remains active                true
Report Settings remain active         true
notification producer                 false
Worker deployment count               0
Report Settings write count           0
Automation / Schedule                 0 / 0
Production                            BLOCKED
next gate                             notification_admission_requires_separate_approval
```

## Repository implementation safety

Repository implementation and CI perform no Remote action. The only live mutation is the separately confirmed,
post-merge exact-main Terminal execution described above. No new notification engine, Queue framework, D1 writer,
Lark repository, transport, Scheduler or AI runtime is introduced.
