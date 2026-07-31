# Meta History Exact-Plan Continuation Recovery v1

## Incident

The ninth one-time Meta history attempt created and admitted the reviewed Facebook July operation:

```text
repository_head       5ff8e2cfb1f890ac2a8f2867a904b477c6456d91
operation_id          meta-facebook-history-20260701-20260731-1d12a5ec4fef
work_key              facebook:meta-facebook-history-20260701-20260731-1d12a5ec4fef
sync_run_id           meta:facebook:facebook:meta-facebook-history-20260701-20260731-1d12a5ec4fef
original_requested_at 2026-07-31T16:51:11.017Z
period                2026-07-01..2026-07-31
```

A later Terminal invocation correctly stopped at Cloudflare readiness because Remote Reliability was no
longer idle. Two read-only identity snapshots proved one active Facebook Work and one Queue operation.

The exact-operation diagnostic then proved a stable boundary across two snapshots:

```text
sync_run_status               success
D1 phase                      complete
D1 state organicHistoryDone   true
Coverage runs / invalid       2 / 0
Operation account daily rows  1
Active lock                   0
Queue operation rows          1
Lark phase                    absent
Completion phase              absent
Work lifecycle                active
```

No diagnostic performed a Remote write or Queue send.

## Required decision

The Facebook operation must not be restarted, replaced, abandoned or sent through the D1 Queue again.
The only valid first continuation is same-operation Lark parity using the retained operation ID and original
requested-at generation. After Facebook Lark completion returns Reliability to idle, the remaining operations
must resume from the persisted runtime plan bound to the retained Repository Head.

Running the ordinary Terminal from current main is invalid because current main has a different deterministic
plan identity. Manual child-launcher phase execution is also not a public recovery boundary.

## Repository-head boundary

Current main is exactly one reviewed commit after the retained Meta Head. The delta is limited to the Lark
Dashboard compatibility freeze and Record-only backfill files. Every Meta finalizer, Meta D1/Lark operator,
Shared Worker, Queue contract, Meta runtime config and Lark connector path is byte-unchanged.

The continuation must fail closed if the delta differs from the exact reviewed path set or if any critical Meta
path changes.

## Public continuation contract

`scripts/meta-history-2026-exact-plan-continuation.mjs` is the only public recovery entrypoint. It must:

1. require clean current `main == origin/main` and an explicit one-time confirmation;
2. validate the exact retained Head, operation, generation, period and persisted runtime plan;
3. validate the exact unrelated current-main delta and zero critical Meta drift;
4. validate the retained D1 summary through the existing Lark acceptance contract;
5. verify the active Worker is all false;
6. read the exact Remote boundary twice and require byte-stable normalized state;
7. build an isolated local clone whose `main` and `origin/main` both point to the retained Head;
8. reuse the original private outputs/evidence without editing them;
9. run only the Meta Lark chain for the existing Facebook operation;
10. block any Queue send when an attempt marker exists without accepted phase evidence;
11. restore and verify all-false Worker state after any activated Lark window;
12. validate accepted Facebook Lark completion and idempotent same-operation rerun;
13. invoke the existing one-command finalizer inside the isolated retained-Head clone so completed Facebook
    evidence is reused and remaining retained operations continue;
14. accept completion only from the existing `META_HISTORY_2026_COMPLETED_SAFE` final summary.

## Safety invariants

```text
Facebook Provider replay                 0
Facebook D1 Queue resend                 0
New Facebook operation ID                0
Lifecycle mutation by SQL                0
Evidence deletion/edit                   0
Current main branch/worktree mutation    0
Schedule activation                      0
Production                               blocked
```

The temporary isolated clone is local-only and removed after execution. `outputs/` remains the retained
authoritative evidence location. Credentials remain in the private `.dev.vars`/Secret authorities and are
never copied into Source or emitted in evidence.

## Acceptance criteria

```text
Exact operation identity locked                         PASS
Exact originalRequestedAt locked                        PASS
Reviewed current-main delta only                        PASS
Critical Meta path drift                                0
D1 summary accepted for Lark                            PASS
Two stable read-only Remote snapshots                   PASS
D1 complete / Lark pending / active Work                PASS
Facebook Lark same-operation completion                 PASS
Facebook Lark idempotent rerun                           PASS
Remaining retained operations                           complete
Final D1/Lark parity                                    PASS
Final active Work / Lock / Queue                        0 / 0 / 0
Worker execution flags                                  all false
Schedule                                                disabled
Production                                              blocked
```

## Verification

Required on the exact PR Head:

```text
npm ci
npm run check
node --test tests/application/meta-history-exact-plan-continuation.test.js
node --test tests/application/meta-history-exact-plan-continuation-wiring.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

Implementation and CI perform no Remote Provider, Queue, D1, Lark, Worker deployment, Schedule or Production
action.
